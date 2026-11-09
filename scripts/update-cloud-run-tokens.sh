#!/usr/bin/env bash
# Push Schwab tokens from .env onto Cloud Run.
# Sets SCHWAB_ACCESS_TOKEN, SCHWAB_REFRESH_TOKEN, and the client id/secret the
# process requires before it will start with a refresh token. Updates the API
# service and any collect, backtest, and seed jobs that exist.
# Does not rebuild the image. Cloud Build deploys with --update-env-vars and
# --update-secrets, so tokens applied here remain on the next full deploy.
#
# Usage:
#   PROJECT_ID=your-project-id REGION=us-east4 bash scripts/update-cloud-run-tokens.sh
#   PROJECT_ID=your-project-id REGION=us-east4 bash scripts/update-cloud-run-tokens.sh --dry-run

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
REGION=${REGION:-us-east4}
SERVICE_NAME=${SERVICE_NAME:-market-regime-monitor}
ENV_FILE=${ENV_FILE:-.env}
DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

cd "$(dirname "$0")/.."

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

read_env() {
  local key="$1"
  local file="$2"
  local line="" value=""
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" | tail -n 1 || true)
  if [[ -z "$line" ]]; then
    echo "Missing ${key} in ${file}" >&2
    exit 1
  fi
  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ ${#value} -ge 2 && "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ ${#value} -ge 2 && "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  if [[ -z "$value" ]]; then
    echo "${key} is empty in ${file}" >&2
    exit 1
  fi
  if [[ "$value" =~ ^YOUR_[A-Z0-9_]+$ ]]; then
    echo "${key} is still the .env.example placeholder" >&2
    exit 1
  fi
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "${key} contains a newline, which this script cannot pass to gcloud safely" >&2
    exit 1
  fi
  printf '%s' "$value"
}

read_env_if_present() {
  local key="$1"
  local file="$2"
  if ! grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file"; then
    return 0
  fi
  read_env "$key" "$file"
}

# One key per flag. A shared separator collides when a token ends with the
# same character the separator starts with, and gcloud then stores the next
# variable under a corrupted name.
env_update_arg() {
  local key="$1"
  local value="$2"
  local delim
  local -a candidates
  candidates=($'\037' '#' '%' '!' '~' '|' ',' '@' ':' ';' '/' '+')
  for delim in "${candidates[@]}"; do
    if [[ "$key" != *"$delim"* && "$value" != *"$delim"* ]]; then
      printf '^%s^%s=%s' "$delim" "$key" "$value"
      return 0
    fi
  done
  delim='___ENV_DELIM___'
  if [[ "$value" == *"$delim"* ]]; then
    echo "Could not find a safe gcloud delimiter for ${key}" >&2
    return 1
  fi
  printf '^%s^%s=%s' "$delim" "$key" "$value"
}

access_token=$(read_env SCHWAB_ACCESS_TOKEN "$ENV_FILE")
refresh_token=$(read_env SCHWAB_REFRESH_TOKEN "$ENV_FILE")
client_id=$(read_env_if_present SCHWAB_CLIENT_ID "$ENV_FILE")
client_id_key="SCHWAB_CLIENT_ID"
if [[ -z "$client_id" ]]; then
  client_id=$(read_env_if_present CLIENT_ID "$ENV_FILE")
  client_id_key="CLIENT_ID"
fi
client_secret=$(read_env_if_present SCHWAB_CLIENT_SECRET "$ENV_FILE")
client_secret_key="SCHWAB_CLIENT_SECRET"
if [[ -z "$client_secret" ]]; then
  client_secret=$(read_env_if_present CLIENT_SECRET "$ENV_FILE")
  client_secret_key="CLIENT_SECRET"
fi
if [[ -z "$client_id" || -z "$client_secret" ]]; then
  echo "SCHWAB_REFRESH_TOKEN requires CLIENT_ID and CLIENT_SECRET in ${ENV_FILE}. Cloud Run exits on startup without them." >&2
  exit 1
fi

update_args=(
  "$(env_update_arg SCHWAB_ACCESS_TOKEN "$access_token")"
  "$(env_update_arg SCHWAB_REFRESH_TOKEN "$refresh_token")"
  "$(env_update_arg "$client_id_key" "$client_id")"
  "$(env_update_arg "$client_secret_key" "$client_secret")"
)

job_names=("${SERVICE_NAME}-collect" "${SERVICE_NAME}-backtest" "${SERVICE_NAME}-seed")

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run. Would set SCHWAB_ACCESS_TOKEN (${#access_token} chars), SCHWAB_REFRESH_TOKEN (${#refresh_token} chars), ${client_id_key} (${#client_id} chars), and ${client_secret_key} (${#client_secret} chars) from ${ENV_FILE}."
  echo "Project ${PROJECT_ID}, region ${REGION}."
  echo "  service ${SERVICE_NAME}"
  printf '  job %s (skipped if it does not exist)\n' "${job_names[@]}"
  exit 0
fi

command -v gcloud >/dev/null || { echo "Install the Google Cloud CLI first." >&2; exit 1; }

env_names() {
  local kind="$1"
  local name="$2"
  if [[ "$kind" == "services" ]]; then
    gcloud run services describe "$name" \
      --project="$PROJECT_ID" --region="$REGION" \
      --format='value(spec.template.spec.containers[0].env.name)'
  else
    gcloud run jobs describe "$name" \
      --project="$PROJECT_ID" --region="$REGION" \
      --format='value(spec.template.spec.template.spec.containers[0].env.name)'
  fi
}

job_exists() {
  gcloud run jobs describe "$1" \
    --project="$PROJECT_ID" --region="$REGION" \
    --format='value(metadata.name)' >/dev/null 2>&1
}

apply_tokens() {
  local kind="$1"
  local name="$2"
  local -a args
  args=(
    run "$kind" update "$name"
    --project="$PROJECT_ID"
    --region="$REGION"
    --quiet
  )
  local arg
  for arg in "${update_args[@]}"; do
    args+=(--update-env-vars="$arg")
  done
  local names
  names=$(env_names "$kind" "$name" || true)
  if [[ "$names" == *"@SCHWAB_REFRESH_TOKEN"* ]]; then
    echo "Removing invalid env var @SCHWAB_REFRESH_TOKEN from ${name}"
    args+=(--remove-env-vars=@SCHWAB_REFRESH_TOKEN)
  fi
  echo "Updating Cloud Run ${kind} ${name}"
  gcloud "${args[@]}"
}

apply_tokens services "$SERVICE_NAME"

updated_jobs=()
skipped_jobs=()
for job in "${job_names[@]}"; do
  if job_exists "$job"; then
    apply_tokens jobs "$job"
    updated_jobs+=("$job")
  else
    echo "Skipping ${job}: no job with that name in ${REGION}."
    skipped_jobs+=("$job")
  fi
done

echo "Updated SCHWAB_ACCESS_TOKEN, SCHWAB_REFRESH_TOKEN, ${client_id_key}, and ${client_secret_key} on service ${SERVICE_NAME}."
if [[ ${#updated_jobs[@]} -gt 0 ]]; then
  echo "Updated jobs: ${updated_jobs[*]}."
fi
if [[ ${#skipped_jobs[@]} -gt 0 ]]; then
  echo "Skipped missing jobs: ${skipped_jobs[*]}."
fi
echo "The API revision rolls out now. Updated jobs use the new tokens on their next execution."
