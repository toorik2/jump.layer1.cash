/**
 * Phase modules for EVM to CashScript conversion
 */
export { executeDomainExtraction } from './domain-extraction.js';

export { executeArchitectureDesign } from './architecture-design.js';

export { applyNameMappingToTemplates } from './code-generation.js';
export type { ContractInfo } from './code-generation.js';

export { ValidationOrchestrator } from './validation-orchestrator.js';
export type { OrchestratorEvent } from './validation-orchestrator.js';
