// ============================================================================
// THREE-PHASE CONVERSION PIPELINE
// Phase 1: Domain Extraction (platform-agnostic)
// Phase 2: UTXO Architecture Design
// Phase 3: CashScript Code Generation
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import type { DomainModel } from '../types/domain-model.js';
import type { UTXOArchitecture } from '../types/utxo-architecture.js';
import {
  DOMAIN_EXTRACTION_PROMPT,
  UTXO_ARCHITECTURE_PROMPT,
  CODE_GENERATION_PROMPT,
  // Schemas available for structured outputs when needed:
  // DOMAIN_MODEL_SCHEMA,
  // UTXO_ARCHITECTURE_SCHEMA,
} from '../prompts/conversion-prompts.js';

export interface ThreePhaseResult {
  domainModel: DomainModel;
  utxoArchitecture: UTXOArchitecture;
  contracts: GeneratedContract[];
  phases: {
    phase1: PhaseMetrics;
    phase2: PhaseMetrics;
    phase3: PhaseMetrics;
  };
}

export interface GeneratedContract {
  name: string;
  code: string;
  role: 'primary' | 'helper' | 'state';
  validationPurpose: string;
  valid: boolean;
  error?: string;
  bytecodeSize?: number;
}

export interface PhaseMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface ConversionConfig {
  phase1Model: string;
  phase2Model: string;
  phase3Model: string;
  maxTokensPhase1: number;
  maxTokensPhase2: number;
  maxTokensPhase3: number;
  knowledgeBase: string;
  onPhaseStart?: (phase: number, name: string) => void;
  onPhaseComplete?: (phase: number, name: string, metrics: PhaseMetrics) => void;
}

const DEFAULT_CONFIG: ConversionConfig = {
  phase1Model: 'claude-sonnet-4-20250514',
  phase2Model: 'claude-sonnet-4-20250514',
  phase3Model: 'claude-sonnet-4-20250514',
  maxTokensPhase1: 8192,
  maxTokensPhase2: 16384,
  maxTokensPhase3: 32768,
  knowledgeBase: '',
};

/**
 * Execute the complete 3-phase conversion pipeline
 */
export async function executeThreePhaseConversion(
  anthropic: Anthropic,
  solidityCode: string,
  config: Partial<ConversionConfig> = {}
): Promise<ThreePhaseResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Phase 1: Domain Extraction
  cfg.onPhaseStart?.(1, 'Domain Extraction');
  const phase1Result = await executeDomainExtraction(anthropic, solidityCode, cfg);
  cfg.onPhaseComplete?.(1, 'Domain Extraction', phase1Result.metrics);

  // Phase 2: UTXO Architecture Design
  cfg.onPhaseStart?.(2, 'UTXO Architecture Design');
  const phase2Result = await executeArchitectureDesign(
    anthropic,
    solidityCode,
    phase1Result.domainModel,
    cfg
  );
  cfg.onPhaseComplete?.(2, 'UTXO Architecture Design', phase2Result.metrics);

  // Phase 3: Code Generation
  cfg.onPhaseStart?.(3, 'Code Generation');
  const phase3Result = await executeCodeGeneration(
    anthropic,
    solidityCode,
    phase1Result.domainModel,
    phase2Result.architecture,
    cfg
  );
  cfg.onPhaseComplete?.(3, 'Code Generation', phase3Result.metrics);

  return {
    domainModel: phase1Result.domainModel,
    utxoArchitecture: phase2Result.architecture,
    contracts: phase3Result.contracts,
    phases: {
      phase1: phase1Result.metrics,
      phase2: phase2Result.metrics,
      phase3: phase3Result.metrics,
    },
  };
}

/**
 * Phase 1: Extract platform-agnostic domain model from Solidity
 */
async function executeDomainExtraction(
  anthropic: Anthropic,
  solidityCode: string,
  config: ConversionConfig
): Promise<{ domainModel: DomainModel; metrics: PhaseMetrics }> {
  const startTime = Date.now();

  const response = await anthropic.messages.create({
    model: config.phase1Model,
    max_tokens: config.maxTokensPhase1,
    system: DOMAIN_EXTRACTION_PROMPT,
    messages: [{
      role: 'user',
      content: `Extract the domain model from this smart contract:\n\n${solidityCode}`
    }]
  });

  const endTime = Date.now();
  const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

  // Parse the domain model from JSON response
  const domainModel = extractJSON<DomainModel>(responseText);

  return {
    domainModel,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: config.phase1Model,
    },
  };
}

/**
 * Phase 2: Design UTXO architecture from domain model
 */
async function executeArchitectureDesign(
  anthropic: Anthropic,
  solidityCode: string,
  domainModel: DomainModel,
  config: ConversionConfig
): Promise<{ architecture: UTXOArchitecture; metrics: PhaseMetrics }> {
  const startTime = Date.now();

  const userMessage = `Design a UTXO architecture for this domain model.

DOMAIN MODEL:
${JSON.stringify(domainModel, null, 2)}

ORIGINAL SOLIDITY (for reference):
${solidityCode}

Design the UTXO architecture following the patterns and prime directives in the system prompt.`;

  const response = await anthropic.messages.create({
    model: config.phase2Model,
    max_tokens: config.maxTokensPhase2,
    system: UTXO_ARCHITECTURE_PROMPT,
    messages: [{
      role: 'user',
      content: userMessage
    }]
  });

  const endTime = Date.now();
  const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

  const architecture = extractJSON<UTXOArchitecture>(responseText);

  return {
    architecture,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: config.phase2Model,
    },
  };
}

/**
 * Phase 3: Generate CashScript code from architecture
 */
async function executeCodeGeneration(
  anthropic: Anthropic,
  solidityCode: string,
  domainModel: DomainModel,
  architecture: UTXOArchitecture,
  config: ConversionConfig
): Promise<{ contracts: GeneratedContract[]; metrics: PhaseMetrics }> {
  const startTime = Date.now();

  const systemPrompt = `${CODE_GENERATION_PROMPT}

CashScript Language Reference:
${config.knowledgeBase}`;

  const userMessage = `Generate CashScript contracts based on this architecture.

DOMAIN MODEL (what the system does):
${JSON.stringify(domainModel, null, 2)}

UTXO ARCHITECTURE (how to implement it):
${JSON.stringify(architecture, null, 2)}

ORIGINAL SOLIDITY (for reference):
${solidityCode}

Generate complete, compilable CashScript for each contract in the architecture.
Return JSON with a "contracts" array, each with "name", "code", "role", and "validationPurpose".`;

  const response = await anthropic.messages.create({
    model: config.phase3Model,
    max_tokens: config.maxTokensPhase3,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: userMessage
    }]
  });

  const endTime = Date.now();
  const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

  // Parse contracts from response
  const parsed = extractJSON<{ contracts: Array<{
    name: string;
    code: string;
    role: 'primary' | 'helper' | 'state';
    validationPurpose: string;
  }> }>(responseText);

  const contracts: GeneratedContract[] = parsed.contracts.map(c => ({
    name: c.name,
    code: c.code,
    role: c.role,
    validationPurpose: c.validationPurpose,
    valid: false, // Will be validated separately
  }));

  return {
    contracts,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: config.phase3Model,
    },
  };
}

/**
 * Extract JSON from a response that may contain markdown or other text
 */
function extractJSON<T>(text: string): T {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try to find JSON in markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }

    // Try to find raw JSON object/array
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }

    throw new Error('Could not extract JSON from response');
  }
}

/**
 * Validate generated contracts using the CashScript compiler
 */
export function validateContracts(
  contracts: GeneratedContract[],
  validateFn: (code: string) => { valid: boolean; error?: string; bytecodeSize?: number }
): GeneratedContract[] {
  return contracts.map(contract => {
    const result = validateFn(contract.code);
    return {
      ...contract,
      valid: result.valid,
      error: result.error,
      bytecodeSize: result.bytecodeSize,
    };
  });
}

/**
 * Create a summary of the conversion for logging
 */
export function summarizeConversion(result: ThreePhaseResult): string {
  const totalDuration =
    result.phases.phase1.durationMs +
    result.phases.phase2.durationMs +
    result.phases.phase3.durationMs;

  const totalTokens =
    result.phases.phase1.inputTokens + result.phases.phase1.outputTokens +
    result.phases.phase2.inputTokens + result.phases.phase2.outputTokens +
    result.phases.phase3.inputTokens + result.phases.phase3.outputTokens;

  const validContracts = result.contracts.filter(c => c.valid).length;

  return `
3-Phase Conversion Summary:
- Domain: ${result.domainModel.domain}
- Entities: ${result.domainModel.entities.length}
- Transitions: ${result.domainModel.transitions.length}
- Contracts: ${result.contracts.length} (${validContracts} valid)
- Patterns: ${result.utxoArchitecture.patterns.map(p => p.name).join(', ')}
- Total Duration: ${(totalDuration / 1000).toFixed(2)}s
- Total Tokens: ${totalTokens}
`.trim();
}
