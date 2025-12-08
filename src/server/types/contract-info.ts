/**
 * Contract information shared between Phase 3 (generation) and Phase 4 (validation)
 */
export interface ContractInfo {
  id: string;
  name: string;
  purpose: string;
  code: string;
  role: string;
  validated?: boolean;
  bytecodeSize?: number;
  validationError?: string;
}
