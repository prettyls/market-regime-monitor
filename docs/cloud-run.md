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

Use a Google Cloud project with billing enabled, the Google Cloud CLI installed and authenticated, and an AlloyDB PostgreSQL instance reachable from Cloud Run over private networking. The deployment script assumes these prerequisites exist; it does not create the database instance or its users.

Set your own values:

```bash
export PROJECT_ID="your-project-id"
export REGION="us-east4"
export VPC_EGRESS="private-ranges-only"
export VPC_NETWORK="default"
export VPC_SUBNET="default"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com --project="$PROJECT_ID"
gcloud artifacts repositories create market-regime-monitor --repository-format=docker --location="$REGION" --project="$PROJECT_ID"
```

Skip create commands for resources you already have. Create the application database and a password-authenticated database user in AlloyDB. The current service reaches that private IP with Direct VPC egress on the `default` network and `default` subnet (`private-ranges-only`). A VPC connector is optional: set `VPC_CONNECTOR` to its resource name and leave `VPC_NETWORK` unused. Cloud Run cannot use a connector and Direct VPC egress on the same revision.

Create a Secret Manager secret named `market-regime-database-url` in the console. Put the complete connection URL in its value:

```text
postgresql://DB_USER:DB_PASSWORD@ALLOYDB_PRIVATE_IP:5432/postgres?schema=public&sslmode=require
```

Replace the placeholders and URL-encode special characters in credentials. Do not commit this value or bake it into the image. The current API and migration job already have `DATABASE_URL` set as an environment variable, and a deploy leaves that value in place. To bind the secret instead, set `DATABASE_SECRET=market-regime-database-url`. That replaces the plain `DATABASE_URL` variable on the next release. `SECRET_VERSION` defaults to `latest`; set it to a number to pin one version. Allow the runtime identity to read this secret:

```bash
export DATABASE_SECRET="market-regime-database-url"
export SERVICE_ACCOUNT="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding "$DATABASE_SECRET" --project="$PROJECT_ID" --member="serviceAccount:$SERVICE_ACCOUNT" --role=roles/secretmanager.secretAccessor
```

The deploying identity needs Cloud Build submission, Cloud Run administration, and permission to act as the runtime service account. Database migrations use the same database credentials here, so that user must own the application schema and be allowed to create/alter its tables.

[deploy-cloud-run.sh](../scripts/deploy-cloud-run.sh) defaults to Direct VPC egress in `us-east4` and the default Compute Engine service account. Set `REGION`, `VPC_NETWORK`, or `VPC_SUBNET` when the resources differ. Set `SERVICE_ACCOUNT_ID` to a service account name in this project to run as that account instead of the default Compute Engine account.

## Build and deploy

```bash
bash scripts/deploy-cloud-run.sh
```

This uploads the source filtered by `.gcloudignore` and runs [cloudbuild.yaml](../cloudbuild.yaml). The build runs the image tests, pushes the runtime and migration images, then:

1. Deploys and executes a migration job, waiting for success.
2. Deploys an authenticated API service on port 8080.
3. Creates Collector, daily-bar, and Backtest jobs without executing them.
4. Creates a seed job without executing it.
5. Creates or updates a Cloud Scheduler job that runs the daily-bar job at 7:30am America/New_York.

A failed migration stops the build before the API or the other jobs change. The manual command tags images with a UTC timestamp. Set `IMAGE_TAG` for an explicit release identifier. `SERVICE_NAME`, `REPOSITORY`, `DATABASE_SECRET`, and `SECRET_VERSION` are also configurable. The defaults name the service `market-regime-monitor` and its jobs with `-migrate`, `-collect`, `-daily`, `-backtest`, and `-seed` suffixes. The `-daily` job runs `node dist/src/collect.js --last-day`. Re-running the script builds a new release and applies pending migrations before deploying it. Use backward-compatible migrations because an older API revision can still be serving during migration.

Deploys set `NODE_ENV`, `LOG_LEVEL`, and `HOST` and leave every other environment variable in place, including `DATABASE_URL` and the Schwab tokens applied with [update-cloud-run-tokens.sh](../scripts/update-cloud-run-tokens.sh). Collector, daily-bar, Backtest, and Seed jobs created for the first time do not inherit those variables. Apply the tokens again after they exist, and set `DATABASE_URL` on each new job or set `DATABASE_SECRET` so the next deploy binds it.

For a new database, seed and collect explicitly:

```bash
gcloud run jobs execute market-regime-monitor-seed --project="$PROJECT_ID" --region="$REGION" --wait
gcloud run jobs execute market-regime-monitor-collect --project="$PROJECT_ID" --region="$REGION" --wait
gcloud run jobs execute market-regime-monitor-backtest --project="$PROJECT_ID" --region="$REGION" --wait
```

Jobs use one task and no automatic retries. Do not overlap collector executions. Collection uses all active configured instruments and can still fail if a data provider denies access.

Each deploy ensures Cloud Scheduler job `market-regime-monitor-daily` posts to the Cloud Run jobs API at 07:30 America/New_York (`30 7 * * *`). That executes `market-regime-monitor-daily`, which imports the previous weekday's daily bar for every active instrument and then analyzes it. Saturday, Sunday, and Monday mornings import Friday. A market holiday returns no bar and skips analysis. Re-run [setup-cloud-build-trigger.sh](../scripts/setup-cloud-build-trigger.sh) once before the first scheduled deploy so the deployer can manage Cloud Scheduler and Cloud Scheduler can mint a token for the runtime service account. The runtime account receives `roles/run.invoker` on the daily job during deploy.

## Deploy on each merge to main

Connect GitHub once, then a push to `main` runs the same `cloudbuild.yaml`. The image tag is the commit's short SHA.

```bash
bash scripts/setup-cloud-build-trigger.sh
```

The script enables the deploy APIs and creates the Artifact Registry repository when it is missing. This project's default Cloud Build identity is the Compute Engine service account, which is also the API runtime identity, so the script creates `market-regime-deployer` and runs the trigger as that account. It grants the deployer:

- `roles/run.admin`, `roles/cloudscheduler.admin`, and `roles/logging.logWriter` on the project
- `roles/artifactregistry.writer` on the project
- `roles/iam.serviceAccountUser` on the runtime service account

The Cloud Scheduler service agent gets `roles/iam.serviceAccountTokenCreator` on the runtime service account so the 7:30am job can execute. The Cloud Build service agent gets `roles/iam.serviceAccountUser` on the deployer so it can start those builds, and `roles/secretmanager.admin` so it can store the GitHub connection token. With `DATABASE_SECRET` set to a secret name, the script also grants `roles/secretmanager.secretAccessor` on that secret to the deployer and the runtime service account. The default `none` skips that grant.

It then links `https://github.com/prettyls/market-regime-monitor.git` and creates the trigger `market-regime-monitor-main` for `^main$`. The first run prints a GitHub authorization URL. Install the Cloud Build GitHub App, then run the script again. The trigger stores the network, service account, and secret settings. Build logs are reported back to the GitHub commit.

The trigger's service account is `market-regime-deployer@PROJECT_ID.iam.gserviceaccount.com`. That account is the deployer.

## API access and operations

The API is private by default because instrument creation, import, and analysis routes mutate data and the app has no application-level authentication. Grant `roles/run.invoker` to intended callers. To test as an authorized user, run:

```bash
gcloud run services proxy market-regime-monitor --project="$PROJECT_ID" --region="$REGION" --port=8081
# In another terminal:
curl --fail http://localhost:8081/health
curl --fail http://localhost:8081/api/v1/instruments
```

`/health` is a process liveness check, not a database readiness check. Confirm database access with `/api/v1/instruments` and inspect job execution logs. Runtime logs are JSON in Cloud Logging. The server honors Cloud Run's `PORT` and closes HTTP/database connections on SIGTERM.

The API is capped at three instances with concurrency 20. With `connection_limit=5`, budget database connections for those instances, old revisions during rollout, and concurrently running jobs. Increase CPU/memory/timeouts for larger backtests after measuring workload. Run imports and backtests as jobs for long workloads rather than relying on HTTP request lifetimes. AlloyDB storage is persistent; container filesystems are not the data store. Enable database backups before production use.

To roll back application code, send traffic to the previous Cloud Run revision and redeploy job images from the previous release tag. This does not undo database migrations.

## References

- [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract)
- [AlloyDB connectivity options](https://cloud.google.com/alloydb/docs/connectivity-overview)
- [Secret Manager configuration](https://docs.cloud.google.com/run/docs/configuring/services/secrets)
- [Cloud Run job deployment flags](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/deploy)
- [Cloud Build triggers](https://cloud.google.com/build/docs/automating-builds/create-manage-triggers)
- [Cloud Build GitHub connection](https://cloud.google.com/build/docs/automating-builds/github/connect-repo-github)

## Public access and administrator login

The deploy script now uses `--allow-unauthenticated`. Cloud Run's public access setting applies to the service; the application enforces route permissions. Deploy the new application before opening an older revision to public access.

- Public: `/`, `/analysis?symbol=SPY`, `/health`, and GET/HEAD requests for instrument names, latest results, saved individual analysis and alerts.
- Administrator: `/admin`, `/instruments/new`, instrument creation, imports, analysis execution, history downloads, data, signals, backtests and provider token status.
- Agent endpoints retain their separate scoped bearer authentication.

Visit `/admin` or `/instruments/new` to use the browser's Basic login prompt. The default username is `admin`; override with `ADMIN_USERNAME`. Set `ADMIN_PASSWORD` to a unique random value of at least 32 characters. Missing passwords disable administrator access; short passwords prevent startup. Use HTTPS; browser Basic credentials persist until cleared or the browser session ends. Cross-origin writes are rejected. Never put the password in a URL or frontend code.

Create a Secret Manager secret named `market-regime-admin-password` containing your generated password, without a trailing newline, and grant the runtime service account `roles/secretmanager.secretAccessor` on that secret, as with the database secret above. Bind it to the API service:

```bash
gcloud run services update market-regime-monitor \
  --project="$PROJECT_ID" --region="$REGION" \
  --update-secrets=ADMIN_PASSWORD=market-regime-admin-password:latest
```

The deploy script preserves this existing secret binding. Jobs do not need the admin password. REST clients use HTTP Basic authentication for admin operations; Google identity tokens do not authorize these operations.

Public pages read saved results and do not trigger provider downloads or analysis computation. Scheduled collection continues to refresh results. Successful public JSON reads are cached per instance for 15 seconds, up to 128 entries of 256 KiB each; writes clear the local cache. Other instances may show older results for up to 15 seconds. The public instrument list exposes only symbol, name and kind. Provider token polling runs only on the admin page.

The existing service limits remain 1 CPU, 512 MiB, concurrency 20, and maximum 3 instances. This cache reduces repeat database reads; it is not a rate limiter or DDoS protection. If public traffic exhausts resources, measure latency and memory, then tune concurrency and consider a load balancer with Cloud Armor rate limiting. Maximum instances limits scaling, not a strict spending cap.

References: [Cloud Run public access](https://docs.cloud.google.com/run/docs/authenticating/public), [concurrency](https://docs.cloud.google.com/run/docs/about-concurrency), [maximum instance limits](https://docs.cloud.google.com/run/docs/configuring/max-instances-limits).
