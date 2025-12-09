export type ContractInfo = {
  id: string;
  name: string;
  purpose: string;
  code: string;
  role: string;
  validated?: boolean;
  bytecodeSize?: number;
  artifact?: any;
  validationError?: string;
};

// v2 schema types for transactions
// Sentinel values: empty strings/arrays/objects instead of null
export type CovenantChecklist = {
  lockingBytecode?: string;
  tokenCategory?: string;
  value?: string;
  tokenAmount?: string;
  nftCommitment?: string;
};

export type TransactionInput = {
  index: number;
  from: string;
  utxoType: string;
  stateRequired?: string;
  validates?: string[];
};

export type TransactionOutput = {
  index: number;
  to: string;
  utxoType: string;
  stateProduced?: string;
  covenantChecklist?: CovenantChecklist;
};

export type Transaction = {
  name: string;
  purpose: string;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
};

export type PendingContract = {
  name: string;
  custodies?: string;
  validates?: string;
};

export type DisplayContract = {
  id?: string;
  name: string;
  custodies?: string;
  validates?: string;
  validated: boolean;
  code: string;
  role: string;
  isSkeleton?: boolean;
  bytecodeSize?: number;
  artifact?: any;
  validationError?: string;
};
