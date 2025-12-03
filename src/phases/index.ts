/**
 * Phase modules for EVM to CashScript conversion
 */
export { executeDomainExtraction, phase1OutputSchema } from './domain-extraction.js';
export type { Phase1Result } from './domain-extraction.js';

export {
  executeArchitectureDesign,
  phase2OutputSchema,
  isDocumentationOnlyContract,
  filterDocumentationOnlyContracts
} from './architecture-design.js';
export type { Phase2Result } from './architecture-design.js';

export {
  outputSchema,
  retryOutputSchemaMulti,
  retryOutputSchemaSingle,
  validateContract,
  getCodeContext,
  enhanceErrorMessage,
  extractContractNameFromCode,
  normalizeContractNames,
  isPlaceholderContract,
  validateMultiContractResponse,
  applyNameMappingToTemplates,
  buildRetryMessage,
  isMultiContractResponse
} from './code-generation.js';
export type {
  ContractParam,
  ContractInfo,
  DeploymentStep,
  DeploymentGuide,
  MultiContractResponse
} from './code-generation.js';

export { ContractRegistry } from './contract-registry.js';
