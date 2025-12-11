/**
 * Phase 3: Code Generation
 * Translates UTXO Architecture into CashScript contracts
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
import { getStaticInstructions, buildUserMessage } from './prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load schema
const outputSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf-8'));

// Re-export ContractInfo for consumers
export type { ContractInfo } from '../../types/contract-info.js';

export interface Phase3Result {
  contracts: ContractInfo[];
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export async function execute(
  anthropic: Anthropic,
  conversionId: number,
  _domainModel: DomainModel, // Kept for backward compatibility, not used
  architecture: UTXOArchitecture,
  knowledgeBase: string
): Promise<Phase3Result> {
  console.log('[Phase 3] Starting code generation...');
  const startTime = Date.now();

  // Extract contract metadata from architecture for dynamic prompt
  const contractMeta = architecture.contracts?.map(c => ({
    name: c.name,
    role: c.role
  })) || [];

  const utxoArchitectureJSON = JSON.stringify(architecture, null, 2);
  const staticInstructions = getStaticInstructions();
  const userMessage = buildUserMessage(contractMeta, utxoArchitectureJSON);

  let message: Anthropic.Beta.Messages.BetaMessage;
  let errorMessage: string | undefined;

  try {
    message = await anthropic.beta.messages.create({
      model: ANTHROPIC_CONFIG.phase3.model,
      max_tokens: ANTHROPIC_CONFIG.phase3.maxTokens,
      system: [
        {
          type: 'text',
          text: knowledgeBase,  // ~30k tokens - CACHEABLE across all conversions
          cache_control: { type: ANTHROPIC_CONFIG.cache.type, ttl: ANTHROPIC_CONFIG.cache.ttl },
        },
        {
          type: 'text',
          text: staticInstructions,  // ~2k tokens - static instructions
        }
      ],
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
      system_prompt: `[KNOWLEDGE_BASE: ${knowledgeBase.length} chars]\n\n${staticInstructions}`,
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
    system_prompt: `[KNOWLEDGE_BASE: ${knowledgeBase.length} chars]\n\n${staticInstructions}`,
  });

  // Parse response - check for token limit truncation
  let parsed;
  try {
    parsed = JSON.parse(response);
  } catch (parseError) {
    const outputTokens = message.usage?.output_tokens || 0;
    const maxTokens = ANTHROPIC_CONFIG.phase3.maxTokens;

    // Check if we hit the token limit (output_tokens >= maxTokens indicates truncation)
    if (outputTokens >= maxTokens - 100) {
      throw new Error(
        `Response truncated: This contract system is too large for a single generation pass. ` +
        `The AI generated ${outputTokens.toLocaleString()} tokens but was cut off at the ` +
        `${maxTokens.toLocaleString()} token limit (Anthropic API hard limit for non-streaming). ` +
        `This is rare and only affects very complex multi-contract systems. ` +
        `Try simplifying the input contract or reducing the number of functions.`
      );
    }

    // Some other JSON parse error
    throw new Error(`Failed to parse generated code: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }

  const contracts: ContractInfo[] = parsed.contracts;

  if (!contracts || contracts.length === 0) {
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
