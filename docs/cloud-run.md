# Docker and Google Cloud Run

The `runtime` image runs compiled JavaScript as the unprivileged `node` user. It contains the API, Collector, Backtest, CLI, and generated Prisma client. It excludes development dependencies and `.env` files. The `migration` target includes the Prisma CLI and committed migrations. Both build from the pinned pnpm version and frozen lockfile; no database is needed during image creation.

## Local Docker

Keep the existing database-only workflow with `docker compose up -d`. To run the application stack instead:

```bash
docker compose -f docker-compose.yml -f compose.app.yml up --build -d
curl --fail http://localhost:8080/health
docker compose -f docker-compose.yml -f compose.app.yml run --rm api node dist/src/cli.js seed
docker compose -f docker-compose.yml -f compose.app.yml run --rm api node dist/src/collect.js --symbol VIX --from 2020-01-01
docker compose -f docker-compose.yml -f compose.app.yml run --rm api node dist/src/backtest.js --symbol VIX
```

The overlay uses the existing local database volume and runs migrations before starting the API. To stop the stack while retaining data, use the same two `-f` arguments with `down` (without `-v`). Local database credentials in Compose are for development only.

Build a Cloud Run compatible image locally on Apple Silicon with:

```bash
docker build --platform linux/amd64 --target runtime -t market-regime-monitor:local .
docker run --rm --platform linux/amd64 market-regime-monitor:local node dist/src/cli.js --help
```

The default command starts the API; override it with `node dist/src/collect.js`, `node dist/src/backtest.js`, or `node dist/src/cli.js ...` for the other modes. Supply `DATABASE_URL` at runtime for database operations. The production image uses these compiled commands, rather than the development `tsx` npm scripts.

## Cloud resources

Use a Google Cloud project with billing enabled, the Google Cloud CLI installed and authenticated, and a PostgreSQL Cloud SQL instance in the deployment region. The deployment script assumes these prerequisites exist; it does not create the database instance or its users.

Set your own values:

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export INSTANCE_CONNECTION_NAME="your-project-id:us-central1:your-postgres-instance"
export SERVICE_ACCOUNT="market-regime-monitor@${PROJECT_ID}.iam.gserviceaccount.com"
export DATABASE_SECRET="market-regime-database-url"
export SECRET_VERSION="1"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com --project="$PROJECT_ID"
gcloud artifacts repositories create market-regime-monitor --repository-format=docker --location="$REGION" --project="$PROJECT_ID"
gcloud iam service-accounts create market-regime-monitor --project="$PROJECT_ID"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SERVICE_ACCOUNT" --role=roles/cloudsql.client
```

Skip create commands for resources you already have. Create the `regime` database and a password-authenticated database user using the Cloud SQL console. This setup uses the Cloud SQL attachment and Unix socket with a public-IP-enabled instance; no authorized-network entry is needed for the managed connector. A private-IP-only instance instead requires VPC connectivity configuration, which this script does not configure.

Create a Secret Manager secret named `market-regime-database-url` in the console. Put the complete connection URL in its value:

```text
postgresql://DB_USER:URL_ENCODED_PASSWORD@localhost/regime?host=/cloudsql/PROJECT_ID:REGION:INSTANCE&schema=public&connection_limit=5&pool_timeout=20
```

Replace the placeholders, URL-encode special characters in credentials, and set `SECRET_VERSION` to the created numeric version. Do not commit this value or bake it into the image. Allow the runtime identity to read this secret:

```bash
gcloud secrets add-iam-policy-binding "$DATABASE_SECRET" --project="$PROJECT_ID" --member="serviceAccount:$SERVICE_ACCOUNT" --role=roles/secretmanager.secretAccessor
```

The deploying identity needs Cloud Build submission, Cloud Run administration, and permission to act as the runtime service account. The project's Cloud Build identity needs Artifact Registry Writer on the repository, access to the build source bucket, and permission to write build logs. Check your project's actual build identity rather than assuming a legacy default service account. Database migrations use the same database credentials here, so that user must own the application schema and be allowed to create/alter its tables.

## Build and deploy

```bash
bash scripts/deploy-cloud-run.sh
```

This command uploads the source filtered by `.gcloudignore`, builds and pushes two images via `cloudbuild.yaml`, then:

1. Deploys and executes a migration job, waiting for success.
2. Deploys an authenticated API service on port 8080.
3. Creates Collector and Backtest jobs without executing them.
4. Creates a seed job without executing it.

Each deployment uses a timestamp image tag. Set `IMAGE_TAG` for an explicit release identifier. `SERVICE_NAME`, `REPOSITORY`, and `DATABASE_SECRET` are also configurable. The defaults name the service `market-regime-monitor` and its jobs with `-migrate`, `-collect`, `-backtest`, and `-seed` suffixes. Re-running the script builds a new release and applies pending migrations before deploying it. Use backward-compatible migrations because an older API revision can still be serving during migration.

For a new database, seed and collect explicitly:

```bash
gcloud run jobs execute market-regime-monitor-seed --project="$PROJECT_ID" --region="$REGION" --wait
gcloud run jobs execute market-regime-monitor-collect --project="$PROJECT_ID" --region="$REGION" --wait
gcloud run jobs execute market-regime-monitor-backtest --project="$PROJECT_ID" --region="$REGION" --wait
```

Jobs use one task and no automatic retries. Do not overlap collector executions. Collection uses all active configured instruments and can still fail if a data provider denies access; deploying to Cloud Run does not fix Stooq availability. For periodic collection, configure Cloud Scheduler to execute the Collector job with a service account granted Cloud Run Invoker on that job. Choose a schedule and timezone before enabling it.

## API access and operations

The API is private by default because instrument creation, import, and analysis routes mutate data and the app has no application-level authentication. Grant `roles/run.invoker` to intended callers. To test as an authorized user, run:

```bash
gcloud run services proxy market-regime-monitor --project="$PROJECT_ID" --region="$REGION" --port=8081
# In another terminal:
curl --fail http://localhost:8081/health
curl --fail http://localhost:8081/api/v1/instruments
```

`/health` is a process liveness check, not a database readiness check. Confirm database access with `/api/v1/instruments` and inspect job execution logs. Runtime logs are JSON in Cloud Logging. The server honors Cloud Run's `PORT` and closes HTTP/database connections on SIGTERM.

The API is capped at three instances with concurrency 20. With `connection_limit=5`, budget database connections for those instances, old revisions during rollout, and concurrently running jobs. Increase CPU/memory/timeouts for larger backtests after measuring workload. Run imports and backtests as jobs for long workloads rather than relying on HTTP request lifetimes. Cloud SQL storage is persistent; container filesystems are not the data store. Enable database backups before production use.

To roll back application code, send traffic to the previous Cloud Run revision and redeploy job images from the previous release tag. This does not undo database migrations.

## References

- [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract)
- [Cloud SQL PostgreSQL connections from Cloud Run](https://docs.cloud.google.com/sql/docs/postgres/connect-run)
- [Secret Manager configuration](https://docs.cloud.google.com/run/docs/configuring/services/secrets)
- [Cloud Run job deployment flags](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/deploy)
