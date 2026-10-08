# Kobi operations runbook

## Deployment

The beta topology is one frontend container and one backend container behind HTTPS, with one
backend worker and one persistent SQLite volume. The backend is not published to the internet.
Use separate `.env` files for staging and production; never put `BACKEND_JWT_SECRET`, `AUTH_SECRET`,
`LLM_API_KEY`, or `RESEND_API_KEY` in the frontend environment.

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
curl -fsS https://YOUR_HOST/api/health
```

Stage changes with a separate database volume and secret set:

```sh
docker compose -f docker-compose.yml -f docker-compose.staging.yml up --build -d
curl -fsS https://STAGING_HOST/api/health
```

Set `AUTH_URL` and `FRONTEND_ORIGIN` to the HTTPS origin. `RESEND_FROM_EMAIL` must be a verified
sender, and invitation, verification and recovery messages are sent only by the backend.

## Backup and restore

Back up before migrations and before every release:

```sh
BACKUP_ENCRYPTION_KEY_FILE=/secure/kobi-backup.key bash scripts/backup.sh
BACKUP_ENCRYPTION_KEY_FILE=/secure/kobi-backup.key bash scripts/restore-check.sh backups/kobi-20261008T120000Z.db.enc
bash scripts/migration-check.sh
env -C backend .venv/bin/python -m pytest -q tests/test_backup_restore.py
```

Backups use AES-256-CBC with PBKDF2 when `BACKUP_ENCRYPTION_KEY_FILE` is set, default to a 30-day
retention window, and must be copied off the host. A restore is an operator action: stop the stack, preserve the existing volume, replace
`app.db` with a verified backup, start the stack, and check `/api/health` plus sign-in, workspace
membership, cards, activity and notifications. Never run a restore check against the live volume.

SQLite constraints are intentional for the invite-only beta: one replica, one writer, persistent
storage. Move to PostgreSQL before adding replicas or materially increasing concurrency.

## Monitoring and incident response

- Container health: `/api/health`, frontend availability, restart count and disk space.
- Application logs: request id, method, redacted path, status and duration. Invitation tokens,
  passwords, hashes, email bodies and LLM prompts must not be logged.
- Provider checks: Resend delivery failures are logged generically and leave invitations retryable;
  LLM failures return a clear provider error without mutating the board.
- Alert on repeated 5xx/429 responses, failed health checks, database errors, low disk space and
  backup/restore-check failures.

The authenticated `/api/health/metrics` endpoint exposes redacted process counters for request
errors, auth failures, rate limits, and latency. Workspace AI usage also records monthly actions,
provider calls, latency and errors without prompts or generated content.

Rollback is the previous image pair plus the database backup taken before migration. Do not roll
back the image across an incompatible migration without first restoring the matching backup.
