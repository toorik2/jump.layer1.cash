/**
 * Phase 2: UTXO Architecture Design
 * Transforms platform-agnostic domain model into CashScript-specific architecture
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ANTHROPIC_CONFIG } from '../../config.js';
import { insertUtxoArchitecture } from '../../database.js';
import type { DomainModel } from '../../types/domain-model.js';
import type { UTXOArchitecture } from '../../types/utxo-architecture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load and process prompt with schema embedded
const promptTemplate = fs.readFileSync(path.join(__dirname, 'prompt.md'), 'utf-8');
const outputSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf-8'));
const schemaForPrompt = JSON.stringify(outputSchema.schema, null, 2);
const systemPrompt = promptTemplate.replace('{{SCHEMA}}', schemaForPrompt);

export interface Phase2Result {
  architecture: UTXOArchitecture;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export async function execute(
  anthropic: Anthropic,
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
    model: ANTHROPIC_CONFIG.phase2.model,
    max_tokens: ANTHROPIC_CONFIG.phase2.maxTokens,
    betas: [...ANTHROPIC_CONFIG.betas],
    output_format: outputSchema,
    system: systemPrompt,
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
    model_used: ANTHROPIC_CONFIG.phase2.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    response_time_ms: duration,
    user_prompt: userMessage,
    system_prompt: systemPrompt
  });

  return {
    architecture,
    durationMs: duration,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens
  };
}
