#!/bin/bash
# Run all Solidity conversions in parallel
# Usage: ./utils/run-conversions.sh [dir]
# Default dir: docs/solidity-examples

DIR="${1:-docs/solidity-examples}"
SERVER="http://localhost:3001/api/convert-stream"
LOGDIR="/tmp/conversions_$(date +%Y%m%d_%H%M%S)"

mkdir -p "$LOGDIR"

echo "Converting all .sol files in $DIR"
echo "Logs: $LOGDIR"
echo ""

count=0
for f in "$DIR"/*.sol; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .sol)
  echo "Starting: $name"
  cat "$f" | jq -Rs '{contract: .}' | curl -s -X POST "$SERVER" \
    -H "Content-Type: application/json" \
    -d @- > "$LOGDIR/${name}.log" 2>&1 &
  count=$((count + 1))
done

echo ""
echo "$count conversions started in parallel"
echo "Waiting for completion..."
wait
echo "Done"
echo ""

# Show results
success=0
failed=0
for log in "$LOGDIR"/*.log; do
  name=$(basename "$log" .log)
  if grep -q '^event: done' "$log"; then
    echo "✅ $name"
    success=$((success + 1))
  elif grep -q '^event: error' "$log"; then
    error=$(grep -A1 '^event: error' "$log" | tail -1 | sed 's/.*"message":"\([^"]*\)".*/\1/')
    echo "❌ $name: $error"
    failed=$((failed + 1))
  else
    echo "⚠️  $name: unknown status"
    failed=$((failed + 1))
  fi
done

echo ""
echo "Results: $success success, $failed failed"
