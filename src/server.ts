import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeDatabase, closeDatabase, updateConversion, insertContract, generateHash, generateUUID } from './database.js';
import { loggerMiddleware } from './middleware/logger.js';
import { rateLimiter } from './middleware/rate-limit.js';
import {
  logConversionStart,
  logConversionComplete,
  logApiCallStart,
  logApiCallComplete,
} from './services/logging.js';
import type { DomainModel } from './types/domain-model.js';
import type { UTXOArchitecture } from './types/utxo-architecture.js';
import { ANTHROPIC_CONFIG, SERVER_CONFIG } from './config.js';

// Import phase modules
import {
  executeDomainExtraction,
  executeArchitectureDesign,
  filterDocumentationOnlyContracts,
  outputSchema,
  retryOutputSchemaMulti,
  retryOutputSchemaSingle,
  validateContract,
  enhanceErrorMessage,
  normalizeContractNames,
  isPlaceholderContract,
  validateMultiContractResponse,
  applyNameMappingToTemplates,
  isMultiContractResponse,
  type ContractInfo
} from './phases/index.js';

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(loggerMiddleware);
app.use(express.static('dist'));

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_CONFIG.apiKey
});

let knowledgeBase = '';

async function init() {
  console.log('[Server] Initializing database...');
  initializeDatabase();

  console.log('[Server] Loading CashScript knowledge base...');

  const languageRef = await readFile('./cashscript-knowledge-base/language/language-reference.md', 'utf-8');
  const multiContractPatterns = await readFile('./cashscript-knowledge-base/concepts/multi-contract-architecture.md', 'utf-8');

  knowledgeBase = `${languageRef}

---

# MULTI-CONTRACT ARCHITECTURE PATTERNS

The following patterns are CRITICAL for any conversion involving multiple contracts.
When multiple contracts participate in the SAME transaction, EACH contract's script runs and MUST validate.

${multiContractPatterns}`;

  console.log(`[Server] Knowledge base loaded: ${knowledgeBase.length} characters`);
}

// Concurrent request limiting
let activeConversions = 0;

function validateContractInput(contract: any): { valid: boolean; error?: string; statusCode?: number } {
  if (typeof contract !== 'string') {
    return { valid: false, error: 'Contract must be a string', statusCode: 400 };
  }
  if (!contract || contract.trim().length === 0) {
    return { valid: false, error: 'Contract cannot be empty', statusCode: 400 };
  }
  if (contract.length < 10) {
    return { valid: false, error: 'Contract must be at least 10 characters', statusCode: 400 };
  }
  if (contract.length > 50000) {
    return { valid: false, error: 'Contract too large. Maximum 50,000 characters allowed.', statusCode: 413 };
  }
  return { valid: true };
}

// Build Phase 3 system prompt (code generation)
function buildCodeGenerationPrompt(): string {
  return `You are a CashScript expert. Convert EVM (Solidity) smart contracts to CashScript.

CashScript Language Reference:
${knowledgeBase}

CRITICAL RULES:
1. Always use "pragma cashscript ^0.13.0;" at the top of every CashScript contract.

1a. CONTRACT PURPOSE RULE - Before creating ANY contract, answer: "What does this contract VALIDATE?"
   - Every CashScript contract MUST add CONSTRAINTS to transactions
   - If a contract validates nothing, it should NOT EXIST
   - The minimum viable contract is a sidecar's attach() function with REAL validation:
     * require(outpointTransactionHash equality) - validates same-origin
     * require(outpointIndex sequential) - validates creation order
     * require(lockingBytecode preservation) - validates self-replication
   - For every contract you create, complete: "This contract validates that _______________."
   - Examples of valid validation purposes:
     * "validates the sidecar was created with the main contract"
     * "validates only authorized function NFTs can trigger state changes"
     * "validates output count prevents unauthorized minting"
   - If you cannot complete the sentence, DELETE the contract
   - This is PRODUCTION CODE with real BCH - every require() must have purpose

2. EVERY function parameter you declare MUST be used in the function body.
   - CashScript compiler strictly enforces this requirement (similar to Rust)
   - If a parameter is not needed in the function logic, do NOT declare it
   - This is the most common cause of compilation failures
   - Example: function transfer(pubkey recipient, sig senderSig) requires BOTH recipient and senderSig to be used

3. BCH is UTXO-based (stateless), NOT account-based like Ethereum.
   - Solidity state variables that can be updated → CashScript MUST use covenant patterns
   - "Update" means: spend old UTXO, enforce output creates new UTXO with new constructor params
   - Use tx.outputs constraints to enforce recreation (see STATE VARIABLES section in reference)
   - Solidity view/pure functions MUST BE COMPLETELY DELETED - do NOT convert them to CashScript
     * ❌ WRONG: Creating a function with require(false) to "document" the view function
     * ❌ WRONG: Creating a viewHelper() or queryProposal() function with comments saying "documentation-only"
     * ❌ WRONG: Creating ANY placeholder/stub version of a view function
     * ✅ CORRECT: Complete deletion - the function simply doesn't exist in the CashScript output
     * Examples to DELETE ENTIRELY: getBalance(), viewData(), currentState(), viewHelper(), queryProposal(), queryData()
     * Reading is done off-chain by inspecting constructor parameters - NO on-chain function needed
     * UTXO model makes read functions IMPOSSIBLE - deletion is the ONLY correct conversion

4. For DATA STORAGE, use NFT commitments, NOT OP_RETURN.
   - OP_RETURN is provably unspendable (funds burned) - use ONLY for event logging
   - NFT commitments provide local transferrable state (128 bytes max)
   - Pattern: tx.inputs[i].nftCommitment → tx.outputs[i].nftCommitment
   - Solidity state → Store in NFT commitment, validate/update via covenant

5. No visibility modifiers (public/private/internal/external) in CashScript.
   - All functions callable by anyone who constructs valid transaction
   - Use require(checkSig(s, pk)) for access control
   - Solidity private → CashScript function with signature gate

6. ALWAYS validate this.activeInputIndex and exact input/output counts.
   - require(this.activeInputIndex == 0) - Contract must be expected input position
   - require(tx.inputs.length == 2) - Use == not >= for exact validation
   - require(tx.outputs.length <= 3) - Strict output constraints
   - This prevents malicious transaction construction

7. UTXO-based authorization is PREFERRED over signatures for user actions.
   - Instead of: require(checkSig(s, userPk))
   - Prefer: require(tx.inputs[1].lockingBytecode == new LockingBytecodeP2PKH(userPkh))
   - User proves ownership by spending their UTXO, no signature parameter needed
   - Only use checkSig for fixed admin/oracle keys

8. Pack structured data into NFT commitments (128 bytes max).
   - Plan byte layout: [pubkeyhash(20) + reserved(18) + blocks(2)] = 40 bytes example
   - Write: tx.outputs[0].nftCommitment == userPkh + bytes18(0) + bytes2(blocks)
   - Read: bytes20(tx.inputs[0].nftCommitment.split(20)[0]) for first 20 bytes
   - Use .split(N)[1] to skip N bytes and get remainder

9. Account for dust and fees explicitly.
   - require(tx.outputs[0].value == 1000) - Minimum dust for token UTXOs
   - require(amount >= 5000) - Enough sats for future fees
   - require(tx.outputs[0].value == tx.inputs[0].value - 3000) - Explicit fee subtraction

10. Manipulate token capabilities with .split(32)[0].
    - tx.inputs[0].tokenCategory.split(32)[0] + 0x01 = strip capability, add mutable
    - tx.inputs[0].tokenCategory.split(32)[0] = strip to immutable
    - masterCategory + 0x02 = add minting capability

10a. CRITICAL: P2SH32 addresses MUST be bytes32 type - avoid type-losing operations!
    - ALWAYS use bytes32 for contract addresses in multi-contract systems
    - ✓ CORRECT: bytes32 votingBoothHash = 0x1234...;
    - ✗ WRONG: bytes32 hash = someData.split(1)[1]; // Results in bytes31!
    - ✓ FIX: bytes32 hash = bytes32(someData.split(1)[1]); // Explicit cast
    - OR BETTER: Use direct literal assignment (hardcode addresses at compile time)
    - Common error: "Type 'bytes31' can not be assigned to variable of type 'bytes32'"

11. Use chained splits and tuple destructuring for complex commitment parsing.
    - bytes4 pledgeID, bytes5 campaignID = commitment.split(31)[1].split(4)
    - Chained: commitment.split(26)[1].split(4)[0] = skip 26 bytes, take next 4
    - Tuple: bytes20 addr, bytes remaining = data.split(20) = single split, two vars

12. Validate Script Number minimal encoding bounds (MSB constraint).
    - require(amount <= 140737488355327) - Max bytes6 (2^47-1, MSB reserved for sign)
    - require(newID != 2147483647) - Max bytes4 (2^31-1)
    - Auto-increment: int newID = int(oldID) + 1; require(newID < max); then use

13. IMPLICIT NFT BURNING - Not recreating NFT in outputs = destroyed.
    - if (no_pledges) require(tx.outputs.length == 1); // Don't include NFT = burn
    - Key UTXO insight: anything not explicitly recreated ceases to exist
    - Use output count to control burn vs preserve behavior

14. NFT CAPABILITY AS STATE MACHINE - Capability encodes contract state.
    - MINTING (0x02) = Active state (can modify freely)
    - MUTABLE (0x01) = Stopped state (restricted modifications)
    - IMMUTABLE (no byte) = Final state (receipt/proof)
    - Downgrade: .split(32)[0] + 0x01 (minting→mutable) or .split(32)[0] (→immutable)
    - Verify state: bytes capability = tokenCategory.split(32)[1]; require(capability == 0x02);

15. VALUE-BASED STATE DETECTION - Satoshi amount indicates state.
    - if (tx.inputs[1].value == 1000) = initial/empty state (dust only)
    - if (tx.inputs[1].value > 1000) = modified state (has accumulated funds)
    - Design initial values to be identifiable (e.g., exactly 1000 sats)

16. RECEIPT NFT PATTERN - Immutable NFTs as cryptographic proofs.
    - Create: tx.outputs[1].tokenCategory == category.split(32)[0]; // No capability = immutable
    - Store proof data in commitment: pledgeAmount + padding + metadata
    - Verify later: require(capability2 == 0x); // Must be immutable

17. PERMISSIONLESS CONTRACTS - Some protocols need ZERO authorization.
    - No checkSig, no UTXO ownership checks - pure constraint validation
    - Anyone can call if transaction structure is valid
    - Use for: games, public goods, open protocols, deterministic state machines
    - Authorization via constraints, not signatures

18. STATELESS LOGIC CONTRACTS - Separate logic from state.
    - Logic contracts: contract PureLogic() { } - NO constructor params
    - State contracts: contract State(bytes categoryID) { } - embed trust anchors
    - Pattern: State contracts hold data, logic contracts validate rules

19. UTXO ORDERING AS DATA STRUCTURE - Input position encodes information.
    - tx.inputs[this.activeInputIndex - 1] = previous input
    - tx.inputs[this.activeInputIndex + 1] = next input
    - Sequential UTXOs represent paths (source → intermediates → destination)
    - Use for: path validation, sequential processes, graph traversal

20. CONSTRUCTOR PARAMETERS AS TRUST ANCHORS - Embed category IDs at compile time.
    - contract X(bytes tokenCategory01) { require(tx.inputs[i].tokenCategory == tokenCategory01); }
    - Trustless cross-contract validation via hardcoded category IDs
    - Compile-time trust establishment

21. TIMELOCK COMPARISON OPERATORS - CRITICAL SYNTAX RULE:
    **With tx.time and this.age, you can ONLY use >= operator. You CANNOT use <, >, or <=.**

    The CashScript compiler ENFORCES this restriction for Bitcoin Script timelock semantics:

    ❌ WRONG - These ALL cause compilation errors:
    require(tx.time < deadline);         // Error: "Mismatched input '<' expecting '>='"
    require(tx.time > lockTime);         // Error: "Mismatched input '>' expecting '>='"
    require(tx.time <= deadline);        // Error: "Mismatched input '<=' expecting '>='"
    require(this.age < vestingPeriod);   // Same error
    require(this.age <= vestingPeriod);  // Same error

    ✅ CORRECT - tx.time MUST be on the LEFT side of >= ONLY:
    require(tx.time >= lockTime);        // Transaction is at or after lock time
    require(this.age >= vestingPeriod);  // Has aged at least N blocks

    ❌ WRONG - tx.time CANNOT appear on the right side of any operator:
    require(deadline >= tx.time);        // COMPILE ERROR! tx.time cannot be on right
    require(deadline <= tx.time);        // COMPILE ERROR! Same issue
    require(!(tx.time >= deadline));     // COMPILE ERROR! Even negation fails

    **Why this restriction exists:**
    - Bitcoin Script nLocktime uses OP_CHECKLOCKTIMEVERIFY which only supports >= semantics
    - The compiler grammar ONLY allows: require(tx.time >= <expression>)
    - You CANNOT enforce "before deadline" with timelocks - this is a Bitcoin limitation!

    **Common time-based patterns:**
    // "Can only execute AFTER locktime" (timelocks, vesting, refunds):
    require(tx.time >= lockTime);              // ✅ Only valid pattern

    // "Must wait N blocks" (age-based logic):
    require(this.age >= vestingPeriod);        // ✅ Only valid pattern

    **CRITICAL: "Before deadline" logic CANNOT use tx.time!**
    For deadline-based systems (voting, auctions, crowdfunding), use STATE-BASED approach:
    - Store deadline in NFT commitment as bytes8
    - Have separate functions for "before deadline" and "after deadline" phases
    - Use DIFFERENT FUNCTIONS, not timelock checks:
      function pledgeDuringCampaign() { ... }     // Called while campaign active
      function claimAfterDeadline() {             // Only callable after deadline
        require(tx.time >= int(deadline));        // ✅ Correct usage
      }
      function refundAfterDeadline() {            // Only callable after deadline
        require(tx.time >= int(deadline));        // ✅ Correct usage
      }

    **Loop conditions are different - <, >, <= are valid there:**
    while (inputIndex < tx.inputs.length) { }     // ✅ Valid for loops
    require(index < tx.outputs.length);           // ✅ Valid for bounds checking
    if (amount <= maxValue) { }                   // ✅ Valid for value comparisons

    The >= restriction ONLY applies to tx.time and this.age comparisons.

22. WHAT EVERY CONTRACT MUST HAVE:
    Every contract function MUST include these validation elements:

    ✅ REQUIRED: At least one meaningful require() statement
    ✅ REQUIRED: Input position validation: require(this.activeInputIndex == N);
    ✅ REQUIRED: Output count limit: require(tx.outputs.length <= N);
    ✅ REQUIRED: If covenant, self-replication validation (5-point checklist)

    Every function must answer: "What constraint does this add?"
    - If answer is "none", DELETE the function
    - If Solidity function cannot be converted, DELETE it entirely - do NOT create placeholder

23. MULTI-CONTRACT ARCHITECTURE:
    When converting complex Solidity with multiple interacting contracts:

    a) Main+Sidecar Pattern - For contracts needing multiple token types:
       - BCH allows only ONE token category per UTXO output
       - Main contract holds NFT state, Sidecar holds fungible tokens
       - Sidecar validates same-origin: require(outpointTransactionHash ==)

    b) Function Contract Pattern - For contracts with 3+ functions:
       - Split each function into separate contract file
       - Authenticate via NFT commitment first-byte identifier
       - Main contract routes: if (functionId == 0x00) { } else if (0x01) { }

    c) Strict Input Position Pattern:
       - Every contract MUST know its exact input index
       - Validate all other contracts at known positions
       - No dynamic lookup - positions are explicit

    d) Cross-Contract Authentication:
       - Validate via token category arithmetic: systemTokenId + 0x01
       - The 33rd byte encodes capability (0x01=mutable, 0x02=minting)
       - Origin proof: outpointTransactionHash equality = same-transaction creation

24. OUTPUT COUNT LIMITING (SECURITY-CRITICAL):
    EVERY function MUST limit output count to prevent unauthorized token minting:

    ✅ REQUIRED: require(tx.outputs.length <= 7);  // Adjust N per operation

    Standard limits by operation type:
    - Simple transfer: <= 4
    - Swap/exchange: <= 6
    - Complex DeFi: <= 10
    - Maximum recommended: <= 50

    WHY: Without this, attackers can add extra outputs minting unauthorized tokens.
    The contract validates expected outputs but ignores extras - this prevents that.

25. 5-POINT COVENANT VALIDATION CHECKLIST:
    For ANY self-replicating covenant, validate ALL five properties:

    // 1. Same contract code (prevents code injection)
    require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
    // 2. Same token category (prevents category substitution)
    require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
    // 3. Expected satoshi value (prevents value extraction)
    require(tx.outputs[0].value == expectedValue);
    // 4. Expected token amount (prevents token extraction)
    require(tx.outputs[0].tokenAmount == expectedTokenAmount);
    // 5. Expected/new state commitment (prevents state manipulation)
    require(tx.outputs[0].nftCommitment == newCommitment);

    Missing ANY of these creates exploitable vulnerabilities.

DOCUMENTATION SCALING - MATCH OUTPUT VERBOSITY TO INPUT COMPLEXITY:
- Simple contracts (constants, basic getters, trivial logic) → Minimal code only
  * pragma + clean code, no excessive comments
  * No BCH vs Ethereum explanations unless conversion logic is non-obvious
  * No documentation blocks for trivial contracts
  * Example: 7-line Solidity constant → ~15 line CashScript, not 100+ lines

- Complex contracts (state machines, covenants, multi-contract systems) → Full documentation
  * Apply BCHess-style documentation (see below)
  * Include NFT state blocks, input/output tables, inline comments
  * Explain state transitions and validation logic

PROFESSIONAL DOCUMENTATION REQUIREMENTS (for complex contracts only):
When contract complexity warrants it, include BCHess-style professional documentation:

1. NFT STATE BLOCK (before contract declaration):
   /*  --- ContractName [Mutable/Immutable/none] NFT State ---
       type variableName = defaultValue        // optional comment
   */
   - Use "Mutable" if contract modifies nftCommitment
   - Use "Immutable" if contract has fixed constructor params only
   - Use "none" if no NFT state exists
   - List ALL state variables with types and default values

2. FUNCTION DOCUMENTATION (before each function):
   //////////////////////////////////////////////////////////////////////////////////////////
   //  Brief description of what the function does and why.
   //
   //inputs:
   //  idx   Name                      [TYPE]      (from source)
   //outputs:
   //  idx   Name                      [TYPE]      (to destination)
   //////////////////////////////////////////////////////////////////////////////////////////

   - Separator: min 78 chars, extend to match longest line
   - Column alignment: Index @4, Name @30, Type @42
   - Index notation: 0-N (fixed), ? (variable), ranges (2-65)
   - Type annotations: [NFT], [BCH], [FT]
   - Source/destination: ALWAYS specify (from X), (to X)
   - Optional outputs: Mark with {optional}

3. INLINE COMMENTS:
   - Explain validation logic: require(x) // Why this check matters
   - Document state transitions: int newCount = old + 1; // Increment
   - Clarify business logic: if (value == 1000) // No pledges = initial state

4. MULTI-CONTRACT DOCUMENTATION:
   - Show clear UTXO flow between contracts
   - Document input/output for each function in every contract
   - Consistent naming across related contracts
   - NFT state blocks for all contracts in the system

Examples in knowledge base: BCHess contracts (8 contracts), CashStarter (6 contracts)

Respond with valid JSON. Use ONE of these structures:

FOR SINGLE CONTRACT (simple translations):
{
  "primaryContract": "string - Complete CashScript code with pragma, documentation, and all functions"
}

FOR MULTI-CONTRACT SYSTEMS (when Solidity pattern requires multiple CashScript contracts):
{
  "contracts": [
    {
      "id": "unique-id",
      "name": "Human Readable Name",
      "purpose": "What this contract does in the system",
      "code": "pragma cashscript ^0.13.0;...",
      "role": "primary | helper | state",
      "deploymentOrder": 1,
      "dependencies": ["other-contract-id"],
      "constructorParams": [
        {
          "name": "paramName",
          "type": "pubkey | bytes | bytes32 | int",
          "description": "What this parameter is for",
          "source": "user-provided | from-contract | computed",
          "sourceContractId": "null or id of contract that produces this value"
        }
      ]
    }
  ],
  "deploymentGuide": {
    "steps": [
      {
        "order": 1,
        "contractId": "contract-id",
        "description": "Step description",
        "prerequisites": ["What must exist before this step"],
        "outputs": ["What this step produces (e.g., tokenCategory ID)"]
      }
    ],
    "warnings": ["Important deployment considerations"],
    "testingNotes": ["How to verify the system works"]
  }
}

CONTRACT ROLE DEFINITIONS (critical for UI display order):
- "primary": Main user-facing contracts that handle core logic
  * Examples: VotingBooth (voting system), Manager/Main (CashStarter), ChessMaster (BCHess)
  * These are displayed FIRST in the UI tabs
  * Users interact with these contracts directly

- "helper": Utility contracts that assist primary contracts
  * Examples: Cancel, Claim, Refund, Stop (CashStarter helpers)
  * These are displayed SECOND in the UI tabs
  * Usually have sentinel IDs (0xFFFFFFFFFF) and validate primary contract NFTs

- "state": State storage and registry contracts
  * Examples: VoterRegistry, ProposalCounter, data holders
  * These are displayed LAST in the UI tabs
  * Primarily store and manage state data

IMPORTANT: Assign roles carefully - the UI sorts by role first (primary → helper → state), then by deploymentOrder within each role.

Use multi-contract structure when:
- Solidity contract has complex state that needs multiple CashScript contracts to manage
- Pattern requires separate logic contracts (like BCHess piece validators)
- System needs helper contracts (like CashStarter's cancel/claim/refund)
- Factory patterns that create child contracts

Use your best judgment. Include deployment order and parameter sources for multi-contract systems.`;
}

// Streaming conversion endpoint with real-time progress
app.post('/api/convert-stream', rateLimiter, async (req, res) => {
  if (activeConversions >= SERVER_CONFIG.maxConcurrentConversions) {
    return res.status(503).json({
      error: 'Server busy',
      message: `Maximum ${SERVER_CONFIG.maxConcurrentConversions} concurrent conversions. Please try again in a moment.`
    });
  }

  activeConversions++;
  const startTime = Date.now();
  let conversionId: number | undefined;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let clientDisconnected = false;
  res.on('close', () => {
    clientDisconnected = true;
  });

  const sendEvent = (event: string, data: any) => {
    if (!res.writable) {
      throw new Error('AbortError: Client disconnected');
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const endResponse = () => {
    if (!res.writable) {
      throw new Error('AbortError: Client disconnected');
    }
    res.end();
  };

  let sentContracts = new Set<string>();

  try {
    const { contract } = req.body;

    const validation = validateContractInput(contract);
    if (!validation.valid) {
      sendEvent('error', { message: validation.error });
      endResponse();
      return;
    }
    const metadata = req.metadata!;
    conversionId = logConversionStart(metadata, contract);

    // PHASE 1: Domain Extraction
    sendEvent('phase1_start', { message: 'Extracting domain model...' });

    let domainModel: DomainModel;
    let domainModelJSON: string;

    try {
      if (clientDisconnected) throw new Error('AbortError: Client disconnected');

      const phase1Result = await executeDomainExtraction(anthropic, conversionId, contract);
      domainModel = phase1Result.domainModel;
      domainModelJSON = JSON.stringify(domainModel, null, 2);
      sendEvent('phase1_complete', {
        message: 'Domain extraction complete',
        domain: domainModel.domain,
        entities: domainModel.entities.length,
        transitions: domainModel.transitions.length
      });
    } catch (phase1Error) {
      console.error('[Phase 1] Domain extraction failed:', phase1Error);
      sendEvent('error', {
        phase: 1,
        message: 'Domain extraction failed',
        details: phase1Error instanceof Error ? phase1Error.message : String(phase1Error)
      });
      endResponse();
      return;
    }

    // PHASE 2: UTXO Architecture Design
    sendEvent('phase2_start', { message: 'Designing UTXO architecture...' });

    let utxoArchitecture: UTXOArchitecture;
    let utxoArchitectureJSON: string;

    try {
      if (clientDisconnected) throw new Error('AbortError: Client disconnected');

      const phase2Result = await executeArchitectureDesign(anthropic, conversionId, domainModel);
      utxoArchitecture = phase2Result.architecture;

      // Filter documentation-only contracts before Phase 3
      const { filtered, removedCount } = filterDocumentationOnlyContracts(utxoArchitecture);
      utxoArchitecture = filtered;

      utxoArchitectureJSON = JSON.stringify(utxoArchitecture, null, 2);

      const contractCount = Array.isArray(utxoArchitecture.contracts) ? utxoArchitecture.contracts.length : 0;
      const patternNames = Array.isArray(utxoArchitecture.patterns)
        ? utxoArchitecture.patterns.map(p => p?.name || 'unnamed')
        : [];

      sendEvent('phase2_complete', {
        message: 'Architecture design complete',
        contracts: contractCount,
        patterns: patternNames,
        durationMs: phase2Result.durationMs
      });

      // Send transaction templates for UI
      const transactionTemplates = Array.isArray(utxoArchitecture.transactionTemplates)
        ? utxoArchitecture.transactionTemplates
        : [];
      const contractSpecs = Array.isArray(utxoArchitecture.contracts)
        ? utxoArchitecture.contracts.map(c => ({ name: c.name, custodies: c.custodies, validates: c.validates }))
        : [];
      if (transactionTemplates.length > 0 || contractSpecs.length > 0) {
        sendEvent('transactions_ready', {
          transactions: transactionTemplates,
          contractSpecs: contractSpecs
        });
      }
    } catch (phase2Error) {
      console.error('[Phase 2] Architecture design failed:', phase2Error);
      sendEvent('error', {
        phase: 2,
        message: 'Architecture design failed',
        details: phase2Error instanceof Error ? phase2Error.message : String(phase2Error)
      });
      endResponse();
      return;
    }

    // PHASE 3: Code Generation
    sendEvent('phase3_start', { message: 'Generating CashScript...' });

    const systemPrompt = buildCodeGenerationPrompt();
    let parsed: any;
    let validationPassed = false;
    let validationError: string | undefined;
    let retryMessage: string = '';
    let savedValidContracts: any[] = [];
    let isMultiContractMode = false;
    let savedDeploymentGuide: any = null;
    let originalContractOrder: string[] = [];
    let contractAttempts: Map<string, number> = new Map();
    let totalExpectedContracts = 0;
    let expectedFailedNames: string[] = [];

    for (let attemptNumber = 1; attemptNumber <= ANTHROPIC_CONFIG.phase2.maxRetries; attemptNumber++) {
      if (clientDisconnected) throw new Error('AbortError: Client disconnected');

      const messageContent = attemptNumber === 1
        ? `DOMAIN MODEL (what the system does - platform-agnostic):
${domainModelJSON}

UTXO ARCHITECTURE (how to implement it):
${utxoArchitectureJSON}

Generate CashScript contracts based on the UTXO architecture above. Follow the contract specifications exactly:
- Use the contract names, roles, and validation purposes from the architecture
- Implement the functions as specified with their validation requirements
- Follow the transaction templates for input/output positions
- Apply the mandatory checklist from the system prompt

Every contract must validate something. Every function must add constraints. No placeholders.`
        : retryMessage;

      const apiCallStartTime = Date.now();
      const apiCallId = logApiCallStart(conversionId, attemptNumber, messageContent);

      if (clientDisconnected) throw new Error('AbortError: Client disconnected');

      let selectedSchema;
      if (attemptNumber === 1) {
        selectedSchema = outputSchema;
      } else {
        selectedSchema = isMultiContractMode ? retryOutputSchemaMulti : retryOutputSchemaSingle;
      }

      const message = await anthropic.beta.messages.create({
        model: ANTHROPIC_CONFIG.phase2.model,
        max_tokens: ANTHROPIC_CONFIG.phase2.maxTokens,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: ANTHROPIC_CONFIG.cache.type, ttl: ANTHROPIC_CONFIG.cache.ttl }
          }
        ],
        betas: [...ANTHROPIC_CONFIG.betas],
        output_format: selectedSchema,
        messages: [
          {
            role: 'user',
            content: messageContent
          }
        ]
      });

      const response = message.content[0].type === 'text' ? message.content[0].text : '';
      const usage = message.usage;

      try {
        parsed = JSON.parse(response);
      } catch (parseError) {
        sendEvent('error', {
          phase: 3,
          message: 'Response truncated - contract too complex',
          details: parseError instanceof Error ? parseError.message : String(parseError)
        });
        endResponse();
        return;
      }

      // Normalize and filter contracts
      if (parsed.contracts && Array.isArray(parsed.contracts)) {
        normalizeContractNames(parsed.contracts);

        const beforeFilter = parsed.contracts.length;
        parsed.contracts = parsed.contracts.filter((c: ContractInfo) => {
          if (isPlaceholderContract(c.code)) {
            console.log(`[Filter] Removing placeholder contract: ${c.name}`);
            return false;
          }
          return true;
        });
        const removed = beforeFilter - parsed.contracts.length;
        if (removed > 0) {
          console.log(`[Filter] Removed ${removed} placeholder contract(s)`);
        }
      }

      // After first attempt, track mode and start Phase 4
      if (attemptNumber === 1) {
        sendEvent('phase3_complete', { message: 'Code generation complete' });
        sendEvent('phase4_start', { message: 'Validating contracts... You\'ll be redirected to results as soon as we have something to show. We\'ll keep working on the rest in the background.' });

        isMultiContractMode = isMultiContractResponse(parsed);
        if (isMultiContractMode && parsed.deploymentGuide) {
          savedDeploymentGuide = parsed.deploymentGuide;
          originalContractOrder = parsed.contracts.map((c: any) => c.name);
          totalExpectedContracts = parsed.contracts.length;
          parsed.contracts.forEach((c: any) => {
            contractAttempts.set(c.name, 1);
          });
        } else if (!isMultiContractMode) {
          totalExpectedContracts = 1;
        }
      } else if (attemptNumber > 1 && isMultiContractMode) {
        // Merge saved valid contracts with newly fixed contracts
        const fixedContracts = parsed.contracts || [];

        if (fixedContracts.length > 0 && expectedFailedNames.length > 0) {
          const validNames = new Set(savedValidContracts.map((c: any) => c.name));

          for (const fixedContract of fixedContracts) {
            if (!validNames.has(fixedContract.name) && !expectedFailedNames.includes(fixedContract.name)) {
              const unmatchedExpected = expectedFailedNames.find(name =>
                !fixedContracts.some(c => c.name === name)
              );
              if (unmatchedExpected) {
                console.warn(`[Merge] Contract name changed during retry: "${fixedContract.name}" -> renaming to expected "${unmatchedExpected}"`);
                fixedContract.name = unmatchedExpected;
              } else {
                console.error(`[Merge] ERROR: Fixed contract "${fixedContract.name}" doesn't match any expected failed name: [${expectedFailedNames.join(', ')}]`);
              }
            }
          }
        }

        for (const fixedContract of fixedContracts) {
          contractAttempts.set(fixedContract.name, attemptNumber);
        }

        const contractMap = new Map();
        for (const contract of savedValidContracts) {
          const contractCopy = {
            ...contract,
            dependencies: contract.dependencies ? [...contract.dependencies] : [],
            constructorParams: contract.constructorParams ? [...contract.constructorParams] : []
          };
          contractMap.set(contract.name, contractCopy);
        }

        for (const fixedContract of fixedContracts) {
          const wasValidated = savedValidContracts.some(c => c.name === fixedContract.name);
          if (wasValidated) {
            console.warn(`[Merge] WARNING: AI returned already-validated contract "${fixedContract.name}" - ignoring AI version, keeping original`);
          } else {
            contractMap.set(fixedContract.name, fixedContract);
          }
        }

        const mergedContracts: any[] = [];
        for (const name of originalContractOrder) {
          const contract = contractMap.get(name);
          if (contract) {
            mergedContracts.push(contract);
          } else {
            console.error(`[Merge] ERROR: Contract "${name}" missing from merge`);
          }
        }

        parsed = {
          contracts: mergedContracts,
          deploymentGuide: savedDeploymentGuide
        };
      }

      // Validate contracts
      const isMultiContract = isMultiContractResponse(parsed);

      if (isMultiContract) {
        updateConversion(conversionId, {
          is_multi_contract: true,
          contract_count: parsed.contracts.length
        });

        const multiValidation = validateMultiContractResponse(parsed, sentContracts);
        validationPassed = multiValidation.allValid;
        validationError = multiValidation.firstError;

        const contractStatus = parsed.contracts.map((c: ContractInfo) => ({
          name: c.name,
          validated: c.validated || false,
          attempt: contractAttempts.get(c.name) || attemptNumber
        }));

        sendEvent('validation', {
          passed: validationPassed,
          validCount: multiValidation.validCount,
          failedCount: multiValidation.failedCount,
          attempt: attemptNumber,
          maxAttempts: ANTHROPIC_CONFIG.phase2.maxRetries,
          contracts: contractStatus,
          isMultiContract: true
        });

        // Send contract_ready events for newly validated contracts
        for (const contract of parsed.contracts) {
          if (contract.validated && !sentContracts.has(contract.name)) {
            const contractReadyData: any = {
              contract: contract,
              totalExpected: totalExpectedContracts,
              readySoFar: sentContracts.size + 1
            };

            if (sentContracts.size === 0 && savedDeploymentGuide) {
              contractReadyData.deploymentGuide = savedDeploymentGuide;
            }

            sendEvent('contract_ready', contractReadyData);
            sentContracts.add(contract.name);
          }
        }
      } else {
        const singleValidation = validateContract(parsed.primaryContract);
        validationPassed = singleValidation.valid;
        validationError = singleValidation.error ? enhanceErrorMessage(singleValidation.error, parsed.primaryContract) : singleValidation.error;

        sendEvent('validation', {
          passed: validationPassed,
          attempt: attemptNumber,
          maxAttempts: ANTHROPIC_CONFIG.phase2.maxRetries,
          isMultiContract: false
        });

        if (validationPassed) {
          parsed.validated = true;
          parsed.bytecodeSize = singleValidation.bytecodeSize;
          parsed.artifact = singleValidation.artifact;
          updateConversion(conversionId, { contract_count: 1 });

          if (!sentContracts.has('primary')) {
            const contractNameMatch = parsed.primaryContract.match(/contract\s+(\w+)/);
            const contractName = contractNameMatch ? contractNameMatch[1] : 'Primary Contract';

            sendEvent('contract_ready', {
              contract: {
                id: 'primary',
                name: contractName,
                code: parsed.primaryContract,
                validated: true,
                bytecodeSize: parsed.bytecodeSize,
                artifact: parsed.artifact,
                role: 'primary',
                deploymentOrder: 1,
                dependencies: [],
                constructorParams: []
              },
              totalExpected: 1,
              readySoFar: 1
            });
            sentContracts.add('primary');
          }
        }
      }

      // Save valid contracts for retries
      if (isMultiContract && !validationPassed) {
        savedValidContracts = parsed.contracts.filter((c: ContractInfo) => c.validated);
      }

      logApiCallComplete(
        apiCallId,
        apiCallStartTime,
        true,
        response,
        undefined,
        {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_tokens: usage.cache_read_input_tokens || 0,
          cache_write_tokens: usage.cache_creation_input_tokens || 0
        },
        isMultiContract ? 'multi' : 'single'
      );

      if (validationPassed) {
        // Store contracts in database
        if (isMultiContract) {
          for (const contract of parsed.contracts) {
            const contractUuid = generateUUID();
            const codeHash = generateHash(contract.code);
            const lineCount = contract.code.split('\n').length;

            insertContract({
              conversion_id: conversionId,
              contract_uuid: contractUuid,
              produced_by_attempt: attemptNumber,
              name: contract.name,
              role: contract.role,
              purpose: contract.purpose,
              cashscript_code: contract.code,
              code_hash: codeHash,
              deployment_order: contract.deploymentOrder,
              bytecode_size: contract.bytecodeSize,
              line_count: lineCount,
              is_validated: contract.validated || false
            });
          }
        } else {
          const contractUuid = generateUUID();
          const codeHash = generateHash(parsed.primaryContract);
          const lineCount = parsed.primaryContract.split('\n').length;

          insertContract({
            conversion_id: conversionId,
            contract_uuid: contractUuid,
            produced_by_attempt: attemptNumber,
            name: 'Primary Contract',
            role: 'primary',
            purpose: undefined,
            cashscript_code: parsed.primaryContract,
            code_hash: codeHash,
            deployment_order: 1,
            bytecode_size: parsed.bytecodeSize,
            line_count: lineCount,
            is_validated: parsed.validated || false
          });
        }

        sendEvent('phase4_complete', { message: 'Validation complete' });

        // Check for name drift and update transaction templates
        if (isMultiContract && utxoArchitecture.transactionTemplates?.length > 0) {
          const nameMap = new Map<string, string>();
          const archContracts = utxoArchitecture.contracts || [];
          const validatedContracts = parsed.contracts || [];

          for (let i = 0; i < archContracts.length; i++) {
            const archName = archContracts[i]?.name;
            const validatedName = validatedContracts[i]?.name;
            if (archName && validatedName && archName !== validatedName) {
              console.log(`[Transactions] Name drift detected: "${archName}" → "${validatedName}"`);
              nameMap.set(archName, validatedName);
            }
          }

          if (nameMap.size > 0) {
            const updatedTemplates = applyNameMappingToTemplates(
              utxoArchitecture.transactionTemplates,
              nameMap
            );
            sendEvent('transactions_ready', { transactions: updatedTemplates });
            console.log(`[Transactions] Sent updated templates with ${nameMap.size} name corrections`);
          }
        }

        break;
      }

      // Build retry message
      if (attemptNumber === ANTHROPIC_CONFIG.phase2.maxRetries) {
        sendEvent('error', {
          phase: 4,
          message: `Contract validation failed after ${ANTHROPIC_CONFIG.phase2.maxRetries} attempts. This is not a deterministic system, so just try again - it's likely to work!`,
          details: validationError
        });
        endResponse();
        return;
      }

      if (isMultiContract) {
        const failedContracts = parsed.contracts.filter((c: ContractInfo) => !c.validated);
        const failedContractNames = failedContracts.map((c: ContractInfo) => c.name).join(', ');
        expectedFailedNames = failedContracts.map((c: ContractInfo) => c.name);

        retryMessage = `Fix ONLY the specific compilation errors in the following ${failedContracts.length} ${failedContracts.length === 1 ? 'contract' : 'contracts'}:\n\n`;

        failedContracts.forEach((c: ContractInfo) => {
          retryMessage += `CONTRACT: ${c.name}\n`;
          retryMessage += `CURRENT CODE:\n${c.code}\n\n`;
          retryMessage += `COMPILATION ERROR:\n${c.validationError}\n\n`;
          retryMessage += `INSTRUCTIONS: Make MINIMAL changes to fix ONLY this specific error. Do NOT restructure the contract, change function logic, or modify working code. Only fix what the compiler is complaining about.\n\n`;
          retryMessage += `---\n\n`;
        });

        retryMessage += `CRITICAL RULES:\n`;
        retryMessage += `1. Return ONLY these ${failedContracts.length} ${failedContracts.length === 1 ? 'contract' : 'contracts'}: ${failedContractNames}\n`;
        retryMessage += `2. Do NOT include any already-validated contracts in your response\n`;
        retryMessage += `3. Make MINIMAL changes - only fix the specific compilation error\n`;
        retryMessage += `4. Do NOT change contract structure, logic, or working code\n`;
        retryMessage += `5. If the error is about an unused variable, remove ONLY that variable\n`;
        retryMessage += `6. If the error is about a missing parameter, add ONLY that parameter\n`;
        retryMessage += `7. Do NOT rewrite functions, change business logic, or alter contract behavior`;
      } else {
        retryMessage = `Fix the following compilation error:\n\n`;
        retryMessage += `CURRENT CODE:\n${parsed.primaryContract}\n\n`;
        retryMessage += `COMPILATION ERROR:\n${validationError}\n\n`;
        retryMessage += `INSTRUCTIONS:\n`;
        retryMessage += `Make MINIMAL changes to fix ONLY this specific error.\n`;
        retryMessage += `Do NOT restructure the contract or change its logic.\n`;
        retryMessage += `Only fix what the compiler is complaining about.\n\n`;
        retryMessage += `Return the corrected contract code.`;
      }
    }

    logConversionComplete(conversionId, startTime, 'success');
    sendEvent('done', parsed);
    endResponse();

  } catch (error) {
    console.error('[Conversion] Error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (conversionId) {
      logConversionComplete(conversionId, startTime, 'error');
    }

    if (sentContracts.size === 0) {
      sendEvent('error', {
        message: 'Internal server error',
        details: errorMessage
      });
    } else {
      sendEvent('done', { partialSuccess: true });
    }
    endResponse();
  } finally {
    activeConversions--;
  }
});

app.get('*', (_req, res) => {
  res.sendFile(join(process.cwd(), 'dist', 'index.html'));
});

init().then(() => {
  const server = app.listen(SERVER_CONFIG.port, () => {
    console.log(`[Server] Running on http://localhost:${SERVER_CONFIG.port}`);
  });

  server.timeout = SERVER_CONFIG.timeout;
  server.keepAliveTimeout = SERVER_CONFIG.keepAliveTimeout;
  server.headersTimeout = SERVER_CONFIG.headersTimeout;

  process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down gracefully...');
    server.close(() => {
      console.log('[Server] HTTP server closed');
      closeDatabase();
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('[Server] SIGINT received, shutting down gracefully...');
    server.close(() => {
      console.log('[Server] HTTP server closed');
      closeDatabase();
      process.exit(0);
    });
  });
}).catch((error) => {
  console.error('[FATAL] Server initialization failed:', error);
  process.exit(1);
});
