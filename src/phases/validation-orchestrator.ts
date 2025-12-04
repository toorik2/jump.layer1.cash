/**
 * Validation Orchestrator
 * Owns the retry loop for contract validation
 * Single path: always treats responses as multi-contract
 */
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_CONFIG } from '../config.js';
import { ContractRegistry } from './contract-registry.js';
import {
  validateMultiContractResponse,
  buildRetryMessage,
  normalizeContractNames,
  isMultiContractResponse,
  retryOutputSchema,
  type ContractInfo,
  type DeploymentGuide,
} from './code-generation.js';

// Events emitted during validation
export type OrchestratorEvent =
  | { type: 'generation_complete' }
  | { type: 'validation_start' }
  | { type: 'validation_progress'; validCount: number; failedCount: number; attempt: number }
  | { type: 'contract_validated'; contract: ContractInfo; readySoFar: number; totalExpected: number; deploymentGuide: DeploymentGuide | null }
  | { type: 'retrying'; attempt: number; failedNames: string[] }
  | { type: 'complete'; contracts: ContractInfo[]; deploymentGuide: DeploymentGuide | null }
  | { type: 'max_retries_exceeded'; lastError: string };

interface GenerationResponse {
  contracts: ContractInfo[];
  deploymentGuide: DeploymentGuide | null;
}

/**
 * Normalize any AI response to multi-contract format
 * Single path: everything is an array of contracts
 */
function normalizeToMultiContract(parsed: any): GenerationResponse {
  if (isMultiContractResponse(parsed)) {
    return {
      contracts: parsed.contracts,
      deploymentGuide: parsed.deploymentGuide,
    };
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
      deploymentOrder: 1,
      dependencies: [],
      constructorParams: [],
    }],
    deploymentGuide: null,
  };
}

/**
 * Normalize contracts from AI response
 */
function cleanContracts(contracts: ContractInfo[]): ContractInfo[] {
  normalizeContractNames(contracts);
  return contracts;
}

export class ValidationOrchestrator {
  private registry = new ContractRegistry();
  private sentContracts = new Set<string>();

  constructor(
    private anthropic: Anthropic,
    private systemPrompt: string,
  ) {}

  /**
   * Run validation with retries, yielding events as contracts validate
   */
  async *run(
    domainModelJSON: string,
    utxoArchitectureJSON: string,
  ): AsyncGenerator<OrchestratorEvent> {
    // Initial generation
    const initial = await this.generateInitial(domainModelJSON, utxoArchitectureJSON);
    const contracts = cleanContracts(initial.contracts);

    if (contracts.length === 0) {
      throw new Error('No valid contracts generated');
    }

    this.registry.initialize(contracts, initial.deploymentGuide);
    yield { type: 'generation_complete' };
    yield { type: 'validation_start' };

    // Validate all contracts
    const validation = validateMultiContractResponse(
      { contracts, deploymentGuide: initial.deploymentGuide! },
      this.sentContracts
    );

    yield {
      type: 'validation_progress',
      validCount: validation.validCount,
      failedCount: validation.failedCount,
      attempt: 1,
    };

    // Emit validated contracts
    yield* this.emitValidated(contracts);
    this.registry.markValidated(contracts.filter(c => c.validated));

    // Retry loop
    for (let attempt = 2; attempt <= ANTHROPIC_CONFIG.phase2.maxRetries; attempt++) {
      if (this.registry.isComplete()) break;

      const failedNames = this.registry.getFailedNames();
      const failed = contracts.filter(c => failedNames.includes(c.name));

      yield { type: 'retrying', attempt, failedNames };

      const fixed = await this.retryFix(failed);
      const merged = this.registry.mergeFixed(fixed, attempt);

      // Revalidate merged contracts
      const revalidation = validateMultiContractResponse(
        { contracts: merged, deploymentGuide: initial.deploymentGuide! },
        this.sentContracts
      );

      yield {
        type: 'validation_progress',
        validCount: revalidation.validCount,
        failedCount: revalidation.failedCount,
        attempt,
      };

      // Emit newly validated
      yield* this.emitValidated(merged);
      this.registry.markValidated(merged.filter(c => c.validated));

      // Update contracts array for next iteration
      for (let i = 0; i < contracts.length; i++) {
        const mergedContract = merged.find(m => m.name === contracts[i].name);
        if (mergedContract) {
          contracts[i] = mergedContract;
        }
      }
    }

    if (!this.registry.isComplete()) {
      const failedNames = this.registry.getFailedNames();
      const failed = contracts.filter(c => failedNames.includes(c.name));
      const lastError = failed[0]?.validationError || 'Unknown error';
      yield { type: 'max_retries_exceeded', lastError };
      throw new Error(`Validation failed after ${ANTHROPIC_CONFIG.phase2.maxRetries} attempts: ${lastError}`);
    }

    yield {
      type: 'complete',
      contracts: this.getOrderedContracts(contracts),
      deploymentGuide: this.registry.getDeploymentGuide(),
    };
  }

  private getOrderedContracts(contracts: ContractInfo[]): ContractInfo[] {
    const validated = this.registry.getValidated();
    // Return in original order
    return contracts
      .map(c => validated.find(v => v.name === c.name))
      .filter((c): c is ContractInfo => c !== undefined);
  }

  private async generateInitial(
    domainModelJSON: string,
    utxoArchitectureJSON: string,
  ): Promise<GenerationResponse> {
    const message = await this.anthropic.beta.messages.create({
      model: ANTHROPIC_CONFIG.phase2.model,
      max_tokens: ANTHROPIC_CONFIG.phase2.maxTokens,
      system: [{
        type: 'text',
        text: this.systemPrompt,
        cache_control: { type: ANTHROPIC_CONFIG.cache.type, ttl: ANTHROPIC_CONFIG.cache.ttl },
      }],
      betas: [...ANTHROPIC_CONFIG.betas],
      output_format: (await import('./code-generation.js')).outputSchema,
      messages: [{
        role: 'user',
        content: `DOMAIN MODEL (what the system does - platform-agnostic):
${domainModelJSON}

UTXO ARCHITECTURE (how to implement it):
${utxoArchitectureJSON}

Generate CashScript contracts based on the UTXO architecture above. Follow the contract specifications exactly:
- Use the contract names, roles, and validation purposes from the architecture
- Implement the functions as specified with their validation requirements
- Follow the transaction templates for input/output positions
- Apply the mandatory checklist from the system prompt

Every contract must validate something. Every function must add constraints. No placeholders.`,
      }],
    });

    const response = message.content[0].type === 'text' ? message.content[0].text : '';
    const parsed = JSON.parse(response);
    return normalizeToMultiContract(parsed);
  }

  private async retryFix(failed: ContractInfo[]): Promise<ContractInfo[]> {
    const retryMessage = buildRetryMessage(failed);

    const message = await this.anthropic.beta.messages.create({
      model: ANTHROPIC_CONFIG.phase2.model,
      max_tokens: ANTHROPIC_CONFIG.phase2.maxTokens,
      system: [{
        type: 'text',
        text: this.systemPrompt,
        cache_control: { type: ANTHROPIC_CONFIG.cache.type, ttl: ANTHROPIC_CONFIG.cache.ttl },
      }],
      betas: [...ANTHROPIC_CONFIG.betas],
      output_format: retryOutputSchema,
      messages: [{
        role: 'user',
        content: retryMessage,
      }],
    });

    const response = message.content[0].type === 'text' ? message.content[0].text : '';
    const parsed = JSON.parse(response);

    const contracts = parsed.contracts || [];
    normalizeContractNames(contracts);
    return contracts;
  }

  private *emitValidated(contracts: ContractInfo[]): Generator<OrchestratorEvent> {
    const guide = this.registry.getDeploymentGuide();
    const total = this.registry.getTotalExpected();

    for (const contract of contracts) {
      if (contract.validated && !this.sentContracts.has(contract.name)) {
        this.sentContracts.add(contract.name);
        yield {
          type: 'contract_validated',
          contract,
          readySoFar: this.sentContracts.size,
          totalExpected: total,
          deploymentGuide: this.sentContracts.size === 1 ? guide : null,
        };
      }
    }
  }
}
