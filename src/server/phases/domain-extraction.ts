/**
 * Phase 1: Domain Extraction
 * Extracts platform-agnostic domain model from Solidity contracts
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOMAIN_EXTRACTION_PROMPT } from '../prompts/conversion-prompts.js';
import { ANTHROPIC_CONFIG } from '../config.js';
import { insertSemanticAnalysis } from '../database.js';
import type { DomainModel } from '../types/domain-model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load JSON Schema from file (single source of truth)
export const phase1OutputSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../prompts/phase1-schema.json'), 'utf-8')
);

export interface Phase1Result {
  domainModel: DomainModel;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export async function executeDomainExtraction(
  anthropic: Anthropic,
  conversionId: number,
  solidityContract: string
): Promise<Phase1Result> {
  console.log('[Phase 1] Starting domain extraction (platform-agnostic)...');
  const startTime = Date.now();

  const userPrompt = `Extract the domain model from this smart contract:\n\n${solidityContract}`;

  const response = await anthropic.beta.messages.create({
    model: ANTHROPIC_CONFIG.phase1.model,
    max_tokens: ANTHROPIC_CONFIG.phase1.maxTokens,
    betas: [...ANTHROPIC_CONFIG.betas],
    output_format: phase1OutputSchema,
    system: DOMAIN_EXTRACTION_PROMPT,
    messages: [{
      role: 'user',
      content: userPrompt
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

  const duration = Date.now() - startTime;

  // Store in database
  insertSemanticAnalysis({
    conversion_id: conversionId,
    analysis_json: responseText,
    created_at: new Date().toISOString(),
    model_used: ANTHROPIC_CONFIG.phase1.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    response_time_ms: duration,
    user_prompt: userPrompt,
    system_prompt: DOMAIN_EXTRACTION_PROMPT
  });

  console.log('[Phase 1] Domain extraction complete:', {
    duration: `${(duration / 1000).toFixed(2)}s`,
    domain: domainModel.domain,
    entities: domainModel.entities.length,
    transitions: domainModel.transitions.length,
    invariants: domainModel.invariants.length
  });

  return {
    domainModel,
    durationMs: duration,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens
  };
}
