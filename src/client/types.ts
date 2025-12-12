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
// Sentinel values: empty strings/arrays instead of null
// CovenantChecklist is now a pipe-separated string: "locking|category|value|tokenAmount|commitment"

export type TransactionInput = {
  index: number;
  from: string; // Format: "ContractName.functionName" or "P2PKH"
  utxoType: string;
  stateRequired?: string;
  validates?: string; // Comma-separated: "check1, check2, check3"
};

export type TransactionOutput = {
  index: number;
  to: string; // Format: "ContractName.functionName", "P2PKH", or "burned"
  utxoType: string;
  stateProduced?: string;
  covenantChecklist?: string;
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
