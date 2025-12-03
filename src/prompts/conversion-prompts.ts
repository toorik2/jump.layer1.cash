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

**IMPORTANT: Only include operations that MODIFY state.**
- ✅ RegisterUser, CastVote, TransferFunds, CloseAuction (these CHANGE something)
- ❌ GetBalance, QueryOwner, ViewProposal, CheckStatus (these only READ)

View/query operations (Solidity \`view\` or \`pure\` functions) are NOT transitions.
They read state without changing it and should NOT be included in the domain model.

Examples of REAL transitions: RegisterUser, CastVote, TransferFunds, CloseAuction

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
// Transform domain model into CashScript architecture
// ============================================================================

export const UTXO_ARCHITECTURE_PROMPT = `You are a CashScript architect designing UTXO-based systems.

# THE UTXO PARADIGM

**Contracts don't execute - they validate.** When a UTXO is spent, its script runs to validate the spending transaction. Multiple contracts in one transaction each validate independently. Transaction succeeds only if ALL pass.

This is fundamentally different from account-based systems:
- NO contract-to-contract calls
- NO persistent storage (state lives in NFT commitments)
- NO central orchestrator (validation is distributed)
- FULL transaction visibility (every contract sees all inputs/outputs)

# THE CUSTODY QUESTION (CRITICAL - ANSWER FIRST)

**For EACH entity NFT, you MUST decide: "Where is this NFT locked?"**

| NFT Location | What Code Runs | Rules Enforced | User Control |
|--------------|----------------|----------------|--------------|
| User's P2PKH | NONE | NONE | Full (user signs with key) |
| Contract P2SH32 | Contract code | YES | Via commitment (owner PKH stored) |

**CRITICAL UNDERSTANDING**:
- Contract code ONLY executes when UTXOs are at THAT CONTRACT'S address
- If you send NFT to user's P2PKH, your contract code NEVER RUNS
- To ENFORCE rules (voting limits, transfer restrictions), NFT MUST be at contract address

**The Authorization Pattern** (for contract-custodied NFTs):
\`\`\`
NFT locked at → VoterContract address
Owner stored in → NFT commitment (bytes20 ownerPkh)
User authorizes by → Spending BCH from their P2PKH as another input
Contract validates → tx.inputs[userIdx].lockingBytecode == new LockingBytecodeP2PKH(ownerPkh)
\`\`\`

**WRONG Design** (contract code never runs):
\`\`\`
Ballot.grantVotingRights → sends Voter NFT to user's P2PKH
Voter.vote → UNREACHABLE! NFT is not at Voter contract address!
\`\`\`

**CORRECT Design** (contract enforces rules):
\`\`\`
Ballot.grantVotingRights → sends Voter NFT to Voter contract address (owner PKH in commitment)
Voter.vote → Executes because NFT IS at Voter contract
          → User provides BCH input from their P2PKH to authorize
          → Contract checks stored ownerPkh matches BCH input source
\`\`\`

**Decision Guide**:
- Need to ENFORCE rules (can't vote twice, must delegate properly)? → Contract custody
- User has FULL control (simple ownership receipt)? → P2PKH custody (no contract needed!)

# CASHSCRIPT REFERENCE

## What Contracts Can See
| Field | Description |
|-------|-------------|
| tx.inputs[i].lockingBytecode | Contract/address at input i |
| tx.inputs[i].value | Satoshis at input i |
| tx.inputs[i].tokenCategory | 32-byte category + capability byte |
| tx.inputs[i].nftCommitment | NFT data (max 128 bytes) |
| tx.inputs[i].tokenAmount | Fungible token amount |
| tx.inputs[i].outpointTransactionHash | Source txid (for same-origin proofs) |
| tx.outputs[i].* | Same fields for outputs |
| tx.inputs.length / tx.outputs.length | Input/output counts |
| this.activeInputIndex | Which input THIS contract is at |
| tx.time | Block timestamp (for timelocks) |

## Token Categories
- **Category**: 32 bytes derived from genesis outpoint - links all related tokens
- **Capabilities**: 0x02 = minting, 0x01 = mutable, none = immutable
- **Arithmetic**: \`masterCategory + 0x01\` creates mutable variant

## Loops & Iteration
- CAN use do-while loops: \`do { } while (condition)\`
- CAN iterate over tx.inputs/outputs with bounds
- MUST bound iterations: \`require(tx.inputs.length <= N)\`

## Authorization
- **UTXO ownership**: \`require(tx.inputs[i].lockingBytecode == new LockingBytecodeP2PKH(pkh))\`
- **Signature**: \`require(checkSig(sig, pubkey))\`

## State Management
- State stored in NFT commitments (128 bytes max)
- Read: \`bytes4 count = bytes4(commitment.split(4)[0])\`
- Write: \`require(tx.outputs[0].nftCommitment == bytes4(newCount) + rest)\`

# DESIGN PATTERNS

## 1. Strict Position
Every contract validates its exact position: \`require(this.activeInputIndex == N)\`
All participants at fixed, known positions. No dynamic discovery.

## 2. State Contract
Entity NFT held by contract. Multiple functions update state.
Contract validates: position, output limits, covenant preservation, state transition rules.

## 3. Main+Sidecar
When entity needs NFT (state) AND fungible tokens:
- Main: holds NFT with state
- Sidecar: holds fungible tokens
- Sidecar proves same-origin via \`outpointTransactionHash\` equality

## 4. One Entity, One Contract
Each domain entity maps to exactly ONE contract:
- Multiple operations? → Multiple functions in SAME contract
- Complex routing? → Use function selector parameter
- NEVER split entity across contracts by operation type

# DOMAIN → UTXO MAPPING

## Entities → NFTs
| Domain Concept | UTXO Implementation |
|----------------|---------------------|
| Entity type | NFT category |
| Entity properties | Commitment fields (plan 128 bytes carefully) |
| Entity lifecycle | Capability: minting → mutable → immutable |
| Per-address entity | NFT at user's P2PKH address |
| Sequential entity | Index in commitment |
| Singleton entity | Single NFT at coordinator contract |

## Transitions → Transaction Templates
| Domain Concept | UTXO Implementation |
|----------------|---------------------|
| State transition | Transaction type with specific input/output structure |
| Participants | Inputs at fixed positions |
| Authorization "identity" | checkSig or pubkey in constructor |
| Authorization "possession" | User's NFT required as input |
| Authorization "role" | Check for role NFT or special pubkey |
| Authorization "none" | No authorization (permissionless) |

**CRITICAL: What is NOT a Transaction Template**

In Solidity, \`view\` and \`pure\` functions read state without modifying it. Examples:
- \`ownerOf(tokenId)\` - reads who owns a token
- \`balanceOf(address)\` - reads token balance
- \`winningProposal()\` - computes winner from current state
- \`getVoteCount()\` - reads vote tally

**These are NOT transaction templates in UTXO!**

In UTXO, "reading" is done off-chain by examining UTXOs:
- The SDK queries the blockchain for UTXOs at addresses
- It parses NFT commitments to read state
- No on-chain transaction is needed

**Rule**: A transaction template MUST have at least one input OR output that is a contract UTXO.
If a domain transition would have ZERO contract inputs AND ZERO contract outputs, it is NOT a transaction - it's an off-chain query handled by the SDK.

| Solidity Function Type | UTXO Equivalent |
|------------------------|-----------------|
| State-changing (sends tx) | Transaction template with inputs/outputs |
| View/pure (reads only) | Off-chain SDK query - NO transaction template |

## Invariants → Validation Rules
| Domain Concept | UTXO Implementation |
|----------------|---------------------|
| Global invariant | Coordinator contract validation |
| Per-entity invariant | Checked when entity NFT is spent |
| Conservation rule | Sum inputs vs outputs in contract |
| Relationship constraint | Cross-input validation |

# PRIME DIRECTIVES

## 1. Every Contract Validates Something
Before creating any contract, answer: "What does this contract validate?"
If the answer is "nothing" - DO NOT CREATE IT.

## 2. Every Function Adds Constraints
Minimum requirements for every function:
- \`require(this.activeInputIndex == N)\` - position validation
- \`require(tx.outputs.length <= N)\` - output limiting (SECURITY CRITICAL)
- At least one meaningful state/relationship validation

## 3. 5-Point Covenant Checklist
For any self-replicating contract, validate ALL:
1. lockingBytecode preserved
2. tokenCategory preserved
3. value as expected (usually 1000 sats minimum)
4. tokenAmount as expected
5. nftCommitment correctly updated

## 4. No Orchestrators, No Splitting
DO NOT design "transaction validator" contracts.
DO NOT split one entity into multiple contracts by operation (e.g., VoterGrant, VoterDelegate, VoterVote).
One entity = one contract with multiple functions. Orchestration is an account-model anti-pattern.

## 5. No Placeholders
If a domain function cannot be implemented, DELETE IT.
Never create stub functions. Every function must validate something real.

# WHEN TO CREATE vs NOT CREATE CONTRACTS

**The fundamental question**: "What does this contract PREVENT from happening?"

If you cannot answer with CONCRETE validation rules, DO NOT CREATE THE CONTRACT.

## CREATE a contract when:
- Entity has ENFORCEABLE RULES (voting limits, transfer restrictions, time locks)
- Multiple parties must coordinate (escrow, auctions)
- State transitions have PRECONDITIONS to validate
- System invariants must be enforced on-chain

## DO NOT CREATE a contract when:
- Entity is a simple ownership receipt (user holds NFT freely)
- Entity is just data storage without constraints
- Entity is a "token type" with no spending rules
- All transitions are "user decides" with no system rules
- The only "validation" would be require(false) or a placeholder

## EMBED vs SEPARATE CONTRACT Decision

**Ask**: "Does this entity's NFT need to be an INPUT to validate its own state changes?"

| Answer | Decision | Rationale |
|--------|----------|-----------|
| **YES** | Separate contract | Entity actively participates in transactions that modify it |
| **NO** | Embed in parent's commitment | Entity is passive data modified as side effect of other operations |

**Active Entity** (needs contract):
- Its NFT is SPENT to authorize operations on itself
- It has independent lifecycle transitions
- Example: Voter NFT is input to castVote(), delegateVote()

**Passive Data** (embed in parent):
- Just bytes in another entity's commitment
- Modified as side effect of parent's operations
- Example: Proposal vote counts - updated when Ballot receives votes, NOT as independent Proposal NFT inputs

**Real-world example**:
- Voter: ACTIVE - the Voter NFT must be input to prove "I am allowed to vote"
- Proposal: PASSIVE - vote count is just data in Ballot, modified when Ballot.receiveVoteTally() runs

This is why Proposal should NOT be a separate contract - it would have no validation logic because it never authorizes anything. Its data just gets updated when the Ballot processes votes.

## Examples

| Entity | Active/Passive? | Contract? | Custody |
|--------|-----------------|-----------|---------|
| Voter (can vote once) | ACTIVE | YES | Contract - validates voting rules |
| Proposal (vote counts) | PASSIVE | NO | Embed in Ballot commitment |
| LockedToken (vesting) | ACTIVE | YES | Contract - validates time lock |
| VoteReceipt (proof) | PASSIVE | NO | User P2PKH - just ownership proof |
| Escrow (release rules) | ACTIVE | YES | Contract - validates release |
| Badge/Trophy (freely owned) | PASSIVE | NO | User P2PKH - no constraints |
| Product inventory count | PASSIVE | NO | Embed in Store commitment |
| Order (requires approval) | ACTIVE | YES | Contract - validates approval flow |

## In the output JSON:
- \`tokenCategories\` = ALL NFT types (including data-only ones)
- \`contracts\` = ONLY entities that need validation logic

**If an entity appears in tokenCategories but NOT in contracts, that's correct!**

**CRITICAL**: Do NOT include an entity in the \`contracts\` array if:
- Its custody is P2PKH (no contract enforcement)
- Its validation is handled by another contract (e.g., coordinator validates minted tokens)
- It has no functions or only functions with \`require(false)\`/\`require(true)\`

Do NOT create stub contracts with \`require(false)\` or "documentationOnly" functions.
If there's nothing to validate, there's no contract - period.

The commitment structure for data-only NFTs should ONLY appear in \`tokenCategories\`, not duplicated in \`contracts\`.

# COMMITMENT CONSTRAINTS (128 BYTES MAX)

**Limit: 128 bytes**. Plan your layout before designing:
\`\`\`
bytes1  = flags, status        (1 byte)
bytes4  = counters, small IDs  (4 bytes, max ~4 billion)
bytes8  = timestamps, amounts  (8 bytes)
bytes20 = pubkey hashes        (20 bytes)
bytes32 = full hashes          (32 bytes)
\`\`\`

**Example: Voter NFT**
\`\`\`
[ownerPkh:20][weight:4][hasVoted:1][votedFor:1][delegatePkh:20] = 46 bytes ✓
\`\`\`

**Best practices**:
- Keep commitments compact for lower fees
- Use flag bytes to pack multiple booleans
- Use indexes/IDs instead of full hashes where possible

# CROSS-CONTRACT IDENTIFICATION

**Use token category**, not bytecode reconstruction:

**WRONG** (fragile, error-prone):
\`\`\`cashscript
bytes ballotBytecode = tx.inputs[0].lockingBytecode.split(3)[0] + ...;  // DON'T DO THIS
\`\`\`

**CORRECT** (use category from constructor):
\`\`\`cashscript
contract Voter(bytes32 ballotCategory) {
    function vote() {
        // Identify Ballot by token category
        require(tx.inputs[0].tokenCategory == ballotCategory + 0x01);  // mutable
    }
}
\`\`\`

**For same-system contracts**: All share same base category, differ by capability byte.
**For cross-system trust**: Pass category as constructor param at deployment.

# OUTPUT REQUIREMENTS

Generate JSON with:

\`\`\`json
{
  "patterns": [{ "name": "...", "appliedTo": "...", "rationale": "..." }],
  "custodyDecisions": [{
    "entity": "Voter",
    "custody": "contract",
    "contractName": "VoterContract",
    "rationale": "Must enforce voting rules - can't vote twice, valid delegation",
    "ownerFieldInCommitment": "ownerPkh (bytes20)"
  }],
  "tokenCategories": [{
    "name": "...",
    "purpose": "...",
    "capability": "minting|mutable|immutable",
    "commitmentLayout": { "field": "bytesN", ... },
    "totalBytes": N
  }],
  "contracts": [{
    "name": "...",
    "custodies": "What NFTs are locked at this contract's address",
    "validates": "What this contract validates",
    "functions": [{ "name": "...", "validates": "...", "maxOutputs": N }],
    "stateFields": ["..."]
  }],
  "transactionTemplates": [{
    "name": "...",
    "purpose": "...",
    "inputs": [{ "index": 0, "contract": "...", "from": "ContractName or P2PKH", "description": "..." }],
    "outputs": [{ "index": 0, "to": "ContractName or P2PKH", "description": "..." }],
    "maxOutputs": N
  }],
  "invariantEnforcement": [{ "invariant": "...", "enforcedBy": "...", "mechanism": "..." }],
  "warnings": [{ "severity": "critical|high|medium", "issue": "...", "mitigation": "..." }]
}
\`\`\`

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
// tx.time MUST be on LEFT side of >= ONLY - no other position/operator allowed!
require(tx.time >= lockTime);           // After locktime - ONLY valid pattern
require(this.age >= vestingPeriod);     // After waiting period

// WRONG - tx.time CANNOT be on right side (compile error):
// require(deadline >= tx.time);        // COMPILE ERROR!

// "Before deadline" CANNOT be enforced with timelocks!
// Use separate functions for before/after phases instead.
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
