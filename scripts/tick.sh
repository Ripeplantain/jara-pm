#!/usr/bin/env bash
# Tick a task in docs/PLAN.md: ./scripts/tick.sh 6.1
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for id in "$@"; do
  perl -i -pe "s/^- \\[ \\] \Q$id\E /- [x] $id /" "$ROOT/docs/PLAN.md"
done
echo "remaining: $(grep -c '^- \[ \]' "$ROOT/docs/PLAN.md")"
