#!/usr/bin/env bash
# Create a consistent SQLite backup from the running backend container.
# Usage: BACKUP_ENCRYPTION_KEY_FILE=/secure/kobi-backup.key ./scripts/backup.sh [output-path]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
if [ -n "${BACKUP_ENCRYPTION_KEY_FILE:-}" ]; then
  OUTPUT="${1:-$ROOT/backups/kobi-$(date -u +%Y%m%dT%H%M%SZ).db.enc}"
else
  OUTPUT="${1:-$ROOT/backups/kobi-$(date -u +%Y%m%dT%H%M%SZ).db}"
fi
mkdir -p "$(dirname "$OUTPUT")"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

docker compose exec -T backend python -c '
import sqlite3
source = sqlite3.connect("/data/app.db")
target = sqlite3.connect("/tmp/kobi-backup.db")
source.backup(target)
target.close()
source.close()
'
docker compose cp backend:/tmp/kobi-backup.db "$TMP_DIR/backup.db"
if [ -n "${BACKUP_ENCRYPTION_KEY_FILE:-}" ]; then
  if [ ! -f "$BACKUP_ENCRYPTION_KEY_FILE" ]; then
    echo "encryption key file not found: $BACKUP_ENCRYPTION_KEY_FILE" >&2
    exit 2
  fi
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "$TMP_DIR/backup.db" \
    -out "$OUTPUT" -pass "file:$BACKUP_ENCRYPTION_KEY_FILE"
else
  cp "$TMP_DIR/backup.db" "$OUTPUT"
fi
find "$(dirname "$OUTPUT")" -maxdepth 1 -type f \
  \( -name 'kobi-*.db' -o -name 'kobi-*.db.enc' \) -mtime "+$RETENTION_DAYS" -delete
echo "backup written to $OUTPUT"
