#!/bin/bash
# Extract all validation errors from last N conversions
# Usage: ./utils/extract-validation-errors.sh [count] [db_path] [-v|--verbose]
# Default: last 10 conversions
#
# Options:
#   -v, --verbose    Show full error context (all lines)
#   count            Number of conversions to analyze (default: 10)
#   db_path          Path to database (default: data/conversions.db)

VERBOSE=0
COUNT=10
DB="data/conversions.db"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -v|--verbose)
      VERBOSE=1
      shift
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        COUNT="$1"
      elif [[ -f "$1" ]]; then
        DB="$1"
      fi
      shift
      ;;
  esac
done

if [ ! -f "$DB" ]; then
  echo "Error: Database not found at $DB"
  exit 1
fi

echo "=== Validation Errors from Last $COUNT Conversions ==="
echo ""

# Get all errors using JSON mode for reliable parsing
if [ "$VERBOSE" -eq 1 ]; then
  sqlite3 -json "$DB" "
    SELECT
      c.id as conv_id,
      c.final_status as status,
      ct.name as contract_name,
      ct.validation_error as error
    FROM contracts ct
    JOIN conversions c ON ct.conversion_id = c.id
    WHERE c.id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT)
      AND ct.validation_error IS NOT NULL
      AND ct.validation_error != ''
    ORDER BY c.id DESC, ct.name;
  " 2>/dev/null | jq -r '.[] | "Conversion #\(.conv_id) (\(.status))\n  Contract: \(.contract_name)\n  Error:\n\(.error | split("\n") | map("    " + .) | join("\n"))\n"'
else
  sqlite3 -json "$DB" "
    SELECT
      c.id as conv_id,
      c.final_status as status,
      ct.name as contract_name,
      ct.validation_error as error
    FROM contracts ct
    JOIN conversions c ON ct.conversion_id = c.id
    WHERE c.id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT)
      AND ct.validation_error IS NOT NULL
      AND ct.validation_error != ''
    ORDER BY c.id DESC, ct.name;
  " 2>/dev/null | jq -r '.[] | "Conversion #\(.conv_id) (\(.status))\n  Contract: \(.contract_name)\n  Error: \(.error | split("\n")[0])\n"'
fi

# Summary statistics
echo "=== Summary ==="
echo ""

echo "Error Pattern Frequency:"
sqlite3 "$DB" "
  SELECT
    CASE
      WHEN validation_error LIKE '%not castable to type%' THEN 'Type casting error'
      WHEN validation_error LIKE '%tx.time%' THEN 'tx.time misuse'
      WHEN validation_error LIKE '%Unused variable%' THEN 'Unused variable'
      WHEN validation_error LIKE '%Unknown token%' THEN 'Unknown token'
      WHEN validation_error LIKE '%Parse error%' THEN 'Parse error'
      WHEN validation_error LIKE '%Split on non-fixed size%' THEN 'Split on non-fixed size'
      WHEN validation_error LIKE '%does not exist%' THEN 'Non-existent member/method'
      WHEN validation_error LIKE '%Cannot assign%' THEN 'Assignment error'
      WHEN validation_error LIKE '%type of left%' THEN 'Type mismatch'
      WHEN validation_error LIKE '%Cannot call%' THEN 'Cannot call'
      WHEN validation_error LIKE '%Expected%but got%' THEN 'Syntax error'
      WHEN validation_error LIKE '%Mismatched input%' THEN 'Syntax error'
      WHEN validation_error LIKE '%Token recognition%' THEN 'Invalid character'
      WHEN validation_error LIKE '%non-ASCII%' THEN 'Non-ASCII character'
      WHEN validation_error LIKE '%expecting%' THEN 'Syntax error'
      ELSE 'Other'
    END as pattern,
    COUNT(*) as count
  FROM contracts
  WHERE conversion_id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT)
    AND validation_error IS NOT NULL
    AND validation_error != ''
  GROUP BY pattern
  ORDER BY count DESC;
" | while IFS='|' read -r pattern count; do
  printf "  %-25s %s\n" "$pattern" "$count"
done

echo ""
echo "Total conversions analyzed: $COUNT"
echo "Conversions with errors: $(sqlite3 "$DB" "SELECT COUNT(DISTINCT conversion_id) FROM contracts WHERE conversion_id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT) AND validation_error IS NOT NULL AND validation_error != '';")"
echo "Total validation errors: $(sqlite3 "$DB" "SELECT COUNT(*) FROM contracts WHERE conversion_id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT) AND validation_error IS NOT NULL AND validation_error != '';")"
