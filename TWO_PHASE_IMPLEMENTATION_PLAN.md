# Two-Phase Semantic Translation: Complete Implementation Plan

## Executive Summary

Implement a two-phase conversion system:
1. **Phase 1**: Pure Solidity semantic extraction (NO UTXO context)
2. **Phase 2**: UTXO-aware CashScript generation using semantic understanding

This addresses beta tester feedback about skipped logic and wrong contract purpose.

---

## Phase 1: Database Schema Changes

### 1.1 Add `semantic_analyses` Table

**File: `src/database.ts`**

Add new table to store Phase 1 analysis results:

```sql
CREATE TABLE semantic_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversion_id INTEGER NOT NULL,
  analysis_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  model_used TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  response_time_ms INTEGER,
  FOREIGN KEY (conversion_id) REFERENCES conversions(id) ON DELETE CASCADE
);

CREATE INDEX idx_semantic_conversion ON semantic_analyses(conversion_id);
```

### 1.2 Add Database Functions

Add to `src/database.ts`:

```typescript
export interface SemanticAnalysisRecord {
  id?: number;
  conversion_id: number;
  analysis_json: string;
  created_at: string;
  model_used: string;
  input_tokens?: number;
  output_tokens?: number;
  response_time_ms?: number;
}

export function insertSemanticAnalysis(record: Omit<SemanticAnalysisRecord, 'id'>): number
export function getSemanticAnalysis(conversionId: number): SemanticAnalysisRecord | undefined
```

**Estimated effort**: 30 minutes

---

## Phase 2: Define Semantic Specification Schema

### 2.1 Create TypeScript Types

**New file: `src/types/semantic-spec.ts`**

```typescript
export interface StateVariable {
  name: string;
  type: string; // "uint256", "mapping(address => uint)", etc.
  mutability: 'constant' | 'mutable';
  visibility: 'public' | 'private' | 'internal';
  usage: string; // How it's read/written in functions
  initialValue?: string;
}

export interface FunctionSpec {
  name: string;
  purpose: string; // What this function does in business terms
  parameters: {
    name: string;
    type: string;
    description: string;
  }[];
  accessControl: 'anyone' | 'owner' | 'role-based' | 'conditional';
  accessControlDetails?: string; // e.g., "requires msg.sender == owner"
  stateChanges: string[]; // Which state variables are modified
  requires: string[]; // Preconditions (business logic, not code)
  ensures: string[]; // Postconditions (business logic)
  emits: string[]; // Events emitted
}

export interface SemanticSpecification {
  contractPurpose: string; // High-level: "Crowdfunding with refunds"

  businessLogic: string[]; // Critical rules: "If goal not met by deadline, allow refunds"

  stateVariables: StateVariable[];

  functions: FunctionSpec[];

  accessControlSummary: {
    roles: string[]; // "owner", "user", etc.
    patterns: string[]; // "owner-only functions", "public payable", etc.
  };

  dataRelationships: string[]; // "totalSupply = sum of all balances"

  criticalInvariants: string[]; // Must hold: "balance[x] <= totalSupply"

  edgeCases: string[]; // "What happens if called twice?", etc.
}
```

### 2.2 Create JSON Schema for Structured Output

**File: `src/server.ts`** - Add constant:

```typescript
const semanticSpecSchema = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      contractPurpose: { type: "string" },
      businessLogic: { type: "array", items: { type: "string" } },
      stateVariables: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            mutability: { enum: ["constant", "mutable"] },
            visibility: { enum: ["public", "private", "internal"] },
            usage: { type: "string" },
            initialValue: { type: "string" }
          },
          required: ["name", "type", "mutability", "visibility", "usage"],
          additionalProperties: false
        }
      },
      functions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            purpose: { type: "string" },
            parameters: { type: "array" },
            accessControl: { enum: ["anyone", "owner", "role-based", "conditional"] },
            accessControlDetails: { type: "string" },
            stateChanges: { type: "array", items: { type: "string" } },
            requires: { type: "array", items: { type: "string" } },
            ensures: { type: "array", items: { type: "string" } },
            emits: { type: "array", items: { type: "string" } }
          },
          required: ["name", "purpose", "parameters", "accessControl", "stateChanges"],
          additionalProperties: false
        }
      },
      accessControlSummary: {
        type: "object",
        properties: {
          roles: { type: "array", items: { type: "string" } },
          patterns: { type: "array", items: { type: "string" } }
        },
        required: ["roles", "patterns"]
      },
      dataRelationships: { type: "array", items: { type: "string" } },
      criticalInvariants: { type: "array", items: { type: "string" } },
      edgeCases: { type: "array", items: { type: "string" } }
    },
    required: [
      "contractPurpose",
      "businessLogic",
      "stateVariables",
      "functions",
      "accessControlSummary",
      "dataRelationships",
      "criticalInvariants",
      "edgeCases"
    ],
    additionalProperties: false
  }
} as const;
```

**Estimated effort**: 45 minutes

---

## Phase 3: Create Phase 1 System Prompt

### 3.1 Design Semantic Analysis Prompt

**File: `src/server.ts`** - Add new constant (before Phase 2 prompt):

```typescript
const SEMANTIC_ANALYSIS_PROMPT = `You are an expert Solidity contract analyzer. Your task is to extract the complete semantic understanding of a Solidity smart contract.

DO NOT think about implementation in other languages. Focus ONLY on understanding what this contract does.

Extract the following information:

1. CONTRACT PURPOSE
   - What problem does this contract solve?
   - What is the high-level business domain? (token, crowdfunding, voting, etc.)
   - What are the main use cases?

2. STATE VARIABLES ANALYSIS
   For EACH state variable:
   - Name and Solidity type (exact syntax)
   - Is it constant or mutable?
   - Visibility (public/private/internal)
   - How is it used? (read-only, written by single function, etc.)
   - Initial value (if any)

3. FUNCTION SEMANTICS
   For EACH function:
   - Name and purpose (in business terms, not code)
   - Parameters and their meaning
   - Access control: who can call this? (anyone/owner/specific role/conditional)
   - Access control details (e.g., "requires msg.sender == owner")
   - Which state variables does it read?
   - Which state variables does it modify?
   - What are the preconditions (requires)? Express as business rules
   - What are the postconditions (ensures)? Express as business rules
   - What events does it emit?

4. ACCESS CONTROL SUMMARY
   - What roles exist? (owner, admin, user, etc.)
   - What access control patterns are used? (owner-only, role-based, etc.)

5. DATA RELATIONSHIPS
   - How do state variables relate to each other?
   - Are there invariants like "sum of parts = whole"?
   - Dependencies between variables?

6. CRITICAL INVARIANTS
   - What MUST ALWAYS be true?
   - Business rules that cannot be violated
   - Examples: "total supply = sum of balances", "can only vote once"

7. EDGE CASES
   - What happens if a function is called multiple times?
   - What happens with zero values or empty inputs?
   - What are the boundary conditions?

IMPORTANT RULES:
- Extract semantic meaning, not syntax
- Use business terminology, not code terminology
- Be comprehensive - missing logic is the #1 problem we're solving
- Don't make assumptions - if something is unclear, note it
- Don't suggest implementations - just understand what IS

Output a complete semantic specification as JSON.`;
```

**Estimated effort**: 1 hour

---

## Phase 4: Modify Phase 2 System Prompt

### 4.1 Enhance Existing Prompt

**File: `src/server.ts`** - Modify existing `systemPrompt` (line 273):

Add at the very beginning:

```typescript
const systemPrompt = `You are a CashScript expert. Convert EVM (Solidity) smart contracts to CashScript.

SEMANTIC SPECIFICATION:
The following semantic analysis describes what the Solidity contract does:

${semanticSpecJSON}

YOUR MISSION: Generate CashScript that faithfully implements ALL the business logic, invariants, and functionality described in the semantic specification above.

CashScript Language Reference:
${knowledgeBase}

CRITICAL RULES:
[... existing 20 rules ...]

SEMANTIC PRESERVATION REQUIREMENT:
Before you finish, verify your CashScript implements:
✓ All functions from the semantic spec
✓ All state variables (mapped to appropriate UTXO storage)
✓ All access control requirements
✓ All critical invariants
✓ All business logic rules

If you cannot implement something, explain why in code comments.

[... rest of existing prompt ...]
`;
```

**Estimated effort**: 30 minutes

---

## Phase 5: Implement Phase 1 API Call

### 5.1 Add Phase 1 Execution Function

**File: `src/server.ts`** - Add before `/api/convert` handler:

```typescript
async function executeSemanticAnalysis(
  conversionId: number,
  solidityContract: string
): Promise<SemanticSpecification> {
  console.log('[Phase 1] Starting semantic analysis...');
  const startTime = Date.now();

  const response = await anthropic.beta.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096, // Smaller than Phase 2
    system: SEMANTIC_ANALYSIS_PROMPT,
    betas: ['structured-outputs-2025-11-13'],
    output_format: semanticSpecSchema,
    messages: [{
      role: 'user',
      content: solidityContract
    }]
  });

  const responseText = response.content[0].type === 'text'
    ? response.content[0].text
    : '';

  const semanticSpec: SemanticSpecification = JSON.parse(responseText);

  // Log to database
  const duration = Date.now() - startTime;
  insertSemanticAnalysis({
    conversion_id: conversionId,
    analysis_json: responseText,
    created_at: new Date().toISOString(),
    model_used: 'claude-sonnet-4-5-20250929',
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    response_time_ms: duration
  });

  console.log('[Phase 1] Semantic analysis complete:', {
    duration: `${(duration / 1000).toFixed(2)}s`,
    functions: semanticSpec.functions.length,
    stateVars: semanticSpec.stateVariables.length,
    invariants: semanticSpec.criticalInvariants.length
  });

  return semanticSpec;
}
```

**Estimated effort**: 30 minutes

---

## Phase 6: Modify Main Conversion Handler

### 6.1 Update `/api/convert` Endpoint

**File: `src/server.ts`** - Modify handler (line 260):

```typescript
app.post('/api/convert', async (req, res) => {
  const startTime = Date.now();
  let conversionId: number | undefined;
  let semanticSpec: SemanticSpecification | undefined;

  try {
    console.log('[Conversion] Received conversion request');
    const { contract } = req.body;
    const metadata = req.metadata!;

    // Log conversion start
    conversionId = await logConversionStart(metadata, contract);
    console.log(`[Conversion] Started with ID ${conversionId}`);

    // ========================================
    // PHASE 1: SEMANTIC ANALYSIS
    // ========================================
    try {
      semanticSpec = await executeSemanticAnalysis(conversionId, contract);
    } catch (phase1Error) {
      console.error('[Phase 1] Semantic analysis failed:', phase1Error);
      // Log error and return
      logError('phase1_error',
        phase1Error instanceof Error ? phase1Error.message : String(phase1Error),
        conversionId
      ).catch(err => console.error('[Logging] Failed to log error:', err));

      return res.status(500).json({
        error: 'Semantic analysis failed',
        message: 'Could not extract contract semantics. Please check your Solidity code.',
        details: phase1Error instanceof Error ? phase1Error.message : String(phase1Error)
      });
    }

    // ========================================
    // PHASE 2: CODE GENERATION WITH SEMANTIC GUIDANCE
    // ========================================
    const semanticSpecJSON = JSON.stringify(semanticSpec, null, 2);

    // Build Phase 2 system prompt with semantic spec
    const phase2SystemPrompt = `You are a CashScript expert. Convert EVM (Solidity) smart contracts to CashScript.

SEMANTIC SPECIFICATION:
The following semantic analysis describes what the Solidity contract does:

${semanticSpecJSON}

YOUR MISSION: Generate CashScript that faithfully implements ALL the business logic, invariants, and functionality described in the semantic specification above.

CashScript Language Reference:
${knowledgeBase}

CRITICAL RULES:
[... existing 20 rules ...]

SEMANTIC PRESERVATION REQUIREMENT:
Before you finish, verify your CashScript implements:
✓ All functions from the semantic spec
✓ All state variables (mapped to appropriate UTXO storage)
✓ All access control requirements
✓ All critical invariants
✓ All business logic rules

If you cannot implement something, explain why in code comments.

[... rest of existing prompt ...]`;

    // [Continue with existing retry loop, but use phase2SystemPrompt]
    // [Pass semanticSpecJSON in retry messages too]

    // ... rest of existing handler logic ...

  } catch (error) {
    // ... existing error handling ...
  }
});
```

**Estimated effort**: 1 hour

---

## Phase 7: Update Retry Logic

### 7.1 Include Semantic Spec in Retries

**File: `src/server.ts`** - Modify retry message construction (line 752+):

```typescript
// Build retry message for next attempt
console.log(`[Conversion] Attempt ${attemptNumber} failed, preparing retry...`);

// Include semantic spec in retry context
retryMessage = `SEMANTIC SPECIFICATION (what the contract must do):
${semanticSpecJSON}

ORIGINAL SOLIDITY CONTRACT:
${contract}

YOUR PREVIOUS TRANSLATION HAD ERRORS:
${validationError}

FAILED CODE:
${failedCode}

INSTRUCTIONS:
Fix the compilation errors while ensuring ALL semantic requirements from the specification are implemented.
Verify every function, invariant, and business rule from the semantic spec is present in your corrected code.`;
```

**Estimated effort**: 20 minutes

---

## Phase 8: Add Logging and Monitoring

### 8.1 Add Semantic Analysis Logging

**File: `src/services/logging.ts`** - Add functions:

```typescript
export async function logSemanticAnalysisStart(conversionId: number): Promise<void>
export async function logSemanticAnalysisComplete(
  conversionId: number,
  startTime: number,
  success: boolean,
  spec?: SemanticSpecification,
  error?: string
): Promise<void>
```

### 8.2 Track Phase Metrics

Add to `api_attempts` table or create new tracking:
- Phase 1 duration
- Phase 2 duration
- Total duration comparison vs single-phase

**Estimated effort**: 30 minutes

---

## Phase 9: Testing Strategy

### 9.1 Unit Tests

**New file: `tests/semantic-analysis.test.ts`**

Test Phase 1:
- ✓ Extracts contract purpose correctly
- ✓ Identifies all state variables
- ✓ Captures all functions with semantics
- ✓ Detects access control patterns
- ✓ Finds critical invariants

Test Phase 2:
- ✓ Generated code implements all functions from spec
- ✓ State variables mapped to UTXO storage
- ✓ Access control preserved
- ✓ Invariants enforced

### 9.2 Integration Tests

**Test with known problem contracts from beta testers:**

1. Simple token (baseline - should work)
2. Crowdfunding with refunds (reported issue)
3. Voting with delegation (complex logic)
4. Multi-contract factory pattern

Compare:
- Single-phase vs two-phase semantic accuracy
- Retry rates
- Final code correctness

### 9.3 Manual Testing Checklist

- [ ] Phase 1 extracts complete semantics for simple contract
- [ ] Phase 1 extracts complete semantics for complex contract
- [ ] Phase 2 generates valid CashScript from semantic spec
- [ ] Retry loop includes semantic spec
- [ ] Database stores semantic analyses
- [ ] Error messages reference semantic spec
- [ ] End-to-end: Solidity → Semantic Spec → CashScript → Compiled

**Estimated effort**: 3 hours

---

## Phase 10: Deployment and Rollout

### 10.1 Feature Flag

**File: `src/server.ts`** - Add environment variable:

```typescript
const USE_TWO_PHASE = process.env.TWO_PHASE_ENABLED === 'true';

// In handler:
if (USE_TWO_PHASE) {
  semanticSpec = await executeSemanticAnalysis(...);
  // Two-phase flow
} else {
  // Original single-phase flow
}
```

### 10.2 Gradual Rollout Plan

**Week 1**: Internal testing
- Deploy to staging with TWO_PHASE_ENABLED=true
- Test with known problem contracts
- Measure semantic accuracy

**Week 2**: Beta tester trial (10%)
- Enable for 10% of conversions (random)
- Collect feedback
- Monitor error rates and costs

**Week 3**: Expanded rollout (50%)
- If Week 2 successful, expand to 50%
- Continue monitoring

**Week 4**: Full rollout (100%)
- If no issues, enable for all conversions
- Remove feature flag in future update

### 10.3 Rollback Plan

If critical issues found:
1. Set TWO_PHASE_ENABLED=false
2. Reverts to single-phase immediately
3. No code deployment needed

**Estimated effort**: 30 minutes setup + ongoing monitoring

---

## Phase 11: Optional UI Enhancement

### 11.1 Show Semantic Spec to Users

**File: `src/App.tsx`** - Add expandable section:

Show the semantic specification in the UI so users can:
- Verify the system understood their contract correctly
- Debug semantic mismatches
- Learn about UTXO mapping decisions

Could add "View Semantic Analysis" button that shows:
- Contract purpose
- Extracted functions and their semantics
- Identified invariants

**Priority**: Low (nice-to-have, not critical)
**Estimated effort**: 2 hours

---

## Success Metrics

Track the following:

### Primary Metrics
- **Semantic failure rate**: % of conversions where generated code doesn't match original purpose
- **User-reported issues**: "Wrong purpose" / "Skipped logic" complaints
- **Manual review accuracy**: Sample contracts reviewed for semantic correctness

### Secondary Metrics
- **Retry rate**: Average attempts needed (should decrease)
- **First-attempt success**: % valid on first try (should increase)
- **Phase 1 extraction quality**: Manual review of semantic specs

### Performance Metrics
- **Total latency**: Phase 1 + Phase 2 time
- **Total cost**: Phase 1 + Phase 2 cost
- **Cache hit rate**: Phase 2 knowledge base caching

### Target Improvements
- 30-50% reduction in semantic failures
- 20% reduction in retry rate
- < 20% cost increase
- < 30% latency increase

---

## Cost and Latency Analysis

### Current System (Single-Phase)
- **Latency**: ~30s per attempt × retries
- **Cost**: $0.40 first attempt, $0.08 retries (with cache)
- **Avg conversions**: 3 attempts = ~$0.56

### Two-Phase System
- **Phase 1**: 15s, $0.08 (no retries, no cache)
- **Phase 2**: 30s × retries, $0.40 first + $0.08 retries
- **Avg**: 15s + (30s × 3) = 105s, $0.08 + $0.56 = $0.64

### Impact
- **Cost increase**: ~14% ($0.08 per conversion)
- **Latency increase**: ~16% (15s for Phase 1)
- **Expected benefit**: 30-50% reduction in semantic failures

**ROI**: Worth it if semantic accuracy improves significantly

---

## Implementation Timeline

### Week 1: Core Implementation
- Day 1-2: Database schema + types (Phase 1-2)
- Day 3-4: Phase 1 prompt + execution (Phase 3-5)
- Day 5: Phase 2 integration (Phase 6-7)

### Week 2: Testing & Polish
- Day 1-2: Testing (Phase 9)
- Day 3: Logging and monitoring (Phase 8)
- Day 4-5: Bug fixes and refinement

### Week 3: Deployment
- Day 1: Staging deployment
- Day 2-3: Internal testing
- Day 4-5: Beta rollout start (Phase 10)

### Week 4+: Monitoring & Iteration
- Collect metrics
- Refine prompts based on failures
- Consider UI enhancements (Phase 11)

**Total estimated effort**: 60-80 hours

---

## Risk Mitigation

### Risk: Phase 1 fails to extract complete semantics
**Mitigation**: Comprehensive testing with diverse contracts, prompt refinement

### Risk: Phase 2 ignores semantic spec
**Mitigation**: Strong prompt engineering emphasizing semantic preservation, validation checks

### Risk: Cost increase too high
**Mitigation**: Feature flag allows rollback, monitor closely during beta

### Risk: Latency unacceptable to users
**Mitigation**: Can optimize Phase 1 max_tokens, parallel execution if needed

### Risk: Two-phase doesn't improve semantic accuracy
**Mitigation**: A/B testing during rollout, clear metrics, rollback plan

---

## Next Steps

1. **Get approval** on this plan
2. **Start with Phase 1-2**: Database + types (low risk, foundational)
3. **Prototype Phase 1 prompt**: Test semantic extraction quality on sample contracts
4. **Review extraction quality** before proceeding to integration
5. **Implement sequentially** following phases 3-10
6. **Test thoroughly** before any user-facing deployment
7. **Monitor closely** during gradual rollout

---

## Questions to Resolve Before Implementation

1. Should Phase 1 have retry logic? (Currently: no)
2. What if Phase 1 JSON is malformed? (Fallback to single-phase or error?)
3. Show semantic spec in UI? (Optional enhancement)
4. Should we validate that Phase 2 code mentions all functions from Phase 1 spec? (Semantic completeness check)
5. Database retention policy for semantic analyses? (Keep forever or cleanup old ones?)

---

## Beta Tester Feedback That Led to This Plan

> "Tossed an old solidity contract at it, cashscript looks overall correct syntax, but it skipped a bunch of the solidity logic, and got the actual 'purpose' of the solidity contract wildly wrong. So don't put a lot of faith in the output still, but can use it to possibly guide you in how to start looking at things from a cashscript sense maybe?"

**Root Cause Identified**: Single-phase approach tries to parse, understand, and translate simultaneously. The AI is cognitively overloaded trying to handle Solidity semantics + UTXO paradigm mapping + CashScript generation + 20+ rules all at once.

**Solution**: Separate semantic understanding (Phase 1) from code generation (Phase 2), allowing focused problem-solving at each stage.
