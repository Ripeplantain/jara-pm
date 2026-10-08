#!/usr/bin/env bash
# One command that decides whether the tree is good. Used by every Ralph iteration.
#
# Prefers Docker (the documented dev path). Falls back to host toolchains when the Docker
# daemon is not running: backend/.venv for Python, nvm's Node for the frontend.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILED=()
run() { # run <label> <cmd...>
  local label="$1"; shift
  echo "--- $label"
  if "$@"; then echo "    ok"; else echo "    FAILED: $label"; FAILED+=("$label"); fi
}

if docker info >/dev/null 2>&1; then
  run "backend pytest+ruff" docker compose run --rm --no-deps backend sh -c 'pytest -q && ruff check .'
  run "frontend lint" docker compose exec -T frontend npm run lint
  run "frontend typecheck" docker compose exec -T frontend npm run typecheck
else
  echo "(docker daemon unavailable - using host toolchains)"
  if [ -x backend/.venv/bin/python ]; then
    # Invoke modules through the environment's Python so a moved checkout does not
    # depend on stale absolute shebangs in console scripts.
    run "backend pytest" env -C backend ./.venv/bin/python -m pytest -q
    run "backend ruff" env -C backend ./.venv/bin/python -m ruff check .
  else
    echo "    SKIPPED backend: create backend/.venv (python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements-dev.txt)"
    FAILED+=("backend env missing")
  fi
  NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v22.*/bin 2>/dev/null | tail -1)"
  [ -n "${NODE_BIN:-}" ] && export PATH="$NODE_BIN:$PATH"
  if command -v npm >/dev/null 2>&1; then
    run "frontend lint" env -C frontend npm run --silent lint
    run "frontend typecheck" env -C frontend npm run --silent typecheck
  else
    echo "    SKIPPED frontend: no npm on PATH"
    FAILED+=("frontend env missing")
  fi
fi

echo
if [ ${#FAILED[@]} -eq 0 ]; then echo "VERIFY: PASS"; exit 0; fi
echo "VERIFY: FAIL (${FAILED[*]})"; exit 1
