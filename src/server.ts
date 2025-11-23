import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileString } from 'cashc';
import { initializeDatabase, closeDatabase, updateConversion, insertContract, generateHash, generateUUID, insertSemanticAnalysis } from './database.js';
import { loggerMiddleware } from './middleware/logger.js';
import { rateLimiter } from './middleware/rate-limit.js';
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
import type { SemanticSpecification } from './types/semantic-spec.js';
import { ANTHROPIC_CONFIG, SERVER_CONFIG, calculateCost } from './config.js';

const app = express();
app.use(express.json({ limit: '50kb' })); // Explicit size limit for abuse protection
app.use(cookieParser());
app.use(loggerMiddleware);
app.use(express.static('dist'));

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_CONFIG.apiKey
});

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

/**
 * Extract 3 lines of code context (before, error, after) with visual marker
 * Fails loudly if line number is invalid - no silent fallbacks
 */
function getCodeContext(code: string, errorLine: number): string {
  const lines = code.split('\n');

  if (errorLine < 1 || errorLine > lines.length) {
    console.error(`[ERROR] Line ${errorLine} out of bounds. Code has ${lines.length} lines`);
    throw new Error(`Line number ${errorLine} is out of bounds (code has ${lines.length} lines)`);
  }

  const startLine = Math.max(1, errorLine - 1);
  const endLine = Math.min(lines.length, errorLine + 1);

  let context = '';
  for (let i = startLine; i <= endLine; i++) {
    const prefix = i === errorLine ? '> ' : '  ';
    const lineContent = lines[i - 1].trim();
    context += `${prefix}Line ${i}: ${lineContent}\n`;
  }

  return context.trim();
}

/**
 * Enhance compiler error message with code context
 * Returns original message if no line number is present (e.g., for warnings)
 */
function enhanceErrorMessage(error: string, code: string): string {
  const lineMatch = error.match(/at Line (\d+), Column (\d+)/);

  if (!lineMatch) {
    // Some compiler messages (like warnings) don't have line numbers - that's okay
    console.log('[Compiler] Message without line number:', error);
    return error;
  }

  const lineNum = parseInt(lineMatch[1], 10);
  const context = getCodeContext(code, lineNum);

  return `${error}\n${context}`;
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

// ============================================================================
// PHASE 1: SEMANTIC ANALYSIS
// ============================================================================

// JSON Schema for Phase 1: Semantic Specification
const semanticSpecSchema = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      contractPurpose: {
        type: "string",
        description: "High-level description of what the contract does"
      },
      businessLogic: {
        type: "array",
        items: { type: "string" },
        description: "Critical business rules that must be enforced"
      },
      stateVariables: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            mutability: { type: "string", enum: ["constant", "mutable"] },
            visibility: { type: "string", enum: ["public", "private", "internal"] },
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
            parameters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string" },
                  description: { type: "string" }
                },
                required: ["name", "type", "description"],
                additionalProperties: false
              }
            },
            accessControl: {
              type: "string",
              enum: ["anyone", "owner", "role-based", "conditional"]
            },
            accessControlDetails: { type: "string" },
            stateChanges: {
              type: "array",
              items: { type: "string" }
            },
            requires: {
              type: "array",
              items: { type: "string" }
            },
            ensures: {
              type: "array",
              items: { type: "string" }
            },
            emits: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["name", "purpose", "parameters", "accessControl", "stateChanges", "requires", "ensures", "emits"],
          additionalProperties: false
        }
      },
      accessControlSummary: {
        type: "object",
        properties: {
          roles: {
            type: "array",
            items: { type: "string" }
          },
          patterns: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["roles", "patterns"],
        additionalProperties: false
      },
      dataRelationships: {
        type: "array",
        items: { type: "string" }
      },
      criticalInvariants: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: [
      "contractPurpose",
      "businessLogic",
      "stateVariables",
      "functions",
      "accessControlSummary",
      "dataRelationships",
      "criticalInvariants"
    ],
    additionalProperties: false
  }
} as const;

// Phase 1 System Prompt: Pure semantic extraction (NO UTXO/CashScript thinking)
const SEMANTIC_ANALYSIS_PROMPT = `You are an expert Solidity contract analyzer. Your task is to extract the complete semantic understanding of a Solidity smart contract.

CRITICAL CONTEXT: This analysis will be used to generate a fully functional, production-ready smart contract. Your semantic specification MUST capture ALL business logic, state transitions, and validation rules so that the resulting contract is complete and deployable. Do NOT omit any logic or create simplified/placeholder descriptions - every detail matters for production use.

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

IMPORTANT RULES:
- Extract semantic meaning, not syntax
- Use business terminology, not code terminology
- Be comprehensive - missing logic is the #1 problem we're solving
- Don't make assumptions - if something is unclear, note it in the description
- Don't suggest implementations - just understand what IS
- CRITICAL: Your specification will produce production code with real value - capture EVERY detail, validation, and invariant

Output a complete semantic specification as JSON.`;

// ============================================================================
// PHASE 2: CODE GENERATION
// ============================================================================

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
            description: "Complete production-ready CashScript contract code with pragma and all IMPLEMENTABLE functions (Solidity view/pure functions must be deleted entirely - do not create placeholders)"
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

// Minimal schemas for retry attempts (only request fixed contracts back)
const retryOutputSchemaMulti = {
  type: "json_schema",
  schema: {
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
      }
    },
    required: ["contracts"],
    additionalProperties: false
  }
} as const;

const retryOutputSchemaSingle = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      primaryContract: {
        type: "string",
        description: "Complete CashScript contract code with pragma, documentation, and all functions"
      }
    },
    required: ["primaryContract"],
    additionalProperties: false
  }
} as const;

function validateMultiContractResponse(
  parsed: MultiContractResponse,
  alreadySentContracts?: Set<string>
): {
  allValid: boolean;
  firstError?: string;
  validCount: number;
  failedCount: number;
  failedContracts: string[];
} {
  // Empty contracts array is a failure, not success
  if (!parsed.contracts || parsed.contracts.length === 0) {
    return {
      allValid: false,
      firstError: 'AI returned empty contracts array - no contracts to validate',
      validCount: 0,
      failedCount: 0,
      failedContracts: []
    };
  }

  let allValid = true;
  let firstError: string | undefined;
  let validCount = 0;
  let failedCount = 0;
  const failedContracts: string[] = [];

  for (const contract of parsed.contracts) {
    // CRITICAL FIX: Skip re-validation for already-sent contracts
    // These contracts were already validated and sent to the user - DON'T touch them
    if (alreadySentContracts && alreadySentContracts.has(contract.name)) {
      // Contract was already validated in a previous attempt
      // Trust the existing validation status, don't re-validate
      if (contract.validated) {
        validCount++;
        console.log(`[Validation] Skipping re-validation of already-sent contract "${contract.name}"`);
      } else {
        // This shouldn't happen - already-sent contracts should be validated
        console.warn(`[Validation] WARNING: Already-sent contract "${contract.name}" has validated=false!`);
        failedCount++;
        failedContracts.push(contract.name);
        if (allValid) {
          allValid = false;
          firstError = `${contract.name}: Already-sent contract is not validated`;
        }
      }
      continue; // Skip to next contract
    }

    // Validate contracts that haven't been sent yet
    const validation = validateContract(contract.code);
    contract.validated = validation.valid;
    if (validation.valid) {
      contract.bytecodeSize = validation.bytecodeSize;
      contract.artifact = validation.artifact;
      validCount++;
    } else {
      contract.validationError = validation.error ? enhanceErrorMessage(validation.error, contract.code) : validation.error;
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

// ============================================================================
// PHASE 1 EXECUTION: Semantic Analysis
// ============================================================================

async function executeSemanticAnalysis(
  conversionId: number,
  solidityContract: string
): Promise<SemanticSpecification> {
  console.log('[Phase 1] Starting semantic analysis...');
  const startTime = Date.now();

  const response = await anthropic.beta.messages.create({
    model: ANTHROPIC_CONFIG.phase1.model,
    max_tokens: ANTHROPIC_CONFIG.phase1.maxTokens,
    system: SEMANTIC_ANALYSIS_PROMPT,
    betas: ANTHROPIC_CONFIG.betas,
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
    model_used: ANTHROPIC_CONFIG.phase1.model,
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

// ============================================================================
// CONCURRENT REQUEST LIMITING
// ============================================================================

let activeConversions = 0;
const MAX_CONCURRENT_CONVERSIONS = 100;

// ============================================================================
// INPUT VALIDATION HELPERS
// ============================================================================

function validateContractInput(contract: any): { valid: boolean; error?: string; statusCode?: number } {
  // Must be a string
  if (typeof contract !== 'string') {
    return { valid: false, error: 'Contract must be a string', statusCode: 400 };
  }

  // Must not be empty
  if (!contract || contract.trim().length === 0) {
    return { valid: false, error: 'Contract cannot be empty', statusCode: 400 };
  }

  // Minimum length check (prevent trivial spam)
  if (contract.length < 10) {
    return { valid: false, error: 'Contract must be at least 10 characters', statusCode: 400 };
  }

  // Maximum length check (50,000 chars ~= 50kb)
  if (contract.length > 50000) {
    return { valid: false, error: 'Contract too large. Maximum 50,000 characters allowed.', statusCode: 413 };
  }

  return { valid: true };
}

// ============================================================================
// API ENDPOINT
// ============================================================================

// Streaming conversion endpoint with real-time progress
app.post('/api/convert-stream', rateLimiter, async (req, res) => {
  // Check concurrent request limit
  if (activeConversions >= MAX_CONCURRENT_CONVERSIONS) {
    return res.status(503).json({
      error: 'Server busy',
      message: `Maximum ${MAX_CONCURRENT_CONVERSIONS} concurrent conversions. Please try again in a moment.`
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

  // Detect client disconnect (e.g., user clicked "Start Over")
  // Listen on 'res' (response), not 'req' (request) - SSE keeps response stream open
  let clientDisconnected = false;
  res.on('close', () => {
    console.log('[Conversion] Client disconnected - aborting processing');
    clientDisconnected = true;
  });

  // Helper to send SSE events (safe - checks if stream is writable)
  const sendEvent = (event: string, data: any) => {
    // Check if response stream is still writable
    if (!res.writable) {
      console.log(`[SSE] Cannot send event '${event}' - stream not writable (client disconnected)`);
      return;
    }

    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      // Stream closed mid-write - log but don't crash
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SSE] Failed to send event '${event}':`, errorMsg);
    }
  };

  try {
    console.log('[Conversion] Received streaming conversion request');
    const { contract } = req.body;

    // Validate input
    const validation = validateContractInput(contract);
    if (!validation.valid) {
      sendEvent('error', { message: validation.error });
      res.end();
      return;
    }
    const metadata = req.metadata!;

    // Log conversion start
    conversionId = await logConversionStart(metadata, contract);
    console.log(`[Conversion] Started with ID ${conversionId}`);

    // ========================================
    // PHASE 1: SEMANTIC ANALYSIS
    // ========================================
    sendEvent('phase1_start', { message: 'Extracting semantic intent...' });

    let semanticSpec: SemanticSpecification;
    let semanticSpecJSON: string;

    try {
      // Check if client disconnected before expensive Phase 1 API call
      if (clientDisconnected) {
        console.log('[Conversion] Aborting Phase 1 - client disconnected');
        return;
      }

      semanticSpec = await executeSemanticAnalysis(conversionId, contract);
      semanticSpecJSON = JSON.stringify(semanticSpec, null, 2);
      sendEvent('phase1_complete', { message: 'Semantic analysis complete' });
    } catch (phase1Error) {
      console.error('[Phase 1] Semantic analysis failed:', phase1Error);
      sendEvent('error', {
        phase: 1,
        message: 'Semantic analysis failed',
        details: phase1Error instanceof Error ? phase1Error.message : String(phase1Error)
      });
      res.end();
      return;
    }

    // ========================================
    // PHASE 2: CODE GENERATION
    // ========================================
    sendEvent('phase2_start', { message: 'Generating CashScript...' });

    const systemPrompt = `You are a CashScript expert. Convert EVM (Solidity) smart contracts to CashScript.

CashScript Language Reference:
${knowledgeBase}

CRITICAL RULES:
1. Always use "pragma cashscript ^0.13.0;" at the top of every CashScript contract.

1a. NEVER create placeholder/stub/dummy contracts or functions. EVERY contract and function MUST be production-ready.
   - ❌ ABSOLUTELY FORBIDDEN: require(false) in ANY context whatsoever
   - ❌ ABSOLUTELY FORBIDDEN: Functions that exist only for documentation purposes
   - ❌ ABSOLUTELY FORBIDDEN: Comments like "Never actually called on-chain" or "documentation-only" or "Prevent execution"
   - ❌ FORBIDDEN: Empty contracts that just hold NFTs without real logic
   - If you cannot implement a contract's full logic, DO NOT create it as a placeholder
   - If a Solidity function has no CashScript equivalent, DELETE it entirely - do NOT create a placeholder version
   - This is PRODUCTION CODE - users will deploy and use these contracts with real BCH

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

21. TIMELOCK COMPARISON OPERATORS - CRITICAL SYNTAX RULE:
    **With tx.time and this.age, you can ONLY use >= operator. You CANNOT use <, >, or <=.**

    The CashScript compiler ENFORCES this restriction for Bitcoin Script timelock semantics:

    ❌ WRONG - These ALL cause compilation errors:
    require(tx.time < deadline);         // Error: "Mismatched input '<' expecting '>='"
    require(tx.time > lockTime);         // Error: "Mismatched input '>' expecting '>='"
    require(tx.time <= deadline);        // Error: "Mismatched input '<=' expecting '>='"
    require(this.age < vestingPeriod);   // Same error
    require(this.age <= vestingPeriod);  // Same error

    ✅ CORRECT - Only >= operator is allowed:
    require(tx.time >= lockTime);        // Transaction is at or after lock time
    require(this.age >= vestingPeriod);  // Has aged at least N blocks
    require(deadline >= tx.time);        // INVERTED: Transaction is before deadline

    **Why this restriction exists:**
    - Bitcoin Script nLocktime uses OP_CHECKLOCKTIMEVERIFY which only supports >= semantics
    - The compiler restricts to >= to match the underlying opcode behavior
    - For "before deadline" logic, you MUST invert the comparison: deadline >= tx.time

    **Common time-based patterns:**
    // "Must execute BEFORE deadline" (voting, auctions, pledges):
    require(deadline >= tx.time);              // ✅ INVERTED comparison!
    // OR use logical negation:
    require(!(tx.time >= deadline + 1));       // ✅ Also valid but less readable

    // "Can only execute AFTER locktime" (timelocks, vesting, refunds):
    require(tx.time >= lockTime);              // ✅ Standard pattern

    // "Must wait N blocks" (age-based logic):
    require(this.age >= vestingPeriod);        // ✅ Standard pattern

    **Loop conditions are different - <, >, <= are valid there:**
    while (inputIndex < tx.inputs.length) { }     // ✅ Valid for loops
    require(index < tx.outputs.length);           // ✅ Valid for bounds checking
    if (amount <= maxValue) { }                   // ✅ Valid for value comparisons

    The >= restriction ONLY applies to tx.time and this.age comparisons.

22. ANTI-PATTERNS - NEVER DO THESE:
    These patterns will cause immediate compilation failure or broken contracts:

    ❌ FORBIDDEN: function viewHelper() { require(false); }
       Reason: Placeholder function with require(false) - violates Rule 1a

    ❌ FORBIDDEN: function queryData() { require(false); }
       Reason: Documentation-only function - violates Rule 1a

    ❌ FORBIDDEN: function queryProposal() { /* Never actually called on-chain */ require(false); }
       Reason: Comment suggesting dead code + require(false) - violates Rule 1a

    ❌ FORBIDDEN: // Prevent execution - documentation-only
       Reason: Any comment suggesting placeholder or non-production code

    ✅ CORRECT: If a Solidity function cannot be converted to CashScript, DELETE it entirely
    ✅ CORRECT: Only create functions that perform actual on-chain validation logic
    ✅ CORRECT: Every function must have real business logic that validates transaction constraints

    Remember: This is production code that users will deploy with real BCH. No placeholders, ever.

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

    // Attempt validation with up to max retries attempts
    let parsed: any;
    let validationPassed = false;
    let validationError: string | undefined;
    let retryMessage: string = '';
    let savedValidContracts: any[] = [];  // Track valid contracts across retries
    let isMultiContractMode = false;      // Track if we're in multi-contract mode
    let savedDeploymentGuide: any = null; // Track deployment guide from first attempt
    let originalContractOrder: string[] = []; // Track original order from attempt 1
    let contractAttempts: Map<string, number> = new Map(); // Track per-contract attempt numbers
    let sentContracts: Set<string> = new Set(); // Track which contracts have been sent via contract_ready
    let totalExpectedContracts = 0; // Total number of contracts expected

    for (let attemptNumber = 1; attemptNumber <= ANTHROPIC_CONFIG.phase2.maxRetries; attemptNumber++) {
      // Check if client disconnected
      if (clientDisconnected) {
        console.log('[Conversion] Aborting retry loop - client disconnected');
        return;
      }

      const messageContent = attemptNumber === 1
        ? `SEMANTIC SPECIFICATION (what the contract must do):
${semanticSpecJSON}

ORIGINAL SOLIDITY CONTRACT:
${contract}

Based on the semantic specification and CashScript language reference provided in the system prompt, generate CashScript that implements the contract above.

Ensure semantic fidelity: Your CashScript must honor all business logic, invariants, and guarantees described in the specification. Structure may differ to fit the UTXO model, but all original contract intentions must be preserved.`
        : retryMessage;

      const apiCallStartTime = Date.now();
      const apiCallId = await logApiCallStart(conversionId, attemptNumber, ANTHROPIC_CONFIG.phase2.model, ANTHROPIC_CONFIG.phase2.maxTokens, messageContent);

      // Check if client disconnected before expensive Phase 2 API call
      if (clientDisconnected) {
        console.log('[Conversion] Aborting Phase 2 - client disconnected');
        return;
      }

      // Select schema based on attempt number and contract mode
      let selectedSchema;
      if (attemptNumber === 1) {
        // First attempt: use full schema (can return single or multi)
        selectedSchema = outputSchema;
      } else {
        // Retries: use minimal schema based on contract mode
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
        betas: ANTHROPIC_CONFIG.betas,
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

      // Parse response
      try {
        parsed = JSON.parse(response);
      } catch (parseError) {
        sendEvent('error', {
          phase: 2,
          message: 'Response truncated - contract too complex',
          details: parseError instanceof Error ? parseError.message : String(parseError)
        });
        res.end();
        return;
      }

      // After first attempt, mark Phase 2 complete and start Phase 3
      if (attemptNumber === 1) {
        sendEvent('phase2_complete', { message: 'Code generation complete' });
        sendEvent('phase3_start', { message: 'Validating contracts... You\'ll be redirected to results as soon as we have something to show. We\'ll keep working on the rest in the background.' });

        // Detect and save contract mode from first attempt
        isMultiContractMode = isMultiContractResponse(parsed);
        if (isMultiContractMode && parsed.deploymentGuide) {
          savedDeploymentGuide = parsed.deploymentGuide;
          // Save original order of contract names from first attempt
          originalContractOrder = parsed.contracts.map((c: any) => c.name);
          // Set total expected contracts
          totalExpectedContracts = parsed.contracts.length;
          // Initialize attempt tracking (all start at attempt 1)
          parsed.contracts.forEach((c: any) => {
            contractAttempts.set(c.name, 1);
          });
        } else if (!isMultiContractMode) {
          totalExpectedContracts = 1;
        }
      } else if (attemptNumber > 1 && isMultiContractMode) {
        // Retry attempt: merge saved valid contracts with newly fixed contracts
        const fixedContracts = parsed.contracts || [];

        // Update attempt numbers for fixed contracts
        for (const fixedContract of fixedContracts) {
          contractAttempts.set(fixedContract.name, attemptNumber);
        }

        // Create contract map for easy lookup
        const contractMap = new Map();

        // CRITICAL FIX: Deep copy saved valid contracts to prevent mutation
        // Shallow references would allow validateMultiContractResponse to mutate the originals
        for (const contract of savedValidContracts) {
          // Deep copy the contract object to isolate it from future mutations
          const contractCopy = {
            ...contract,
            dependencies: contract.dependencies ? [...contract.dependencies] : [],
            constructorParams: contract.constructorParams ? [...contract.constructorParams] : []
          };
          contractMap.set(contract.name, contractCopy);
          console.log(`[Merge] Preserving already-validated contract "${contract.name}" (deep copy)`);
        }

        // Add/replace with newly fixed contracts
        for (const fixedContract of fixedContracts) {
          const wasValidated = savedValidContracts.some(c => c.name === fixedContract.name);
          if (wasValidated) {
            console.warn(`[Merge] WARNING: AI returned already-validated contract "${fixedContract.name}" - ignoring AI version, keeping original`);
            // Don't overwrite - keep the validated version from savedValidContracts
          } else {
            contractMap.set(fixedContract.name, fixedContract);
            console.log(`[Merge] Adding newly-fixed contract "${fixedContract.name}"`);
          }
        }

        // Rebuild contracts array in ORIGINAL order
        const mergedContracts = originalContractOrder
          .map(name => contractMap.get(name))
          .filter(c => c !== undefined); // Filter out any missing contracts

        console.log(`[Merge] Merged ${mergedContracts.length} contracts (${savedValidContracts.length} preserved, ${fixedContracts.filter(fc => !savedValidContracts.some(c => c.name === fc.name)).length} newly fixed)`);

        // Reconstruct full multi-contract response
        parsed = {
          contracts: mergedContracts,
          deploymentGuide: savedDeploymentGuide
        };
      }

      // Validate
      const isMultiContract = isMultiContractResponse(parsed);

      if (isMultiContract) {
        updateConversion(conversionId, {
          is_multi_contract: true,
          contract_count: parsed.contracts.length
        });

        // CRITICAL FIX: Save valid contracts BEFORE validation to prevent corruption
        // If validation mutates contract objects, we need a clean copy saved first
        if (attemptNumber > 1) {
          // On retry attempts, preserve currently valid contracts before re-validation
          const currentlyValid = parsed.contracts.filter(c => c.validated);
          if (currentlyValid.length > 0) {
            console.log(`[Phase 3] Saving ${currentlyValid.length} currently valid contracts before validation (attempt ${attemptNumber})`);
          }
        }

        // Pass sentContracts to skip re-validation of already-sent contracts
        const multiValidation = validateMultiContractResponse(parsed, sentContracts);
        validationPassed = multiValidation.allValid;
        validationError = multiValidation.firstError;

        // Build contract status list for display during retries
        const contractStatus = parsed.contracts.map(c => ({
          name: c.name,
          validated: c.validated || false,
          attempt: contractAttempts.get(c.name) || attemptNumber // Include per-contract attempt number
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

            // Include deployment guide only with the FIRST contract
            if (sentContracts.size === 0 && savedDeploymentGuide) {
              contractReadyData.deploymentGuide = savedDeploymentGuide;
            }

            sendEvent('contract_ready', contractReadyData);
            sentContracts.add(contract.name);
          }
        }
      } else {
        const validation = validateContract(parsed.primaryContract);
        validationPassed = validation.valid;
        validationError = validation.error ? enhanceErrorMessage(validation.error, parsed.primaryContract) : validation.error;

        sendEvent('validation', {
          passed: validationPassed,
          attempt: attemptNumber,
          maxAttempts: ANTHROPIC_CONFIG.phase2.maxRetries,
          isMultiContract: false
        });

        if (validationPassed) {
          parsed.validated = true;
          parsed.bytecodeSize = validation.bytecodeSize;
          parsed.artifact = validation.artifact;

          // Send contract_ready event for single contract
          if (!sentContracts.has('primary')) {
            sendEvent('contract_ready', {
              contract: {
                id: 'primary',
                name: 'Primary Contract',
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

      // Save valid contracts after validation for use in retries
      if (isMultiContract && !validationPassed) {
        // Save valid contracts to avoid regenerating them in retries
        savedValidContracts = parsed.contracts.filter(c => c.validated);
      }

      // Log API call
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

        sendEvent('phase3_complete', { message: 'Validation complete' });
        break;
      }

      // Build retry message if validation failed
      if (attemptNumber === ANTHROPIC_CONFIG.phase2.maxRetries) {
        sendEvent('error', {
          phase: 2,
          message: `Contract validation failed after ${ANTHROPIC_CONFIG.phase2.maxRetries} attempts. This is not a deterministic system, so just try again - it's likely to work!`,
          details: validationError
        });
        res.end();
        return;
      }

      // Build retry message for next attempt with MINIMAL CHANGE instructions
      // Include current contract code so AI can make targeted fixes instead of rewriting from scratch
      if (isMultiContract) {
        const failedContracts = parsed.contracts.filter(c => !c.validated);
        const failedContractNames = failedContracts.map(c => c.name).join(', ');

        retryMessage = `Fix ONLY the specific compilation errors in the following ${failedContracts.length} ${failedContracts.length === 1 ? 'contract' : 'contracts'}:\n\n`;

        failedContracts.forEach(c => {
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

    // Send final result
    logConversionComplete(conversionId, startTime, 'success', parsed.primaryContract, parsed.explanation).catch(err =>
      console.error('[Logging] Failed to log conversion completion:', err)
    );

    sendEvent('done', parsed);
    res.end();

  } catch (error) {
    console.error('[Conversion] Error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (conversionId) {
      logError('unknown_error', errorMessage, conversionId).catch(err =>
        console.error('[Logging] Failed to log error:', err)
      );
      logConversionComplete(conversionId, startTime, 'error').catch(err =>
        console.error('[Logging] Failed to log conversion completion:', err)
      );
    }

    sendEvent('error', {
      message: 'Internal server error',
      details: errorMessage
    });
    res.end();
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

  // Set timeout to handle long conversions
  // With max retries and ~30s per attempt, we need sufficient time
  server.timeout = SERVER_CONFIG.timeout;
  server.keepAliveTimeout = SERVER_CONFIG.keepAliveTimeout;
  server.headersTimeout = SERVER_CONFIG.headersTimeout;

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
