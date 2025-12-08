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

export type TransactionInput = {
  index: number;
  from: string;
  type?: string;
  description: string;
  required: boolean;
};

export type TransactionOutput = {
  index: number;
  to: string;
  type?: string;
  description: string;
  changes?: string;
  required: boolean;
};

export type Transaction = {
  name: string;
  description: string;
  purpose?: string;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  participatingContracts?: string[];
  flowDescription?: string;
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
