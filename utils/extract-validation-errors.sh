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

# Check if validation_attempts table exists
TABLE_EXISTS=$(sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='validation_attempts';" 2>/dev/null)

if [ -n "$TABLE_EXISTS" ]; then
  # Use new validation_attempts table (complete history)
  echo "Source: validation_attempts table (all retry attempts)"
  echo ""

  if [ "$VERBOSE" -eq 1 ]; then
    sqlite3 -json "$DB" "
      SELECT
        va.conversion_id as conv_id,
        va.contract_name,
        va.attempt_number,
        va.passed,
        va.validation_error as error
      FROM validation_attempts va
      WHERE va.conversion_id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT)
        AND va.validation_error IS NOT NULL
        AND va.validation_error != ''
      ORDER BY va.conversion_id DESC, va.contract_name, va.attempt_number;
    " 2>/dev/null | jq -r '.[] | "Conversion #\(.conv_id) | \(.contract_name) | Attempt \(.attempt_number)\n  Error:\n\(.error | split("\n") | map("    " + .) | join("\n"))\n"'
  else
    sqlite3 -json "$DB" "
      SELECT
        va.conversion_id as conv_id,
        va.contract_name,
        va.attempt_number,
        va.passed,
        va.validation_error as error
      FROM validation_attempts va
      WHERE va.conversion_id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT)
        AND va.validation_error IS NOT NULL
        AND va.validation_error != ''
      ORDER BY va.conversion_id DESC, va.contract_name, va.attempt_number;
    " 2>/dev/null | jq -r '.[] | "Conversion #\(.conv_id) | \(.contract_name) | Attempt \(.attempt_number): \(.error | split("\n")[0])"'
  fi

  echo ""
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
    FROM validation_attempts
    WHERE conversion_id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT)
      AND validation_error IS NOT NULL
      AND validation_error != ''
    GROUP BY pattern
    ORDER BY count DESC;
  " | while IFS='|' read -r pattern count; do
    printf "  %-25s %s\n" "$pattern" "$count"
  done

  echo ""
  echo "Attempts Summary:"
  sqlite3 "$DB" "
    SELECT
      'Total validation attempts' as metric,
      COUNT(*) as value
    FROM validation_attempts
    WHERE conversion_id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT)
    UNION ALL
    SELECT
      'Failed attempts' as metric,
      COUNT(*) as value
    FROM validation_attempts
    WHERE conversion_id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT)
      AND passed = 0
    UNION ALL
    SELECT
      'Passed attempts' as metric,
      COUNT(*) as value
    FROM validation_attempts
    WHERE conversion_id IN (SELECT id FROM conversions ORDER BY id DESC LIMIT $COUNT)
      AND passed = 1;
  " | while IFS='|' read -r metric value; do
    printf "  %-25s %s\n" "$metric" "$value"
  done

else
  # Fall back to contracts table (final state only)
  echo "Source: contracts table (final state only - no retry history)"
  echo "Note: Run new conversions to populate validation_attempts table"
  echo ""

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

  echo ""
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
fi

echo ""
echo "Total conversions analyzed: $COUNT"
