import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileString } from 'cashc';
import { initializeDatabase, closeDatabase } from './database.js';
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
  explanation: string;
  considerations: string[];
  alternatives?: any[];
}

interface SingleContractResponse {
  primaryContract: string;
  explanation: string;
  considerations: string[];
  alternatives?: any[];
  validated?: boolean;
  bytecodeSize?: number;
  artifact?: any;
}

function isMultiContractResponse(parsed: any): parsed is MultiContractResponse {
  return parsed.contracts && Array.isArray(parsed.contracts);
}

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

Respond with valid JSON. Use ONE of these structures:

FOR SINGLE CONTRACT (simple translations):
{
  "primaryContract": "string - CashScript code",
  "explanation": "string - brief explanation",
  "considerations": ["key differences between EVM and CashScript"],
  "alternatives": [{"name": "string", "contract": "string", "rationale": "string"}]
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
  },
  "explanation": "Overall system explanation",
  "considerations": ["Key differences between EVM and CashScript"],
  "alternatives": [{"name": "Alternative system design", "contracts": [...], "rationale": "Why this alternative"}]
}

Use multi-contract structure when:
- Solidity contract has complex state that needs multiple CashScript contracts to manage
- Pattern requires separate logic contracts (like BCHess piece validators)
- System needs helper contracts (like CashStarter's cancel/claim/refund)
- Factory patterns that create child contracts

Use your best judgment. Include deployment order and parameter sources for multi-contract systems.`;

    // Initial attempt
    console.log('[Conversion] Calling Anthropic API (initial attempt)...');
    const apiCallStartTime = Date.now();
    const apiCallId = await logApiCallStart(conversionId, 1, 'claude-opus-4-1-20250805', 8000, contract);

    let message = await anthropic.messages.create({
      model: 'claude-opus-4-1-20250805',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: contract
        },
        {
          role: 'assistant',
          content: '{'
        }
      ]
    });

    let response = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonString = '{' + response;

    // Log API call completion (don't wait)
    logApiCallComplete(apiCallId, apiCallStartTime, true, response).catch(err =>
      console.error('[Logging] Failed to log API call completion:', err)
    );

    let parsed = JSON.parse(jsonString);

    // Detect response type and validate accordingly
    const isMultiContract = isMultiContractResponse(parsed);
    console.log(`[Conversion] Response type: ${isMultiContract ? 'multi-contract' : 'single-contract'}`);

    let validationPassed = false;
    let validationError: string | undefined;

    if (isMultiContract) {
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

      // Log initial validation result (don't wait)
      logValidationResult(conversionId, validation.valid, validation.error, validation.bytecodeSize).catch(err =>
        console.error('[Logging] Failed to log validation result:', err)
      );

      if (validationPassed) {
        parsed.validated = true;
        parsed.bytecodeSize = validation.bytecodeSize;
        parsed.artifact = validation.artifact;
      }
    }

    if (!validationPassed) {
      console.log('[Conversion] Validation failed, retrying with error feedback...');

      // Retry with validation error
      const retryApiCallStartTime = Date.now();

      // Parse error for unused variable to provide specific guidance
      const unusedVarMatch = validationError?.match(/Unused variable (\w+) at Line (\d+), Column (\d+)/);

      let retryMessage: string;

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

      const retryApiCallId = await logApiCallStart(conversionId, 2, 'claude-opus-4-1-20250805', 8000, retryMessage);

      message = await anthropic.messages.create({
        model: 'claude-opus-4-1-20250805',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: retryMessage
          },
          {
            role: 'assistant',
            content: '{'
          }
        ]
      });

      response = message.content[0].type === 'text' ? message.content[0].text : '';
      const retryJsonString = '{' + response;

      // Log retry API call completion (don't wait)
      logApiCallComplete(retryApiCallId, retryApiCallStartTime, true, response).catch(err =>
        console.error('[Logging] Failed to log retry API call completion:', err)
      );

      parsed = JSON.parse(retryJsonString);

      // Validate retry attempt based on response type
      const retryIsMultiContract = isMultiContractResponse(parsed);
      let retryValidationPassed = false;
      let retryValidationError: string | undefined;
      let retryBytecodeSize: number | undefined;

      if (retryIsMultiContract) {
        const retryMultiValidation = validateMultiContractResponse(parsed);
        retryValidationPassed = retryMultiValidation.allValid;
        retryValidationError = retryMultiValidation.firstError;
        retryBytecodeSize = parsed.contracts[0]?.bytecodeSize;

        if (retryValidationPassed) {
          console.log(`[Conversion] Retry successful: All ${parsed.contracts.length} contracts valid`);
        } else {
          console.log(`[Conversion] Retry validation: ${retryMultiValidation.validCount} valid, ${retryMultiValidation.failedCount} failed`);
          console.log(`[Conversion] Still failing: ${retryMultiValidation.failedContracts.join(', ')}`);
        }
      } else {
        const retryValidation = validateContract(parsed.primaryContract);
        retryValidationPassed = retryValidation.valid;
        retryValidationError = retryValidation.error;
        retryBytecodeSize = retryValidation.bytecodeSize;

        if (retryValidationPassed) {
          parsed.validated = true;
          parsed.bytecodeSize = retryValidation.bytecodeSize;
          parsed.artifact = retryValidation.artifact;
        }
      }

      // Log retry attempt (don't wait)
      logRetryAttempt(conversionId, retryValidationPassed).catch(err =>
        console.error('[Logging] Failed to log retry attempt:', err)
      );

      // Log retry validation result (don't wait)
      logValidationResult(conversionId, retryValidationPassed, retryValidationError, retryBytecodeSize).catch(err =>
        console.error('[Logging] Failed to log retry validation result:', err)
      );

      if (!retryValidationPassed) {
        console.log('[Conversion] Retry validation failed');

        // Log error (don't wait)
        logError('validation_error', retryValidationError || 'Unknown validation error', conversionId).catch(err =>
          console.error('[Logging] Failed to log error:', err)
        );

        // Log conversion completion (don't wait)
        logConversionComplete(conversionId, startTime, 'validation_failed').catch(err =>
          console.error('[Logging] Failed to log conversion completion:', err)
        );

        return res.status(400).json({
          error: 'Contract validation failed after retry',
          validationError: retryValidationError
        });
      }

      console.log('[Conversion] Retry validation successful');
    } else {
      console.log('[Conversion] Initial validation successful');
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
