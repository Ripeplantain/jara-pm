#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILED=()
run() {
  local label="$1"; shift
  echo "--- $label"
  if "$@"; then echo "    ok"; else echo "    FAILED: $label"; FAILED+=("$label"); fi
}

if docker info >/dev/null 2>&1; then
  run "Nuxt verification image" docker compose build app
  run "Nuxt typecheck" docker compose run --rm --no-deps app npm run typecheck
  run "Nuxt tests" docker compose run --rm --no-deps app npm test
  run "Nuxt production build" docker compose run --rm --no-deps app npm run build
else
  echo "Docker is required for the Nuxt checks because the repository does not require a host Node installation."
  FAILED+=("docker unavailable")
fi

echo
if [ ${#FAILED[@]} -eq 0 ]; then echo "VERIFY: PASS"; exit 0; fi
echo "VERIFY: FAIL (${FAILED[*]})"; exit 1
