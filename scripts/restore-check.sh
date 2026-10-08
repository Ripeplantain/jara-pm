#!/usr/bin/env bash
# Validate a backup without replacing the live database.
# Usage: BACKUP_ENCRYPTION_KEY_FILE=/secure/kobi-backup.key ./scripts/restore-check.sh path/to/backup.db[.enc]
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 path/to/backup.db" >&2
  exit 2
fi

BACKUP="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
if [ ! -f "$BACKUP" ]; then
  echo "backup not found: $BACKUP" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
RESTORE_DB="$BACKUP"
if [[ "$BACKUP" == *.enc ]]; then
  if [ -z "${BACKUP_ENCRYPTION_KEY_FILE:-}" ] || [ ! -f "$BACKUP_ENCRYPTION_KEY_FILE" ]; then
    echo "encrypted backup requires BACKUP_ENCRYPTION_KEY_FILE" >&2
    exit 2
  fi
  RESTORE_DB="$TMP_DIR/backup.db"
  openssl enc -d -aes-256-cbc -pbkdf2 -in "$BACKUP" -out "$RESTORE_DB" \
    -pass "file:$BACKUP_ENCRYPTION_KEY_FILE"
fi
CHECK_DB="$TMP_DIR/check.db"
cp "$RESTORE_DB" "$CHECK_DB"
chmod 666 "$CHECK_DB"

docker compose run --rm --no-deps --user root \
  -v "$CHECK_DB:/restore/backup.db" \
  backend python -c '
import sqlite3
db = sqlite3.connect("/restore/backup.db")
integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
users = db.execute("SELECT count(*) FROM users").fetchone()[0]
workspaces = db.execute("SELECT count(*) FROM workspaces").fetchone()[0]
cards = db.execute("SELECT count(*) FROM cards").fetchone()[0]
members = db.execute("SELECT count(*) FROM workspace_members").fetchone()[0]
activities = db.execute("SELECT count(*) FROM activities").fetchone()[0]
notifications = db.execute("SELECT count(*) FROM notifications").fetchone()[0]
print(
    f"integrity={integrity} users={users} workspaces={workspaces} members={members} "
    f"cards={cards} activities={activities} notifications={notifications}"
)
if integrity != "ok":
    raise SystemExit(1)
'
