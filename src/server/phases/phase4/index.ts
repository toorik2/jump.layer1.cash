/**
 * Phase 4: Validation + Fix Loop
 * Validates contracts with CashC compiler and fixes errors via Claude
 * Completely independent - does NOT call Phase 3
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compileString } from 'cashc';
import { ANTHROPIC_CONFIG } from '../../config.js';
import { insertApiAttempt, insertValidationAttempt, generateHash } from '../../database.js';
import type { ContractInfo } from '../../types/contract-info.js';
import { buildFixPrompt } from './prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load fix schema
const fixSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf-8'));

// Re-export ContractInfo for consumers
export type { ContractInfo } from '../../types/contract-info.js';

// Events emitted during validation
export type ValidationEvent =
  | { type: 'validation_start' }
  | { type: 'validation_progress'; validCount: number; failedCount: number; attempt: number }
  | { type: 'contract_validated'; contract: ContractInfo; readySoFar: number; totalExpected: number }
  | { type: 'retrying'; attempt: number; failedNames: string[] }
  | { type: 'complete'; contracts: ContractInfo[] }
  | { type: 'max_retries_exceeded'; lastError: string };

// ============================================================================
// CONTRACT REGISTRY
// ============================================================================

class ContractRegistry {
  private validatedContracts: Map<string, ContractInfo> = new Map();
  private originalOrder: string[] = [];
  private totalExpected = 0;

  initialize(contracts: ContractInfo[]): void {
    this.originalOrder = contracts.map(c => c.name);
    this.totalExpected = contracts.length;
  }

  markValidated(contracts: ContractInfo[]): void {
    for (const contract of contracts) {
      if (contract.validated) {
        this.validatedContracts.set(contract.name, { ...contract });
      }
    }
  }

  mergeFixed(fixedContracts: ContractInfo[], attemptNumber: number): ContractInfo[] {
    const expectedFailed = this.getFailedNames();

    // Strict name validation - fail if AI returns unexpected names
    for (const fixed of fixedContracts) {
      if (!this.validatedContracts.has(fixed.name) && !expectedFailed.includes(fixed.name)) {
        throw new Error(`[Phase 4] AI returned unexpected contract name: "${fixed.name}". Expected one of: ${expectedFailed.join(', ')}`);
      }
    }

    // Build merged result preserving original order
    const contractMap = new Map(this.validatedContracts);
    for (const fixed of fixedContracts) {
      if (this.validatedContracts.has(fixed.name)) {
        console.warn(`[Phase 4] Ignoring AI re-submission of validated: "${fixed.name}"`);
      } else {
        contractMap.set(fixed.name, fixed);
      }
    }

    const merged: ContractInfo[] = [];
    for (const name of this.originalOrder) {
      const contract = contractMap.get(name);
      if (contract) {
        merged.push(contract);
      } else {
        throw new Error(`[Phase 4] Missing contract in merged result: "${name}"`);
      }
    }

    return merged;
  }

  getFailedNames(): string[] {
    return this.originalOrder.filter(name => !this.validatedContracts.has(name));
  }

  getValidated(): ContractInfo[] {
    return Array.from(this.validatedContracts.values());
  }

  getTotalExpected(): number {
    return this.totalExpected;
  }

  isComplete(): boolean {
    return this.validatedContracts.size === this.totalExpected;
  }
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

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

function getCodeContext(code: string, errorLine: number): string {
  const lines = code.split('\n');

  if (errorLine < 1 || errorLine > lines.length) {
    console.error(`[Phase 4] Line ${errorLine} out of bounds. Code has ${lines.length} lines`);
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

  return context.trimEnd();
}

function enhanceErrorMessage(error: string, code: string): string {
  const lineMatch = error.match(/at Line (\d+), Column (\d+)/);

  if (!lineMatch) {
    return error;
  }

  const lineNum = parseInt(lineMatch[1], 10);
  const context = getCodeContext(code, lineNum);

  return `${error}\n${context}`;
}

function validateContracts(
  contracts: ContractInfo[],
  alreadySentContracts?: Set<string>,
  conversionId?: number,
  attemptNumber?: number
): {
  allValid: boolean;
  firstError?: string;
  validCount: number;
  failedCount: number;
  failedContracts: string[];
} {
  if (!contracts || contracts.length === 0) {
    return {
      allValid: false,
      firstError: 'No contracts to validate',
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

  for (const contract of contracts) {
    if (alreadySentContracts && alreadySentContracts.has(contract.name)) {
      validCount++;
      continue;
    }

    const validation = validateContract(contract.code);
    contract.validated = validation.valid;
    if (validation.valid) {
      contract.bytecodeSize = validation.bytecodeSize;
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

    // Record validation attempt for error analysis
    if (conversionId !== undefined && attemptNumber !== undefined) {
      insertValidationAttempt({
        conversion_id: conversionId,
        contract_name: contract.name,
        attempt_number: attemptNumber,
        passed: validation.valid,
        validation_error: contract.validationError,
        code_hash: generateHash(contract.code),
        created_at: new Date().toISOString(),
      });
    }
  }

  return { allValid, firstError, validCount, failedCount, failedContracts };
}

// ============================================================================
// FIX MESSAGE BUILDER
// ============================================================================

function buildFixMessage(failedContracts: ContractInfo[]): string {
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

// ============================================================================
// EXECUTE (ASYNC GENERATOR)
// ============================================================================

export async function* execute(
  anthropic: Anthropic,
  contracts: ContractInfo[],
  knowledgeBase: string,
  conversionId: number
): AsyncGenerator<ValidationEvent> {
  const registry = new ContractRegistry();
  const sentContracts = new Set<string>();
  let attemptNumber = 1;
  const systemPrompt = buildFixPrompt(knowledgeBase);

  registry.initialize(contracts);
  yield { type: 'validation_start' };

  // Initial validation
  const validation = validateContracts(contracts, sentContracts, conversionId, 1);

  yield {
    type: 'validation_progress',
    validCount: validation.validCount,
    failedCount: validation.failedCount,
    attempt: 1,
  };

  // Emit all contracts
  yield* emitContracts(contracts, registry, sentContracts, false);
  registry.markValidated(contracts.filter(c => c.validated));

  // Fix loop
  for (let attempt = 2; attempt <= ANTHROPIC_CONFIG.phase4.maxRetries; attempt++) {
    if (registry.isComplete()) break;

    const failedNames = registry.getFailedNames();
    const failed = contracts.filter(c => failedNames.includes(c.name));

    yield { type: 'retrying', attempt, failedNames };

    for (const c of failed) {
      console.log(`[Phase 4] ${c.name} error: ${c.validationError?.split('\n')[0]}`);
    }

    // Fix contracts with own Claude call
    attemptNumber++;
    const fixed = await fixContracts(anthropic, systemPrompt, conversionId, attemptNumber, failed);
    const merged = registry.mergeFixed(fixed, attempt);

    // Clear failed contracts from sentContracts so they get re-emitted
    for (const name of failedNames) {
      sentContracts.delete(name);
    }

    // Revalidate merged contracts
    const revalidation = validateContracts(merged, sentContracts, conversionId, attempt);

    yield {
      type: 'validation_progress',
      validCount: revalidation.validCount,
      failedCount: revalidation.failedCount,
      attempt,
    };

    yield* emitContracts(merged, registry, sentContracts, true);
    registry.markValidated(merged.filter(c => c.validated));

    // Update contracts array for next iteration
    for (let i = 0; i < contracts.length; i++) {
      const mergedContract = merged.find(m => m.name === contracts[i].name);
      if (mergedContract) {
        contracts[i] = mergedContract;
      }
    }
  }

  if (!registry.isComplete()) {
    const failedNames = registry.getFailedNames();
    const failed = contracts.filter(c => failedNames.includes(c.name));
    const lastError = failed[0]?.validationError || 'Unknown error';
    yield { type: 'max_retries_exceeded', lastError };
    throw new Error(`Validation failed after ${ANTHROPIC_CONFIG.phase4.maxRetries} attempts: ${lastError}`);
  }

  yield {
    type: 'complete',
    contracts: getOrderedContracts(contracts, registry),
  };
}

function* emitContracts(
  contracts: ContractInfo[],
  registry: ContractRegistry,
  sentContracts: Set<string>,
  isUpdate: boolean
): Generator<ValidationEvent> {
  const total = registry.getTotalExpected();

  for (const contract of contracts) {
    const shouldEmit = contract.code && (isUpdate || !sentContracts.has(contract.name));
    if (shouldEmit) {
      sentContracts.add(contract.name);
      yield {
        type: 'contract_validated',
        contract,
        readySoFar: sentContracts.size,
        totalExpected: total,
      };
    }
  }
}

function getOrderedContracts(contracts: ContractInfo[], registry: ContractRegistry): ContractInfo[] {
  const validated = registry.getValidated();
  return contracts
    .map(c => validated.find(v => v.name === c.name))
    .filter((c): c is ContractInfo => c !== undefined);
}

// ============================================================================
// FIX CONTRACTS (OWN CLAUDE CALL)
// ============================================================================

async function fixContracts(
  anthropic: Anthropic,
  systemPrompt: string,
  conversionId: number,
  attemptNumber: number,
  failedContracts: ContractInfo[]
): Promise<ContractInfo[]> {
  const startTime = Date.now();
  const userMessage = buildFixMessage(failedContracts);

  let message: Anthropic.Beta.Messages.BetaMessage;
  let errorMessage: string | undefined;

  try {
    message = await anthropic.beta.messages.create({
      model: ANTHROPIC_CONFIG.phase4.model,
      max_tokens: ANTHROPIC_CONFIG.phase4.maxTokens,
      system: [{
        type: 'text',
        text: systemPrompt,
        cache_control: { type: ANTHROPIC_CONFIG.cache.type, ttl: ANTHROPIC_CONFIG.cache.ttl },
      }],
      betas: [...ANTHROPIC_CONFIG.betas],
      output_format: fixSchema,
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
    insertApiAttempt({
      conversion_id: conversionId,
      attempt_number: attemptNumber,
      started_at: new Date(startTime).toISOString(),
      response_time_ms: Date.now() - startTime,
      success: false,
      user_message: userMessage,
      error_message: errorMessage,
      system_prompt: systemPrompt,
    });
    throw e;
  }

  const response = message.content[0].type === 'text' ? message.content[0].text : '';

  // Log successful fix API call
  insertApiAttempt({
    conversion_id: conversionId,
    attempt_number: attemptNumber,
    started_at: new Date(startTime).toISOString(),
    response_time_ms: Date.now() - startTime,
    input_tokens: message.usage?.input_tokens,
    output_tokens: message.usage?.output_tokens,
    cache_read_tokens: (message.usage as any)?.cache_read_input_tokens,
    cache_write_tokens: (message.usage as any)?.cache_creation_input_tokens,
    success: true,
    response_type: 'multi',
    user_message: userMessage,
    response_json: response,
    system_prompt: systemPrompt,
  });

  const parsed = JSON.parse(response);
  const contracts = parsed.contracts || [];
  return contracts;
}
