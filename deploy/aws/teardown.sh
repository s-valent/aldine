#!/usr/bin/env bash
# Destroy the whole Papyr AWS stack. EFS (all project data) is included — back it
# up first if it holds anything real. ECR repos are force_delete=true, so their
# images are removed automatically by destroy.
set -euo pipefail

cd "$(dirname "$0")"

echo "This will DESTROY the Papyr AWS stack, including the EFS filesystem and all"
echo "project data on it. This cannot be undone."
read -r -p 'Type "destroy" to continue: ' confirm
[ "$confirm" = "destroy" ] || { echo "Aborted."; exit 1; }

TF="$(command -v terraform || command -v tofu || true)"
[ -n "$TF" ] || { echo "✗ neither terraform nor tofu on PATH" >&2; exit 1; }
"$TF" destroy
