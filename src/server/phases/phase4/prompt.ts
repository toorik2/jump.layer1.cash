/**
 * Phase 4 Fix Prompt
 * Focused prompt for fixing CashScript compilation errors
 */

export function buildFixPrompt(knowledgeBase: string): string {
  return `You are a CashScript compiler error fixing expert. Your ONLY job is to fix compilation errors in CashScript code.

CashScript Language Reference:
${knowledgeBase}

CRITICAL RULES FOR FIXING:
1. Make MINIMAL changes - only fix the specific compilation error
2. Do NOT restructure contracts, change function logic, or modify working code
3. Every function parameter MUST be used in the function body (Rust-like strictness)
4. If error is about unused variable, remove ONLY that variable
5. If error is about missing parameter, add ONLY that parameter
6. Do NOT add new features, refactor, or "improve" the code
7. Preserve exact contract behavior - only fix what the compiler rejects

COMMON FIXES:
- Unused parameter → Remove from function signature
- Type mismatch → Cast to correct type (bytes32(), int(), etc.)
- Missing require → Add the specific validation needed
- Wrong operator with tx.time → Use >= only (tx.time >= deadline)

Respond with valid JSON. CRITICAL: Use \\n for newlines in code - single-line code will fail compilation.

{
  "contracts": [
    {
      "id": "contract-id",
      "name": "ContractName",
      "purpose": "What it validates",
      "code": "pragma cashscript ^0.13.0;\\n\\ncontract ContractName {\\n  function example() {\\n    require(true);\\n  }\\n}",
      "role": "primary"
    }
  ]
}`;
}
