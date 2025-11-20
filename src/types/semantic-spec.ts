// ============================================================================
// SEMANTIC SPECIFICATION TYPES
// Phase 1 semantic analysis output schema
// ============================================================================

export interface StateVariable {
  name: string;
  type: string; // "uint256", "mapping(address => uint)", etc.
  mutability: 'constant' | 'mutable';
  visibility: 'public' | 'private' | 'internal';
  usage: string; // How it's read/written in functions
  initialValue?: string;
}

export interface FunctionParameter {
  name: string;
  type: string;
  description: string;
}

export interface FunctionSpec {
  name: string;
  purpose: string; // What this function does in business terms
  parameters: FunctionParameter[];
  accessControl: 'anyone' | 'owner' | 'role-based' | 'conditional';
  accessControlDetails?: string; // e.g., "requires msg.sender == owner"
  stateChanges: string[]; // Which state variables are modified
  requires: string[]; // Preconditions (business logic, not code)
  ensures: string[]; // Postconditions (business logic)
  emits: string[]; // Events emitted
}

export interface AccessControlSummary {
  roles: string[]; // "owner", "user", etc.
  patterns: string[]; // "owner-only functions", "public payable", etc.
}

export interface SemanticSpecification {
  contractPurpose: string; // High-level: "Crowdfunding with refunds"
  businessLogic: string[]; // Critical rules: "If goal not met by deadline, allow refunds"
  stateVariables: StateVariable[];
  functions: FunctionSpec[];
  accessControlSummary: AccessControlSummary;
  dataRelationships: string[]; // "totalSupply = sum of all balances"
  criticalInvariants: string[]; // Must hold: "balance[x] <= totalSupply"
}
