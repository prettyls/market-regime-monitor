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
  secret_args=(--update-secrets="DATABASE_URL=${_DATABASE_SECRET}:${_SECRET_VERSION}")
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
  --no-allow-unauthenticated \
  "${network_args[@]}" \
  "${secret_args[@]}" \
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
  --image="$app_image" --command=node --args=dist/src/collect.js,--last-day

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
  --schedule="30 7 * * *"
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

echo "Deploying job ${_SERVICE_NAME}-seed"
gcloud run jobs deploy "${_SERVICE_NAME}-seed" "${job_args[@]}" \
  --image="$app_image" --command=node --args=dist/src/cli.js,seed

echo "Release ${SHORT_SHA} deployed in ${_REGION}."
