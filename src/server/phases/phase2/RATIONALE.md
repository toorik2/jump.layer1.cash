# Phase 2 Design Rationale

Why the Phase 2 prompt and schema are structured this way.

---

## 1. The Problem with EVM Mental Models

### Why EVM Thinking Fails for UTXO

The EVM and UTXO models are fundamentally different:

| Aspect | EVM | UTXO (CashScript) |
|--------|-----|-------------------|
| Contract metaphor | Object with state and methods | Validator that approves transactions |
| State location | Contract's storage | NFT commitment bytes |
| Execution trigger | Function call | Transaction spending |
| Who runs code | The called contract | Each input being spent |

### The Fundamental Confusion

EVM developers think: "This contract DOES something when called."

Reality: "This contract VALIDATES whether a transaction is legal."

A CashScript contract never "does" anything. When a transaction spends a UTXO locked by that contract, the contract's script validates whether the transaction is allowed. Multiple contracts in one transaction each validate independently. The transaction succeeds only if ALL pass.

### Consequence Without This Mental Shift

Converted contracts try to "execute" logic that should be "validation" logic:

```solidity
// EVM thinking: "This function transfers tokens"
function transfer(address to, uint256 amount) {
    balances[msg.sender] -= amount;
    balances[to] += amount;
}
```

```cashscript
// UTXO reality: "This validates a transfer is legal"
function transfer(pubkey owner, sig s) {
    // We don't MOVE tokens. We VALIDATE that:
    // - The owner authorized this (signature valid)
    // - Output has correct new owner in commitment
    // - All 5 covenant points satisfied
}
```

---

## 2. Why Transactions Are Primary

### The Insight from ParityUSD

ParityUSD is a production system with 26 contracts across 4 domains. Studying it revealed a key design principle:

They didn't start by designing contracts. They started by asking: **"What transactions does the system support?"**

Contracts emerged from: "What needs to be validated at each transaction position?"

### The Derivation Chain

```
User operations
    ↓
Transaction templates
    ↓
Input positions (which UTXOs participate)
    ↓
Contract functions (what each position validates)
```

### Why This Order Matters

**Designing contracts first** leads to orphan functions:
- "I designed a Voter contract with vote(), delegate(), and revoke()"
- But maybe delegate() never appears in any transaction
- Result: dead code, wasted bytecode

**Designing transactions first** guarantees purpose:
- "The castVote transaction has Ballot at [0], Voter at [1]"
- VoterContract needs a function for position [1] in castVote
- Every function maps to a real transaction

### Practical Example

**Bad (contract-first)**:
```
VoterContract:
  - register()      // used in registerVoter tx
  - vote()          // used in castVote tx
  - delegate()      // ...is this used anywhere?
  - revokeVote()    // ...does this transaction exist?
```

**Good (transaction-first)**:
```
Transactions:
  - registerVoter: [MinterContract] → [VoterContract, MinterContract]
  - castVote: [BallotContract, VoterContract, P2PKH] → [BallotContract, VoterContract]

Derived contracts:
  - VoterContract needs: function for registerVoter[out:0], function for castVote[in:1]
```

---

## 3. Why NFT State Types Are Explicit

### The Problem with Implicit State

Our v1 schema had:
```json
{ "stateLayout": "bytes20 ownerPkh + bytes1 hasVoted" }
```

This is just a string. No structure, no validation, no tooling support.

### Why Explicit Fields Matter

**Code generation can derive CashScript types**:
```json
{
  "fields": [
    { "name": "ownerPkh", "type": "bytes20" },
    { "name": "hasVoted", "type": "bytes1" }
  ]
}
```

Becomes:
```cashscript
bytes20 ownerPkh = commitment.split(20)[0];
bytes1 hasVoted = commitment.split(20)[1].split(1)[0];
```

**Frontend can show state structure**:
- Display field names and types
- Visualize state transitions

**Validation can check byte counts**:
- Sum of field bytes must be <= 128
- Catch overflow at design time

### The 128-Byte Limit

NFT commitments max at 128 bytes. This is a hard VM limit.

Implicit layouts hide this constraint. Explicit layouts force planning:

```json
{
  "fields": [
    { "name": "ownerPkh", "type": "bytes20" },      // 20 bytes
    { "name": "loanAmount", "type": "bytes8" },     // 8 bytes
    { "name": "collateralAmount", "type": "bytes8" }, // 8 bytes
    { "name": "interestRate", "type": "bytes4" },   // 4 bytes
    { "name": "startTime", "type": "bytes8" }       // 8 bytes
  ],
  "totalBytes": 48  // Explicit! Room for growth.
}
```

---

## 4. Why the 5-Point Covenant Checklist

### The Security Insight

Every self-replicating covenant MUST validate exactly five things about its output:

1. **lockingBytecode** - same contract code
2. **tokenCategory** - same token identity + capability
3. **value** - expected BCH amount
4. **tokenAmount** - expected fungible token balance
5. **nftCommitment** - correctly updated state

### What Happens Without Each

| Missing Check | Attack |
|--------------|--------|
| lockingBytecode | Attacker substitutes different contract, steals tokens |
| tokenCategory | Attacker swaps for worthless token with same-looking category |
| value | Attacker drains BCH, leaving UTXO below dust limit |
| tokenAmount | Attacker drains fungible tokens while preserving NFT |
| nftCommitment | Attacker corrupts state, e.g., sets hasVoted back to false |

### Real Example: Missing tokenAmount

```cashscript
// VULNERABLE: Missing tokenAmount check
function withdraw() {
    require(tx.outputs[0].lockingBytecode == lockingBytecode);
    require(tx.outputs[0].tokenCategory == tokenCategory);
    require(tx.outputs[0].value >= 1000);
    require(tx.outputs[0].nftCommitment == newCommitment);
    // Attacker drains all fungible tokens!
}
```

### Why It's in the Schema

By requiring the 5-point checklist in transaction outputs:

```json
{
  "outputs": [{
    "covenantChecklist": {
      "lockingBytecode": "same contract",
      "tokenCategory": "systemCategory + 0x01",
      "value": "1000 sats",
      "tokenAmount": 0,
      "nftCommitment": "hasVoted = 0x01"
    }
  }]
}
```

- Phase 2 is forced to think through every output
- Security analysis is explicit and auditable
- Code generation can emit complete validation code

---

## 5. Why Relationships Are Explicit

### The Sidecar Problem

A sidecar UTXO exists because the main contract needs to hold multiple token types. Each UTXO can only hold one tokenCategory.

The sidecar must:
- Be created alongside the main contract
- Be spent alongside the main contract
- Validate same-origin via outpointTransactionHash

Without explicit relationship:
```json
{ "name": "LoanContract" }
{ "name": "LoanSidecarContract" }
// How does code generation know these are related?
```

With explicit relationship:
```json
{
  "name": "LoanSidecarContract",
  "relationships": {
    "sidecarOf": "LoanContract",
    "linkMethod": "outpointTransactionHash"
  }
}
```

Now code generation knows to:
- Generate same-origin validation code
- Co-deploy both contracts
- Pass correct constructor parameters

### The Function Contract Problem

A function contract validates logic FOR a container. It must:
- Know the container's token category
- Have a unique byte identifier
- Be included in specific transactions

Without explicit relationship:
```json
{ "name": "RepayLoanFuncContract" }
// What container? What identifier? What transactions?
```

With explicit relationship:
```json
{
  "name": "RepayLoanFuncContract",
  "relationships": {
    "functionOf": "LoanContract",
    "forTransaction": "repayLoan",
    "identifier": "0x02"
  }
}
```

### How Explicit Relationships Enable

1. **Code generation** emits correct constructor params
2. **Deployment scripts** co-deploy related contracts
3. **Frontend** can visualize system architecture
4. **Validation** can check that referenced contracts exist

---

## 6. Why Contract Count Matters

### The Bytecode Limit

Pre-May 2025, contracts had approximately 8KB bytecode limit. Complex logic MUST split:

```
Single voting contract with 8 operations: ~12KB (TOO BIG)
Container + 8 function contracts: ~1.5KB each (OK)
```

### The Token Category Limit

One UTXO holds ONE token category. Period.

Need state NFT + fungible tokens? Need sidecar:
```
LoanContract: holds state NFT
LoanSidecarContract: holds BCH collateral + PU debt tokens
```

### The Lifecycle Question

Does a spawned entity outlive its parent?

- NO: Embed in parent's state
- YES: Independent child contract

ParityUSD examples:
- `Redemption` - lives after Redeemer creates it, consumed independently
- `Payout` - lives after StabilityPool creates it, claimed independently

### The Formula

```
Total contracts =
  containers (entities with rules) +
  sidecars (multi-token needs) +
  functions (complex operations) +
  children (independent spawns)
```

---

## 7. Why Naming Encodes Relationships

### The Discoverability Problem

ParityUSD has 26 contracts. How do you know what's related?

Flat naming is confusing:
```
Loan, LoanTokens, PayInterest, Repay, Liquidate, ...
```

### The Solution: Relationship-Aware Naming

| Role | Pattern | Example |
|------|---------|---------|
| Container | `{Entity}Contract` | `LoanContract` |
| Sidecar | `{Entity}SidecarContract` | `LoanSidecarContract` |
| Function | `{Action}{Entity}FuncContract` | `RepayLoanFuncContract` |
| Minting | `{Entity}MinterContract` | `VoterMinterContract` |

### Benefits

- `grep "Loan"` finds all Loan-related contracts
- Clear which contracts must be co-deployed
- Self-documenting architecture
- Matches ParityUSD's actual naming patterns

---

## 8. From v1 to v2: What Changed and Why

| v1 Field | v2 Field | Rationale |
|----------|----------|-----------|
| `valueFlows` | `nftStateTypes` | Abstract strings became structured layouts with explicit fields and byte counts |
| `patterns` | (removed) | Patterns are now embedded in transaction templates rather than separate |
| `tokenCategories` | `tokenTopology` | Added authentication matrix showing which contracts recognize which |
| `contracts.validates` | `contracts.functions` | Vague "validates X" became explicit mapping to transaction positions |
| `transactionTemplates.outputs` | + `covenantChecklist` | Added required 5-point security checklist |
| (none) | `contractCountRationale` | New field to explain architecture decisions |
| (none) | `relationships` | New field for explicit cross-contract dependencies |

---

## 9. How This Enables Better Code Generation

### With Explicit State Types

Schema:
```json
{
  "nftStateTypes": [{
    "name": "VoterState",
    "fields": [
      { "name": "ownerPkh", "type": "bytes20" },
      { "name": "hasVoted", "type": "bytes1" }
    ]
  }]
}
```

Generated code:
```cashscript
// Extract state from NFT commitment
bytes20 ownerPkh = tx.inputs[this.activeInputIndex].nftCommitment.split(20)[0];
bytes1 hasVoted = tx.inputs[this.activeInputIndex].nftCommitment.split(20)[1].split(1)[0];
```

### With Explicit Covenant Checklist

Schema:
```json
{
  "covenantChecklist": {
    "lockingBytecode": "same contract",
    "tokenCategory": "systemCategory + 0x01",
    "value": "1000 sats",
    "tokenAmount": 0,
    "nftCommitment": "hasVoted = 0x01, ownerPkh unchanged"
  }
}
```

Generated code:
```cashscript
// 5-point covenant validation
require(tx.outputs[1].lockingBytecode == tx.inputs[1].lockingBytecode);
require(tx.outputs[1].tokenCategory == systemCategory + 0x01);
require(tx.outputs[1].value >= 1000);
require(tx.outputs[1].tokenAmount == 0);
bytes newCommitment = ownerPkh + 0x01;  // hasVoted = true
require(tx.outputs[1].nftCommitment == newCommitment);
```

### With Explicit Relationships

Schema:
```json
{
  "relationships": {
    "functionOf": "LoanContract",
    "identifier": "0x02"
  }
}
```

Generated code:
```cashscript
contract RepayLoanFuncContract(bytes32 loanCategory) {
    function repay() {
        // Validate we're the expected function contract
        require(tx.inputs[this.activeInputIndex].nftCommitment.split(1)[0] == 0x02);
        // Validate LoanContract is present
        require(tx.inputs[1].tokenCategory == loanCategory + 0x01);
    }
}
```

---

## 10. Conclusion: The Mental Model Shift

### Before (EVM Thinking)

> "I have a Voter contract that can vote."
> "The vote function modifies state."
> "When vote() is called, the Voter updates its hasVoted flag."

### After (UTXO Thinking)

> "I have a `castVote` transaction with Ballot at [0], Voter at [1], User at [2]."
> "VoterContract at position [1] validates that hasVoted changes from 0x00 to 0x01."
> "VoterContract is derived from its participation in castVote."
> "The transaction structure IS the primary artifact. Contracts are validators at positions."

### The Key Insight

**Contracts don't DO things. Transactions DO things. Contracts PERMIT things.**

This is why Phase 2 is structured around transaction templates with contracts derived from them. The transaction is the fundamental unit of change in a UTXO system. Contracts exist to validate that changes are legal.

---

## References

- [ParityUSD Contract Overview](https://github.com/ParityUSD/contracts/blob/main/contract_docs/contract_overview.md)
- [CashScript Documentation](https://cashscript.org)
- [BCH Covenants Explainer](https://blog.bitjson.com/bitcoin-cash-covenants/)
