// ============================================================================
// UTXO ARCHITECTURE TYPES v2
// Transaction-centric state machine design
// Phase 2 output: Transaction templates are PRIMARY, contracts are DERIVED
// ============================================================================

/**
 * NFT commitment field structure
 */
export interface NFTStateField {
  name: string;
  type: 'bytes1' | 'bytes2' | 'bytes4' | 'bytes8' | 'bytes20' | 'bytes32';
  purpose: string;
}

/**
 * NFT state type - explicit commitment layout
 * The "states" in our state machine
 */
export interface NFTStateType {
  name: string;
  derivedFrom: string;
  fields: NFTStateField[];
  totalBytes: number;
  transitions?: string[];
}

/**
 * 5-point covenant checklist for self-replicating outputs
 * Missing ANY = critical vulnerability
 */
export interface CovenantChecklist {
  lockingBytecode: string;
  tokenCategory: string;
  value: string;
  tokenAmount: number | string;
  nftCommitment: string;
}

/**
 * Transaction input specification
 */
export interface TransactionInput {
  index: number;
  from: string;
  utxoType: string;
  stateRequired?: string | null;
  validates?: string[] | null;
}

/**
 * Transaction output specification
 */
export interface TransactionOutput {
  index: number;
  to: string;
  utxoType: string;
  stateProduced?: string | null;
  covenantChecklist?: CovenantChecklist | null;
}

/**
 * Transaction template - the PRIMARY design artifact
 * Design transactions first, contracts are derived from these
 */
export interface TransactionTemplate {
  name: string;
  purpose: string;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
}

/**
 * Contract function - validates one transaction at one position
 */
export interface ContractFunction {
  name: string;
  transaction: string;
  inputPosition: number;
  outputPosition?: number | null;
  validates: string[];
}

/**
 * Contract relationships - explicit cross-contract dependencies
 */
export interface ContractRelationships {
  sidecarOf?: string;
  functionOf?: string;
  forTransaction?: string;
  identifier?: string;
  linkMethod?: string;
  hasSidecar?: string;
  hasFunctions?: string[];
}

/**
 * Contract definition - DERIVED from transaction templates
 */
export interface UTXOContract {
  name: string;
  role: 'container' | 'sidecar' | 'function' | 'minting' | 'independent';
  lifecycle: 'exactly-replicating' | 'state-mutating' | 'state-and-balance-mutating' | 'conditionally-replicating';
  nftStateType?: string | null;
  holdsBch: boolean;
  holdsNft: boolean;
  holdsFungible: boolean;
  functions: ContractFunction[];
  relationships?: ContractRelationships | null;
  stateLayout?: string | null;
}

/**
 * Token topology - how contracts authenticate each other
 */
export interface TokenTopology {
  baseCategory: string;
  typeDiscriminators: Record<string, string>;
  capabilities: Record<string, 'none' | 'mutable' | 'minting'>;
  authentication: {
    from: string;
    recognizes: string;
    via: string;
  }[];
}

/**
 * Custody decision - where each entity's NFT is locked
 */
export interface CustodyDecision {
  entity: string;
  custody: 'contract' | 'p2pkh';
  contractName?: string | null;
  rationale: string;
}

/**
 * Contract count decision
 */
export interface ContractCountDecision {
  entity: string;
  contracts: number;
  reason: string;
}

/**
 * Contract count rationale
 */
export interface ContractCountRationale {
  total: number;
  breakdown: {
    containers: number;
    sidecars: number;
    functions: number;
    children: number;
  };
  decisions: ContractCountDecision[];
}

/**
 * Warning with severity
 */
export interface Warning {
  severity: 'high' | 'medium' | 'low';
  issue: string;
  mitigation: string;
}

/**
 * The complete UTXO architecture v2
 */
export interface UTXOArchitecture {
  nftStateTypes: NFTStateType[];
  transactionTemplates: TransactionTemplate[];
  contracts: UTXOContract[];
  tokenTopology: TokenTopology;
  custodyDecisions: CustodyDecision[];
  contractCountRationale: ContractCountRationale;
  warnings: Warning[];
}
