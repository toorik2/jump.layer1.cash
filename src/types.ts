export type ContractParam = {
  name: string;
  type: string;
  description: string;
  source: string;
  sourceContractId: string | null;
};

export type ContractInfo = {
  id: string;
  name: string;
  purpose: string;
  code: string;
  role: string;
  deploymentOrder: number;
  dependencies: string[];
  constructorParams: ContractParam[];
  validated?: boolean;
  bytecodeSize?: number;
  artifact?: any;
  validationError?: string;
};

export type DeploymentStep = {
  order: number;
  contractId: string;
  description: string;
  prerequisites: string[];
  outputs: string[];
};

export type DeploymentGuide = {
  steps: DeploymentStep[];
  warnings: string[];
  testingNotes: string[];
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
  changes?: Array<{ field: string; changeType: string; description: string }>;
  required: boolean;
};

export type Transaction = {
  name: string;
  description: string;
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
  deploymentOrder: number;
  isSkeleton?: boolean;
  dependencies?: string[];
  bytecodeSize?: number;
  artifact?: any;
  validationError?: string;
};
