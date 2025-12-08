// ============================================================================
// DOMAIN MODEL TYPES
// Platform-agnostic semantic specification for smart contracts
// Phase 1 output: Captures WHAT the contract does, not HOW
// ============================================================================

/**
 * Property of an entity - data that is stored
 */
export interface DomainProperty {
  name: string;
  type: string; // Business type: 'number', 'address', 'boolean', 'bytes'
  description: string;
}

/**
 * An entity is a thing with identity and state in the domain.
 */
export interface DomainEntity {
  name: string;
  identity: string; // How uniquely identified: 'per-address', 'sequential', 'singleton'
  mutable: boolean; // Can state change after creation?
  lifecycle: string[]; // States: ['created', 'active', 'closed']
  properties: DomainProperty[];
}

/**
 * Participant in a transition
 */
export interface TransitionParticipant {
  entity: string; // Entity name
  role: string; // Role in transition: 'sender', 'recipient', 'target'
  changes?: string; // What changes on this entity
}

/**
 * A transition is a named state change in the system.
 */
export interface DomainTransition {
  name: string; // Verb-noun format: 'CastVote', 'TransferFunds'
  description: string;
  authorization: 'identity' | 'possession' | 'role' | 'none';
  participants: TransitionParticipant[];
  effects: string[];
  preconditions: string[];
  postconditions: string[];
  timeConstraints: string; // 'none' if not applicable
}

/**
 * An invariant is a rule that must ALWAYS be true.
 */
export interface DomainInvariant {
  scope: 'global' | 'per-entity' | 'relationship';
  rule: string;
  severity: 'critical' | 'important' | 'advisory';
}

/**
 * A relationship between entities
 */
export interface DomainRelationship {
  type: 'owns' | 'references' | 'contains';
  from: string;
  to: string;
  description: string;
}

/**
 * A role is a special actor in the system
 */
export interface DomainRole {
  name: string;
  assignment: string; // How assigned: 'set at creation', 'elected'
  capabilities: string[]; // Transition names this role can do
}

/**
 * The complete domain model - platform-agnostic understanding
 */
export interface DomainModel {
  systemPurpose: string;
  domain: 'voting' | 'token' | 'crowdfunding' | 'marketplace' | 'game' | 'defi' | 'governance' | 'other';
  entities: DomainEntity[];
  transitions: DomainTransition[];
  invariants: DomainInvariant[];
  relationships: DomainRelationship[];
  roles: DomainRole[];
}
