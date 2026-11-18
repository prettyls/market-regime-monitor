#!/usr/bin/env bash
# Deploy step for cloudbuild.yaml. Cloud Build exports the variables below.
# Migration must succeed before the API or the other jobs are updated.
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${PROJECT_NUMBER:?PROJECT_NUMBER is required}"
: "${SHORT_SHA:?SHORT_SHA is required}"
: "${_REGION:?_REGION is required}"
: "${_REPOSITORY:?_REPOSITORY is required}"
: "${_SERVICE_NAME:?_SERVICE_NAME is required}"
: "${_SERVICE_ACCOUNT_ID:?_SERVICE_ACCOUNT_ID is required}"
: "${_DATABASE_SECRET:?_DATABASE_SECRET is required}"
: "${_SECRET_VERSION:?_SECRET_VERSION is required}"
: "${_VPC_EGRESS:?_VPC_EGRESS is required}"
: "${_VPC_NETWORK:?_VPC_NETWORK is required}"
: "${_VPC_SUBNET:?_VPC_SUBNET is required}"
: "${_VPC_CONNECTOR:?_VPC_CONNECTOR is required}"

if [[ "${_SERVICE_ACCOUNT_ID}" == "default" ]]; then
  service_account="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
else
  service_account="${_SERVICE_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
fi

network_args=(--vpc-egress="${_VPC_EGRESS}")
if [[ "${_VPC_CONNECTOR}" != "none" ]]; then
  network_args+=(--vpc-connector="${_VPC_CONNECTOR}")
else
  network_args+=(--network="${_VPC_NETWORK}" --subnet="${_VPC_SUBNET}")
fi

secret_args=()
if [[ "${_DATABASE_SECRET}" != "none" ]]; then
  secret_args=(--remove-env-vars=DATABASE_URL --update-secrets="DATABASE_URL=${_DATABASE_SECRET}:${_SECRET_VERSION}")
fi

# Optional named credential secrets keep new jobs configured on every release.
market_secret_args=()
trade_secret_args=()
agent_secret_args=()
if [[ "${_CREDENTIAL_SECRET_PREFIX:-none}" != "none" ]]; then
  for key in CLIENT_ID CLIENT_SECRET ACCESS_TOKEN REFRESH_TOKEN; do
    lower_key=$(printf '%s' "$key" | tr '[:upper:]' '[:lower:]')
    market_secret_args+=(--update-secrets="SCHWAB_MARKET_${key}=${_CREDENTIAL_SECRET_PREFIX}-market-${lower_key}:latest")
  done
  for key in CLIENT_ID CLIENT_SECRET ACCESS_TOKEN; do
    lower_key=$(printf '%s' "$key" | tr '[:upper:]' '[:lower:]')
    trade_secret_args+=(--update-secrets="SCHWAB_TRADE_${key}=${_CREDENTIAL_SECRET_PREFIX}-trade-${lower_key}:latest")
  done
  if [[ "${_TRADE_REFRESH_ENABLED:-false}" == "true" ]]; then
    trade_secret_args+=(--update-secrets="SCHWAB_TRADE_REFRESH_TOKEN=${_CREDENTIAL_SECRET_PREFIX}-trade-refresh_token:latest" --update-env-vars=SCHWAB_TRADE_TOKEN_STORE=database)
  fi
  agent_secret_args+=(--update-secrets="AGENT_CREDENTIALS_JSON=${_CREDENTIAL_SECRET_PREFIX}-agents:latest")
fi

image_base="${_REGION}-docker.pkg.dev/${PROJECT_ID}/${_REPOSITORY}"
app_image="${image_base}/app:${SHORT_SHA}"
migration_image="${image_base}/migration:${SHORT_SHA}"

job_args=(
  --project="$PROJECT_ID"
  --region="${_REGION}"
  --service-account="$service_account"
  "${network_args[@]}"
  "${secret_args[@]}"
  "${market_secret_args[@]}"
  --update-env-vars=NODE_ENV=production,LOG_LEVEL=info
  --tasks=1
  --parallelism=1
  --max-retries=0
  --task-timeout=3600s
  --cpu=1
  --memory=1Gi
  --quiet
)

echo "Deploying migration job ${_SERVICE_NAME}-migrate from ${migration_image}"
gcloud run jobs deploy "${_SERVICE_NAME}-migrate" "${job_args[@]}" \
  --image="$migration_image" --execute-now --wait

echo "Deploying API service ${_SERVICE_NAME} from ${app_image}"
gcloud run deploy "${_SERVICE_NAME}" \
  --project="$PROJECT_ID" \
  --region="${_REGION}" \
  --image="$app_image" \
  --service-account="$service_account" \
  --execution-environment=gen2 \
  --port=8080 \
  --allow-unauthenticated \
  "${network_args[@]}" \
  "${secret_args[@]}" \
  "${market_secret_args[@]}" \
  "${trade_secret_args[@]}" \
  "${agent_secret_args[@]}" \
  --update-env-vars=NODE_ENV=production,HOST=0.0.0.0,LOG_LEVEL=info \
  --cpu=1 \
  --memory=512Mi \
  --min-instances=0 \
  --max-instances=3 \
  --concurrency=20 \
  --startup-probe=httpGet.path=/health,httpGet.port=8080,initialDelaySeconds=0,periodSeconds=10,timeoutSeconds=2,failureThreshold=12 \
  --quiet

for mode in collect backtest; do
  echo "Deploying job ${_SERVICE_NAME}-${mode}"
  gcloud run jobs deploy "${_SERVICE_NAME}-${mode}" "${job_args[@]}" \
    --image="$app_image" --command=node --args="dist/src/${mode}.js"
done

echo "Deploying job ${_SERVICE_NAME}-daily"
gcloud run jobs deploy "${_SERVICE_NAME}-daily" "${job_args[@]}" \
  --image="$app_image" --command=node --args=dist/src/daily.js,--last-day

echo "Granting ${service_account} permission to execute ${_SERVICE_NAME}-daily"
gcloud run jobs add-iam-policy-binding "${_SERVICE_NAME}-daily" \
  --project="$PROJECT_ID" \
  --region="${_REGION}" \
  --member="serviceAccount:${service_account}" \
  --role="roles/run.invoker" \
  --quiet >/dev/null

daily_uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${_REGION}/jobs/${_SERVICE_NAME}-daily:run"
scheduler_args=(
  --project="$PROJECT_ID"
  --location="${_REGION}"
  --schedule="30 7 * * 1-5"
  --time-zone="America/New_York"
  --uri="$daily_uri"
  --http-method=POST
  --oauth-service-account-email="$service_account"
  --description="Import the previous weekday daily bar for each active instrument at 7:30am Eastern"
)
if gcloud scheduler jobs describe "${_SERVICE_NAME}-daily" --project="$PROJECT_ID" --location="${_REGION}" >/dev/null 2>&1; then
  echo "Updating Cloud Scheduler job ${_SERVICE_NAME}-daily"
  gcloud scheduler jobs update http "${_SERVICE_NAME}-daily" "${scheduler_args[@]}"
else
  echo "Creating Cloud Scheduler job ${_SERVICE_NAME}-daily"
  gcloud scheduler jobs create http "${_SERVICE_NAME}-daily" "${scheduler_args[@]}"
fi

# Independent execution/report schedules only consume persisted, successful plans.
for phase in execute report; do
  paper_job="${_SERVICE_NAME}-paper-${phase}"
  gcloud run jobs deploy "$paper_job" "${job_args[@]}" \
    --image="$app_image" --command=node --args="dist/src/paper-job.js,${phase}"
  gcloud run jobs add-iam-policy-binding "$paper_job" \
    --project="$PROJECT_ID" --region="${_REGION}" \
    --member="serviceAccount:${service_account}" --role=roles/run.invoker --quiet >/dev/null
  if [[ "$phase" == "execute" ]]; then cron="35 9 * * 1-5"; else cron="15 16 * * 1-5"; fi
  paper_scheduler_args=(--project="$PROJECT_ID" --location="${_REGION}"
    --schedule="$cron" --time-zone=America/New_York --http-method=POST
    --uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${_REGION}/jobs/${paper_job}:run"
    --oauth-service-account-email="$service_account"
    --description="Paper-only ${phase}; closed sessions are skipped")
  if gcloud scheduler jobs describe "$paper_job" --project="$PROJECT_ID" --location="${_REGION}" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$paper_job" "${paper_scheduler_args[@]}"
  else
    gcloud scheduler jobs create http "$paper_job" "${paper_scheduler_args[@]}"
  fi
done

echo "Deploying job ${_SERVICE_NAME}-seed"
gcloud run jobs deploy "${_SERVICE_NAME}-seed" "${job_args[@]}" \
  --image="$app_image" --command=node --args=dist/src/cli.js,seed

# Trade tokens are persisted in PostgreSQL and read by all API replicas.
trade_job="${_SERVICE_NAME}-refresh-trade-token"
gcloud run jobs deploy "$trade_job" "${job_args[@]}" \
  "${trade_secret_args[@]}" \
  --image="$app_image" --command=node --args=dist/src/refresh-trade-token.js \
  --update-env-vars=SCHWAB_TRADE_TOKEN_STORE=database
gcloud run jobs add-iam-policy-binding "$trade_job" \
  --project="$PROJECT_ID" --region="${_REGION}" \
  --member="serviceAccount:${service_account}" --role=roles/run.invoker --quiet >/dev/null
trade_scheduler_args=(--project="$PROJECT_ID" --location="${_REGION}"
  --schedule="*/20 * * * *" --time-zone=America/New_York --http-method=POST
  --uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${_REGION}/jobs/${trade_job}:run"
  --oauth-service-account-email="$service_account"
  --description="Refresh and persist Schwab Accounts and Trading access token every 20 minutes")
if gcloud scheduler jobs describe "$trade_job" --project="$PROJECT_ID" --location="${_REGION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$trade_job" "${trade_scheduler_args[@]}"
else
  gcloud scheduler jobs create http "$trade_job" "${trade_scheduler_args[@]}"
fi
trade_scheduler_state=$(gcloud scheduler jobs describe "$trade_job" --project="$PROJECT_ID" --location="${_REGION}" --format='value(state)')
if [[ "${_TRADE_REFRESH_ENABLED:-false}" == "true" && "$trade_scheduler_state" == "PAUSED" ]]; then
  gcloud scheduler jobs resume "$trade_job" --project="$PROJECT_ID" --location="${_REGION}" --quiet
elif [[ "${_TRADE_REFRESH_ENABLED:-false}" != "true" && "$trade_scheduler_state" != "PAUSED" ]]; then
  gcloud scheduler jobs pause "$trade_job" --project="$PROJECT_ID" --location="${_REGION}" --quiet
fi

# The public calendar serves the last successful private transaction sync.
if [[ "${_DATABASE_SECRET}" != "none" && "${_CREDENTIAL_SECRET_PREFIX:-none}" != "none" ]]; then
  calendar_job="${_SERVICE_NAME}-calendar-sync"
  gcloud run jobs deploy "$calendar_job" "${job_args[@]}" "${trade_secret_args[@]}" \
    --image="$app_image" --command=node --args=dist/src/calendar-sync-job.js
  gcloud run jobs add-iam-policy-binding "$calendar_job" \
    --project="$PROJECT_ID" --region="${_REGION}" \
    --member="serviceAccount:${service_account}" --role=roles/run.invoker --quiet >/dev/null
  calendar_scheduler_args=(--project="$PROJECT_ID" --location="${_REGION}"
    --schedule="30 17 * * 1-5" --time-zone=America/New_York --http-method=POST
    --uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${_REGION}/jobs/${calendar_job}:run"
    --oauth-service-account-email="$service_account"
    --description="Sync Schwab transactions and publish the realized P/L calendar")
  if gcloud scheduler jobs describe "$calendar_job" --project="$PROJECT_ID" --location="${_REGION}" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$calendar_job" "${calendar_scheduler_args[@]}"
  else
    gcloud scheduler jobs create http "$calendar_job" "${calendar_scheduler_args[@]}"
  fi
fi

echo "Release ${SHORT_SHA} deployed in ${_REGION}."
