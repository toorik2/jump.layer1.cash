# Multi-Contract Architecture in CashScript

This document covers production-grade patterns for building complex systems with multiple interacting CashScript contracts. These patterns are derived from analysis of ParityUSD, a 26-contract production stablecoin system.

---

## The Fundamental Challenge

In the UTXO model, contracts cannot "call" each other like in EVM. Instead, multiple contracts must participate in the SAME transaction, with each validating its own constraints. This requires careful architecture.

**Key Insight**: Multi-contract systems are transaction-structure problems, not code-flow problems.

---

## Pattern 1: Main+Sidecar

### The Problem
Bitcoin Cash allows only **one token category per UTXO output**. A contract that needs to manage both an NFT (for state) and fungible tokens (for value) cannot hold them in a single UTXO.

### The Solution
Pair every "main" contract with a "sidecar" that holds additional tokens.

```
┌─────────────────┐      ┌─────────────────────┐
│   Main.cash     │      │  MainSidecar.cash   │
│   (NFT state)   │◄────►│  (fungible tokens)  │
└─────────────────┘      └─────────────────────┘
```

### The Attach Pattern
The sidecar proves it belongs to the main contract by verifying they were created in the same transaction:

```cashscript
contract TokenSidecar() {
    function attach() {
        // Sidecar must be immediately after main contract in inputs
        int mainIndex = this.activeInputIndex - 1;

        // CRITICAL: Prove same-transaction origin
        require(tx.inputs[this.activeInputIndex].outpointTransactionHash ==
                tx.inputs[mainIndex].outpointTransactionHash);

        // CRITICAL: Prove sequential output indices
        require(tx.inputs[this.activeInputIndex].outpointIndex ==
                tx.inputs[mainIndex].outpointIndex + 1);

        // Self-replicate
        require(tx.outputs[this.activeInputIndex].lockingBytecode ==
                tx.inputs[this.activeInputIndex].lockingBytecode);
        require(tx.outputs[this.activeInputIndex].value == 1000);
    }
}
```

### Why This Works
- `outpointTransactionHash` equality proves both UTXOs came from the same creating transaction
- `outpointIndex` sequential ordering proves they were created as adjacent outputs
- Together, this creates an unbreakable bond between main and sidecar

### When to Use
- Contract manages NFT state AND fungible tokens
- Contract needs to hold multiple token categories
- Complex DeFi protocols (lending, stablecoins, DEXes)

---

## Pattern 2: Function Contracts

### The Problem
A contract with many functions becomes:
- Hard to maintain
- Expensive to execute (all code loaded even if using one function)
- Difficult to upgrade

### The Solution
Split each logical "function" into a separate contract file, authenticated by NFT commitment bytes.

```
MainCoordinator.cash
   │
   ├── functionA.cash     (NFT commitment prefix: 0x00)
   ├── functionB.cash     (NFT commitment prefix: 0x01)
   ├── functionC.cash     (NFT commitment prefix: 0x02)
   └── functionD.cash     (NFT commitment prefix: 0x03)
```

### The Routing Pattern

Main contract routes to appropriate validation based on function identifier:

```cashscript
contract MainCoordinator(bytes32 systemTokenId) {
    function interact(int functionInputIndex) {
        // Extract function identifier from the function contract's NFT
        bytes functionId = tx.inputs[functionInputIndex].nftCommitment.split(1)[0];

        // Authenticate the function contract
        require(tx.inputs[functionInputIndex].tokenCategory == systemTokenId + 0x01);

        // Route to appropriate validation
        if (functionId == 0x00) {
            // Function A validation logic
            require(tx.outputs.length <= 5);
            // ... specific constraints
        } else if (functionId == 0x01) {
            // Function B validation logic
            require(tx.outputs.length <= 7);
            // ... specific constraints
        } else if (functionId == 0x02) {
            // Function C validation logic
            // ...
        }
        // Add more functions as needed
    }
}
```

### Function Contract Template

Each function contract validates its own logic and position:

```cashscript
contract FunctionA(bytes32 systemTokenId) {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Execute function A operation.
    //
    //inputs:
    //  0   MainCoordinator           [NFT]       (from MainCoordinator contract)
    //  1   functionA                 [NFT]       (from FunctionA contract - this)
    //  2   userBCH                   [BCH]       (from user)
    //outputs:
    //  0   MainCoordinator           [NFT]       (to MainCoordinator contract)
    //  1   functionA                 [NFT]       (to FunctionA contract)
    //  2   result                    [BCH]       (to user)
    //////////////////////////////////////////////////////////////////////////////////////////
    function execute() {
        // Validate this contract's position
        require(this.activeInputIndex == 1);

        // Validate main coordinator at position 0
        require(tx.inputs[0].tokenCategory == systemTokenId + 0x01);
        require(tx.inputs[0].nftCommitment.split(1)[0] == 0xFF); // Main identifier

        // Function-specific validation
        // ...

        // Self-replicate at fixed value
        require(tx.outputs[1].lockingBytecode == tx.inputs[1].lockingBytecode);
        require(tx.outputs[1].tokenCategory == tx.inputs[1].tokenCategory);
        require(tx.outputs[1].value == 1000);
    }
}
```

### Benefits
- **Modularity**: Add new functions without changing main contract
- **Efficiency**: Only load code for the function being executed
- **Security**: Each function can have specific output limits
- **Upgradability**: Deploy new function contracts while keeping main contract

---

## Pattern 3: Strict Input Position

### The Rule
Every contract in a multi-contract transaction must know exactly which input index it occupies and which indices other contracts occupy.

### Why This Matters
Without explicit position validation:
- Attackers could reorder inputs to bypass validation
- Contracts might validate the wrong input
- Transaction structure becomes ambiguous

### Implementation

```cashscript
function myOperation() {
    // ALWAYS validate your own position first
    require(this.activeInputIndex == 2);

    // Define expected positions
    // Index 0: Price oracle
    // Index 1: Main contract
    // Index 2: This function contract
    // Index 3: User BCH

    // Validate each position
    require(tx.inputs[0].tokenCategory == oracleCategory);
    require(tx.inputs[1].tokenCategory == mainCategory);
    require(tx.inputs[3].tokenCategory == 0x); // Pure BCH

    // Now safe to use these indices
}
```

### Position Documentation Pattern

Always document input/output positions in function headers:

```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Process a redemption operation.
//
//inputs:
//  0   PriceOracle               [NFT]       (from PriceOracle contract)
//  1   MainContract              [NFT]       (from Main contract)
//  2   MainSidecar               [NFT]       (from Sidecar contract)
//  3   redeemFunction            [NFT]       (from Redeem contract - this)
//  4   userKey                   [NFT]       (from user)
//  5   feeBCH                    [BCH]       (from fee payer)
//outputs:
//  0   PriceOracle               [NFT]       (to PriceOracle contract)
//  1   MainContract              [NFT]       (to Main contract)
//  2   MainSidecar               [NFT]       (to Sidecar contract)
//  3   redeemFunction            [NFT]       (to Redeem contract)
//  4   userPayment               [BCH]       (to user)
//////////////////////////////////////////////////////////////////////////////////////////
function redeem() {
    require(this.activeInputIndex == 3);
    // ...
}
```

---

## Pattern 4: Self-Replicating Covenant Categories

### Four Types of Covenants

| Type | What Changes | Example Use |
|------|--------------|-------------|
| **Exactly Self-Replicating** | Nothing | Factory contracts, routers |
| **State-Mutating** | Only NFT commitment | Price oracles, counters |
| **State-and-Balance-Mutating** | NFT commitment + BCH value | Liquidity pools, treasuries |
| **Conditionally-Replicating** | Sometimes doesn't replicate | Loans (close on repayment) |

### The 5-Point Validation Checklist

For any self-replicating covenant, validate ALL of:

```cashscript
// 1. Same contract code
require(tx.outputs[idx].lockingBytecode == tx.inputs[idx].lockingBytecode);

// 2. Same token category
require(tx.outputs[idx].tokenCategory == tx.inputs[idx].tokenCategory);

// 3. Expected satoshi value
require(tx.outputs[idx].value == expectedValue);

// 4. Expected token amount
require(tx.outputs[idx].tokenAmount == expectedTokenAmount);

// 5. Expected state (or modified state)
require(tx.outputs[idx].nftCommitment == newCommitment);
```

### Exactly Self-Replicating Example

```cashscript
contract Router() {
    function route() {
        // Validate exact self-replication
        require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
        require(tx.outputs[0].value == tx.inputs[0].value);
        require(tx.outputs[0].tokenAmount == tx.inputs[0].tokenAmount);
        require(tx.outputs[0].nftCommitment == tx.inputs[0].nftCommitment);

        // Router logic...
    }
}
```

### State-Mutating Example

```cashscript
contract Counter() {
    function increment() {
        // Parse current count
        int count = int(tx.inputs[0].nftCommitment);

        // Increment
        int newCount = count + 1;

        // Self-replicate with new state
        require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
        require(tx.outputs[0].value == tx.inputs[0].value);
        require(tx.outputs[0].tokenAmount == tx.inputs[0].tokenAmount);
        require(tx.outputs[0].nftCommitment == bytes8(newCount)); // Changed!
    }
}
```

---

## Pattern 5: Cross-Contract Trust Model

### Token Category Arithmetic

Contracts authenticate each other using deterministic category offsets:

```cashscript
// Root category (32 bytes)
bytes32 systemTokenId = 0x1234...;

// Different contracts/NFTs use offsets
// systemTokenId + 0x00 = immutable NFTs
// systemTokenId + 0x01 = mutable NFTs
// systemTokenId + 0x02 = minting NFTs

// Validate another contract has minting authority
require(tx.inputs[0].tokenCategory == systemTokenId + 0x02);

// Validate another contract has mutable NFT
require(tx.inputs[1].tokenCategory == systemTokenId + 0x01);
```

### The 33rd Byte

The `tokenCategory` field is 33 bytes:
- Bytes 0-31: The category ID
- Byte 32: The capability flag
  - `0x00` or absent = immutable
  - `0x01` = mutable
  - `0x02` = minting

### Extracting Category vs Capability

```cashscript
bytes category, bytes capability = tx.inputs[0].tokenCategory.split(32);

// Check specific capability
require(capability == 0x02); // Must be minting
require(capability == 0x01); // Must be mutable
require(capability == 0x);   // Must be immutable
```

### Trust Hierarchies

```
Minting NFT (0x02)
   │
   ├── Can create new mutable NFTs
   ├── Can create new immutable NFTs
   │
   └── Mutable NFT (0x01)
          │
          ├── Can modify own commitment once
          ├── Can downgrade to immutable
          │
          └── Immutable NFT (0x00)
                 │
                 └── Permanent, cannot change
```

---

## Pattern 6: Origin Proof Chains

### The Problem
How do you prove an NFT was legitimately created by your system?

### The Solution
Chain of contracts that verify same-transaction origin:

```
Factory.cash
    │
    ├─► Enforcer.cash (verifies Factory co-created)
    │       │
    │       └─► Proof.cash (verifies Enforcer co-created)
    │               │
    └───────────────┴─► [final verified NFT]
```

### Implementation

**Factory** creates both Enforcer and Proof in same transaction:
```cashscript
contract Factory() {
    function create() {
        // Create enforcer at output 1
        require(tx.outputs[1].tokenCategory == factoryCategory + 0x01);

        // Create proof at output 2
        require(tx.outputs[2].tokenCategory == factoryCategory);
        require(tx.outputs[2].nftCommitment == proofData);
    }
}
```

**Enforcer** verifies it was co-created with Factory:
```cashscript
contract Enforcer() {
    function verify() {
        int factoryIdx = this.activeInputIndex - 1;

        // Must have been created together
        require(tx.inputs[this.activeInputIndex].outpointTransactionHash ==
                tx.inputs[factoryIdx].outpointTransactionHash);
    }
}
```

---

## Pattern 7: Output Count Limiting

### Critical Security Rule

**ALWAYS limit the maximum number of outputs** to prevent unauthorized token minting.

```cashscript
function anyOperation() {
    // CRITICAL: Prevent minting attacks
    require(tx.outputs.length <= 5);

    // ... rest of logic
}
```

### Standard Limits by Contract Type

| Contract Type | Typical Limit | Reason |
|--------------|---------------|--------|
| Simple transfer | 3-4 | Input + output + change |
| Function contract | 5-7 | Participants + change |
| Batch operation | 10-20 | Multiple recipients |
| Maximum recommended | 50 | Transaction size limits |

### Why This Matters

Without output limits, an attacker could:
1. Create a valid transaction
2. Add extra outputs minting unauthorized tokens
3. The contract wouldn't notice the extra outputs

---

## Contract Purpose Philosophy

### The Golden Rule

**Before creating any contract, answer: "What does this contract validate?"**

If the answer is "nothing," the contract should not exist.

### What Real Contracts Validate

| Contract Type | What It Validates |
|--------------|-------------------|
| Sidecar | Same-origin with main contract |
| Function | Authority to execute operation |
| Router | Transaction structure matches operation type |
| Oracle | Price data authenticity |
| Receipt | Proof of completed action |

### Minimum Viable Contract

Even the simplest contract (a sidecar) has meaningful validation:

```cashscript
contract MinimalSidecar() {
    function attach() {
        int mainIdx = this.activeInputIndex - 1;

        // Validates: Was created with main contract
        require(tx.inputs[this.activeInputIndex].outpointTransactionHash ==
                tx.inputs[mainIdx].outpointTransactionHash);

        // Validates: Sequential output position
        require(tx.inputs[this.activeInputIndex].outpointIndex ==
                tx.inputs[mainIdx].outpointIndex + 1);

        // Validates: Self-replication
        require(tx.outputs[this.activeInputIndex].lockingBytecode ==
                tx.inputs[this.activeInputIndex].lockingBytecode);
    }
}
```

This is NOT a placeholder - it validates three critical relationships.

### Anti-Placeholder Principle

The question is never "how do I implement this function?"

The question is "what constraint does this contract add to the transaction?"

If no constraint, no contract.

---

## Deployment Checklist

When deploying a multi-contract system:

1. **Deploy all contracts** - Get P2SH32 addresses
2. **Create token category** - Genesis transaction
3. **Hardcode addresses** - Embed in source where needed
4. **Recompile** - With embedded addresses
5. **Redeploy** - Final deployment with trust anchors
6. **Mint system NFTs** - Create master/function/sidecar NFTs
7. **Initialize positions** - Send NFTs to their contracts
8. **Test transactions** - Verify all positions work

### Critical Note

Contracts are **immutable after deployment**. All inter-contract addresses must be correct at compile time. Plan carefully.

---

## MANDATORY CONTRACT VALIDATION CHECKLIST

**CRITICAL: Before finalizing ANY contract, verify ALL items below.**

### For EVERY Contract (Primary, Helper, or State)

| # | Requirement | Example |
|---|-------------|---------|
| 1 | **Output count is LIMITED** | `require(tx.outputs.length <= 5);` |
| 2 | **Function name describes purpose** | `validateUpdate()`, `attachToMain()` |
| 3 | **Input/output positions documented** | See Position Documentation Pattern |

### For Self-Replicating Contracts (5-Point Covenant)

| # | Validation | Code |
|---|------------|------|
| 1 | Same contract code | `require(tx.outputs[idx].lockingBytecode == tx.inputs[idx].lockingBytecode);` |
| 2 | Same token category | `require(tx.outputs[idx].tokenCategory == tx.inputs[idx].tokenCategory);` |
| 3 | Expected satoshi value | `require(tx.outputs[idx].value == 1000);` |
| 4 | Expected token amount | `require(tx.outputs[idx].tokenAmount == expectedAmount);` |
| 5 | Expected/validated commitment | `require(tx.outputs[idx].nftCommitment == expectedCommitment);` |

### BANNED Patterns

```cashscript
// WRONG - Never use these:
function placeholder() { ... }     // Vague, suggests stub
function update() { ... }          // Too generic
function handle() { ... }          // Meaningless

// RIGHT - Descriptive names:
function validateVoteUpdate() { ... }
function attachToVotingBooth() { ... }
function processRedemption() { ... }
```

### State Contract Minimum Requirements

State contracts that participate in transactions with other contracts MUST:

1. **Validate their position**: `require(this.activeInputIndex == expectedIndex);`
2. **Authenticate the primary contract**: Verify token category of the coordinating contract
3. **Limit outputs**: `require(tx.outputs.length <= N);`
4. **Complete 5-point self-replication**: All 5 covenant validations
5. **Document the transaction structure**: Input/output position comments

### Example: Correct State Contract

```cashscript
contract ProposalCounter() {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Validate proposal vote count updates during VotingBooth.vote() transactions.
    //
    //inputs:
    //  0   VotingBooth               [NFT]       (from VotingBooth contract)
    //  1   VoterKey                  [NFT]       (from voter)
    //  2   ProposalCounter           [NFT]       (this contract)
    //  3   voterBCH                  [BCH]       (from voter)
    //outputs:
    //  0   VotingBooth               [NFT]       (to VotingBooth contract)
    //  1   VoterKey                  [NFT]       (to voter)
    //  2   ProposalCounter           [NFT]       (to ProposalCounter contract)
    //  3   change {optional}         [BCH]       (to voter)
    //////////////////////////////////////////////////////////////////////////////////////////
    function validateVoteUpdate() {
        // 1. Validate position
        require(this.activeInputIndex == 2);

        // 2. CRITICAL: Limit outputs
        require(tx.outputs.length <= 4);

        // 3. Authenticate VotingBooth at position 0
        bytes masterCategory = tx.inputs[this.activeInputIndex].tokenCategory.split(32)[0];
        require(tx.inputs[0].tokenCategory == masterCategory + 0x01);

        // 4. Complete 5-point self-replication
        require(tx.outputs[2].lockingBytecode == tx.inputs[2].lockingBytecode);
        require(tx.outputs[2].tokenCategory == tx.inputs[2].tokenCategory);
        require(tx.outputs[2].value == 1000);
        require(tx.outputs[2].tokenAmount == tx.inputs[2].tokenAmount);
        // Commitment validated by VotingBooth (vote count increment)
        // But we still verify structure is preserved
        bytes4 proposalIdx = bytes4(tx.inputs[2].nftCommitment.split(4)[0]);
        bytes32 proposalName = bytes32(tx.inputs[2].nftCommitment.split(12)[1]);
        bytes8 newVoteCount = bytes8(tx.outputs[2].nftCommitment.split(4)[1].split(8)[0]);
        require(tx.outputs[2].nftCommitment.split(4)[0] == proposalIdx);
        require(tx.outputs[2].nftCommitment.split(12)[1] == proposalName);
    }
}
```

This contract validates:
- Its position in the transaction
- Output count security limit
- Primary contract authentication
- All 5 covenant points
- State transition integrity (proposal index and name preserved)
