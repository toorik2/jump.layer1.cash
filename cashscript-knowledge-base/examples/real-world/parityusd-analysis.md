# ParityUSD Deep Analysis Report
## CashScript Multi-Contract Patterns & Lessons Learned

---

## 1. SYSTEM ARCHITECTURE OVERVIEW

ParityUSD is a production-grade stablecoin system with **26 CashScript contracts** organized into 4 domains:

```
ParityUSD System (26 contracts)
├── Loan Module (10 contracts)
│   ├── Loan.cash (main state holder)
│   ├── LoanSidecar.cash (token holder)
│   └── 8 function contracts (liquidate, manage, redeem, etc.)
├── LoanKey Module (3 contracts)
│   ├── LoanKeyFactory.cash
│   ├── LoanKeyOriginEnforcer.cash
│   └── LoanKeyOriginProof.cash
├── Redeemer Module (3 contracts)
│   ├── Redeemer.cash
│   ├── Redemption.cash
│   └── RedemptionSidecar.cash
├── Stability Pool Module (8 contracts)
│   ├── StabilityPool.cash
│   ├── StabilityPoolSidecar.cash
│   ├── Collector.cash
│   ├── Payout.cash
│   └── 4 function contracts
└── Core (2 contracts)
    ├── Parity.cash (borrowing)
    └── PriceContract.cash (oracle)
```

---

## 2. FUNDAMENTAL MULTI-CONTRACT PATTERNS

### Pattern 1: The Main+Sidecar Pattern

**Problem**: Bitcoin Cash allows only ONE token category per UTXO output.

**Solution**: Pair every "main" contract with a "sidecar" that holds tokens.

```
┌─────────────────┐      ┌─────────────────────┐
│   Loan.cash     │      │  LoanSidecar.cash   │
│   (NFT state)   │◄────►│  (fungible tokens)  │
└─────────────────┘      └─────────────────────┘
```

**Implementation Pattern (LoanSidecar.cash)**:
```cashscript
contract LoanTokenSidecar() {
    function attach() {
        // Must be immediately after main contract
        int mainIndex = this.activeInputIndex - 1;

        // Prove same UTXO origin (created together)
        require(tx.inputs[this.activeInputIndex].outpointTransactionHash ==
                tx.inputs[mainIndex].outpointTransactionHash);
        require(tx.inputs[this.activeInputIndex].outpointIndex ==
                tx.inputs[mainIndex].outpointIndex + 1);
    }
}
```

**Key Insight**: The sidecar validates it was created in the SAME transaction as the main contract by checking `outpointTransactionHash` equality.

---

### Pattern 2: Function Contract Pattern (Modular Logic)

**Problem**: Complex contracts become unwieldy and expensive to execute.

**Solution**: Split each "function" into a separate contract file, authenticated by NFT identifier bytes.

```
Loan.cash (coordinator)
   │
   ├── liquidate.cash     (NFT commitment: 0x00)
   ├── manage.cash        (NFT commitment: 0x01)
   ├── redeem.cash        (NFT commitment: 0x02)
   ├── payInterest.cash   (NFT commitment: 0x03)
   └── ... 4 more
```

**Main Contract Pattern (Loan.cash)**:
```cashscript
contract Loan(bytes32 parityTokenId) {
    function interact(
        int functionInputIndex,
        int sidecarOutputIndex,
        int functionOutputIndex
    ) {
        // Extract function identifier from NFT commitment
        bytes functionNftIdentifier =
            tx.inputs[functionInputIndex].nftCommitment.split(1)[0];

        // Authenticate each function by its unique identifier
        if (functionNftIdentifier == 0x00) {
            // liquidate logic - validate outputs
        } else if (functionNftIdentifier == 0x01) {
            // manage logic
        } else if (functionNftIdentifier == 0x02) {
            // redeem logic
        }
        // ... etc
    }
}
```

**Why This Works**: Each function contract holds an NFT with a unique first-byte identifier. The main contract routes to appropriate validation logic based on this byte.

---

### Pattern 3: Strict Input Position Pattern

**Critical Pattern**: Every contract REQUIRES specific input indices.

```cashscript
// From redeem.cash - note the EXPLICIT index requirements
function redeem(int loanBchAfterTxFee) {
    // THIS FUNCTION MUST BE AT INDEX 3
    require(this.activeInputIndex == 3);

    // Each input has a KNOWN position
    // Index 0: PriceContract
    // Index 1: Loan
    // Index 2: LoanTokenSidecar
    // Index 3: redeem (this)
    // Index 4: LoanKey
    // Index 5: feeBch

    // Authenticate price contract at index 0
    require(tx.inputs[0].tokenCategory == parityTokenId + 0x01);
    require(tx.inputs[0].nftCommitment.split(1)[0] == 0x00);

    // Authenticate loan at index 1
    require(tx.inputs[1].tokenCategory == parityTokenId + 0x01);
    bytes loanIdentifier = tx.inputs[1].nftCommitment.split(1)[0];
    require(loanIdentifier == 0x01);
}
```

**Lesson**: There's NO dynamic lookup. Every participant knows exactly which input index holds which contract.

---

### Pattern 4: NFT Commitment State Management

**Problem**: No account-based storage in UTXO model.

**Solution**: Encode ALL state in NFT commitment bytes with strict byte-position layout.

```
Loan NFT Commitment (27 bytes):
┌─────────┬────────────────┬───────────────────┬────────┐
│ 1 byte  │    6 bytes     │     6 bytes       │ ...    │
│ 0x01    │ borrowedAmount │ beingRedeemed     │ state  │
│ (ID)    │                │                   │        │
└─────────┴────────────────┴───────────────────┴────────┘
```

**State Parsing Pattern**:
```cashscript
// Parse state from commitment
bytes rawCommitment = tx.inputs[1].nftCommitment;
bytes identifier, bytes remaining = rawCommitment.split(1);
require(identifier == 0x01);

bytes borrowedAmountBytes, remaining = remaining.split(6);
int borrowedAmount = int(borrowedAmountBytes);

bytes beingRedeemedBytes, remaining = remaining.split(6);
int beingRedeemed = int(beingRedeemedBytes);
```

**State Reconstruction Pattern**:
```cashscript
// Reconstruct state with updates
bytes newCommitment = 0x01
    + bytes6(newBorrowedAmount)
    + bytes6(newBeingRedeemed)
    + remainingState;

// Enforce output has new state
require(tx.outputs[1].nftCommitment == newCommitment);
```

---

### Pattern 5: Self-Replicating Covenant Categories

Four distinct types based on what changes between input and output:

| Type | Changes | Example |
|------|---------|---------|
| **Exactly Self-Replicating** | Nothing | Redeemer, LoanKeyFactory |
| **State-Mutating** | NFT commitment only | Parity, PriceContract |
| **State-and-Balance-Mutating** | NFT + BCH value | StabilityPool |
| **Conditionally-Replicating** | Sometimes doesn't replicate | Loans (can be closed) |

**Validation Checklist for Self-Replication**:
```cashscript
// All 5 must be validated for covenant preservation:
require(tx.outputs[idx].lockingBytecode == tx.inputs[idx].lockingBytecode);
require(tx.outputs[idx].tokenCategory == tx.inputs[idx].tokenCategory);
require(tx.outputs[idx].value == expectedValue);
require(tx.outputs[idx].tokenAmount == expectedTokens);
require(tx.outputs[idx].nftCommitment == newCommitment);
```

---

### Pattern 6: Cross-Contract Authentication via Token Categories

**Problem**: How does one contract know another is legitimate?

**Solution**: Token category arithmetic with deterministic offsets.

```cashscript
// parityTokenId is the "root" category (32 bytes)
// Different contracts use offsets:

// Price contract: parityTokenId + 0x01
require(tx.inputs[0].tokenCategory == parityTokenId + 0x01);

// Loan contract: parityTokenId + 0x01 (same category, different NFT)
// Distinguished by NFT commitment first byte (0x00 vs 0x01)

// Redeemer: redeemerTokenId + 0x02
require(tx.inputs[4].tokenCategory == redeemerTokenId + 0x02);
```

**Key Insight**: The 33rd byte of tokenCategory encodes the NFT capability:
- `0x01` = mutable NFT
- `0x02` = minting NFT

---

### Pattern 7: Burn-to-Destroy Pattern

**Problem**: How to "delete" tokens/NFTs?

**Solution**: Send to OP_RETURN output.

```cashscript
// From LiquidateLoan.cash - burning ParityUSD during liquidation
require(tx.outputs[5].lockingBytecode == 0x6a); // OP_RETURN
require(tx.outputs[5].tokenCategory == parityTokenId);
require(tx.outputs[5].tokenAmount == burnAmount);
```

---

### Pattern 8: Output Count Limiting

**Critical Security Pattern**: Always limit max outputs to prevent unauthorized minting.

```cashscript
// From Redeemer.cash
require(tx.outputs.length <= 10);

// From AddLiquidity.cash
require(tx.outputs.length <= 6);

// From WithdrawFromPool.cash
require(tx.outputs.length <= 7);
```

---

### Pattern 9: Fixed Value Anchors

**Pattern**: Function contracts always output exactly 1000 satoshis.

```cashscript
// Every function contract
require(tx.outputs[functionIdx].value == 1000);
```

**Why**: Creates predictable dust threshold and prevents value manipulation.

---

## 3. ADVANCED PATTERNS

### Pattern 10: Origin Proof Chain

**Problem**: How to prove an NFT was legitimately created?

**Solution**: Chain of origin proof contracts.

```
LoanKeyFactory
      │
      ├─► LoanKeyOriginEnforcer
      │         │
      │         └─► LoanKeyOriginProof
      │                   │
      └───────────────────┴─► [verified loanKey]
```

The Enforcer and Proof contracts verify they were created together (same tx hash, sequential indices), establishing provenance.

---

### Pattern 11: Time Tracking Without Block Height

**Problem**: CashScript cannot directly read block height.

**Solution**: Use `tx.locktime` + state tracking.

```cashscript
// Period calculation
int currentPeriod = (tx.locktime - startBlockHeight) / periodLengthBlocks;

// Require locktime is valid blockheight (not timestamp)
require(tx.locktime < 500000000);

// Require new period > stored period
int storedPeriod = int(commitment.split(4)[0]);
require(currentPeriod > storedPeriod);
```

---

### Pattern 12: Minimum Amount Guards

**Pattern**: All operations have minimum thresholds.

```cashscript
// 100.00 ParityUSD minimum everywhere
require(borrowAmount >= 100_00);
require(redemptionAmount >= 100_00);
require(depositAmount >= 100_00);
require(withdrawalAmount >= 100_00);
```

**Why**: Prevents UTXO congestion attacks and griefing.

---

## 4. CRITICAL LESSONS FOR EVM-TO-CASHSCRIPT CONVERSION

### Lesson 1: NO STORAGE - EVERYTHING IS COMMITMENT BYTES

EVM:
```solidity
mapping(address => uint256) balances;
balances[user] = 100;
```

CashScript:
```cashscript
// NO MAPPING EXISTS. State IS the NFT commitment.
bytes commitment = 0x01 + bytes6(balance) + pubkeyhash;
require(tx.outputs[0].nftCommitment == commitment);
```

### Lesson 2: NO LOOPS - FIXED INPUT/OUTPUT COUNTS

EVM:
```solidity
for (uint i = 0; i < holders.length; i++) {
    transfer(holders[i], amount);
}
```

CashScript: **IMPOSSIBLE**. You must:
- Use fixed input/output counts per function
- Create separate transactions for each iteration
- Or redesign the architecture entirely

### Lesson 3: NO INTERNAL CALLS - ONLY TRANSACTION STRUCTURE

EVM:
```solidity
otherContract.doSomething();
```

CashScript: The other contract must be IN THE SAME TRANSACTION as an input, and you validate it through its token category and position.

### Lesson 4: NO DYNAMIC DISPATCH - EXPLICIT BYTE ROUTING

EVM:
```solidity
function execute(bytes4 selector) { ... }
```

CashScript: Explicit if/else on commitment bytes:
```cashscript
if (functionId == 0x00) { /* liquidate */ }
else if (functionId == 0x01) { /* manage */ }
// ...
```

### Lesson 5: FUNCTIONS ARE CONTRACTS

EVM function -> CashScript contract file

EVM contract with 8 functions -> 1 main contract + 8 function contracts

### Lesson 6: MANDATORY SIDECAR FOR TOKEN HOLDING

If your EVM contract holds multiple token types, you MUST create sidecar contracts to hold each additional token type.

### Lesson 7: ALWAYS VALIDATE OUTPUT RECONSTRUCTION

Every contract must explicitly check that outputs match expected:
- lockingBytecode
- tokenCategory
- value (satoshis)
- tokenAmount
- nftCommitment

---

## 5. ANTI-PLACEHOLDER LESSONS

### Why ParityUSD Has No Placeholders

1. **Every contract has REAL logic**: The simplest contract (LoanSidecar) still has meaningful validation - checking transaction hash and index relationships.

2. **Empty functions don't compile**: CashScript requires at least one `require()` statement to generate valid bytecode.

3. **Contracts exist to VALIDATE**: If a contract has nothing to validate, it shouldn't exist. The question becomes: "What relationship does this prove?"

### The Minimum Viable Contract

The smallest real contract in ParityUSD (StabilityPoolSidecar):
```cashscript
contract StabilityPoolSidecar(bytes32 parityTokenId) {
    function attach() {
        // STILL has real validation:
        int mainIndex = this.activeInputIndex - 1;
        require(tx.inputs[this.activeInputIndex].outpointTransactionHash ==
                tx.inputs[mainIndex].outpointTransactionHash);
        require(tx.inputs[this.activeInputIndex].outpointIndex ==
                tx.inputs[mainIndex].outpointIndex + 1);

        // Output validation
        require(tx.outputs[outputIndex].value == 1000);
        require(tx.outputs[outputIndex].lockingBytecode ==
                tx.inputs[this.activeInputIndex].lockingBytecode);
        require(tx.outputs[outputIndex].nftCommitment == 0x);

        // Token constraint
        require(tx.outputs[outputIndex].tokenCategory == parityTokenId ||
                tx.outputs[outputIndex].tokenCategory == 0x);
    }
}
```

### The Golden Rule

**If you cannot identify what a contract VALIDATES, it should not exist.**

Every contract must answer: "What would go wrong if this contract didn't exist?" If nothing, delete it.

---

## 6. ARCHITECTURAL PRINCIPLES FOR MULTI-CONTRACT SYSTEMS

1. **One Contract = One Responsibility**
   - Loan.cash: Coordinate loan operations
   - LoanSidecar: Hold loan tokens
   - liquidate.cash: Validate liquidation logic

2. **Explicit Over Implicit**
   - Input indices are explicit, not discovered
   - Token categories are hardcoded with offsets
   - State byte positions are fixed

3. **Composition Over Inheritance**
   - Function contracts compose with main contracts
   - Sidecars compose with their parents
   - No inheritance hierarchy exists

4. **Validation at Boundaries**
   - Every input is authenticated
   - Every output is constrained
   - Every state change is explicit

5. **Fail Closed**
   - Missing require = transaction fails
   - Wrong commitment = transaction fails
   - Wrong category = transaction fails

---

## 7. SUMMARY: WHAT THIS TEACHES US

For converting EVM to CashScript:

1. **Decompose** - Split EVM contracts into main + function + sidecar contracts
2. **Flatten state** - Convert mappings/arrays to commitment byte layouts
3. **Fix positions** - Assign explicit input/output indices to every participant
4. **Validate everything** - Every contract must have real `require()` statements
5. **Limit outputs** - Always cap `tx.outputs.length`
6. **Use token arithmetic** - Authenticate contracts via category offsets
7. **Never placeholder** - If nothing to validate, the contract shouldn't exist

---

## 8. KEY TAKEAWAYS FOR PREVENTING PLACEHOLDER VIOLATIONS

The ParityUSD analysis reveals **why placeholders are architecturally impossible in well-designed CashScript**:

1. **Every contract PROVES something** - The sidecar proves it was created with the main contract. The function contract proves it has authority to execute that operation. If a contract proves nothing, it has no reason to exist.

2. **The minimum viable contract is not empty** - Even the simplest "attach()" function validates transaction hash equality and output constraints. There's always SOMETHING to validate.

3. **Contracts exist to CONSTRAIN** - Not to "hold functions" like in EVM. A CashScript contract's purpose is to add constraints to a transaction. No constraints = no contract.

**For the conversion system**, instead of telling the model "don't use placeholders", we should:

1. Require the model to identify **what each contract validates**
2. If a contract validates nothing, eliminate it (don't create it)
3. Enforce minimum require() statements per contract
4. Validate that every contract has meaningful logic connecting inputs to outputs

The ParityUSD patterns give us concrete examples of what "real" multi-contract systems look like - every contract has purpose, every function has validation, and every interaction is explicitly constrained.
