#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Fast pre-push gate: lint, typecheck, and tests against the working tree.
#
# The Nuxt production build, the production image build, and the health smoke
# test deliberately do NOT run here. They run in CI
# (.github/workflows/deploy.yml) on every pull request and push to main, and
# the deploy job will not run unless they pass. Keeping them out of the hook
# is what makes a push take seconds instead of minutes.
#
# Run ./scripts/verify.sh for the full gate, including both builds.

if ! docker info >/dev/null 2>&1; then
  echo "Docker is required for these checks because the repository does not require a host Node installation."
  exit 1
fi

echo "--- lint, typecheck, and tests"
if docker compose run --rm --no-deps app sh -c 'npm run lint && npm run typecheck && npm test'; then
  echo "Pre-push checks passed."
  exit 0
fi

cat <<'MSG'

Pre-push checks failed.

  Fix lint findings automatically:  docker compose run --rm --no-deps app npm run lint:fix
  Full local gate including builds: ./scripts/verify.sh
  Push anyway (skips this hook):    git push --no-verify
MSG
exit 1
