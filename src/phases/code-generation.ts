/**
 * Phase 3: Code Generation
 * Generates CashScript contracts from UTXO architecture
 * Includes validation and retry logic
 */
import { compileString } from 'cashc';

// Type definitions for multi-contract responses
export interface ContractParam {
  name: string;
  type: string;
  description: string;
  source: string;
  sourceContractId: string | null;
}

export interface ContractInfo {
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

export interface DeploymentStep {
  order: number;
  contractId: string;
  description: string;
  prerequisites: string[];
  outputs: string[];
}

export interface DeploymentGuide {
  steps: DeploymentStep[];
  warnings: string[];
  testingNotes: string[];
}

export interface MultiContractResponse {
  contracts: ContractInfo[];
  deploymentGuide: DeploymentGuide;
}

export function isMultiContractResponse(parsed: any): parsed is MultiContractResponse {
  return parsed != null && Array.isArray(parsed.contracts);
}

// JSON Schema for structured outputs - multi-contract only (single path)
export const outputSchema = {
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
} as const;

// Minimal schema for retry attempts (only request fixed contracts back)
export const retryOutputSchema = {
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

// Validation utilities

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
 * Returns original message if no line number is present
 */
function enhanceErrorMessage(error: string, code: string): string {
  const lineMatch = error.match(/at Line (\d+), Column (\d+)/);

  if (!lineMatch) {
    console.log('[Compiler] Message without line number:', error);
    return error;
  }

  const lineNum = parseInt(lineMatch[1], 10);
  const context = getCodeContext(code, lineNum);

  return `${error}\n${context}`;
}

/**
 * Extract contract name from CashScript code
 * AI sometimes outputs names with tokenization artifacts
 */
function extractContractNameFromCode(code: string): string | null {
  const match = code.match(/contract\s+(\w+)/);
  return match ? match[1] : null;
}

/**
 * Normalize contract names by extracting from actual code
 * Fixes AI tokenization artifacts like "Ball ot Initial izer" -> "BallotInitializer"
 */
export function normalizeContractNames(contracts: ContractInfo[]): void {
  for (const contract of contracts) {
    const extractedName = extractContractNameFromCode(contract.code);
    if (extractedName && extractedName !== contract.name) {
      console.log(`[Normalize] Fixing contract name: "${contract.name}" -> "${extractedName}"`);
      contract.name = extractedName;
    }
  }
}

/**
 * Validate multiple contracts, tracking which have been sent to client
 */
export function validateMultiContractResponse(
  parsed: MultiContractResponse,
  alreadySentContracts?: Set<string>
): {
  allValid: boolean;
  firstError?: string;
  validCount: number;
  failedCount: number;
  failedContracts: string[];
} {
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

/**
 * Apply name mapping to transaction templates
 * Updates contract references when AI renames contracts during retry
 */
export function applyNameMappingToTemplates(
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
 * Build retry message for failed contracts
 */
export function buildRetryMessage(failedContracts: ContractInfo[]): string {
  const failedContractNames = failedContracts.map(c => c.name).join(', ');
  let message = `Fix ONLY the specific compilation errors in the following ${failedContracts.length} ${failedContracts.length === 1 ? 'contract' : 'contracts'}:\n\n`;

  failedContracts.forEach(c => {
    message += `CONTRACT: ${c.name}\n`;
    message += `CURRENT CODE:\n${c.code}\n\n`;
    message += `COMPILATION ERROR:\n${c.validationError}\n\n`;
    message += `INSTRUCTIONS: Make MINIMAL changes to fix ONLY this specific error. Do NOT restructure the contract, change function logic, or modify working code. Only fix what the compiler is complaining about.\n\n`;
    message += `---\n\n`;
  });

  message += `CRITICAL RULES:\n`;
  message += `1. Return ONLY these ${failedContracts.length} ${failedContracts.length === 1 ? 'contract' : 'contracts'}: ${failedContractNames}\n`;
  message += `2. Do NOT include any already-validated contracts in your response\n`;
  message += `3. Make MINIMAL changes - only fix the specific compilation error\n`;
  message += `4. Do NOT change contract structure, logic, or working code\n`;
  message += `5. If the error is about an unused variable, remove ONLY that variable\n`;
  message += `6. If the error is about a missing parameter, add ONLY that parameter\n`;
  message += `7. Do NOT rewrite functions, change business logic, or alter contract behavior`;

  return message;
}
