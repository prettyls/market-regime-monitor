#!/usr/bin/env bash
# Grant the Cloud Build identity permission to deploy, then create a trigger on main.
# GitHub authorization needs a browser. If the connection is not complete, finish it and re-run.
#
# Usage:
#   PROJECT_ID=your-project-id bash scripts/setup-cloud-build-trigger.sh
#
# Defaults match the current Cloud Run service: Direct VPC egress on the default
# network, the default Compute Engine service account, and the existing DATABASE_URL
# environment variable left in place. Set VPC_CONNECTOR to use a connector instead.
# Set DATABASE_SECRET to a secret name to bind DATABASE_URL from Secret Manager.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
REGION=${REGION:-us-east4}
REPOSITORY=${REPOSITORY:-market-regime-monitor}
SERVICE_NAME=${SERVICE_NAME:-market-regime-monitor}
SERVICE_ACCOUNT_ID=${SERVICE_ACCOUNT_ID:-default}
DATABASE_SECRET=${DATABASE_SECRET:-none}
SECRET_VERSION=${SECRET_VERSION:-latest}
VPC_EGRESS=${VPC_EGRESS:-private-ranges-only}
VPC_NETWORK=${VPC_NETWORK:-default}
VPC_SUBNET=${VPC_SUBNET:-default}
VPC_CONNECTOR=${VPC_CONNECTOR:-none}
CONNECTION=${CONNECTION:-github}
REPO_ID=${REPO_ID:-market-regime-monitor}
REMOTE_URI=${REMOTE_URI:-https://github.com/prettyls/market-regime-monitor.git}
TRIGGER=${TRIGGER:-market-regime-monitor-main}

if [[ "$VPC_CONNECTOR" == *'~'* || "$VPC_NETWORK" == *'~'* || "$VPC_SUBNET" == *'~'* || "$DATABASE_SECRET" == *'~'* ]]; then
  echo "VPC_CONNECTOR, VPC_NETWORK, VPC_SUBNET, and DATABASE_SECRET cannot contain '~'." >&2
  exit 1
fi

command -v gcloud >/dev/null || { echo "Install the Google Cloud CLI first." >&2; exit 1; }

echo "Enabling Cloud Run, Cloud Build, Artifact Registry, and Secret Manager"
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  --project="$PROJECT_ID"

if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating Artifact Registry repository ${REPOSITORY} in ${REGION}"
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker --location="$REGION" --project="$PROJECT_ID"
fi

project_number=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
if [[ "$SERVICE_ACCOUNT_ID" == "default" ]]; then
  runtime_sa="${project_number}-compute@developer.gserviceaccount.com"
else
  runtime_sa="${SERVICE_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$runtime_sa" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "Creating runtime service account ${runtime_sa}"
    gcloud iam service-accounts create "$SERVICE_ACCOUNT_ID" --project="$PROJECT_ID"
  fi
fi

# The project's default Cloud Build identity is the Compute Engine account, which is
# also the API runtime identity. Use a separate deployer so the API does not gain deploy rights.
DEPLOYER_ID=${DEPLOYER_ID:-market-regime-deployer}
deployer_sa="${DEPLOYER_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$deployer_sa" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating deployer service account ${deployer_sa}"
  gcloud iam service-accounts create "$DEPLOYER_ID" \
    --project="$PROJECT_ID" \
    --display-name="Market regime monitor Cloud Build deployer"
fi
echo "Cloud Build deployer: ${deployer_sa}"

# A service account can be missing from IAM for a short time after it is created.
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if "$@"; then
      return 0
    fi
    echo "Retrying after a service-account propagation delay (${attempt}/6)" >&2
    sleep 10
  done
  return 1
}

grant_project_role() {
  retry gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${deployer_sa}" \
    --role="$1" \
    --condition=None \
    --quiet >/dev/null
  echo "Granted ${1} on project ${PROJECT_ID}"
}

grant_project_role roles/run.admin
grant_project_role roles/logging.logWriter
grant_project_role roles/artifactregistry.writer

# Let Cloud Build run the deployer, and let the deployer act as the runtime identity.
service_agent="service-${project_number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
retry gcloud iam service-accounts add-iam-policy-binding "$deployer_sa" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${service_agent}" \
  --role=roles/iam.serviceAccountUser \
  --condition=None \
  --quiet >/dev/null
echo "Granted roles/iam.serviceAccountUser on ${deployer_sa} to ${service_agent}"

retry gcloud iam service-accounts add-iam-policy-binding "$runtime_sa" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${deployer_sa}" \
  --role=roles/iam.serviceAccountUser \
  --condition=None \
  --quiet >/dev/null
echo "Granted roles/iam.serviceAccountUser on ${runtime_sa}"

if [[ "$DATABASE_SECRET" != "none" ]]; then
  if ! gcloud secrets describe "$DATABASE_SECRET" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "Create secret ${DATABASE_SECRET} first. See docs/cloud-run.md." >&2
    exit 1
  fi
  for member in "$deployer_sa" "$runtime_sa"; do
    gcloud secrets add-iam-policy-binding "$DATABASE_SECRET" \
      --project="$PROJECT_ID" \
      --member="serviceAccount:${member}" \
      --role=roles/secretmanager.secretAccessor \
      --condition=None \
      --quiet >/dev/null
    echo "Granted roles/secretmanager.secretAccessor on ${DATABASE_SECRET} to ${member}"
  done
fi

# GitHub connections store the installation token in Secret Manager.
retry gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${service_agent}" \
  --role=roles/secretmanager.admin \
  --condition=None \
  --quiet >/dev/null
echo "Granted roles/secretmanager.admin on project ${PROJECT_ID} to ${service_agent}"

if ! gcloud builds connections describe "$CONNECTION" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
  echo "Creating GitHub connection ${CONNECTION} in ${REGION}."
  echo "Open the printed URL, authorize Cloud Build, install the GitHub App, then re-run this script."
  gcloud builds connections create github "$CONNECTION" --project="$PROJECT_ID" --region="$REGION"
  exit 0
fi

installation=$(gcloud builds connections describe "$CONNECTION" \
  --project="$PROJECT_ID" --region="$REGION" --format='yaml(installationState)')
stage=$(printf '%s\n' "$installation" | awk '/stage:/ { print $2; exit }')
if [[ "$stage" != "COMPLETE" ]]; then
  echo "GitHub connection ${CONNECTION} is ${stage:-incomplete}." >&2
  printf '%s\n' "$installation" >&2
  echo "Finish the installation, then re-run this script." >&2
  exit 1
fi

if ! gcloud builds repositories describe "$REPO_ID" \
  --connection="$CONNECTION" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
  echo "Linking ${REMOTE_URI}"
  gcloud builds repositories create "$REPO_ID" \
    --remote-uri="$REMOTE_URI" \
    --connection="$CONNECTION" \
    --project="$PROJECT_ID" \
    --region="$REGION"
fi

repo_resource="projects/${PROJECT_ID}/locations/${REGION}/connections/${CONNECTION}/repositories/${REPO_ID}"
substitutions="^~^_VPC_CONNECTOR=${VPC_CONNECTOR}~_VPC_NETWORK=${VPC_NETWORK}~_VPC_SUBNET=${VPC_SUBNET}~_REGION=${REGION}~_REPOSITORY=${REPOSITORY}~_SERVICE_NAME=${SERVICE_NAME}~_SERVICE_ACCOUNT_ID=${SERVICE_ACCOUNT_ID}~_DATABASE_SECRET=${DATABASE_SECRET}~_SECRET_VERSION=${SECRET_VERSION}~_VPC_EGRESS=${VPC_EGRESS}"

if gcloud builds triggers describe "$TRIGGER" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
  echo "Updating trigger ${TRIGGER}"
  gcloud builds triggers update github "$TRIGGER" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --repository="$repo_resource" \
    --branch-pattern='^main$' \
    --build-config=cloudbuild.yaml \
    --include-logs-with-status \
    --service-account="projects/${PROJECT_ID}/serviceAccounts/${deployer_sa}" \
    --description='Build and deploy market-regime-monitor on each push to main' \
    --update-substitutions="$substitutions"
else
  echo "Creating trigger ${TRIGGER}"
  gcloud builds triggers create github \
    --name="$TRIGGER" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --repository="$repo_resource" \
    --branch-pattern='^main$' \
    --build-config=cloudbuild.yaml \
    --include-logs-with-status \
    --service-account="projects/${PROJECT_ID}/serviceAccounts/${deployer_sa}" \
    --description='Build and deploy market-regime-monitor on each push to main' \
    --substitutions="$substitutions"
fi

echo "Trigger ${TRIGGER} deploys pushes to main in ${REGION}."
echo "Builds run as ${deployer_sa}. A merge to main builds cloudbuild.yaml and deploys Cloud Run."
