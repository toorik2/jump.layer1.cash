// ============================================================================
// DOMAIN MODEL TYPES
// Platform-agnostic semantic specification for smart contracts
// Phase 1 output: Captures WHAT the contract does, not HOW
// ============================================================================

/**
 * An entity is a thing with identity and state in the domain.
 * Maps naturally to NFTs in UTXO model.
 */
export interface DomainEntity {
  name: string;
  description: string;

  /**
   * How is this entity uniquely identified?
   * Examples: "unique per address", "sequential index", "singleton"
   */
  identity: {
    type: 'per-address' | 'sequential' | 'singleton' | 'composite';
    description: string;
  };

  /**
   * Properties that persist for this entity
   */
  properties: DomainProperty[];

  /**
   * Lifecycle states this entity can be in
   * Example: ["nonexistent", "registered", "voted"]
   */
  lifecycle: string[];

  /**
   * Can this entity's state change after creation?
   * Informs mutable vs immutable NFT choice
   */
  mutable: boolean;

  /**
   * How many of this entity can exist?
   */
  cardinality: 'one' | 'fixed' | 'unbounded';
  cardinalityLimit?: number; // For 'fixed' cardinality
}

export interface DomainProperty {
  name: string;
  type: 'number' | 'boolean' | 'address' | 'bytes' | 'string' | 'reference';
  description: string;

  /**
   * For 'reference' type - which entity does this refer to?
   */
  referenceTo?: string;

  /**
   * Size constraints for serialization planning
   */
  maxBytes?: number;

  /**
   * Is this property optional?
   */
  optional?: boolean;

  /**
   * Initial/default value
   */
  initialValue?: string;
}

/**
 * A transition is a named state change in the system.
 * Maps naturally to transaction types in UTXO model.
 */
export interface DomainTransition {
  name: string;
  description: string;

  /**
   * Which entities participate in this transition?
   * Each entry describes an entity's role and state change
   */
  participants: TransitionParticipant[];

  /**
   * What effects does this transition have?
   * Human-readable descriptions of state changes
   */
  effects: string[];

  /**
   * Who can authorize this transition?
   */
  authorization: Authorization;

  /**
   * What must be true BEFORE this transition?
   */
  preconditions: string[];

  /**
   * What must be true AFTER this transition?
   */
  postconditions: string[];

  /**
   * Are there any time constraints?
   */
  timeConstraints?: TimeConstraint[];
}

export interface TransitionParticipant {
  entity: string; // Entity name
  role: 'subject' | 'target' | 'coordinator' | 'witness' | 'beneficiary';

  /**
   * What state must this entity be in before?
   * Use "any" if no state requirement
   */
  fromState?: string;

  /**
   * What state will this entity be in after?
   * Use "unchanged" if state doesn't change
   */
  toState?: string;

  /**
   * Is this participant consumed/destroyed in this transition?
   */
  consumed?: boolean;

  /**
   * Is this participant created in this transition?
   */
  created?: boolean;

  /**
   * What properties change and how?
   */
  propertyChanges?: PropertyChange[];
}

export interface PropertyChange {
  property: string;
  changeType: 'set' | 'increment' | 'decrement' | 'transfer';
  value?: string; // For 'set'
  amount?: string; // For increment/decrement
  from?: string; // For transfer
  to?: string; // For transfer
}

export interface Authorization {
  /**
   * Type of authorization required
   * - identity: Must prove you ARE someone (signature check)
   * - possession: Must HAVE something (UTXO ownership)
   * - role: Must hold a specific role/capability
   * - none: Anyone can authorize (permissionless)
   */
  type: 'identity' | 'possession' | 'role' | 'none';

  /**
   * Who/what provides the authorization
   */
  authorizer?: string;

  /**
   * Additional description
   */
  description?: string;
}

export interface TimeConstraint {
  type: 'before' | 'after' | 'within';
  reference: string; // What time/duration
  description: string;
}

/**
 * An invariant is a rule that must ALWAYS be true.
 * Maps to require() statements in CashScript.
 */
export interface DomainInvariant {
  scope: 'global' | 'entity' | 'relationship';
  scopeTarget?: string; // Entity name if scope is 'entity'
  rule: string;
  description: string;

  /**
   * How critical is this invariant?
   * - critical: Violation = security breach
   * - important: Violation = broken business logic
   * - advisory: Violation = degraded experience
   */
  severity: 'critical' | 'important' | 'advisory';
}

/**
 * A relationship between entities
 */
export interface DomainRelationship {
  type: 'ownership' | 'reference' | 'containment' | 'delegation';
  from: string; // Entity name
  to: string; // Entity name
  cardinality: 'one-to-one' | 'one-to-many' | 'many-to-many';
  via?: string; // Property name that holds the relationship
  bidirectional?: boolean;
  description: string;
}

/**
 * The complete domain model - platform-agnostic understanding
 */
export interface DomainModel {
  /**
   * High-level purpose of this system
   */
  systemPurpose: string;

  /**
   * Domain category for pattern selection
   */
  domain: 'voting' | 'token' | 'crowdfunding' | 'marketplace' | 'game' | 'defi' | 'governance' | 'other';

  /**
   * All entities in the domain
   */
  entities: DomainEntity[];

  /**
   * All transitions (operations) in the domain
   */
  transitions: DomainTransition[];

  /**
   * All invariants that must hold
   */
  invariants: DomainInvariant[];

  /**
   * Relationships between entities
   */
  relationships: DomainRelationship[];

  /**
   * Special roles in the system (admin, oracle, etc.)
   */
  roles: DomainRole[];

  /**
   * Anything that couldn't be cleanly mapped
   * Signals need for human review
   */
  unmappedConcepts?: string[];
}

export interface DomainRole {
  name: string;
  description: string;

  /**
   * How is this role assigned?
   * - constructor: Fixed at deployment
   * - entity: Has special entity (e.g., admin NFT)
   * - dynamic: Can be transferred/delegated
   */
  assignment: 'constructor' | 'entity' | 'dynamic';

  /**
   * What transitions can this role authorize?
   */
  canAuthorize: string[];
}
