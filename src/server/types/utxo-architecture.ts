// ============================================================================
// UTXO ARCHITECTURE TYPES
// CashScript-specific design derived from domain model
// Phase 2 output: HOW to implement the domain in UTXO model
// ============================================================================

/**
 * A contract in the UTXO architecture
 */
export interface UTXOContract {
  name: string;
  description: string;

  /**
   * Contract role in the system
   * - primary: Main coordinator, handles core logic
   * - helper: Auxiliary contract (sidecar, function contract)
   * - state: Pure state storage, validated by others
   */
  role: 'primary' | 'helper' | 'state';

  /**
   * What does this contract VALIDATE?
   * PRIME DIRECTIVE: Every contract must have a clear validation purpose
   */
  validationPurpose: string;

  /**
   * Constructor parameters (immutable after deployment)
   */
  constructorParams: ConstructorParam[];

  /**
   * NFT configuration if this contract uses NFTs
   */
  nft?: NFTConfig;

  /**
   * Functions this contract will have
   */
  functions: UTXOFunction[];

  /**
   * Which domain entities does this contract manage?
   */
  managesEntities: string[];

  /**
   * Which transaction templates does this contract participate in?
   */
  participatesIn: string[];

  /**
   * Deployment order (lower = deploy first)
   */
  deploymentOrder: number;
}

export interface ConstructorParam {
  name: string;
  type: 'bytes20' | 'bytes32' | 'pubkey' | 'int' | 'bytes';
  description: string;
  /**
   * Where does this value come from?
   * - deployment: Set at deployment time
   * - computed: Derived from other contracts (e.g., P2SH32 hash)
   */
  source: 'deployment' | 'computed';
}

export interface NFTConfig {
  /**
   * NFT capability
   * - minting: Can create new NFTs (0x02)
   * - mutable: State can change (0x01)
   * - immutable: Permanent receipt (0x00)
   */
  capability: 'minting' | 'mutable' | 'immutable';

  /**
   * Commitment structure (max 128 bytes)
   */
  commitment: CommitmentField[];

  /**
   * Total bytes used by commitment
   */
  totalBytes: number;
}

export interface CommitmentField {
  name: string;
  type: 'bytes1' | 'bytes2' | 'bytes4' | 'bytes8' | 'bytes20' | 'bytes32';
  bytes: number;
  description: string;

  /**
   * Maps to which domain property?
   */
  mapsToProperty?: string;
}

export interface UTXOFunction {
  name: string;
  description: string;

  /**
   * What does this function VALIDATE?
   * PRIME DIRECTIVE: Every function must add constraints
   */
  validationPurpose: string;

  /**
   * Function parameters (must all be used in body)
   */
  parameters: FunctionParam[];

  /**
   * Which transaction template does this function implement?
   */
  implementsTransition: string;

  /**
   * Expected input index for this contract
   */
  expectedInputIndex: number;

  /**
   * Validations this function must perform (maps to require statements)
   */
  validations: FunctionValidation[];

  /**
   * Does this function replicate the contract's NFT?
   */
  selfReplicates: boolean;

  /**
   * For self-replicating: which commitment fields change?
   */
  commitmentChanges?: string[];
}

export interface FunctionParam {
  name: string;
  type: 'sig' | 'pubkey' | 'int' | 'bytes' | 'bytes20' | 'bytes32';
  description: string;

  /**
   * Where in the function body is this used?
   * Helps ensure no unused parameters
   */
  usedFor: string;
}

export interface FunctionValidation {
  category: 'position' | 'input' | 'output' | 'authorization' | 'state' | 'time' | 'count';
  description: string;

  /**
   * The actual require statement (pseudo-code)
   */
  requireStatement: string;

  /**
   * Why is this validation needed?
   */
  reason: string;
}

/**
 * A transaction template describing inputs/outputs structure
 */
export interface TransactionTemplate {
  name: string;
  description: string;

  /**
   * Which domain transition does this implement?
   */
  implementsTransition: string;

  /**
   * All inputs in order
   */
  inputs: TransactionInput[];

  /**
   * All outputs in order
   */
  outputs: TransactionOutput[];

  /**
   * Maximum allowed outputs (PRIME DIRECTIVE: output count limiting)
   */
  maxOutputs: number;

  /**
   * Which contracts participate and validate?
   */
  participatingContracts: string[];

  /**
   * Human-readable description of the transaction flow
   */
  flowDescription: string;
}

export interface TransactionInput {
  index: number;
  nftCapability?: 'minting' | 'mutable' | 'immutable';
  type: 'contract-nft' | 'user-nft' | 'bch' | 'fungible';
  from: string; // Contract name (ending with "Contract") or "P2PKH"/"User" for wallets
  description: string;
  required: boolean;
}

export interface TransactionOutput {
  index: number;
  nftCapability?: 'minting' | 'mutable' | 'immutable';
  type: 'contract-nft' | 'user-nft' | 'bch' | 'fungible';
  to: string; // Contract name (ending with "Contract") or "P2PKH"/"User" for wallets
  description: string;

  /**
   * What changes from input to output?
   */
  changes: OutputChange[];

  required: boolean;
}

export interface OutputChange {
  field: 'commitment' | 'value' | 'category' | 'tokenAmount';
  changeType: 'unchanged' | 'updated' | 'derived';
  description: string;
}

/**
 * The complete UTXO architecture
 */
export interface UTXOArchitecture {
  /**
   * System overview
   */
  systemName: string;
  systemDescription: string;

  /**
   * Token category design
   */
  tokenCategory: TokenCategoryDesign;

  /**
   * All contracts in the system
   */
  contracts: UTXOContract[];

  /**
   * All transaction templates
   */
  transactionTemplates: TransactionTemplate[];

  /**
   * Deployment instructions
   */
  deployment: DeploymentPlan;

  /**
   * Architecture patterns used
   */
  patterns: ArchitecturePattern[];

  /**
   * Warnings and considerations
   */
  warnings: string[];
}

export interface TokenCategoryDesign {
  /**
   * How is the genesis category created?
   */
  genesisDescription: string;

  /**
   * Capability assignments
   */
  capabilities: {
    '0x02_minting': string; // Which contract holds minting?
    '0x01_mutable': string; // Which contracts use mutable?
    '0x00_immutable': string; // What gets immutable (receipts)?
  };
}

export interface DeploymentPlan {
  /**
   * Ordered steps for deployment
   */
  steps: DeploymentStep[];

  /**
   * Dependencies between contracts
   */
  dependencies: { [contract: string]: string[] };
}

export interface DeploymentStep {
  order: number;
  action: string;
  contracts?: string[];
  description: string;
  prerequisites: string[];
}

export interface ArchitecturePattern {
  name: 'main-sidecar' | 'function-contracts' | 'strict-position' | 'origin-proof' | 'state-machine' | 'permissionless';
  appliedTo: string[]; // Contract names
  reason: string;
}
