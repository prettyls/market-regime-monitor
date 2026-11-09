#!/usr/bin/env bash
set -euo pipefail

# Submits cloudbuild.yaml, which builds both images, runs migrations, and deploys Cloud Run.
# Run only after completing docs/cloud-run.md. This creates/updates cloud resources.
: "${PROJECT_ID:?Set PROJECT_ID}"
REGION=${REGION:-us-east4}
REPOSITORY=${REPOSITORY:-market-regime-monitor}
SERVICE_NAME=${SERVICE_NAME:-market-regime-monitor}
if [[ -z "${SERVICE_ACCOUNT_ID:-}" && -n "${SERVICE_ACCOUNT:-}" ]]; then
  if [[ "$SERVICE_ACCOUNT" == *-compute@developer.gserviceaccount.com ]]; then
    SERVICE_ACCOUNT_ID=default
  else
    SERVICE_ACCOUNT_ID=${SERVICE_ACCOUNT%%@*}
  fi
fi
SERVICE_ACCOUNT_ID=${SERVICE_ACCOUNT_ID:-default}
DATABASE_SECRET=${DATABASE_SECRET:-none}
SECRET_VERSION=${SECRET_VERSION:-latest}
VPC_EGRESS=${VPC_EGRESS:-private-ranges-only}
VPC_NETWORK=${VPC_NETWORK:-default}
VPC_SUBNET=${VPC_SUBNET:-default}
VPC_CONNECTOR=${VPC_CONNECTOR:-none}
IMAGE_TAG=${IMAGE_TAG:-$(date -u +%Y%m%d-%H%M%S)}

if [[ "$VPC_CONNECTOR" == *'~'* || "$IMAGE_TAG" == *'~'* || "$REGION" == *'~'* || "$VPC_NETWORK" == *'~'* || "$VPC_SUBNET" == *'~'* ]]; then
  echo "VPC_CONNECTOR, VPC_NETWORK, VPC_SUBNET, IMAGE_TAG, and REGION cannot contain '~'." >&2
  exit 1
fi

command -v gcloud >/dev/null || { echo "Install the Google Cloud CLI first." >&2; exit 1; }
cd "$(dirname "$0")/.."

# SHORT_SHA is the image tag. A main-branch trigger sets it from the commit.
gcloud builds submit . --project="$PROJECT_ID" --config=cloudbuild.yaml \
  --substitutions="^~^SHORT_SHA=${IMAGE_TAG}~_REGION=${REGION}~_REPOSITORY=${REPOSITORY}~_SERVICE_NAME=${SERVICE_NAME}~_SERVICE_ACCOUNT_ID=${SERVICE_ACCOUNT_ID}~_DATABASE_SECRET=${DATABASE_SECRET}~_SECRET_VERSION=${SECRET_VERSION}~_VPC_CONNECTOR=${VPC_CONNECTOR}~_VPC_EGRESS=${VPC_EGRESS}~_VPC_NETWORK=${VPC_NETWORK}~_VPC_SUBNET=${VPC_SUBNET}"
