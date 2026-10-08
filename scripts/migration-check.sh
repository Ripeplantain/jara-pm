#!/usr/bin/env bash
# Apply every migration to a disposable SQLite database and verify the expected schema exists.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

(cd "$ROOT/backend" && DATABASE_PATH="$TMP_DIR/migration-check.db" \
  .venv/bin/python -m alembic upgrade head)
DATABASE_PATH="$TMP_DIR/migration-check.db" "$ROOT/backend/.venv/bin/python" - <<'PY'
import os
import sqlite3

db = sqlite3.connect(os.environ["DATABASE_PATH"])
tables = {row[0] for row in db.execute("select name from sqlite_master where type='table'")}
required = {"users", "workspaces", "cards", "notifications", "ai_proposals", "ai_usage"}
missing = required - tables
if missing:
    raise SystemExit(f"missing tables: {sorted(missing)}")
print(f"migration check passed: {len(tables)} tables")
PY
