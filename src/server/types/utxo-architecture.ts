// ============================================================================
// UTXO ARCHITECTURE TYPES v2
// Transaction-centric state machine design
// Phase 2 output: Transaction templates are PRIMARY, contracts are DERIVED
// ============================================================================

/**
 * NFT state field - individual field in commitment layout
 */
export interface NFTStateField {
  name: string;
  type: string;
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
 * Format: "locking|category|value|tokenAmount|commitment"
 * Example: "same|systemCategory+0x01|>=1000|0|updated state"
 * Use empty string for non-replicating outputs
 */
// covenantChecklist is now a pipe-separated string, not an interface

/**
 * Transaction input specification
 * Sentinel values: stateRequired="" for no state, validates="" for P2PKH
 */
export interface TransactionInput {
  index: number;
  from: string;
  utxoType: string;
  stateRequired?: string;
  validates?: string; // Comma-separated: "check1, check2, check3"
}

/**
 * Transaction output specification
 * Sentinel values: stateProduced="" for no state, covenantChecklist="" for non-replicating
 */
export interface TransactionOutput {
  index: number;
  to: string;
  utxoType: string;
  stateProduced?: string;
  covenantChecklist?: string;
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
 * Contract definition - DERIVED from transaction templates
 * Sentinels: nftStateType="" for no state, relationships="" for none, stateLayout="" for none
 * functions format: "funcName @ txName [inputPos→outputPos]: validation1, validation2"
 */
export interface UTXOContract {
  name: string;
  role: 'container' | 'sidecar' | 'function' | 'minting' | 'independent';
  lifecycle: 'exactly-replicating' | 'state-mutating' | 'state-and-balance-mutating' | 'conditionally-replicating';
  nftStateType?: string;
  holdsBch: boolean;
  holdsNft: boolean;
  holdsFungible: boolean;
  functions: string[]; // Each: "funcName @ txName [inputPos→outputPos]: validations"
  relationships?: string;
  stateLayout?: string;
}

/**
 * Type discriminator - maps a byte prefix to a contract type
 * Used for cross-contract authentication via commitment[0]
 */
export interface TypeDiscriminator {
  discriminator: string; // Hex byte, e.g., "0x00", "0x01"
  contract: string;      // Contract name this discriminator identifies
}

/**
 * Token topology - how contracts authenticate each other
 * capabilities format: "ContractName:capability"
 * authentication format: "ContractA recognizes ContractB via commitment[0]==0x01"
 */
export interface TokenTopology {
  baseCategory: string;
  typeDiscriminators: TypeDiscriminator[];
  capabilities: string[]; // Each: "BallotContract:mutable"
  authentication: string[];
}

/**
 * Custody decision for an entity
 * custody: "contract" = NFT locked in contract, "p2pkh" = user wallet
 */
export interface CustodyDecision {
  entity: string;
  custody: 'contract' | 'p2pkh';
  contractName?: string; // Required when custody = "contract"
  rationale: string;
}

/**
 * Contract count rationale
 * breakdown format: "N containers, N sidecars, N functions, N children"
 * decisions format: "Entity: N - reason"
 */
export interface ContractCountRationale {
  total: number;
  breakdown: string;
  decisions: string[]; // Each: "Voter: 1 - state tracking"
}

/**
 * The complete UTXO architecture v2
 * warnings format: "SEVERITY: issue description - mitigation strategy"
 */
export interface UTXOArchitecture {
  nftStateTypes: NFTStateType[];
  transactionTemplates: TransactionTemplate[];
  contracts: UTXOContract[];
  tokenTopology: TokenTopology;
  custodyDecisions: CustodyDecision[];
  contractCountRationale: ContractCountRationale;
  warnings: string[];
}
