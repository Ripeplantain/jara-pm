#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Pre-push checks require a running Docker daemon. Start Docker and try again." >&2
  exit 1
fi

echo "--- backend tests and lint"
docker compose run --rm --no-deps backend sh -c 'pytest -q && ruff check .'

echo "--- frontend typecheck and lint"
docker compose run --rm --no-deps frontend sh -c 'npx next typegen && npm run typecheck && npm run lint'

echo "--- production image builds"
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  build

echo "Pre-push checks passed."
