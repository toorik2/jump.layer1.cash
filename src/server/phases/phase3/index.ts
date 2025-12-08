/**
 * Phase 3: Code Generation
 * Generates CashScript contracts from domain model and UTXO architecture
 * Returns unvalidated contracts - Phase 4 handles validation
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ANTHROPIC_CONFIG } from '../../config.js';
import { insertApiAttempt } from '../../database.js';
import type { DomainModel } from '../../types/domain-model.js';
import type { UTXOArchitecture } from '../../types/utxo-architecture.js';
import type { ContractInfo } from '../../types/contract-info.js';
import { buildCodeGenerationPrompt } from './prompt.js';
import { normalizeContractNames } from '../phase4/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load schema
const outputSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf-8'));

// Re-export ContractInfo for consumers
export type { ContractInfo } from '../../types/contract-info.js';

interface MultiContractResponse {
  contracts: ContractInfo[];
}

function isMultiContractResponse(parsed: any): parsed is MultiContractResponse {
  return parsed != null && Array.isArray(parsed.contracts);
}

/**
 * Normalize any AI response to multi-contract format
 */
function normalizeToMultiContract(parsed: any): { contracts: ContractInfo[] } {
  if (isMultiContractResponse(parsed)) {
    return { contracts: parsed.contracts };
  }

  // Single contract response → wrap in array
  const contractNameMatch = parsed.primaryContract?.match(/contract\s+(\w+)/);
  const name = contractNameMatch ? contractNameMatch[1] : 'PrimaryContract';

  return {
    contracts: [{
      id: 'primary',
      name,
      purpose: 'Primary contract',
      code: parsed.primaryContract,
      role: 'primary',
    }],
  };
}

export interface Phase3Result {
  contracts: ContractInfo[];
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export async function execute(
  anthropic: Anthropic,
  conversionId: number,
  domainModel: DomainModel,
  architecture: UTXOArchitecture,
  knowledgeBase: string
): Promise<Phase3Result> {
  console.log('[Phase 3] Starting code generation...');
  const startTime = Date.now();

  const systemPrompt = buildCodeGenerationPrompt(knowledgeBase);
  const domainModelJSON = JSON.stringify(domainModel, null, 2);
  const utxoArchitectureJSON = JSON.stringify(architecture, null, 2);

  const userMessage = `DOMAIN MODEL (what the system does - platform-agnostic):
${domainModelJSON}

UTXO ARCHITECTURE (how to implement it):
${utxoArchitectureJSON}

Generate CashScript contracts based on the UTXO architecture above. Follow the contract specifications exactly:
- Use the contract names, roles, and validation purposes from the architecture
- Implement the functions as specified with their validation requirements
- Follow the transaction templates for input/output positions
- Apply the mandatory checklist from the system prompt

Every contract must validate something. Every function must add constraints. No placeholders.`;

  let message: Anthropic.Beta.Messages.BetaMessage;
  let errorMessage: string | undefined;

  try {
    message = await anthropic.beta.messages.create({
      model: ANTHROPIC_CONFIG.phase3.model,
      max_tokens: ANTHROPIC_CONFIG.phase3.maxTokens,
      system: [{
        type: 'text',
        text: systemPrompt,
        cache_control: { type: ANTHROPIC_CONFIG.cache.type, ttl: ANTHROPIC_CONFIG.cache.ttl },
      }],
      betas: [...ANTHROPIC_CONFIG.betas],
      output_format: outputSchema,
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
    insertApiAttempt({
      conversion_id: conversionId,
      attempt_number: 1,
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
  const duration = Date.now() - startTime;

  // Log successful API call
  insertApiAttempt({
    conversion_id: conversionId,
    attempt_number: 1,
    started_at: new Date(startTime).toISOString(),
    response_time_ms: duration,
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
  const { contracts } = normalizeToMultiContract(parsed);
  normalizeContractNames(contracts, '[Phase 3]');

  if (contracts.length === 0) {
    throw new Error('No valid contracts generated');
  }

  console.log('[Phase 3] Code generation complete:', {
    duration: `${(duration / 1000).toFixed(2)}s`,
    contracts: contracts.length,
    names: contracts.map(c => c.name).join(', ')
  });

  return {
    contracts,
    durationMs: duration,
    inputTokens: message.usage?.input_tokens || 0,
    outputTokens: message.usage?.output_tokens || 0
  };
}
