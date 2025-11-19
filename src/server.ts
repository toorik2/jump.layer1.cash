import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileString } from 'cashc';
import { initializeDatabase, closeDatabase, updateConversion, insertContract, generateHash, generateUUID } from './database.js';
import { loggerMiddleware } from './middleware/logger.js';
import {
  logConversionStart,
  logConversionComplete,
  logApiCallStart,
  logApiCallComplete,
  logAlternatives,
  logConsiderations,
  logValidationResult,
  logRetryAttempt,
  logError,
} from './services/logging.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(loggerMiddleware);
app.use(express.static('dist'));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Maximum number of retry attempts when validation fails
// With prompt caching, retries are cost-effective (90% savings on cache hits)
const MAX_RETRIES = 10;

// Maximum output tokens per API call
// Set to 21K - max for non-streaming (SDK requires streaming above ~21,333 for 10min+ operations)
// Claude Sonnet 4.5 supports up to 64K tokens, but we use 21K to avoid streaming complexity
const MAX_OUTPUT_TOKENS = 21000;

// Preamble message for initial conversion attempts
// Explicitly connects the system prompt (rules, knowledge base) to the user's Solidity code
const CONVERSION_PREAMBLE = "Based on the CashScript language reference and conversion rules provided above, convert the following Solidity smart contract to CashScript:";

let knowledgeBase = '';

async function init() {
  console.log('[Server] Initializing database...');
  initializeDatabase();

  console.log('[Server] Loading CashScript language reference...');
  knowledgeBase = await readFile('./cashscript-knowledge-base/language/language-reference.md', 'utf-8');
  console.log(`[Server] Knowledge base loaded: ${knowledgeBase.length} characters`);
}

function validateContract(code: string): { valid: boolean; error?: string; bytecodeSize?: number; artifact?: any } {
  try {
    const artifact = compileString(code);
    const bytecodeSize = artifact.bytecode.length / 2;
    return { valid: true, bytecodeSize, artifact };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}

// Type definitions for multi-contract responses
interface ContractParam {
  name: string;
  type: string;
  description: string;
  source: string;
  sourceContractId: string | null;
}

interface ContractInfo {
  id: string;
  name: string;
  purpose: string;
  code: string;
  role: string;
  deploymentOrder: number;
  dependencies: string[];
  constructorParams: ContractParam[];
  validated?: boolean;
  bytecodeSize?: number;
  artifact?: any;
  validationError?: string;
}

interface DeploymentStep {
  order: number;
  contractId: string;
  description: string;
  prerequisites: string[];
  outputs: string[];
}

interface DeploymentGuide {
  steps: DeploymentStep[];
  warnings: string[];
  testingNotes: string[];
}

interface MultiContractResponse {
  contracts: ContractInfo[];
  deploymentGuide: DeploymentGuide;
}

interface SingleContractResponse {
  primaryContract: string;
  validated?: boolean;
  bytecodeSize?: number;
  artifact?: any;
}

function isMultiContractResponse(parsed: any): parsed is MultiContractResponse {
  return parsed.contracts && Array.isArray(parsed.contracts);
}

// JSON Schema for structured outputs
const outputSchema = {
  type: "json_schema",
  schema: {
    anyOf: [
      {
        // Single contract response
        type: "object",
        properties: {
          primaryContract: {
            type: "string",
            description: "Complete CashScript contract code with pragma, documentation, and all functions"
          }
        },
        required: ["primaryContract"],
        additionalProperties: false
      },
      {
        // Multi-contract response
        type: "object",
        properties: {
          contracts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                purpose: { type: "string" },
                code: { type: "string" },
                role: {
                  type: "string",
                  enum: ["primary", "helper", "state"]
                },
                deploymentOrder: { type: "integer" },
                dependencies: {
                  type: "array",
                  items: { type: "string" }
                },
                constructorParams: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      type: { type: "string" },
                      description: { type: "string" },
                      source: { type: "string" },
                      sourceContractId: {
                        type: ["string", "null"]
                      }
                    },
                    required: ["name", "type", "description", "source", "sourceContractId"],
                    additionalProperties: false
                  }
                }
              },
              required: ["id", "name", "purpose", "code", "role", "deploymentOrder", "dependencies", "constructorParams"],
              additionalProperties: false
            }
          },
          deploymentGuide: {
            type: "object",
            properties: {
              steps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    order: { type: "integer" },
                    contractId: { type: "string" },
                    description: { type: "string" },
                    prerequisites: {
                      type: "array",
                      items: { type: "string" }
                    },
                    outputs: {
                      type: "array",
                      items: { type: "string" }
                    }
                  },
                  required: ["order", "contractId", "description", "prerequisites", "outputs"],
                  additionalProperties: false
                }
              },
              warnings: {
                type: "array",
                items: { type: "string" }
              },
              testingNotes: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["steps", "warnings", "testingNotes"],
            additionalProperties: false
          }
        },
        required: ["contracts", "deploymentGuide"],
        additionalProperties: false
      }
    ]
  }
} as const;

function validateMultiContractResponse(parsed: MultiContractResponse): {
  allValid: boolean;
  firstError?: string;
  validCount: number;
  failedCount: number;
  failedContracts: string[];
} {
  let allValid = true;
  let firstError: string | undefined;
  let validCount = 0;
  let failedCount = 0;
  const failedContracts: string[] = [];

  for (const contract of parsed.contracts) {
    const validation = validateContract(contract.code);
    contract.validated = validation.valid;
    if (validation.valid) {
      contract.bytecodeSize = validation.bytecodeSize;
      contract.artifact = validation.artifact;
      validCount++;
    } else {
      contract.validationError = validation.error;
      failedCount++;
      failedContracts.push(contract.name);
      if (allValid) {
        allValid = false;
        firstError = `${contract.name}: ${validation.error}`;
      }
    }
  }

  return { allValid, firstError, validCount, failedCount, failedContracts };
}

app.post('/api/convert', async (req, res) => {
  const startTime = Date.now();
  let conversionId: number | undefined;

  try {
    console.log('[Conversion] Received conversion request');
    const { contract } = req.body;
    const metadata = req.metadata!;

    // Log conversion start (async, but wait for ID)
    conversionId = await logConversionStart(metadata, contract);
    console.log(`[Conversion] Started with ID ${conversionId}`);

    const systemPrompt = `You are a CashScript expert. Convert EVM (Solidity) smart contracts to CashScript.

CashScript Language Reference:
${knowledgeBase}

CRITICAL RULES:
1. Always use "pragma cashscript ^0.13.0;" at the top of every CashScript contract.

2. EVERY function parameter you declare MUST be used in the function body.
   - CashScript compiler strictly enforces this requirement (similar to Rust)
   - If a parameter is not needed in the function logic, do NOT declare it
   - This is the most common cause of compilation failures
   - Example: function transfer(pubkey recipient, sig senderSig) requires BOTH recipient and senderSig to be used

3. BCH is UTXO-based (stateless), NOT account-based like Ethereum.
   - Solidity state variables that can be updated → CashScript MUST use covenant patterns
   - "Update" means: spend old UTXO, enforce output creates new UTXO with new constructor params
   - Use tx.outputs constraints to enforce recreation (see STATE VARIABLES section in reference)
   - Remove "read" functions - reading is done off-chain by inspecting constructor parameters

4. For DATA STORAGE, use NFT commitments, NOT OP_RETURN.
   - OP_RETURN is provably unspendable (funds burned) - use ONLY for event logging
   - NFT commitments provide local transferrable state (40 bytes, 128 bytes planned 2026)
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

8. Pack structured data into 40-byte NFT commitments.
   - Plan byte layout: [pubkeyhash(20) + reserved(18) + blocks(2)] = 40 bytes
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

    // Attempt validation with up to MAX_RETRIES attempts
    let parsed: any;
    let validationPassed = false;
    let validationError: string | undefined;
    let retryMessage: string = '';

    for (let attemptNumber = 1; attemptNumber <= MAX_RETRIES; attemptNumber++) {
      // Determine message content for this attempt
      // Initial attempt: Add preamble to connect system prompt with user's Solidity code
      // Retry attempts: Use detailed retry message with error context
      const messageContent = attemptNumber === 1
        ? `${CONVERSION_PREAMBLE}\n\n${contract}`
        : retryMessage;
      const attemptLabel = attemptNumber === 1 ? 'initial attempt' : `retry ${attemptNumber - 1}/${MAX_RETRIES - 1}`;

      console.log(`[Conversion] Calling Anthropic API (${attemptLabel})...`);
      const apiCallStartTime = Date.now();
      const apiCallId = await logApiCallStart(conversionId, attemptNumber, 'claude-sonnet-4-5-20250929', MAX_OUTPUT_TOKENS, messageContent);

      const message = await anthropic.beta.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: MAX_OUTPUT_TOKENS,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral", ttl: "1h" }
          }
        ],
        betas: ['structured-outputs-2025-11-13'],
        output_format: outputSchema,
        messages: [
          {
            role: 'user',
            content: messageContent
          }
        ]
      });

      const response = message.content[0].type === 'text' ? message.content[0].text : '';

      // Log cache usage metrics
      const usage = message.usage;
      const apiDuration = ((Date.now() - apiCallStartTime) / 1000).toFixed(2);
      console.log(`[Cache] API call completed in ${apiDuration}s`);
      console.log('[Cache] Usage metrics:', {
        input_tokens: usage.input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        output_tokens: usage.output_tokens
      });
      if (usage.cache_creation_input_tokens) {
        console.log('[Cache] ✓ 1-hour cache created:', usage.cache_creation_input_tokens, 'tokens (2x cost)');
      }
      if (usage.cache_read_input_tokens) {
        console.log('[Cache] ✓ 1-hour cache hit:', usage.cache_read_input_tokens, 'tokens (0.1x cost - 90% savings!)');
      }

      // Calculate cost for Sonnet 4.5: $3/MTok input, $15/MTok output
      // 1-hour cache: write=2x ($6), read=0.1x ($0.30)
      const inputCost = (usage.input_tokens * 3.0 +
                        (usage.cache_creation_input_tokens || 0) * 6.0 +
                        (usage.cache_read_input_tokens || 0) * 0.30) / 1000000;
      const outputCost = (usage.output_tokens * 15.0) / 1000000;
      console.log(`[Cache] Cost: $${(inputCost + outputCost).toFixed(4)} (input: $${inputCost.toFixed(4)}, output: $${outputCost.toFixed(4)})`);

      // Parse JSON response with error handling
      try {
        parsed = JSON.parse(response);
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.error('[Conversion] JSON parse error:', errorMsg);
        console.error('[Conversion] Response length:', response.length, 'Max tokens hit:', usage.output_tokens >= MAX_OUTPUT_TOKENS - 100);

        // Log API call with error
        logApiCallComplete(
          apiCallId,
          apiCallStartTime,
          false,
          undefined,
          errorMsg,
          {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_read_tokens: usage.cache_read_input_tokens || 0,
            cache_write_tokens: usage.cache_creation_input_tokens || 0
          }
        ).catch(err => console.error('[Logging] Failed to log API call:', err));

        // Log conversion failure
        logConversionComplete(conversionId, startTime, 'failed').catch(err =>
          console.error('[Logging] Failed to log conversion completion:', err)
        );

        return res.status(500).json({
          error: 'Response truncated - contract too complex',
          message: 'The generated contract exceeded token limits. Try a simpler contract or increase max_tokens.',
          details: errorMsg
        });
      }

      // Detect response type and validate accordingly
      const isMultiContract = isMultiContractResponse(parsed);
      console.log(`[Conversion] Response type: ${isMultiContract ? 'multi-contract' : 'single-contract'}`);

      // Log API call completion with full metrics (don't wait)
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
      ).catch(err => console.error('[Logging] Failed to log API call completion:', err));

      if (isMultiContract) {
        // Update conversion record with multi-contract info
        updateConversion(conversionId, {
          is_multi_contract: true,
          contract_count: parsed.contracts.length
        });

        // Validate all contracts in multi-contract response
        console.log(`[Conversion] Validating ${parsed.contracts.length} contracts...`);
        const multiValidation = validateMultiContractResponse(parsed);
        validationPassed = multiValidation.allValid;
        validationError = multiValidation.firstError;

        if (!validationPassed) {
          console.log(`[Conversion] Multi-contract validation: ${multiValidation.validCount} valid, ${multiValidation.failedCount} failed`);
          console.log(`[Conversion] Failed contracts: ${multiValidation.failedContracts.join(', ')}`);
        }

        // Log validation result (don't wait)
        const firstContract = parsed.contracts[0];
        logValidationResult(conversionId, validationPassed, validationError, firstContract?.bytecodeSize).catch(err =>
          console.error('[Logging] Failed to log validation result:', err)
        );
      } else {
        // Validate single contract
        console.log('[Conversion] Validating primary contract...');
        const validation = validateContract(parsed.primaryContract);
        validationPassed = validation.valid;
        validationError = validation.error;

        // Log validation result (don't wait)
        logValidationResult(conversionId, validation.valid, validation.error, validation.bytecodeSize).catch(err =>
          console.error('[Logging] Failed to log validation result:', err)
        );

        if (validationPassed) {
          parsed.validated = true;
          parsed.bytecodeSize = validation.bytecodeSize;
          parsed.artifact = validation.artifact;
        }
      }

      // If validation passed, we're done
      if (validationPassed) {
        console.log(`[Conversion] Validation successful on attempt ${attemptNumber}`);

        // Store contracts in database
        if (isMultiContract) {
          console.log(`[Conversion] Storing ${parsed.contracts.length} contracts in database...`);
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
          console.log(`[Conversion] ✓ Stored ${parsed.contracts.length} contracts`);
        } else {
          // Store single contract
          console.log('[Conversion] Storing contract in database...');
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
          console.log('[Conversion] ✓ Stored contract');
        }

        if (attemptNumber > 1) {
          // Log successful retry
          logRetryAttempt(conversionId, true).catch(err =>
            console.error('[Logging] Failed to log retry attempt:', err)
          );
        }
        break;
      }

      // If this was the last attempt, exit loop
      if (attemptNumber === MAX_RETRIES) {
        console.log(`[Conversion] All ${MAX_RETRIES} attempts failed`);
        // Log final failed retry
        logRetryAttempt(conversionId, false).catch(err =>
          console.error('[Logging] Failed to log retry attempt:', err)
        );
        break;
      }

      // Build retry message for next attempt
      console.log(`[Conversion] Attempt ${attemptNumber} failed, preparing retry ${attemptNumber + 1}...`);

      // Parse error for unused variable to provide specific guidance
      const unusedVarMatch = validationError?.match(/Unused variable (\w+) at Line (\d+), Column (\d+)/);

      // Build retry message based on response type
      if (isMultiContract) {
        // For multi-contract responses, provide detailed context
        const validContracts = parsed.contracts.filter(c => c.validated);
        const failedContracts = parsed.contracts.filter(c => !c.validated);

        console.log(`[Conversion] Multi-contract retry: ${validContracts.length} valid, ${failedContracts.length} failed`);

        retryMessage = `Original EVM contract:\n${contract}\n\n`;
        retryMessage += `Your previous multi-contract translation generated ${parsed.contracts.length} contracts:\n\n`;

        // List all contracts with their status
        parsed.contracts.forEach(c => {
          retryMessage += `- ${c.name} (${c.role}): ${c.validated ? '✓ VALID' : '✗ FAILED'}\n`;
        });

        retryMessage += `\n`;

        // Include valid contracts for context
        if (validContracts.length > 0) {
          retryMessage += `The following contracts compiled successfully (keep these in your response):\n\n`;
          validContracts.forEach(c => {
            retryMessage += `CONTRACT: ${c.name}\n`;
            retryMessage += `ROLE: ${c.role}\n`;
            retryMessage += `CODE:\n${c.code}\n\n`;
          });
        }

        // Detail failed contracts with errors
        retryMessage += `The following ${failedContracts.length === 1 ? 'contract has' : 'contracts have'} compilation errors:\n\n`;
        failedContracts.forEach(c => {
          retryMessage += `CONTRACT: ${c.name}\n`;
          retryMessage += `ERROR: ${c.validationError}\n`;
          retryMessage += `FAILED CODE:\n${c.code}\n\n`;
        });

        retryMessage += `INSTRUCTIONS:\n`;
        retryMessage += `1. Keep ALL ${validContracts.length} valid contracts EXACTLY as shown above\n`;
        retryMessage += `2. Fix ONLY the ${failedContracts.length} failed ${failedContracts.length === 1 ? 'contract' : 'contracts'}\n`;
        retryMessage += `3. Maintain the same multi-contract architecture (${parsed.contracts.length} contracts total)\n`;
        retryMessage += `4. Return the COMPLETE multi-contract JSON response with all ${parsed.contracts.length} contracts\n`;
        retryMessage += `5. Ensure the deployment order and dependencies remain consistent\n\n`;
        retryMessage += `Fix the compilation errors and provide the corrected multi-contract response.`;
      } else if (unusedVarMatch) {
        const [_, varName, line, column] = unusedVarMatch;
        retryMessage = `Original EVM contract:\n${contract}\n\nYour previous CashScript translation has a critical error:

UNUSED PARAMETER ERROR: The variable '${varName}' at Line ${line}, Column ${column} is declared in your function signature but never used in the function body.

CashScript strictly requires that ALL function parameters must be used (similar to Rust). You have two options:
1. Use the '${varName}' parameter somewhere in your function logic
2. Remove '${varName}' from the function signature if it's not needed for the contract logic

Please fix this specific issue and provide a corrected translation. Make sure every parameter you declare is actually used in the code.`;
      } else {
        // Generic retry message for single-contract errors
        retryMessage = `Original EVM contract:\n${contract}\n\nYour previous CashScript translation has a syntax error:\n${validationError}\n\nPlease fix the syntax error and provide a corrected translation.`;
      }
    }

    // After all attempts, check if validation passed
    if (!validationPassed) {
      console.log('[Conversion] Validation failed after all attempts');

      // Log error (don't wait)
      logError('validation_error', validationError || 'Unknown validation error', conversionId).catch(err =>
        console.error('[Logging] Failed to log error:', err)
      );

      // Log conversion completion (don't wait)
      logConversionComplete(conversionId, startTime, 'validation_failed').catch(err =>
        console.error('[Logging] Failed to log conversion completion:', err)
      );

      return res.status(400).json({
        error: `Contract validation failed after ${MAX_RETRIES} attempts`,
        validationError: validationError
      });
    }

    // Log alternatives and considerations (don't wait)
    if (parsed.alternatives && parsed.alternatives.length > 0) {
      logAlternatives(conversionId, parsed.alternatives).catch(err =>
        console.error('[Logging] Failed to log alternatives:', err)
      );
    }

    if (parsed.considerations && parsed.considerations.length > 0) {
      logConsiderations(conversionId, parsed.considerations).catch(err =>
        console.error('[Logging] Failed to log considerations:', err)
      );
    }

    // Log conversion completion (don't wait)
    logConversionComplete(conversionId, startTime, 'success', parsed.primaryContract, parsed.explanation).catch(err =>
      console.error('[Logging] Failed to log conversion completion:', err)
    );

    console.log('[Conversion] Complete');
    res.json(parsed);

  } catch (error) {
    console.error('[Conversion] Error:', error);

    // Log error (don't wait)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stackTrace = error instanceof Error ? error.stack : undefined;

    if (conversionId) {
      logError('unknown_error', errorMessage, conversionId, stackTrace).catch(err =>
        console.error('[Logging] Failed to log error:', err)
      );

      logConversionComplete(conversionId, startTime, 'error').catch(err =>
        console.error('[Logging] Failed to log conversion completion:', err)
      );
    } else {
      logError('unknown_error', errorMessage, undefined, stackTrace).catch(err =>
        console.error('[Logging] Failed to log error:', err)
      );
    }

    res.status(500).json({
      error: 'Internal server error',
      message: errorMessage
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(join(process.cwd(), 'dist', 'index.html'));
});

init().then(() => {
  const server = app.listen(3001, () => {
    console.log('[Server] Running on http://localhost:3001');
  });

  // Graceful shutdown
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
});
