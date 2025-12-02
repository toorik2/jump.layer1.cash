// ============================================================================
// CONVERSION PROMPTS
// Three-phase pipeline prompts for EVM to CashScript conversion
// ============================================================================

// ============================================================================
// PHASE 1: DOMAIN EXTRACTION
// Platform-agnostic understanding of what the contract does
// ============================================================================

export const DOMAIN_EXTRACTION_PROMPT = `You are a domain modeling expert. Your task is to extract a platform-agnostic understanding of a smart contract's business logic.

DO NOT think about Solidity, Ethereum, EVM, UTXO, or CashScript. Focus ONLY on the BUSINESS DOMAIN.

Think like a business analyst, not a programmer. Extract:

## 1. ENTITIES
Entities are things with identity and state. Ask:
- What "things" does this contract manage?
- What properties does each thing have?
- What states can each thing be in?
- Is each thing unique per user? Sequential? Singleton?

Examples of entities: User Account, Proposal, Vote, Token Balance, Auction Item

For each entity, identify:
- Name: Clear business name
- Properties: What data is stored (name, type, description)
- Lifecycle: What states can it be in (e.g., "created" → "active" → "closed")
- Identity: How is it uniquely identified
- Mutable: Can its state change after creation?

## 2. TRANSITIONS
Transitions are named state changes. Ask:
- What operations can users perform?
- What changes when each operation happens?
- Who can authorize each operation?

Examples: RegisterUser, CastVote, TransferFunds, CloseAuction

For each transition, identify:
- Name: Clear action name (verb-noun format)
- Description: What happens in business terms
- Participants: Which entities are involved and their roles
- Effects: What properties change and how
- Authorization: Who can trigger this (identity, possession, role, or anyone)
- Preconditions: What must be true before
- Postconditions: What must be true after
- Time constraints: Any deadlines or delays

## 3. INVARIANTS
Invariants are rules that must ALWAYS be true. Ask:
- What can NEVER happen in this system?
- What relationships must always hold?
- What security properties are critical?

Examples:
- "Total supply never changes"
- "A user can only vote once"
- "Refunds only possible if goal not met"

For each invariant, identify:
- Scope: Global, per-entity, or relationship-based
- Rule: The constraint in plain language
- Severity: Critical (security), important (logic), or advisory

## 4. RELATIONSHIPS
How entities relate to each other. Ask:
- Who owns what?
- What references what?
- What contains what?

Examples: "User owns Token Balance", "Vote references Proposal"

## 5. ROLES
Special actors in the system. Ask:
- Are there admins, oracles, or special users?
- How are roles assigned?
- What can each role do?

## CRITICAL RULES

1. NO PLATFORM CONCEPTS
   - ❌ mapping, msg.sender, storage, function call
   - ✅ collection of entities, proof of identity, persistent data, transition

2. BUSINESS TERMINOLOGY
   - ❌ "calls transfer function"
   - ✅ "transfers funds from sender to recipient"

3. COMPLETE CAPTURE
   - Every piece of state must map to an entity property
   - Every state change must map to a transition
   - Every require() must map to a precondition or invariant

4. LIFECYCLE THINKING
   - What creates each entity?
   - What destroys/finalizes each entity?
   - What states can it pass through?

5. AUTHORIZATION CLARITY
   - "identity" = must prove you ARE someone (e.g., chairperson)
   - "possession" = must HAVE something (e.g., own the token)
   - "role" = must hold a special capability
   - "none" = anyone can do it (permissionless)

## 6. DOMAIN CLASSIFICATION
Classify the contract into one of these domains based on its PRIMARY purpose:

- **voting**: Ballot systems, proposals, delegation, vote casting, tallying
- **token**: ERC20/ERC721-like tokens, minting, burning, transfers, balances
- **crowdfunding**: Campaigns, pledges, funding goals, refunds, deadlines
- **marketplace**: Listings, purchases, escrow, auctions, bidding
- **game**: Game state, moves, turns, winners, scores
- **defi**: Swaps, liquidity, staking, yields, collateral
- **governance**: DAOs, proposals with execution, timelock, admin roles
- **other**: Only if none of the above fit

IMPORTANT: Choose the MOST SPECIFIC domain that applies.
For example, a contract with "vote", "delegate", "ballot", "proposal" → domain: "voting"

Output a complete DomainModel as JSON. Include a "domain" field at the top level.`;

// ============================================================================
// PHASE 2: UTXO ARCHITECTURE DESIGN
// Map domain model to UTXO/CashScript patterns
// ============================================================================

export const UTXO_ARCHITECTURE_PROMPT = `You are a CashScript architect. Your task is to design a UTXO-based implementation of a domain model.

You will receive a platform-agnostic domain model. Design how to implement it using CashScript and CashTokens.

## CORE MAPPING RULES

### Entities → NFTs
- Each domain entity type typically becomes an NFT category
- Entity properties → NFT commitment fields (40 bytes max, plan carefully)
- Entity lifecycle → NFT capability (minting → mutable → immutable)
- Entity identity:
  - "per-address" → NFT owned by that address (user key pattern)
  - "sequential" → NFT with index in commitment
  - "singleton" → Single NFT held by coordinator contract

### Transitions → Transaction Templates
- Each domain transition becomes a transaction type
- Transition participants → Transaction inputs
- Authorization:
  - "identity" → checkSig(s, pk) or known pubkey in constructor
  - "possession" → User must include their NFT as input
  - "role" → Special NFT or pubkey check
  - "none" → No authorization checks (permissionless)

### Invariants → Validation Rules
- Global invariants → Checked in coordinator contract
- Per-entity invariants → Checked when entity's NFT is spent
- Relationship invariants → Cross-input validation

### Relationships → Token Category Arithmetic
- Ownership: NFT locking bytecode = owner's P2PKH
- References: Store reference ID in commitment
- Containment: Same token category with different commitments

## PRIME DIRECTIVES (MUST FOLLOW)

1. **EVERY CONTRACT MUST VALIDATE SOMETHING**
   - Before creating a contract, answer: "What does this contract validate?"
   - If "nothing", the contract should NOT exist
   - Every contract needs a clear validationPurpose

2. **EVERY FUNCTION MUST ADD CONSTRAINTS**
   - Every function needs at least one meaningful require()
   - Position validation: require(this.activeInputIndex == N)
   - Output count limiting: require(tx.outputs.length <= N)
   - If function validates nothing, DELETE it

3. **5-POINT COVENANT CHECKLIST** (for self-replicating contracts)
   - lockingBytecode preserved
   - tokenCategory preserved
   - value as expected
   - tokenAmount as expected
   - nftCommitment as expected (or correctly modified)

4. **OUTPUT COUNT LIMITING** (SECURITY CRITICAL)
   - Every function MUST have require(tx.outputs.length <= N)
   - Prevents unauthorized token minting
   - Calculate minimum needed + small buffer

5. **NO PLACEHOLDERS**
   - If a Solidity function can't be implemented, DELETE it
   - Never create stub functions
   - Function names must describe what they validate

## ARCHITECTURE PATTERNS

### Main+Sidecar Pattern
Use when: Entity needs both NFT (state) and fungible tokens (value)
- Main contract: NFT with state commitment
- Sidecar: Fungible token holder
- Sidecar validates same-origin via outpointTransactionHash

### Function Contract Pattern
Use when: More than 3 functions or complex validation
- Main coordinator contract
- Separate contract per function
- Function ID in NFT commitment first byte
- Main routes based on function ID

### Strict Position Pattern
Use when: Multi-contract transactions
- Every contract knows its exact input index
- Fixed positions for all participants
- No dynamic discovery

### State Contract Pattern
Use when: Entity state needs updates from multiple transitions
- State contract holds entity NFT
- Other contracts validate state changes
- State contract only validates it can be updated

## COMMITMENT BYTE PLANNING

40 bytes available (128 in 2026). Plan carefully:
- bytes4 = 4 bytes (counters, IDs)
- bytes8 = 8 bytes (large numbers, timestamps)
- bytes20 = 20 bytes (addresses, pubkey hashes)
- bytes32 = 32 bytes (hashes) - TOO BIG for most uses

Example layout:
[proposalCount:4][voterCount:4][votingOpen:1] = 9 bytes
[weight:4][hasVoted:1][delegated:1][votedFor:4][delegatePkh:20] = 30 bytes

## TRANSACTION TEMPLATE DESIGN

For each transition:
1. List all participating entities
2. Map to input positions (0, 1, 2, ...)
3. Determine what each output should contain
4. Calculate maxOutputs (minimize for security)
5. Document the flow clearly

## OUTPUT FORMAT

Generate UTXOArchitecture JSON with:
- contracts: All contracts with validation purposes
- transactionTemplates: All transaction patterns
- deployment: Ordered deployment steps
- patterns: Which patterns applied where
- warnings: Any concerns or limitations

Be thorough. This architecture directly drives code generation.`;

// ============================================================================
// PHASE 3: CODE GENERATION
// Generate CashScript from UTXO architecture
// ============================================================================

export const CODE_GENERATION_PROMPT = `You are a CashScript code generator. Generate production-ready CashScript code from a UTXO architecture specification.

You have been given:
1. Domain Model - What the system does
2. UTXO Architecture - How to implement it
3. CashScript Language Reference - Syntax and patterns

Generate complete, compilable CashScript contracts.

## PRIME DIRECTIVES (ENFORCE STRICTLY)

### 1. CONTRACT PURPOSE RULE
Before writing ANY contract, complete this sentence:
"This contract validates that _______________."

If you cannot complete it, DO NOT CREATE THE CONTRACT.

### 2. FUNCTION PARAMETER RULE
EVERY function parameter MUST be used in the function body.
CashScript compiler rejects unused parameters.
If a parameter isn't needed, don't declare it.

### 3. REQUIRED VALIDATIONS (Every Function)
\`\`\`cashscript
// 1. Position validation (ALWAYS first)
require(this.activeInputIndex == expectedIndex);

// 2. Output count limiting (ALWAYS)
require(tx.outputs.length <= maxOutputs);

// 3. Input count validation (when fixed structure)
require(tx.inputs.length == expectedInputs);

// 4. For covenants: 5-point checklist
require(tx.outputs[idx].lockingBytecode == tx.inputs[idx].lockingBytecode);
require(tx.outputs[idx].tokenCategory == tx.inputs[idx].tokenCategory);
require(tx.outputs[idx].value == expectedValue);
require(tx.outputs[idx].tokenAmount == expectedAmount);
require(tx.outputs[idx].nftCommitment == expectedCommitment);
\`\`\`

### 4. NO PLACEHOLDERS
- ❌ function placeholder() { }
- ❌ function update() { require(false); }
- ❌ // TODO: implement later
- ✅ Delete anything that can't be fully implemented

### 5. MEANINGFUL NAMES
- ❌ placeholder, handle, update, process
- ✅ validateVoteUpdate, attachToMain, processRedemption

### 6. UTXO AUTHORIZATION (Preferred)
\`\`\`cashscript
// PREFERRED: User proves ownership by spending UTXO
require(tx.inputs[1].lockingBytecode == new LockingBytecodeP2PKH(userPkh));

// ONLY for fixed admin keys:
require(checkSig(adminSig, adminPk));
\`\`\`

### 7. TIMELOCK SYNTAX
\`\`\`cashscript
// ONLY >= operator allowed with tx.time and this.age
require(tx.time >= lockTime);           // After locktime
require(deadline >= tx.time);           // Before deadline (INVERTED!)
require(this.age >= vestingPeriod);     // After waiting period
\`\`\`

### 8. TOKEN CATEGORY ARITHMETIC
\`\`\`cashscript
bytes masterCategory = tx.inputs[0].tokenCategory.split(32)[0];
// + 0x02 = minting, + 0x01 = mutable, nothing = immutable
require(tx.inputs[1].tokenCategory == masterCategory + 0x01);
\`\`\`

### 9. COMMITMENT PARSING
\`\`\`cashscript
// Always use typed variables
bytes4 count = bytes4(tx.inputs[0].nftCommitment.split(4)[0]);
bytes20 pkh = bytes20(tx.inputs[0].nftCommitment.split(4)[1].split(20)[0]);

// Reconstruct for output
require(tx.outputs[0].nftCommitment == bytes4(newCount) + pkh);
\`\`\`

### 10. INPUT/OUTPUT DOCUMENTATION
\`\`\`cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Function description
//
//inputs:
//  0   ContractName              [NFT]       (from ContractName contract)
//  1   UserKey                   [NFT]       (from user)
//  2   userBCH                   [BCH]       (from user)
//outputs:
//  0   ContractName              [NFT]       (to ContractName contract)
//  1   UserKey                   [NFT]       (to user)
//  2   change {optional}         [BCH]       (to user)
//////////////////////////////////////////////////////////////////////////////////////////
\`\`\`

## CODE STRUCTURE

\`\`\`cashscript
pragma cashscript ^0.13.0;

/*  --- ContractName NFT State ---
    bytes4 field1 = 0x00000000
    bytes20 field2 = 0x...
*/

contract ContractName(bytes32 systemTokenId) {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Function documentation with input/output structure
    //////////////////////////////////////////////////////////////////////////////////////////
    function functionName(param1, param2) {
        // 1. Position validation
        require(this.activeInputIndex == 0);

        // 2. Input/output count validation
        require(tx.inputs.length == 3);
        require(tx.outputs.length <= 4);

        // 3. Authorization (if needed)
        require(tx.inputs[2].lockingBytecode == new LockingBytecodeP2PKH(userPkh));

        // 4. Parse input state
        bytes commitment = tx.inputs[0].nftCommitment;
        bytes4 field1 = bytes4(commitment.split(4)[0]);

        // 5. Business logic validation
        require(int(field1) < 100);

        // 6. Compute new state
        bytes4 newField1 = bytes4(int(field1) + 1);

        // 7. Self-replication (5-point)
        require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
        require(tx.outputs[0].value == 1000);
        require(tx.outputs[0].tokenAmount == tx.inputs[0].tokenAmount);
        require(tx.outputs[0].nftCommitment == newField1 + field2);
    }
}
\`\`\`

## WHAT TO DELETE

If the domain model or Solidity source has:
- view/pure functions → DELETE entirely
- getter functions → DELETE entirely
- Events → No equivalent needed (tx is the event)
- Internal helpers → Inline the logic

Generate production-ready code. Every contract must compile and validate meaningful constraints.`;

// ============================================================================
// JSON SCHEMAS FOR STRUCTURED OUTPUTS
// ============================================================================

export const DOMAIN_MODEL_SCHEMA = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      systemPurpose: { type: "string" },
      domain: {
        type: "string",
        enum: ["voting", "token", "crowdfunding", "marketplace", "game", "defi", "governance", "other"]
      },
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            identity: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["per-address", "sequential", "singleton", "composite"] },
                description: { type: "string" }
              },
              required: ["type", "description"],
              additionalProperties: false
            },
            properties: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string", enum: ["number", "boolean", "address", "bytes", "string", "reference"] },
                  description: { type: "string" },
                  referenceTo: { type: "string" },
                  maxBytes: { type: "number" },
                  optional: { type: "boolean" },
                  initialValue: { type: "string" }
                },
                required: ["name", "type", "description"],
                additionalProperties: false
              }
            },
            lifecycle: { type: "array", items: { type: "string" } },
            mutable: { type: "boolean" },
            cardinality: { type: "string", enum: ["one", "fixed", "unbounded"] },
            cardinalityLimit: { type: "number" }
          },
          required: ["name", "description", "identity", "properties", "lifecycle", "mutable", "cardinality"],
          additionalProperties: false
        }
      },
      transitions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            participants: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entity: { type: "string" },
                  role: { type: "string", enum: ["subject", "target", "coordinator", "witness", "beneficiary"] },
                  fromState: { type: "string" },
                  toState: { type: "string" },
                  consumed: { type: "boolean" },
                  created: { type: "boolean" },
                  propertyChanges: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        property: { type: "string" },
                        changeType: { type: "string", enum: ["set", "increment", "decrement", "transfer"] },
                        value: { type: "string" },
                        amount: { type: "string" },
                        from: { type: "string" },
                        to: { type: "string" }
                      },
                      required: ["property", "changeType"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["entity", "role"],
                additionalProperties: false
              }
            },
            effects: { type: "array", items: { type: "string" } },
            authorization: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["identity", "possession", "role", "none"] },
                authorizer: { type: "string" },
                description: { type: "string" }
              },
              required: ["type"],
              additionalProperties: false
            },
            preconditions: { type: "array", items: { type: "string" } },
            postconditions: { type: "array", items: { type: "string" } },
            timeConstraints: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["before", "after", "within"] },
                  reference: { type: "string" },
                  description: { type: "string" }
                },
                required: ["type", "reference", "description"],
                additionalProperties: false
              }
            }
          },
          required: ["name", "description", "participants", "effects", "authorization", "preconditions", "postconditions"],
          additionalProperties: false
        }
      },
      invariants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            scope: { type: "string", enum: ["global", "entity", "relationship"] },
            scopeTarget: { type: "string" },
            rule: { type: "string" },
            description: { type: "string" },
            severity: { type: "string", enum: ["critical", "important", "advisory"] }
          },
          required: ["scope", "rule", "description", "severity"],
          additionalProperties: false
        }
      },
      relationships: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["ownership", "reference", "containment", "delegation"] },
            from: { type: "string" },
            to: { type: "string" },
            cardinality: { type: "string", enum: ["one-to-one", "one-to-many", "many-to-many"] },
            via: { type: "string" },
            bidirectional: { type: "boolean" },
            description: { type: "string" }
          },
          required: ["type", "from", "to", "cardinality", "description"],
          additionalProperties: false
        }
      },
      roles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            assignment: { type: "string", enum: ["constructor", "entity", "dynamic"] },
            canAuthorize: { type: "array", items: { type: "string" } }
          },
          required: ["name", "description", "assignment", "canAuthorize"],
          additionalProperties: false
        }
      },
      unmappedConcepts: { type: "array", items: { type: "string" } }
    },
    required: ["systemPurpose", "domain", "entities", "transitions", "invariants", "relationships", "roles"],
    additionalProperties: false
  }
} as const;

export const UTXO_ARCHITECTURE_SCHEMA = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      systemName: { type: "string" },
      systemDescription: { type: "string" },
      tokenCategory: {
        type: "object",
        properties: {
          genesisDescription: { type: "string" },
          capabilities: {
            type: "object",
            properties: {
              "0x02_minting": { type: "string" },
              "0x01_mutable": { type: "string" },
              "0x00_immutable": { type: "string" }
            },
            required: ["0x02_minting", "0x01_mutable", "0x00_immutable"],
            additionalProperties: false
          }
        },
        required: ["genesisDescription", "capabilities"],
        additionalProperties: false
      },
      contracts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            role: { type: "string", enum: ["primary", "helper", "state"] },
            validationPurpose: { type: "string" },
            constructorParams: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string" },
                  description: { type: "string" },
                  source: { type: "string", enum: ["deployment", "computed"] }
                },
                required: ["name", "type", "description", "source"],
                additionalProperties: false
              }
            },
            nft: {
              type: "object",
              properties: {
                capability: { type: "string", enum: ["minting", "mutable", "immutable"] },
                commitment: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      type: { type: "string" },
                      bytes: { type: "number" },
                      description: { type: "string" },
                      mapsToProperty: { type: "string" }
                    },
                    required: ["name", "type", "bytes", "description"],
                    additionalProperties: false
                  }
                },
                totalBytes: { type: "number" }
              },
              required: ["capability", "commitment", "totalBytes"],
              additionalProperties: false
            },
            functions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  validationPurpose: { type: "string" },
                  parameters: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        type: { type: "string" },
                        description: { type: "string" },
                        usedFor: { type: "string" }
                      },
                      required: ["name", "type", "description", "usedFor"],
                      additionalProperties: false
                    }
                  },
                  implementsTransition: { type: "string" },
                  expectedInputIndex: { type: "number" },
                  validations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        category: { type: "string" },
                        description: { type: "string" },
                        requireStatement: { type: "string" },
                        reason: { type: "string" }
                      },
                      required: ["category", "description", "requireStatement", "reason"],
                      additionalProperties: false
                    }
                  },
                  selfReplicates: { type: "boolean" },
                  commitmentChanges: { type: "array", items: { type: "string" } }
                },
                required: ["name", "description", "validationPurpose", "parameters", "implementsTransition", "expectedInputIndex", "validations", "selfReplicates"],
                additionalProperties: false
              }
            },
            managesEntities: { type: "array", items: { type: "string" } },
            participatesIn: { type: "array", items: { type: "string" } },
            deploymentOrder: { type: "number" }
          },
          required: ["name", "description", "role", "validationPurpose", "constructorParams", "functions", "managesEntities", "participatesIn", "deploymentOrder"],
          additionalProperties: false
        }
      },
      transactionTemplates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            implementsTransition: { type: "string" },
            inputs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "number" },
                  contract: { type: "string" },
                  nftCapability: { type: "string" },
                  type: { type: "string" },
                  from: { type: "string" },
                  description: { type: "string" },
                  required: { type: "boolean" }
                },
                required: ["index", "type", "from", "description", "required"],
                additionalProperties: false
              }
            },
            outputs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "number" },
                  contract: { type: "string" },
                  nftCapability: { type: "string" },
                  type: { type: "string" },
                  to: { type: "string" },
                  description: { type: "string" },
                  changes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        field: { type: "string" },
                        changeType: { type: "string" },
                        description: { type: "string" }
                      },
                      required: ["field", "changeType", "description"],
                      additionalProperties: false
                    }
                  },
                  required: { type: "boolean" }
                },
                required: ["index", "type", "to", "description", "changes", "required"],
                additionalProperties: false
              }
            },
            maxOutputs: { type: "number" },
            participatingContracts: { type: "array", items: { type: "string" } },
            flowDescription: { type: "string" }
          },
          required: ["name", "description", "implementsTransition", "inputs", "outputs", "maxOutputs", "participatingContracts", "flowDescription"],
          additionalProperties: false
        }
      },
      deployment: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                order: { type: "number" },
                action: { type: "string" },
                contracts: { type: "array", items: { type: "string" } },
                description: { type: "string" },
                prerequisites: { type: "array", items: { type: "string" } }
              },
              required: ["order", "action", "description", "prerequisites"],
              additionalProperties: false
            }
          },
          dependencies: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } }
          }
        },
        required: ["steps", "dependencies"],
        additionalProperties: false
      },
      patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            appliedTo: { type: "array", items: { type: "string" } },
            reason: { type: "string" }
          },
          required: ["name", "appliedTo", "reason"],
          additionalProperties: false
        }
      },
      warnings: { type: "array", items: { type: "string" } }
    },
    required: ["systemName", "systemDescription", "tokenCategory", "contracts", "transactionTemplates", "deployment", "patterns", "warnings"],
    additionalProperties: false
  }
} as const;
