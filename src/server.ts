import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileString } from 'cashc';
import { initializeDatabase, closeDatabase, updateConversion, insertContract, generateHash, generateUUID, insertSemanticAnalysis, insertUtxoArchitecture } from './database.js';
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
import {
  DOMAIN_EXTRACTION_PROMPT,
  UTXO_ARCHITECTURE_PROMPT,
} from './prompts/conversion-prompts.js';
import { ANTHROPIC_CONFIG, SERVER_CONFIG } from './config.js';

const app = express();
app.use(express.json({ limit: '50kb' })); // Explicit size limit for abuse protection
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

  // Load core language reference
  const languageRef = await readFile('./cashscript-knowledge-base/language/language-reference.md', 'utf-8');

  // Load multi-contract architecture patterns (critical for complex conversions)
  const multiContractPatterns = await readFile('./cashscript-knowledge-base/concepts/multi-contract-architecture.md', 'utf-8');

  // Combine knowledge base sections
  knowledgeBase = `${languageRef}

---

# MULTI-CONTRACT ARCHITECTURE PATTERNS

The following patterns are CRITICAL for any conversion involving multiple contracts.
When multiple contracts participate in the SAME transaction, EACH contract's script runs and MUST validate.

${multiContractPatterns}`;

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

/**
 * Extract contract name from CashScript code
 * AI sometimes outputs names with tokenization artifacts (spaces in camelCase)
 * This extracts the actual name from the code to avoid display issues
 */
function extractContractNameFromCode(code: string): string | null {
  const match = code.match(/contract\s+(\w+)/);
  return match ? match[1] : null;
}

/**
 * Normalize contract names by extracting from actual code
 * Fixes AI tokenization artifacts like "Ball ot Initial izer" -> "BallotInitializer"
 */
function normalizeContractNames(contracts: ContractInfo[]): void {
  for (const contract of contracts) {
    const extractedName = extractContractNameFromCode(contract.code);
    if (extractedName && extractedName !== contract.name) {
      console.log(`[Normalize] Fixing contract name: "${contract.name}" -> "${extractedName}"`);
      contract.name = extractedName;
    }
  }
}

/**
 * Detect if a contract is a placeholder/documentation-only stub
 * These violate the rule: "If a contract validates nothing, it should NOT EXIST"
 *
 * Signs of a placeholder contract:
 * - Contains require(false) as the only meaningful validation
 * - Has "documentationOnly" or similar placeholder function names
 */
function isPlaceholderContract(code: string): boolean {
  // Check for require(false) - the telltale sign of "nothing to validate"
  const hasRequireFalse = /require\s*\(\s*false\s*\)/.test(code);
  if (!hasRequireFalse) return false;

  // Count all require statements
  const allRequires = code.match(/require\s*\([^)]+\)/g) || [];
  // Filter out require(false)
  const nonFalseRequires = allRequires.filter(r => !/require\s*\(\s*false\s*\)/.test(r));

  // If require(false) is the ONLY require statement, it's a placeholder
  return nonFalseRequires.length === 0;
}

/**
 * Apply name mapping to transaction templates
 * Updates contract references in participatingContracts, inputs, and outputs
 */
function applyNameMappingToTemplates(
  templates: any[],
  nameMap: Map<string, string>
): any[] {
  if (nameMap.size === 0) return templates;

  return templates.map(tx => ({
    ...tx,
    participatingContracts: tx.participatingContracts?.map((name: string) =>
      nameMap.get(name) || name
    ),
    inputs: tx.inputs?.map((input: any) => ({
      ...input,
      contract: input.contract ? (nameMap.get(input.contract) || input.contract) : input.contract,
      from: nameMap.get(input.from) || input.from
    })),
    outputs: tx.outputs?.map((output: any) => ({
      ...output,
      contract: output.contract ? (nameMap.get(output.contract) || output.contract) : output.contract,
      to: nameMap.get(output.to) || output.to
    }))
  }));
}

/**
 * Extract JSON from a response that may contain markdown code blocks or other text
 */
function extractJSON<T>(text: string): T {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch (directError) {
    console.error('[JSON] Direct parse failed:', directError instanceof Error ? directError.message : directError);

    // Try to find JSON in markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch (blockError) {
        console.error('[JSON] Markdown block parse failed:', blockError instanceof Error ? blockError.message : blockError);
      }
    }

    // Try to find raw JSON object/array
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (objectError) {
        console.error('[JSON] Raw object parse failed:', objectError instanceof Error ? objectError.message : objectError);
      }
    }

    throw new Error('Could not extract JSON from response');
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

function isMultiContractResponse(parsed: any): parsed is MultiContractResponse {
  return parsed.contracts && Array.isArray(parsed.contracts);
}

// ============================================================================
// ============================================================================
// PHASE 1: DOMAIN EXTRACTION (JSON schema for structured outputs)
// ============================================================================

const phase1OutputSchema = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        enum: ["voting", "token", "crowdfunding", "marketplace", "game", "defi", "governance", "other"]
      },
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            properties: {
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
            lifecycle: { type: "array", items: { type: "string" } },
            identity: { type: "string" },
            mutable: { type: "boolean" }
          },
          required: ["name", "description", "properties", "lifecycle", "identity", "mutable"],
          additionalProperties: false
        }
      },
      transitions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            participants: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  role: { type: "string" },
                  description: { type: "string" }
                },
                required: ["role", "description"],
                additionalProperties: false
              }
            },
            effects: { type: "array", items: { type: "string" } },
            authorization: { type: "string" },
            preconditions: { type: "array", items: { type: "string" } },
            postconditions: { type: "array", items: { type: "string" } },
            timeConstraints: { type: "string" }
          },
          required: ["name", "description", "participants", "effects", "authorization", "preconditions", "postconditions", "timeConstraints"],
          additionalProperties: false
        }
      },
      invariants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            scope: { type: "string" },
            rule: { type: "string" },
            severity: { type: "string" }
          },
          required: ["scope", "rule", "severity"],
          additionalProperties: false
        }
      },
      relationships: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            type: { type: "string" },
            description: { type: "string" }
          },
          required: ["from", "to", "type", "description"],
          additionalProperties: false
        }
      },
      roles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            assignment: { type: "string" },
            capabilities: { type: "array", items: { type: "string" } }
          },
          required: ["name", "description", "assignment", "capabilities"],
          additionalProperties: false
        }
      }
    },
    required: ["domain", "entities", "transitions", "invariants", "relationships", "roles"],
    additionalProperties: false
  }
} as const;

// ============================================================================
// PHASE 2: UTXO ARCHITECTURE (JSON schema for structured outputs)
// ============================================================================

const phase2OutputSchema = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            appliedTo: { type: "string" },
            rationale: { type: "string" }
          },
          required: ["name", "appliedTo", "rationale"],
          additionalProperties: false
        }
      },
      custodyDecisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            entity: { type: "string" },
            custody: { type: "string" },
            contractName: { type: "string" },
            rationale: { type: "string" },
            ownerFieldInCommitment: { type: "string" }
          },
          required: ["entity", "custody", "contractName", "rationale", "ownerFieldInCommitment"],
          additionalProperties: false
        }
      },
      tokenCategories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            purpose: { type: "string" },
            capability: { type: "string" },
            commitmentLayout: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  bytes: { type: "integer" },
                  description: { type: "string" }
                },
                required: ["field", "bytes", "description"],
                additionalProperties: false
              }
            },
            totalBytes: { type: "integer" }
          },
          required: ["name", "purpose", "capability", "commitmentLayout", "totalBytes"],
          additionalProperties: false
        }
      },
      contracts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            custodies: { type: "string" },
            validates: { type: "string" },
            functions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  validates: { type: "string" },
                  maxOutputs: { type: "integer" }
                },
                required: ["name", "validates", "maxOutputs"],
                additionalProperties: false
              }
            },
            stateFields: { type: "array", items: { type: "string" } }
          },
          required: ["name", "custodies", "validates", "functions", "stateFields"],
          additionalProperties: false
        }
      },
      transactionTemplates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            purpose: { type: "string" },
            inputs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  type: { type: "string" },
                  description: { type: "string" }
                },
                required: ["index", "type", "description"],
                additionalProperties: false
              }
            },
            outputs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  type: { type: "string" },
                  description: { type: "string" }
                },
                required: ["index", "type", "description"],
                additionalProperties: false
              }
            },
            maxOutputs: { type: "integer" }
          },
          required: ["name", "purpose", "inputs", "outputs", "maxOutputs"],
          additionalProperties: false
        }
      },
      invariantEnforcement: {
        type: "array",
        items: {
          type: "object",
          properties: {
            invariant: { type: "string" },
            enforcedBy: { type: "string" },
            mechanism: { type: "string" }
          },
          required: ["invariant", "enforcedBy", "mechanism"],
          additionalProperties: false
        }
      },
      warnings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string" },
            issue: { type: "string" },
            mitigation: { type: "string" }
          },
          required: ["severity", "issue", "mitigation"],
          additionalProperties: false
        }
      }
    },
    required: ["patterns", "custodyDecisions", "tokenCategories", "contracts", "transactionTemplates", "invariantEnforcement", "warnings"],
    additionalProperties: false
  }
} as const;

// ============================================================================
// PHASE 3: CODE GENERATION (JSON schemas for structured outputs)
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
    // Skip already-sent contracts - they were validated before being sent
    if (alreadySentContracts && alreadySentContracts.has(contract.name)) {
      validCount++;
      continue;
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
// PHASE 1 EXECUTION: Domain Extraction (Platform-Agnostic)
// ============================================================================

async function executeDomainExtraction(
  conversionId: number,
  solidityContract: string
): Promise<DomainModel> {
  console.log('[Phase 1] Starting domain extraction (platform-agnostic)...');
  const startTime = Date.now();

  const response = await anthropic.beta.messages.create({
    model: ANTHROPIC_CONFIG.phase1.model,
    max_tokens: ANTHROPIC_CONFIG.phase1.maxTokens,
    betas: [...ANTHROPIC_CONFIG.betas],
    output_format: phase1OutputSchema,
    system: DOMAIN_EXTRACTION_PROMPT,
    messages: [{
      role: 'user',
      content: `Extract the domain model from this smart contract:\n\n${solidityContract}`
    }]
  });

  const responseText = response.content[0].type === 'text'
    ? response.content[0].text
    : '';

  const domainModel = JSON.parse(responseText) as DomainModel;

  // Validate required fields - fail loud if structured output failed
  if (!Array.isArray(domainModel.entities)) {
    throw new Error('Phase 1 returned invalid domain model: entities missing');
  }
  if (!Array.isArray(domainModel.transitions)) {
    throw new Error('Phase 1 returned invalid domain model: transitions missing');
  }
  if (!domainModel.domain) {
    throw new Error('Phase 1 returned invalid domain model: domain missing');
  }

  // Log to database (reusing semantic_analysis table for now)
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

  console.log('[Phase 1] Domain extraction complete:', {
    duration: `${(duration / 1000).toFixed(2)}s`,
    domain: domainModel.domain,
    entities: domainModel.entities.length,
    transitions: domainModel.transitions.length,
    invariants: domainModel.invariants.length
  });

  return domainModel;
}

// ============================================================================
// PHASE 2 EXECUTION: UTXO Architecture Design
// ============================================================================

interface Phase2Result {
  architecture: UTXOArchitecture;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

async function executeArchitectureDesign(
  conversionId: number,
  domainModel: DomainModel
): Promise<Phase2Result> {
  console.log('[Phase 2] Starting UTXO architecture design...');
  const startTime = Date.now();

  const userMessage = `Design a UTXO architecture for this domain model.

DOMAIN MODEL:
${JSON.stringify(domainModel, null, 2)}

Design the UTXO architecture following the patterns and prime directives in the system prompt.`;

  const response = await anthropic.beta.messages.create({
    model: ANTHROPIC_CONFIG.phase1.model, // Use same model as phase 1
    max_tokens: 16384, // Architecture design needs more tokens
    betas: [...ANTHROPIC_CONFIG.betas],
    output_format: phase2OutputSchema,
    system: UTXO_ARCHITECTURE_PROMPT,
    messages: [{
      role: 'user',
      content: userMessage
    }]
  });

  const responseText = response.content[0].type === 'text'
    ? response.content[0].text
    : '';

  const architecture = JSON.parse(responseText) as UTXOArchitecture;

  // Validate required fields - fail loud if structured output failed
  if (!Array.isArray(architecture.contracts)) {
    throw new Error('Phase 2 returned invalid architecture: contracts missing');
  }
  if (!Array.isArray(architecture.transactionTemplates)) {
    throw new Error('Phase 2 returned invalid architecture: transactionTemplates missing');
  }

  const duration = Date.now() - startTime;

  console.log('[Phase 2] Architecture design complete:', {
    duration: `${(duration / 1000).toFixed(2)}s`,
    contracts: architecture.contracts.length,
    transactions: architecture.transactionTemplates.length,
    patterns: architecture.patterns?.map(p => p.name).join(', ') || '(none)'
  });

  // Store Phase 2 architecture in database
  insertUtxoArchitecture({
    conversion_id: conversionId,
    architecture_json: responseText,
    created_at: new Date().toISOString(),
    model_used: ANTHROPIC_CONFIG.phase1.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    response_time_ms: duration
  });

  return {
    architecture,
    durationMs: duration,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens
  };
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
    clientDisconnected = true;
  });

  // Helper to send SSE events - throws on error (fail loud)
  const sendEvent = (event: string, data: any) => {
    if (!res.writable) {
      throw new Error('AbortError: Client disconnected');
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Helper to end response stream - throws on error (fail loud)
  const endResponse = () => {
    if (!res.writable) {
      throw new Error('AbortError: Client disconnected');
    }
    res.end();
  };

  // Track which contracts have been successfully sent to client
  // Declared here so catch block can check if user already has working contracts
  let sentContracts = new Set<string>();

  try {
    const { contract } = req.body;

    // Validate input
    const validation = validateContractInput(contract);
    if (!validation.valid) {
      sendEvent('error', { message: validation.error });
      endResponse();
      return;
    }
    const metadata = req.metadata!;

    // Log conversion start
    conversionId = logConversionStart(metadata, contract);

    // ========================================
    // PHASE 1: DOMAIN EXTRACTION (Platform-Agnostic)
    // ========================================
    sendEvent('phase1_start', { message: 'Extracting domain model...' });

    let domainModel: DomainModel;
    let domainModelJSON: string;

    try {
      // Check if client disconnected before expensive Phase 1 API call
      if (clientDisconnected) {
        throw new Error('AbortError: Client disconnected');
      }

      domainModel = await executeDomainExtraction(conversionId, contract);
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

    // ========================================
    // PHASE 2: UTXO ARCHITECTURE DESIGN
    // ========================================
    sendEvent('phase2_start', { message: 'Designing UTXO architecture...' });

    let utxoArchitecture: UTXOArchitecture;
    let utxoArchitectureJSON: string;
    let phase2DurationMs: number;

    try {
      if (clientDisconnected) {
        throw new Error('AbortError: Client disconnected');
      }

      const phase2Result = await executeArchitectureDesign(conversionId, domainModel);
      utxoArchitecture = phase2Result.architecture;
      phase2DurationMs = phase2Result.durationMs;
      utxoArchitectureJSON = JSON.stringify(utxoArchitecture, null, 2);

      // Defensive access for SSE event
      const contractCount = Array.isArray(utxoArchitecture.contracts) ? utxoArchitecture.contracts.length : 0;
      const patternNames = Array.isArray(utxoArchitecture.patterns)
        ? utxoArchitecture.patterns.map(p => p?.name || 'unnamed')
        : [];

      sendEvent('phase2_complete', {
        message: 'Architecture design complete',
        contracts: contractCount,
        patterns: patternNames,
        durationMs: phase2DurationMs
      });

      // Send transaction templates and contract specs for UI
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

    // ========================================
    // PHASE 3: CODE GENERATION
    // ========================================
    sendEvent('phase3_start', { message: 'Generating CashScript...' });

    const systemPrompt = `You are a CashScript expert. Convert EVM (Solidity) smart contracts to CashScript.

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
    // sentContracts now declared at function scope (line 734) to be accessible in catch block
    let totalExpectedContracts = 0; // Total number of contracts expected
    let expectedFailedNames: string[] = []; // Track names of failed contracts for retry matching

    for (let attemptNumber = 1; attemptNumber <= ANTHROPIC_CONFIG.phase2.maxRetries; attemptNumber++) {
      // Check if client disconnected
      if (clientDisconnected) {
        throw new Error('AbortError: Client disconnected');
      }

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

      // Check if client disconnected before expensive Phase 2 API call
      if (clientDisconnected) {
        throw new Error('AbortError: Client disconnected');
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

      // Parse response
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

      // Normalize contract names by extracting from actual code
      // Fixes AI tokenization artifacts like "Ball ot Initial izer" -> "BallotInitializer"
      if (parsed.contracts && Array.isArray(parsed.contracts)) {
        normalizeContractNames(parsed.contracts);

        // Filter out placeholder contracts (require(false) only)
        // These violate the rule: "If a contract validates nothing, it should NOT EXIST"
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

      // After first attempt, mark Phase 3 complete and start Phase 4 (validation)
      if (attemptNumber === 1) {
        sendEvent('phase3_complete', { message: 'Code generation complete' });
        sendEvent('phase4_start', { message: 'Validating contracts... You\'ll be redirected to results as soon as we have something to show. We\'ll keep working on the rest in the background.' });

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

        // Match fixed contracts to expected failed names if names changed during normalization
        // This handles cases where AI renames the contract in the code during retry
        if (fixedContracts.length > 0 && expectedFailedNames.length > 0) {
          const validNames = new Set(savedValidContracts.map((c: any) => c.name));

          for (const fixedContract of fixedContracts) {
            // If this contract name isn't in savedValidContracts and isn't in expectedFailedNames,
            // it was probably renamed during retry - find the matching expected name
            if (!validNames.has(fixedContract.name) && !expectedFailedNames.includes(fixedContract.name)) {
              // Find an expected failed name that hasn't been matched yet
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
        }

        // Add/replace with newly fixed contracts
        for (const fixedContract of fixedContracts) {
          const wasValidated = savedValidContracts.some(c => c.name === fixedContract.name);
          if (wasValidated) {
            console.warn(`[Merge] WARNING: AI returned already-validated contract "${fixedContract.name}" - ignoring AI version, keeping original`);
            // Don't overwrite - keep the validated version from savedValidContracts
          } else {
            contractMap.set(fixedContract.name, fixedContract);
          }
        }

        // Rebuild contracts array in ORIGINAL order
        // Log if any contracts are missing
        const mergedContracts: any[] = [];
        for (const name of originalContractOrder) {
          const contract = contractMap.get(name);
          if (contract) {
            mergedContracts.push(contract);
          } else {
            console.error(`[Merge] ERROR: Contract "${name}" missing from merge - not in savedValidContracts or fixedContracts`);
          }
        }

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

        // Pass sentContracts to skip re-validation of already-sent contracts
        const multiValidation = validateMultiContractResponse(parsed, sentContracts);
        validationPassed = multiValidation.allValid;
        validationError = multiValidation.firstError;

        // Build contract status list for display during retries
        const contractStatus = parsed.contracts.map((c: ContractInfo) => ({
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
          updateConversion(conversionId, { contract_count: 1 });

          // Send contract_ready event for single contract
          if (!sentContracts.has('primary')) {
            // Extract actual contract name from CashScript code
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

      // Save valid contracts after validation for use in retries
      if (isMultiContract && !validationPassed) {
        // Save valid contracts to avoid regenerating them in retries
        savedValidContracts = parsed.contracts.filter((c: ContractInfo) => c.validated);
      }

      // Log API call - let errors propagate (fail loud)
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

        // Post-validation: Check if contract names drifted and update transaction templates
        if (isMultiContract && utxoArchitecture.transactionTemplates?.length > 0) {
          const nameMap = new Map<string, string>();
          const archContracts = utxoArchitecture.contracts || [];
          const validatedContracts = parsed.contracts || [];

          // Match by index (order is preserved through retries via originalContractOrder)
          for (let i = 0; i < archContracts.length; i++) {
            const archName = archContracts[i]?.name;
            const validatedName = validatedContracts[i]?.name;
            if (archName && validatedName && archName !== validatedName) {
              console.log(`[Transactions] Name drift detected: "${archName}" → "${validatedName}"`);
              nameMap.set(archName, validatedName);
            }
          }

          // If any names drifted, send updated transaction templates
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

      // Build retry message if validation failed
      if (attemptNumber === ANTHROPIC_CONFIG.phase2.maxRetries) {
        sendEvent('error', {
          phase: 4,
          message: `Contract validation failed after ${ANTHROPIC_CONFIG.phase2.maxRetries} attempts. This is not a deterministic system, so just try again - it's likely to work!`,
          details: validationError
        });
      endResponse();
        return;
      }

      // Build retry message for next attempt with MINIMAL CHANGE instructions
      // Include current contract code so AI can make targeted fixes instead of rewriting from scratch
      if (isMultiContract) {
        const failedContracts = parsed.contracts.filter((c: ContractInfo) => !c.validated);
        const failedContractNames = failedContracts.map((c: ContractInfo) => c.name).join(', ');

        // Save expected failed names for matching on retry (handles AI renaming contracts)
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

    // Send final result - let errors propagate (fail loud)
    logConversionComplete(conversionId, startTime, 'success');

    sendEvent('done', parsed);
      endResponse();

  } catch (error) {
    console.error('[Conversion] Error:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (conversionId) {
      logConversionComplete(conversionId, startTime, 'error');
    }

    // Only send error to client if they don't already have working contracts
    // If contracts were successfully sent, retry failures are just background noise
    if (sentContracts.size === 0) {
      sendEvent('error', {
        message: 'Internal server error',
        details: errorMessage
      });
    } else {
      // Contracts were sent - send 'done' event so client knows we're finished
      // Client already has contracts from contract_ready events, just needs completion signal
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
}).catch((error) => {
  console.error('[FATAL] Server initialization failed:', error);
  process.exit(1);
});
