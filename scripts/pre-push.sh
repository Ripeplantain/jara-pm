#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "--- backend tests and lint"
  docker compose run --rm --no-deps backend sh -c 'pytest -q && ruff check .'

  echo "--- frontend typecheck and lint"
  docker compose run --rm --no-deps frontend sh -c 'npx next typegen && npm run typecheck && npm run lint'

  echo "--- production image builds"
  docker compose \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    build
else
  echo "(docker daemon unavailable - using host checks)"
  ./scripts/verify.sh

  echo "--- backend Python compilation"
  env -C backend ./.venv/bin/python -m compileall -q app

  echo "--- frontend production build"
  NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v22.*/bin 2>/dev/null | tail -1)"
  [ -n "${NODE_BIN:-}" ] && export PATH="$NODE_BIN:$PATH"
  env -C frontend npm run --silent build

  echo "WARNING: Docker image builds were skipped because Docker is unavailable."
  echo "CI will still validate the production images."
fi

echo "Pre-push checks passed."
