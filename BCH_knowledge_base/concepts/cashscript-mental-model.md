# CashScript Mental Model for Production Systems

A comprehensive framework for designing safe, production-ready CashScript contract systems. Derived from analysis of ParityUSD's 26-contract stablecoin system.

---

## Part 1: The UTXO Mindset

### Think in Transactions

"Transaction T consumes UTXO A and creates UTXO B. Contract script validates whether this transformation is allowed."

The fundamental unit is the **transaction**, not the contract. A contract doesn't "do" anything - it only **validates** whether a proposed transaction meets its rules.

### The Core Question

For every contract, ask: **"What transformation of UTXOs does this contract permit?"**

Not "what does this contract do" but "what does this contract ALLOW to happen to itself?"

### State Lives in UTXOs

```
UTXO → consumed & recreated → state carried in new UTXO
```
- **Mutable NFT commitment** = where state lives
- **Contract recreation** = how state persists
- **NFT capability** = authority identifier

---

## Part 2: Multi-Contract Architecture Patterns

### Pattern 1: Dumb Container + Smart Functions

**Problem**: Complex contracts exceed size limits, waste transaction space

**Solution**: Split into a minimal "container" contract and separate "function" contracts

```
┌─────────────────────────────────────────────────────────┐
│ Container Contract (Loan.cash - minimal logic)          │
│  - Holds BCH collateral                                 │
│  - Holds state in mutable NFT                           │
│  - Only validates: "Is correct function attached?"       │
└─────────────────────────────────────────────────────────┘
          ↓ authenticates presence of
┌─────────────────────────────────────────────────────────┐
│ Function Contract (e.g., manageLoan.cash)               │
│  - Contains all business logic                          │
│  - Validates state transitions                          │
│  - Enforces recreation rules                            │
└─────────────────────────────────────────────────────────┘
```

**Container authenticates function**:
```cashscript
// In Loan.cash
function interact() {
  // Authenticate function contract is present
  bytes32 parityTokenId = tx.inputs[this.activeInputIndex].tokenCategory.split(32)[0];
  int nftFunctionInputIndex = this.activeInputIndex + 2;
  require(tx.inputs[nftFunctionInputIndex].tokenCategory == parityTokenId);
  bytes commitmentNftFunction = tx.inputs[nftFunctionInputIndex].nftCommitment;
  require(commitmentNftFunction.length == 1); // Single-byte identifier
}
```

**Benefits**:
- Transaction only includes the function logic being used
- Each function can be audited independently
- Easy to add new functions (new contracts with new identifiers)

### Pattern 2: Sidecar UTXOs

**Problem**: A UTXO can only hold ONE token category. What if contract needs to track a loan owner's token AND hold its own state token?

**Solution**: Create companion "sidecar" UTXOs that travel together

```
┌──────────────────────┐  ┌──────────────────────┐
│ Main UTXO            │  │ Sidecar UTXO         │
│ - Has BCH collateral │  │ - Holds owner tokenId│
│ - Has state NFT      │  │ - Simple contract    │
│ - Main logic         │  │ - Just validates it  │
└──────────────────────┘  │   stays attached     │
         ↑                └──────────────────────┘
         └── created together, travel together ──┘
```

**Sidecar authentication** (always at adjacent index):
```cashscript
// In LoanTokenSidecar.cash
function attach() {
  int loanInputIndex = this.activeInputIndex - 1;
  // Verify we were created in same tx as loan (same outpoint hash)
  require(tx.inputs[this.activeInputIndex].outpointTransactionHash ==
          tx.inputs[loanInputIndex].outpointTransactionHash);
  // Verify we're the next output after loan
  require(tx.inputs[this.activeInputIndex].outpointIndex ==
          tx.inputs[loanInputIndex].outpointIndex + 1);
}
```

### Pattern 3: Input Index Pinning

**Problem**: How do contracts find and authenticate each other?

**Solution**: Enforce exact input positions in every transaction

```
// Example: payInterest transaction
// Inputs: 00-PriceContract, 01-loan, 02-loanSidecar, 03-payInterest, 04-collector
function payInterest() {
  require(this.activeInputIndex == 3);  // Function MUST be at index 3

  // Authenticate price contract at index 0
  require(tx.inputs[0].tokenCategory == parityTokenId + 0x01);
  require(tx.inputs[0].nftCommitment.split(1)[0] == 0x00); // Price identifier

  // Authenticate loan at index 1
  require(tx.inputs[1].tokenCategory == parityTokenId + 0x01);
  require(tx.inputs[1].nftCommitment.split(1)[0] == 0x01); // Loan identifier
}
```

**Why this works**: Every function documents its expected layout. Transaction builders MUST follow this layout. Contracts validate each other's presence at exact positions.

### Pattern 4: Token Category as Identity + Authority

Token categories encode BOTH identity and capability:

```cashscript
// tokenCategory = 32-byte categoryId + optional 1-byte capability
// 0x01 = mutable NFT capability
// 0x02 = minting NFT capability

// Authenticate price contract (mutable NFT)
require(tx.inputs[0].tokenCategory == parityTokenId + 0x01);

// Authenticate stability pool (minting NFT)
require(tx.inputs[4].tokenCategory == stabilityPoolTokenId + 0x02);

// Authenticate function contract (immutable NFT - no suffix)
require(tx.inputs[3].tokenCategory == parityTokenId);
```

**Hierarchy of trust**:
- Minting NFT (`+ 0x02`) = highest authority, can create tokens
- Mutable NFT (`+ 0x01`) = stateful contract
- Immutable NFT (no suffix) = static function/identifier

---

## Part 3: State Management

### NFT Commitment as Structured State

State is stored as tightly-packed bytes in NFT commitments:

```cashscript
/*  --- State Mutable NFT (10 items, 27 bytes) ---
    byte identifier == 0x01
    bytes6 borrowedTokenAmount (tokens)
    bytes6 amountBeingRedeemed (tokens)
    byte status (0x00 newLoan, 0x01 single period, 0x02 mature loan)
    bytes4 lastPeriodInterestPaid
    byte2 currentInterestRate
    byte2 nextInterestRate
    byte interestManager
    bytes2 minRateManager
    bytes2 maxRateManager
*/
```

**Parsing state**:
```cashscript
bytes loanState = tx.inputs[0].nftCommitment;
bytes7 firstPart, bytes remainingPart = loanState.split(7);
byte identifier, bytes6 borrowedAmountBytes = firstPart.split(1);
require(identifier == 0x01);  // Validate this is indeed a loan
```

**Updating state**:
```cashscript
// Keep fixed parts, update variable parts
bytes20 fixedPartLoanState = loanState.split(20)[0];
bytes27 newLoanCommitment = fixedPartLoanState + nextInterestRate + bytes5(interestManagerConfiguration);
```

### First Byte as Type Identifier

Use first byte to distinguish contract types sharing same tokenId:

```cashscript
// Same parityTokenId, different contract types
0x00 = Price contract
0x01 = Loan contract
0x04 = startRedemption function
0x07 = payInterest function
```

This allows:
```cashscript
require(tx.inputs[0].nftCommitment.split(1)[0] == 0x00); // Must be price contract
```

---

## Part 4: The 5-Point Covenant Validation

**EVERY self-replicating contract must validate ALL 5 points**:

```cashscript
// 1. lockingBytecode - same contract code
require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);

// 2. tokenCategory - same token identity + capability
require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);

// 3. value - BCH amount (often exactly 1000 sats)
require(tx.outputs[0].value == 1000);

// 4. tokenAmount - fungible token balance
require(tx.outputs[0].tokenAmount == tx.inputs[0].tokenAmount);

// 5. nftCommitment - state data
require(tx.outputs[0].nftCommitment == newStateCommitment);
```

**Missing ANY of these is a critical vulnerability.**

---

## Part 5: Covenant Categories

### 1. Exactly Self-Replicating (Eternal)

These UTXOs ALWAYS recreate themselves exactly. They live forever.

```cashscript
// Examples: Redeemer, LoanKeyFactory, Function contracts
require(tx.outputs[idx].lockingBytecode == tx.inputs[idx].lockingBytecode);
require(tx.outputs[idx].tokenCategory == tx.inputs[idx].tokenCategory);
require(tx.outputs[idx].nftCommitment == tx.inputs[idx].nftCommitment);
require(tx.outputs[idx].value == 1000);
```

### 2. State-Mutating (Eternal with changing state)

Same contract, but NFT commitment updates:

```cashscript
// Examples: Parity borrowing contract, PriceContract
require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
require(tx.outputs[0].nftCommitment == newPeriodState);  // Different!
require(tx.outputs[0].value == 1000);
```

### 3. State-and-Balance-Mutating (Eternal with changing state + value)

Both state AND BCH amount can change:

```cashscript
// Example: StabilityPool - accumulates BCH from liquidations
require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
require(tx.outputs[0].nftCommitment == newPoolState);
require(tx.outputs[0].value == newPoolBalance);  // Changes!
```

### 4. Conditionally-Replicating (Mortal)

May or may not recreate - these can be destroyed:

```cashscript
// Example: Loan - can be closed when fully repaid
bool isLoanRecreated = tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory;
if(isLoanRecreated) {
  // Enforce recreation rules
}
// Otherwise, loan is being closed
```

---

## Part 6: Minting Authority Protection

Contracts with minting NFTs are HIGH VALUE TARGETS. Attackers want to create unauthorized tokens.

### Rule: Control ALL Outputs

```cashscript
// ALWAYS limit output count
require(tx.outputs.length <= 10);

// ALWAYS validate each output's token category
if (tx.outputs.length > 4) {
  bool noTokenOrParityTokens = tx.outputs[4].tokenCategory == 0x ||
                                tx.outputs[4].tokenCategory == parityTokenId;
  require(noTokenOrParityTokens);
}

// ALWAYS validate optional outputs
if (tx.outputs.length > 5) {
  require(tx.outputs[5].tokenCategory == 0x);  // Pure BCH only
}
```

### Why Output Limiting Matters

A minting NFT can create ANY token with that category. If you allow arbitrary outputs, attackers can:
1. Create fake receipts
2. Mint unauthorized tokens
3. Create fake function NFTs

**Every output in a transaction with a minting contract MUST be explicitly validated.**

---

## Part 7: Time Management

Contracts cannot read "current time" directly. Time is derived from transaction metadata.

### Absolute Time (Block Height)

- Transaction's `locktime` field can represent block height (if < 500M) or unix timestamp
- Contract validates locktime meets requirements
- Transaction builder sets the locktime value

**Use case**: Period boundaries, unlock dates, expiration

### Relative Time (UTXO Age)

- Sequence numbers encode "blocks since UTXO creation"
- Requires transaction version 2

**Use case**: Waiting periods (e.g., 12 blocks before redemption finalizes)

---

## Part 8: Design Rules for Production Systems

### Rule 1: Start with Transaction Layouts

Before writing ANY code, document every transaction type:

```
// ALWAYS document like this:
// Inputs:  00-PriceContract, 01-loan, 02-loanSidecar, 03-function, 04-collector
// Outputs: 00-PriceContract, 01-loan, 02-loanSidecar, 03-function, 04-collector
```

### Rule 2: One Contract, One Responsibility

Each contract does ONE thing:
- Container holds value/state
- Function validates one operation
- Sidecar holds one additional token

### Rule 3: Explicit Input Indices

```cashscript
// ALWAYS start with this
require(this.activeInputIndex == EXPECTED_INDEX);
```

### Rule 4: Authenticate Everything

```cashscript
// For EACH input you depend on:
require(tx.inputs[idx].tokenCategory == expectedCategory);
require(tx.inputs[idx].nftCommitment.split(1)[0] == expectedIdentifier);
```

### Rule 5: Protect All Outputs

```cashscript
// ALWAYS limit and validate outputs
require(tx.outputs.length <= MAX_OUTPUTS);
// Validate each possible output
```

### Rule 6: Use Function Identifiers

```cashscript
// Single-byte identifiers for function contracts
enum LoanFunction {
  LIQUIDATED = 0x01,
  MANAGE_LOAN = 0x02,
  // ...
}
```

### Rule 7: Minimum Value Requirements

```cashscript
// Standard UTXO value
require(tx.outputs[idx].value == 1000);

// For contracts accumulating value
require(tx.outputs[idx].value >= minimumValue);
```

### Rule 8: Document State Layout

```cashscript
/*  --- State NFT (X items, Y bytes) ---
    byte identifier == 0xNN
    bytesN field1 (description)
    bytesN field2 (description)
    ...
*/
```

---

## Part 9: Security Checklist

Before deploying ANY CashScript system:

### Covenant Validation
- [ ] All 5 points validated for self-replicating contracts
- [ ] Correct capability flags checked (0x01 mutable, 0x02 minting)
- [ ] NFT commitment structure validated (first byte identifier)

### Authority
- [ ] All input contracts authenticated via tokenCategory
- [ ] Position indices enforced with `this.activeInputIndex`
- [ ] No unauthorized tokens can be created

### Minting Protection
- [ ] Output count limited (`require(tx.outputs.length <= N)`)
- [ ] Each output's tokenCategory validated
- [ ] Change outputs restricted to BCH-only or known tokens

### State
- [ ] State byte layouts documented
- [ ] All state transitions validated
- [ ] No state can be corrupted by invalid input

### Value
- [ ] BCH values validated (minimum 1000 sats typically)
- [ ] Value changes calculated correctly
- [ ] No value can leak

### Time
- [ ] Locktime validated appropriately
- [ ] Sequence numbers used correctly for relative locks
- [ ] Period/epoch boundaries handled

### Edge Cases
- [ ] Division by zero prevented
- [ ] Minimum amounts enforced
- [ ] Partial operations handled correctly
- [ ] Empty/full scenarios covered

---

## Part 10: From Intent to Implementation

### Step 1: Define the System

"What economic/business logic does this system encode?"

Example: "A lending protocol where users deposit BCH, borrow stablecoins, pay interest, and can be liquidated."

### Step 2: Identify Value Flows

Draw arrows showing how value moves:
- BCH: User → Loan (collateral) → User (on repayment) / StabilityPool (on liquidation)
- Tokens: Minting contract → User (on borrow) → Burn (on repay/redeem)

### Step 3: Identify State

What needs to be tracked?
- Loan: borrowed amount, collateral, interest rate, status
- Pool: total staked, period, accumulated interest
- Price: current price, last update

### Step 4: Design Contract Topology

```
1. What holds value? → Container contracts (Loan, StabilityPool)
2. What operations exist? → Function contracts (manage, payInterest, liquidate)
3. What needs extra tokens? → Sidecar contracts
4. What creates things? → Minting contracts (Redeemer, Factory)
```

### Step 5: Design Transaction Layouts

For EACH operation, document:
```
Operation: payInterest
Inputs:  [price, loan, sidecar, function, collector]
Outputs: [price, loan, sidecar, function, collector]
State changes: loan.lastPeriodInterestPaid++, collector.balance += interest
```

