#!/usr/bin/env bash
set -euo pipefail

# Run only after completing docs/cloud-run.md. This creates/updates cloud resources.
: "${PROJECT_ID:?Set PROJECT_ID}"
: "${INSTANCE_CONNECTION_NAME:?Set INSTANCE_CONNECTION_NAME (project:region:instance)}"
: "${SECRET_VERSION:?Set a numeric DATABASE_URL secret version}"
REGION=${REGION:-us-central1}
REPOSITORY=${REPOSITORY:-market-regime-monitor}
SERVICE_NAME=${SERVICE_NAME:-market-regime-monitor}
SERVICE_ACCOUNT=${SERVICE_ACCOUNT:-market-regime-monitor@${PROJECT_ID}.iam.gserviceaccount.com}
DATABASE_SECRET=${DATABASE_SECRET:-market-regime-database-url}
IMAGE_TAG=${IMAGE_TAG:-$(date -u +%Y%m%d-%H%M%S)}
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"

command -v gcloud >/dev/null || { echo "Install the Google Cloud CLI first." >&2; exit 1; }
cd "$(dirname "$0")/.."
gcloud builds submit . --project="$PROJECT_ID" --config=cloudbuild.yaml \
  --substitutions="_REGION=$REGION,_REPOSITORY=$REPOSITORY,_TAG=$IMAGE_TAG"

job_options=(
  --project="$PROJECT_ID" --region="$REGION"
  --service-account="$SERVICE_ACCOUNT"
  --set-cloudsql-instances="$INSTANCE_CONNECTION_NAME"
  --set-secrets="DATABASE_URL=${DATABASE_SECRET}:${SECRET_VERSION}"
  --set-env-vars=NODE_ENV=production,LOG_LEVEL=info
  --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=3600s
  --cpu=1 --memory=1Gi
)

# Stop here on any migration failure, before releasing the API or application jobs.
gcloud run jobs deploy "${SERVICE_NAME}-migrate" "${job_options[@]}" \
  --image="${IMAGE_BASE}/migration:${IMAGE_TAG}" --execute-now --wait

gcloud run deploy "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" \
  --image="${IMAGE_BASE}/app:${IMAGE_TAG}" --service-account="$SERVICE_ACCOUNT" \
  --execution-environment=gen2 --port=8080 --no-allow-unauthenticated \
  --set-cloudsql-instances="$INSTANCE_CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=${DATABASE_SECRET}:${SECRET_VERSION}" \
  --set-env-vars=NODE_ENV=production,HOST=0.0.0.0,LOG_LEVEL=info \
  --cpu=1 --memory=512Mi --min-instances=0 --max-instances=3 --concurrency=20 \
  --startup-probe=httpGet.path=/health,httpGet.port=8080,initialDelaySeconds=0,periodSeconds=10,timeoutSeconds=2,failureThreshold=12

for mode in collect backtest; do
  gcloud run jobs deploy "${SERVICE_NAME}-${mode}" "${job_options[@]}" \
    --image="${IMAGE_BASE}/app:${IMAGE_TAG}" --command=node --args="dist/src/${mode}.js"
done

# Explicitly execute this job to initialize VIX on a new database.
gcloud run jobs deploy "${SERVICE_NAME}-seed" "${job_options[@]}" \
  --image="${IMAGE_BASE}/app:${IMAGE_TAG}" --command=node --args=dist/src/cli.js,seed
