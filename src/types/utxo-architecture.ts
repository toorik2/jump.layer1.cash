// ============================================================================
// UTXO ARCHITECTURE TYPES (v2)
// 6-Role Mental Model derived from ParityUSD research (26 contracts)
// Phase 2 output: HOW to implement the domain in UTXO model
// ============================================================================

// ============================================================================
// CONTRACT ROLES
// ============================================================================

/**
 * The 6 contract roles in CashScript systems
 * Each role has specific characteristics and max function limits
 */
export type ContractRole = 'entity' | 'sidecar' | 'function' | 'factory' | 'oracle' | 'utility';

/**
 * Contract identity - how instances relate to each other
 * - unique: Multiple instances with distinct tokenIds (e.g., each Loan is separate)
 * - singleton: One global instance (e.g., PriceContract, StabilityPool)
 * - ephemeral: Created and consumed within same transaction
 */
export type ContractIdentity = 'unique' | 'singleton' | 'ephemeral';

/**
 * Coupling strength between contracts
 * - tight: Sidecar pattern (origin-proof validation)
 * - medium: Function contract pattern (commitment-byte selector)
 * - loose: Entity-to-entity (category match in constructor)
 */
export type CouplingStrength = 'tight' | 'medium' | 'loose';

// ============================================================================
// AUTHENTICATION PATTERNS
// ============================================================================

/**
 * How contracts authenticate their relationships
 */
export type AuthenticationPattern =
  | { type: 'origin-proof'; mainPosition: number }           // Sidecar: same txHash, index+1
  | { type: 'commitment-byte'; selectorByte: string }        // Function: first byte of commitment
  | { type: 'category-match'; expectedCategory: string }     // Entity: tokenCategory check
  | { type: 'signature'; signerField: string }               // User: checkSig
  | { type: 'none' };                                        // Permissionless

// ============================================================================
// CONTRACT VALIDATION (PRIME DIRECTIVE)
// ============================================================================

/**
 * What does this contract validate?
 * RULE: Every contract must justify its existence with validations
 */
export interface ContractValidation {
  /** Explicit list of what this contract validates */
  validates: string[];
  /** Do these validations justify contract existence? (vs using P2PKH) */
  justified: boolean;
}

// ============================================================================
// CONTRACT COUPLING
// ============================================================================

/**
 * How this contract relates to others
 */
export interface ContractCoupling {
  /** For sidecar/function: which entity is this attached to */
  primary?: string;
  /** For entity: what sidecars are attached */
  sidecars?: string[];
  /** For entity: what function contracts are available */
  functions?: string[];
  /** Coupling strength */
  strength: CouplingStrength;
  /** How authentication is performed */
  authentication: AuthenticationPattern;
}

// ============================================================================
// CONTRACT GROUPS (Folder Structure)
// ============================================================================

/**
 * Domain-based grouping (e.g., "loan", "pool")
 */
export interface ContractGroup {
  /** Group/folder name (lowercase) */
  name: string;
  /** Primary entity in this group */
  primaryEntity: string;
  /** All contracts in this group */
  contracts: string[];
  /** Subfolder for function contracts (e.g., "loanFunctions") */
  functionSubfolder?: string;
}

// ============================================================================
// NFT CONFIGURATION
// ============================================================================

export interface NFTConfig {
  /** NFT capability: minting (0x02), mutable (0x01), immutable (0x00) */
  capability: 'minting' | 'mutable' | 'immutable';
  /** Commitment structure (max 128 bytes) */
  commitment: CommitmentField[];
  /** Total bytes used */
  totalBytes: number;
}

export interface CommitmentField {
  name: string;
  type: 'bytes1' | 'bytes2' | 'bytes4' | 'bytes8' | 'bytes20' | 'bytes32';
  bytes: number;
  description: string;
  /** Maps to which domain property? */
  mapsToProperty?: string;
}

// ============================================================================
// CONSTRUCTOR PARAMETERS
// ============================================================================

export interface ConstructorParam {
  name: string;
  type: 'bytes20' | 'bytes32' | 'pubkey' | 'int' | 'bytes';
  description: string;
  /** Where does this value come from? */
  source: 'deployment' | 'computed';
}

// ============================================================================
// FUNCTION SPECIFICATION
// ============================================================================

export interface FunctionSpec {
  name: string;
  description: string;
  /** What does this function validate? */
  validationPurpose: string;
  /** Function parameters */
  parameters: FunctionParam[];
  /** Which transaction template does this implement? */
  implementsTransition: string;
  /** Expected input index (from position convention) */
  expectedInputIndex: number;
  /** Validations (maps to require statements) */
  validations: FunctionValidation[];
  /** Does this function replicate the contract's NFT? */
  selfReplicates: boolean;
  /** For self-replicating: which commitment fields change? */
  commitmentChanges?: string[];
}

export interface FunctionParam {
  name: string;
  type: 'sig' | 'pubkey' | 'int' | 'bytes' | 'bytes20' | 'bytes32';
  description: string;
  /** Where is this used? (ensures no unused params) */
  usedFor: string;
}

export interface FunctionValidation {
  category: 'position' | 'input' | 'output' | 'authorization' | 'state' | 'time' | 'count';
  description: string;
  /** The actual require statement (pseudo-code) */
  requireStatement: string;
  /** Why is this validation needed? */
  reason: string;
}

// ============================================================================
// CONTRACT SPECIFICATION (Main Type)
// ============================================================================

/**
 * Complete specification for a CashScript contract
 * CONSTRAINT: Maximum 2 functions per contract (except function role which has 1)
 */
export interface ContractSpec {
  /** Contract name (ParityUSD style: no "Contract" suffix) */
  name: string;
  description: string;
  /** Role in the system */
  role: ContractRole;
  /** Domain group (folder) */
  group: string;
  /** Instance identity */
  identity: ContractIdentity;
  /** Expected input position (from position convention) */
  expectedPosition: number | null;
  /** Coupling relationships */
  coupling: ContractCoupling;
  /** What does this contract validate? (PRIME DIRECTIVE) */
  validation: ContractValidation;
  /** NFT configuration (if applicable) */
  nft: NFTConfig | null;
  /** Functions (max 2 for non-function roles, 1 for function role) */
  functions: FunctionSpec[];
  /** Constructor parameters */
  constructorParams: ConstructorParam[];
  /** Deployment order (lower = deploy first) */
  deploymentOrder: number;
}

// ============================================================================
// TRANSACTION TEMPLATES
// ============================================================================

/**
 * A participant in a transaction
 */
export interface TransactionParticipant {
  /** Input index (0-based, from position convention) */
  position: number;
  /** Contract name (or "P2PKH" for user wallet) */
  contract: string;
  /** Role in this transaction */
  role: 'oracle' | 'entity' | 'sidecar' | 'function' | 'user' | 'utility';
  /** What this participant contributes */
  provides: string;
  /** What this participant validates (if contract) */
  validates: string[];
  /** How this participant authenticates */
  authentication?: AuthenticationPattern;
  /** Is this input fully spent? */
  consumed: boolean;
  /** Does it self-replicate to an output? */
  replicated: boolean;
  /** Output index if replicated */
  replicatedToPosition?: number;
}

/**
 * A state change in a transaction
 */
export interface StateChange {
  /** Which entity's state changes */
  entity: string;
  /** Which field changes */
  field: string;
  /** Previous value (or "any") */
  from: string;
  /** New value (or "computed") */
  to: string;
  /** How the change is validated */
  validation: string;
}

/**
 * Transaction template describing inputs/outputs structure
 */
export interface TransactionTemplate {
  /** Transaction name (e.g., "createPair", "liquidateLoan") */
  name: string;
  /** What this transaction accomplishes */
  description: string;
  /** Which contract's function triggers this */
  triggeredBy: string;
  /** All participants (inputs) */
  participants: TransactionParticipant[];
  /** State mutations that occur */
  stateChanges: StateChange[];
  /** Summary of all validations across participants */
  validations: string[];
  /** Maximum allowed outputs */
  maxOutputs: number;
}

// ============================================================================
// DEPLOYMENT
// ============================================================================

export interface DeploymentStep {
  order: number;
  action: string;
  contracts?: string[];
  description: string;
  prerequisites: string[];
}

export interface DeploymentPlan {
  steps: DeploymentStep[];
  dependencies: { [contract: string]: string[] };
}

// ============================================================================
// TOKEN CATEGORY DESIGN
// ============================================================================

export interface TokenCategoryDesign {
  /** How is the genesis category created? */
  genesisDescription: string;
  /** Capability assignments */
  capabilities: {
    '0x02_minting': string;
    '0x01_mutable': string;
    '0x00_immutable': string;
  };
}

// ============================================================================
// ARCHITECTURE PATTERNS
// ============================================================================

export interface ArchitecturePattern {
  name: 'main-sidecar' | 'function-contracts' | 'strict-position' | 'origin-proof' | 'state-machine' | 'permissionless';
  appliedTo: string[];
  reason: string;
}

// ============================================================================
// COMPLETE UTXO ARCHITECTURE
// ============================================================================

/**
 * The complete UTXO architecture output from Phase 2
 */
export interface UTXOArchitecture {
  /** System name */
  systemName: string;
  /** System description */
  systemDescription: string;
  /** Contract groups (folder structure) */
  groups: ContractGroup[];
  /** Token category design */
  tokenCategory: TokenCategoryDesign;
  /** All contracts */
  contracts: ContractSpec[];
  /** All transaction templates */
  transactionTemplates: TransactionTemplate[];
  /** Deployment plan */
  deployment: DeploymentPlan;
  /** Architecture patterns used */
  patterns: ArchitecturePattern[];
  /** Warnings and considerations */
  warnings: string[];
}

// ============================================================================
// POSITION CONVENTION (from ParityUSD)
// ============================================================================

/**
 * Standard input positions for transaction participants
 * Position 0: Oracle (PriceContract) - provides external data
 * Position 1: Main entity - primary state holder
 * Position 2: Sidecar - token custody companion
 * Position 3: Function contract - logic module
 * Position 4+: Additional participants (other entities, users)
 */
export const POSITION_CONVENTION = {
  ORACLE: 0,
  ENTITY: 1,
  SIDECAR: 2,
  FUNCTION: 3,
  ADDITIONAL_START: 4,
} as const;

// ============================================================================
// MAX FUNCTIONS BY ROLE
// ============================================================================

/**
 * Maximum functions allowed per contract role
 * CONSTRAINT: No contract can have more than 2 functions
 */
export const MAX_FUNCTIONS_BY_ROLE: Record<ContractRole, number> = {
  entity: 2,
  sidecar: 2,
  function: 1,
  factory: 2,
  oracle: 2,
  utility: 2,
};
