#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./scripts/verify.sh

echo "--- production image build"
docker compose -f docker-compose.yml -f docker-compose.prod.yml build

echo "Pre-push checks passed."
