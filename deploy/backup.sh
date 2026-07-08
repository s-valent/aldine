#!/usr/bin/env bash
# Snapshot Papyr's data + secrets volumes to a single tarball.
# Usage: deploy/backup.sh [output.tar.gz]   (run from anywhere; needs docker)
set -euo pipefail

PROJECT="${PAPYR_PROJECT:-papyr}"
OUT="${1:-papyr-backup-$(date +%Y%m%d-%H%M%S).tar.gz}"
OUT_DIR="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd || pwd)"
OUT_FILE="$(basename "$OUT")"

# Volumes are created as <project>_<name> by docker compose.
DATA_VOL="${PROJECT}_papyr-data"
SECRETS_VOL="${PROJECT}_papyr-secrets"

for v in "$DATA_VOL" "$SECRETS_VOL"; do
  if ! docker volume inspect "$v" >/dev/null 2>&1; then
    echo "error: volume '$v' not found (set PAPYR_PROJECT if your compose project name differs)" >&2
    exit 1
  fi
done

docker run --rm \
  -v "${DATA_VOL}":/data:ro \
  -v "${SECRETS_VOL}":/secrets:ro \
  -v "${OUT_DIR}":/backup \
  alpine tar czf "/backup/${OUT_FILE}" -C / data secrets

echo "Backup written: ${OUT_DIR}/${OUT_FILE}"
echo "Contains: /data (projects + git repos) and /secrets (users, sessions, API keys, comments)."
