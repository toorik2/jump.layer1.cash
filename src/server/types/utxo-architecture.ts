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
 * Use empty object {} for non-replicating outputs
 */
export interface CovenantChecklist {
  lockingBytecode?: string;
  tokenCategory?: string;
  value?: string;
  tokenAmount?: string;
  nftCommitment?: string;
}

/**
 * Transaction input specification
 * Sentinel values: stateRequired="" for no state, validates=[] for P2PKH
 */
export interface TransactionInput {
  index: number;
  from: string;
  utxoType: string;
  stateRequired?: string;
  validates?: string[];
}

/**
 * Transaction output specification
 * Sentinel values: stateProduced="" for no state, covenantChecklist={} for non-replicating
 */
export interface TransactionOutput {
  index: number;
  to: string;
  utxoType: string;
  stateProduced?: string;
  covenantChecklist?: CovenantChecklist;
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
 * Sentinel: outputPosition=-1 means consumed (no output)
 */
export interface ContractFunction {
  name: string;
  transaction: string;
  inputPosition: number;
  outputPosition?: number;
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
 * Sentinels: nftStateType="" for no state, relationships={} for none, stateLayout="" for none
 */
export interface UTXOContract {
  name: string;
  role: 'container' | 'sidecar' | 'function' | 'minting' | 'independent';
  lifecycle: 'exactly-replicating' | 'state-mutating' | 'state-and-balance-mutating' | 'conditionally-replicating';
  nftStateType?: string;
  holdsBch: boolean;
  holdsNft: boolean;
  holdsFungible: boolean;
  functions: ContractFunction[];
  relationships?: ContractRelationships;
  stateLayout?: string;
}

/**
 * Type discriminator mapping
 */
export interface TypeDiscriminator {
  discriminator: string;
  contract: string;
}

/**
 * Capability mapping
 */
export interface CapabilityMapping {
  contract: string;
  capability: 'none' | 'mutable' | 'minting';
}

/**
 * Token topology - how contracts authenticate each other
 */
export interface TokenTopology {
  baseCategory: string;
  typeDiscriminators: TypeDiscriminator[];
  capabilities: CapabilityMapping[];
  authentication: {
    from: string;
    recognizes: string;
    via: string;
  }[];
}

/**
 * Custody decision - where each entity's NFT is locked
 * Sentinel: contractName="" for p2pkh custody
 */
export interface CustodyDecision {
  entity: string;
  custody: 'contract' | 'p2pkh';
  contractName?: string;
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
