#!/usr/bin/env bash
# Bind pre-created Secret Manager secrets; does not execute any jobs.
set -euo pipefail
: "${PROJECT_ID:?Set PROJECT_ID}"
: "${PAPER_CONFIG_SECRET:?Set PAPER_CONFIG_SECRET to a Secret Manager secret holding PAPER_TRADING_JSON}"
: "${OPENAI_KEY_SECRET:?Set OPENAI_KEY_SECRET to a Secret Manager secret holding OPENAI_API_KEY}"
: "${PAPER_AGENT_MODEL:?Set PAPER_AGENT_MODEL to a Responses API model supporting structured output}"
REGION=${REGION:-us-east4}
SERVICE_NAME=${SERVICE_NAME:-market-regime-monitor}
for secret in "$PAPER_CONFIG_SECRET" "$OPENAI_KEY_SECRET"; do
  if [[ ! "$secret" =~ ^[a-zA-Z0-9_-]+$ ]]; then echo "Use a Secret Manager secret name, not a value or resource path" >&2; exit 1; fi
done
if [[ ! "$PAPER_AGENT_MODEL" =~ ^[a-zA-Z0-9._:-]+$ ]]; then echo "Invalid model ID" >&2; exit 1; fi
for suffix in daily paper-execute paper-report; do
  job="${SERVICE_NAME}-${suffix}"
  args=(--project="$PROJECT_ID" --region="$REGION" --update-secrets="PAPER_TRADING_JSON=${PAPER_CONFIG_SECRET}:latest")
  if [[ "$suffix" == daily ]]; then
    args+=(--update-secrets="OPENAI_API_KEY=${OPENAI_KEY_SECRET}:latest" --update-env-vars="PAPER_AGENT_MODEL=${PAPER_AGENT_MODEL}")
  fi
  gcloud run jobs update "$job" "${args[@]}" --quiet
done
echo "Paper workflow configured. Ensure runtime service accounts can access the referenced secrets. No jobs were executed."
