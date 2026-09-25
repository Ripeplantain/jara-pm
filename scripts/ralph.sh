#!/usr/bin/env bash
# Ralph loop: run the same prompt until the plan is done.
#
#   ./scripts/ralph.sh [max_iterations]   # default 50
#
# Each iteration is a fresh agent with no memory of the last one; docs/PLAN.md is the handoff.
# The loop stops when the plan has no unchecked tasks left, or after max_iterations.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MAX="${1:-50}"
LOG_DIR="$ROOT/.ralph"
mkdir -p "$LOG_DIR"

for ((i = 1; i <= MAX; i++)); do
  remaining=$(grep -c '^- \[ \]' docs/PLAN.md || true)
  if [ "${remaining:-0}" -eq 0 ]; then
    echo "== plan complete after $((i - 1)) iterations"
    exit 0
  fi
  echo "== iteration $i/$MAX ($remaining tasks left) $(date -u +%H:%M:%SZ)"
  claude -p "$(cat PROMPT.md)" \
    --permission-mode acceptEdits \
    2>&1 | tee "$LOG_DIR/iteration-$i.log"

  if ! ./scripts/verify.sh >"$LOG_DIR/verify-$i.log" 2>&1; then
    echo "!! verify failed after iteration $i - see $LOG_DIR/verify-$i.log"
    echo "!! stopping so the next iteration does not build on a red tree"
    exit 1
  fi
done
echo "== hit the $MAX iteration cap; $(grep -c '^- \[ \]' docs/PLAN.md) tasks still open"
