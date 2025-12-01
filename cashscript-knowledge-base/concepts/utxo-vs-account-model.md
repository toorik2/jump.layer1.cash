# UTXO vs Account Model - EVM→CashScript Conversion Reference

## Core Model Differences

| Aspect | UTXO (CashScript/BCH) | Account (EVM/Solidity) |
|--------|----------------------|------------------------|
| **State** | No global state, independent atomic UTXOs | Global state tree, persistent storage |
| **Execution** | Transaction-level validation, stateless scripts | Contract-level execution, stateful |
| **Concurrency** | Parallel spending of different UTXOs | Sequential (nonce-based) |
| **Persistence** | UTXO chains, NFT commitments (40 bytes, 128 planned 2026) | Storage slots, mappings, state variables |
| **Transaction** | Multiple inputs → Multiple outputs | Single sender → Single recipient |
| **Gas Model** | Fee based on tx size (bytes) | Computational steps (opcode-based) |
| **Introspection** | Full tx visibility (`tx.inputs[]`, `tx.outputs[]`) | Limited (`msg.sender`, `msg.value`) |
| **Covenants** | Native output constraints via bytecode validation | No native support |
| **Reentrancy** | N/A (atomic transactions) | Vulnerable (requires guards) |
| **Arrays** | Limited (multiple UTXOs or covenant chains) | Native arrays, mappings |
| **Tokens** | Native CashTokens (FT/NFT) | ERC-20/721 contract standards |
| **Inter-Contract** | Via multi-input transactions | `call`, `delegatecall`, `staticcall` |
| **Loops** | `do {} while()` (v0.13.0+, beta) | `for`, `while`, `do while` |
| **Signatures** | Explicit `checkSig(sig, pk)` | Implicit `msg.sender` recovery |
| **Time** | `tx.time` (block height or Unix timestamp) | `block.timestamp`, `block.number` |

## CashScript UTXO Primitives

### Transaction Introspection

```cashscript
// Input Properties
tx.inputs[i].value                 // int: BCH amount in satoshis
tx.inputs[i].lockingBytecode       // bytes: Input script
tx.inputs[i].tokenCategory         // bytes: 32-byte category + optional capability (0x01=mutable, 0x02=minting)
tx.inputs[i].tokenAmount           // int: Fungible token amount
tx.inputs[i].nftCommitment         // bytes: NFT data (40 bytes, 128 planned 2026)
tx.inputs[i].sequenceNumber        // int: nSequence field value
tx.inputs[i].unlockingBytecode     // bytes: scriptSig of input
tx.inputs[i].outpointTransactionHash // bytes32: Previous transaction hash
tx.inputs[i].outpointIndex         // int: Previous output index

// Output Properties
tx.outputs[i].value                // int: BCH amount in satoshis
tx.outputs[i].lockingBytecode      // bytes: Output script
tx.outputs[i].tokenCategory        // bytes: 32-byte category + optional capability (0x01=mutable, 0x02=minting)
tx.outputs[i].tokenAmount          // int: Fungible token amount
tx.outputs[i].nftCommitment        // bytes: NFT data (40 bytes, 128 planned 2026)

// Context
this.activeInputIndex              // int: Current UTXO being spent
this.activeBytecode                // bytes: Current UTXO's script

// Time
tx.time                           // int: nLocktime (<500M=block, ≥500M=Unix timestamp)
tx.version                        // int: Transaction version
tx.locktime                       // int: Same as tx.time
this.age                          // int: nSequence relative timelock (blocks only in SDK)
```

### Locking Bytecode Constructors

```cashscript
new LockingBytecodeP2PKH(bytes20 pkHash)           // Standard payment
new LockingBytecodeP2SH20(bytes20 scriptHash)      // Legacy (less secure)
new LockingBytecodeP2SH32(bytes32 scriptHash)      // Default (more secure)
new LockingBytecodeNullData(bytes[] chunks)        // OP_RETURN (223 bytes total/tx)
```

### Timelock Semantics

```cashscript
// Absolute Time (nLocktime)
require(tx.time >= lockTime);      // ✅ ALWAYS use >= (not >)

// Relative Time (nSequence)
require(this.age >= blocks);       // Blocks only (SDK limitation, not 512-sec chunks)
```

## EVM→CashScript Pattern Mappings

| Solidity | CashScript | Notes |
|----------|-----------|-------|
| `constructor(address _owner)` | `contract MyContract(pubkey owner)` | Parameters are immutable, set at instantiation |
| `uint256 balance;` | NFT commitment or UTXO chain | State stored in NFT commitments (40 bytes, 128 in 2026) |
| `mapping(address => uint)` | NFT commitment + loop validation | No native mappings, use arrays or commitment data |
| `require(condition, "msg")` | `require(condition);` | No error messages, tx fails if false |
| `msg.sender` | `checkSig(sig, pubkey)` | Explicit signature verification required |
| `msg.value` | `tx.inputs[this.activeInputIndex].value` | Must sum inputs, validate outputs |
| `transfer(recipient, amount)` | `require(tx.outputs[0].value >= amount)` | Covenant-based output validation |
| `payable` keyword | No keyword | All functions can handle value |
| `emit Event(data)` | UTXO change is implicit event; OP_RETURN optional | Transaction IS the event. OP_RETURN only for extra off-chain metadata |
| `modifier onlyOwner` | `require(checkSig(s, pk));` | No native modifiers, inline checks |
| `for(uint i=0; i<n; i++)` | `do { i=i+1; } while(i<n)` | Beta in v0.13.0, body executes first |
| Reentrancy guard | N/A | No reentrancy in UTXO model |
| `storage[]` arrays | Multiple UTXOs or covenant | No storage arrays, separate UTXOs |
| ERC-20 | CashTokens fungible | Native: `tokenAmount`, `tokenCategory` |
| ERC-721 | CashTokens NFT | Native: `nftCommitment`, capabilities |
| `balanceOf[addr]` | `tx.inputs[i].tokenAmount` | Query UTXOs for token balance |
| `view` functions | N/A | All validation happens in spending tx |
| `pure` functions | User-defined functions | `function myFunc(): int { return 42; }` |
| `public` function | All functions (no keyword) | No visibility modifiers in CashScript |
| `private` function | `require(checkSig(s, pk))` | Gate access with signature checks |
| `internal` function | N/A | No contract inheritance |
| `external` function | All functions (no keyword) | All functions externally callable |
| `this.balance` | `tx.inputs[this.activeInputIndex].value` | Current UTXO value |
| `block.timestamp` | `tx.time` | nLocktime value |
| `block.number` | `tx.time` (when <500M) | Block height |
| `selfdestruct()` | Spend to any output | No self-destruct, just spend UTXO |
| `delegatecall()` | N/A | No contract calls |
| `call{value: x}()` | Multi-input transaction | Construct tx with multiple contract inputs |
| `import` | N/A | No code imports - single file contracts |
| `interface` | N/A | No abstract contracts |
| `library` | N/A | No reusable libraries |
| `enum` | int constants | `int PENDING = 0; int ACTIVE = 1;` |
| `struct` | bytes + `.split()` | Pack into bytes, unpack with split() |
| `address` type | `bytes20` or `pubkey` | Hash160 or 33-byte public key |
| `constant` keyword | Constructor params | Immutable per UTXO instance |
| `immutable` keyword | Constructor params | Same as constant - set at deployment |
| `assert(condition)` | `require(condition);` | Only require() exists |
| `revert("msg")` | N/A | No explicit revert - use conditional require() instead. **NEVER use `require(false)` - it creates dead code** |
| `tx.origin` | N/A | No transaction originator concept |
| `storage` location | N/A | Stack-based execution, no storage |
| `memory` location | N/A | Ephemeral stack, no memory allocation |
| `calldata` location | N/A | Transaction introspection instead |

## Critical Gotchas

### No Visibility Modifiers
- ❌ No public/private/internal/external keywords
- ❌ All functions callable by anyone who constructs valid transaction
- ✅ Access control via explicit `require(checkSig(s, pk))` checks
- ✅ Functions don't restrict callers - they restrict valid signatures

### Stack-Based Execution (No Data Locations)
- ❌ No `storage`, `memory`, `calldata` keywords
- ❌ No persistent storage slots or state variables
- ❌ No memory allocation or deallocation
- ✅ All operations on ephemeral stack
- ✅ State lives in NFT commitments (40 bytes, 128 in 2026) or UTXO outputs
- ✅ Transaction introspection provides input data

### No O(1) Lookups
- ❌ No mappings - NO hash table lookups
- ❌ Cannot do `balances[address]` constant-time access
- ✅ Must loop over UTXOs or commitment data
- ✅ Off-chain indexing for complex queries
- ⚠️ Fundamentally different from Solidity's O(1) mapping pattern

### No Code Reuse Mechanisms
- ❌ No `import` statements
- ❌ No `library` contracts
- ❌ No contract inheritance (`is` keyword)
- ❌ No `virtual`/`override` patterns
- ✅ Single file contracts only
- ✅ Copy-paste or user-defined functions for reuse

### Transaction Size Fees (Not Gas)
- ❌ No opcode-based gas costs
- ❌ No storage slot packing optimization
- ✅ Fee = transaction size in bytes × sat/byte rate
- ✅ Optimize by minimizing output count, using P2S over P2SH
- ✅ NFT commitment size (40 bytes, 128 in 2026) affects fee, not "gas"

### State Management
- ❌ No persistent state variables
- ✅ State via UTXO chains: validate input state → create output with new state
- ✅ Pattern: `require(tx.inputs[0].nftCommitment == oldState)` + `require(tx.outputs[0].nftCommitment == newState)`

### No Inter-Contract Calls
- ❌ Cannot call other contracts
- ❌ No `call`, `delegatecall`, `staticcall`
- ✅ Multi-contract interaction via transaction construction (multiple inputs from different contracts)

### Array Bounds Validation
- ❌ No automatic bounds checking
- ✅ ALWAYS validate: `require(tx.outputs.length > index)` before access
- ✅ Same for `tx.inputs.length`

### No Short-Circuit Evaluation
- ❌ `&&` and `||` evaluate ALL operands (not lazy)
- ❌ Cannot use `array.length > 0 && array[0] == value` safely
- ✅ Must separate: `require(array.length > 0); require(array[0] == value);`

### Time Comparison Operators
- ❌ `tx.time > lockTime` is WRONG
- ✅ `tx.time >= lockTime` is CORRECT (ALWAYS use `>=`)
- ❌ `this.age` is NOT 512-second chunks (SDK limitation)
- ✅ `this.age` is blocks only

### Arithmetic Limitations
- ❌ No decimals, no floating point
- ❌ Integer-only, division truncates
- ❌ No compound assignment (`+=`, `-=`, `*=`, `/=`, `%=`)
- ✅ Manual operations: `x = x + 1` (not `x++` or `x += 1`)
- ✅ Overflow checks: `require(a + b >= a)`

### Bitwise Operations (Version-Dependent)
- ❌ Legacy: No shift operators (`<<`, `>>`)
- ❌ Legacy: No bitwise NOT (`~`)
- ✅ Legacy: Only `&`, `|`, `^`
- ✅ Modern (recent upgrades): Full bitwise support including `~`, shifts

### Token Category Byte Order
- ⚠️ `tokenCategory` returned in unreversed order (unlike tx hashes)
- ✅ Use as-is without reversal

### Signature Validation
- ⚠️ `checkSig(0x, pubkey)` returns `false` (not failure)
- ⚠️ Empty signature = valid false response
- ⚠️ Invalid signature format = transaction failure
- ✅ Nullfail rule enforced

### OP_RETURN (Off-Chain Metadata ONLY)
- ❌ NOT for data storage (provably unspendable, funds burned)
- ❌ NOT needed for "events" - UTXO changes are inherently observable
- ❌ 223 bytes TOTAL across ALL OP_RETURN outputs in transaction
- ✅ Use for optional off-chain indexer metadata (app-specific data)
- ✅ For data storage, use NFT commitments
- ✅ Transaction structure itself communicates state changes

### Loops (Pre-v0.13.0)
- ❌ No `for`, `while` loops in older versions
- ✅ v0.13.0+: `do { } while()` syntax (beta)
- ✅ ALWAYS validate bounds: `require(count <= maxIterations)` before loop
- ✅ Check loop state for overflows

### No Fallback/Receive
- ❌ No automatic payment handling
- ❌ No `fallback()` or `receive()`
- ✅ Explicit function calls required

### P2SH Standards
- ✅ P2SH32 (32-byte hash) is default and more secure
- ⚠️ P2SH20 (20-byte hash) is legacy, less collision-resistant
- ✅ P2S (Pay to Script) reduces tx size by 23-35 bytes vs P2SH

### Bytecode Limits
- ✅ 10,000 bytes unlocking bytecode limit
- ✅ NFT commitment: 40 bytes (128 bytes planned for 2026 upgrade)

## Type System Reference

| Type | Size | Range/Constraints | Operations | Auto-Convert To |
|------|------|------------------|------------|----------------|
| `bool` | 1 byte | `true`, `false` | `!`, `&&`, `\|\|` | N/A |
| `int` | Variable | -2^63 to 2^63-1 | `+`, `-`, `*`, `/`, `%`, `<`, `>`, `==`, `!=`, `<=`, `>=` | `bytes` |
| `string` | Variable | UTF-8 or hex (`0x...`) | `.split()`, `.length`, `.reverse()` | `bytes` |
| `bytes` | Variable | Arbitrary byte sequence | `.split()`, `.length`, `.reverse()`, `&`, `\|`, `^` | N/A |
| `bytes1` to `bytes64` | Fixed (N) | Fixed-length byte sequence | Same as `bytes` | `bytes` |
| `pubkey` | 33 bytes | Compressed public key | Used in `checkSig`, `checkMultiSig` | `bytes` |
| `sig` | 64-65 bytes | Schnorr signature | Used in `checkSig`, `checkMultiSig` | `bytes` |
| `datasig` | 64-65 bytes | Data signature | Used in `checkDataSig` | `bytes` |

### Type Constraints
- All variables explicitly typed (no `var`)
- No implicit conversions
- Fixed-length: `bytesN` where N ∈ [1, 64]
- Collections: Arrays limited (mainly `sig[]`, `pubkey[]` for `checkMultiSig`)
- Tuples: Only from `split()` operations, requires destructuring

### Operators

| Category | Supported | Notes |
|----------|-----------|-------|
| Arithmetic | `+`, `-`, `*`, `/`, `%` | Integer only, division truncates |
| Comparison | `<`, `<=`, `>`, `>=`, `==`, `!=` | All types |
| Logical | `!`, `&&`, `\|\|` | No short-circuit evaluation |
| Bitwise (legacy) | `&`, `\|`, `^` | AND, OR, XOR only |
| Bitwise (modern) | `&`, `\|`, `^`, `~`, `<<`, `>>` | Full support in recent versions |
| Assignment | `=` | No compound (`+=`, `-=`, etc.) |

### Units

```cashscript
// BCH Units
1 sats    = 1
1 finney  = 10
1 bits    = 100
1 bitcoin = 100_000_000

// Time Units
1 seconds = 1
1 minutes = 60 seconds
1 hours   = 60 minutes
1 days    = 24 hours
1 weeks   = 7 days
```

### Built-in Functions

| Function | Signature | Returns | Notes |
|----------|-----------|---------|-------|
| `abs()` | `abs(int a)` | `int` | Absolute value |
| `min()` | `min(int a, int b)` | `int` | Minimum of two values |
| `max()` | `max(int a, int b)` | `int` | Maximum of two values |
| `within()` | `within(int x, int lower, int upper)` | `bool` | `lower <= x < upper` (upper exclusive) |
| `sha256()` | `sha256(bytes data)` | `bytes32` | SHA-256 hash |
| `sha1()` | `sha1(bytes data)` | `bytes20` | SHA-1 hash |
| `ripemd160()` | `ripemd160(bytes data)` | `bytes20` | RIPEMD-160 hash |
| `hash160()` | `hash160(bytes data)` | `bytes20` | SHA-256 then RIPEMD-160 |
| `hash256()` | `hash256(bytes data)` | `bytes32` | Double SHA-256 |
| `checkSig()` | `checkSig(sig s, pubkey pk)` | `bool` | Verify signature |
| `checkMultiSig()` | `checkMultiSig(sig[] sigs, pubkey[] pks)` | `bool` | NOT supported in SDK |
| `checkDataSig()` | `checkDataSig(datasig s, bytes msg, pubkey pk)` | `bool` | Verify data signature |
| `bytes()` | `bytes(T data)` | `bytes` | Convert to bytes |

### Mental Model: UTXO State Continuity

```
EVM: storage.balance += amount (in-place state update)

CashScript:
1. Consume UTXO with current balance (input)
2. Validate input has expected balance state: require(tx.inputs[0].nftCommitment == oldState)
3. Create new UTXO with updated balance (output)
4. Enforce balance conservation: sum(inputs) == sum(outputs) + fee
5. Set new state: require(tx.outputs[0].nftCommitment == newState)
```

Think in terms of:
- **Input Selection**: Which UTXOs to consume
- **Validation Logic**: What conditions must inputs/outputs satisfy
- **Output Creation**: What UTXOs to create
- **State Continuity**: How to link current UTXO to next state

NOT:
- ~~Storage updates~~
- ~~State transitions in-place~~
- ~~Function calls between contracts~~
- ~~Persistent memory~~

## Solidity Multi-Contract Pattern Mappings

When converting multi-contract Solidity systems, use these CashScript equivalents:

### Contract Interaction Patterns

| Solidity Pattern | CashScript Equivalent |
|-----------------|----------------------|
| `contractA.call(contractB)` | Multi-input transaction with both contracts |
| Shared state between contracts | Shared token category or NFT commitment |
| Factory pattern | Main+Sidecar with function contracts |
| Library pattern | N/A - inline everything directly |
| Proxy/upgradeable pattern | Conditionally-replicating covenant |
| Interface/abstract contract | Contract constructor parameters |

### Storage Pattern Mappings

| Solidity Storage | CashScript Equivalent |
|-----------------|----------------------|
| `mapping(address => uint)` | NFT commitment with pubkeyhash + value |
| `array[]` | Multiple UTXOs or serialized bytes |
| `struct` | Structured NFT commitment bytes |
| Global state variable | NFT commitment field |
| Immutable variable | Contract constructor parameter |

### Function Call Mappings

| Solidity | CashScript |
|----------|------------|
| `external function()` | Separate contract in transaction |
| `internal function()` | Inline code (no functions) |
| `view function()` | Read from NFT commitment |
| `payable function()` | Accept BCH in transaction |
| Modifier | `require()` statements at function start |

### Multi-Contract Architecture Translation

**Solidity: Contract calls contract**
```solidity
contract A {
    B otherContract;
    function callB() {
        otherContract.doSomething();
    }
}
```

**CashScript: Multi-input transaction**
```cashscript
// Contract A and B must BOTH be inputs in same transaction
contract A(bytes32 contractBCategory) {
    function interact() {
        // Validate B is in transaction at known position
        require(tx.inputs[1].tokenCategory == contractBCategory);

        // B's contract will also validate its constraints
        // Both must pass for transaction to succeed
    }
}
```

### Key Translation Rules

1. **Every cross-contract call becomes a transaction structure**
   - Caller and callee are both inputs
   - Each validates its own constraints
   - Transaction succeeds only if ALL pass

2. **Every storage mapping becomes commitment bytes**
   - Key = identifier byte(s)
   - Value = serialized in commitment
   - Lookups = byte.split() operations

3. **Every modifier becomes require() guards**
   - No separation between modifier and function
   - All checks inline at function start

4. **Every event becomes implicit**
   - Transaction structure IS the event
   - Input/output changes are observable
   - No need for explicit event emission

### Complete Translation Example

**Solidity: Token with allowance**
```solidity
contract Token {
    mapping(address => uint256) balances;
    mapping(address => mapping(address => uint256)) allowances;

    function transfer(address to, uint256 amount) {
        require(balances[msg.sender] >= amount);
        balances[msg.sender] -= amount;
        balances[to] += amount;
    }

    function approve(address spender, uint256 amount) {
        allowances[msg.sender][spender] = amount;
    }
}
```

**CashScript: Token with allowance (conceptual)**
```cashscript
// NOT directly translatable - requires architectural redesign
// Option 1: Each user has their own NFT with balance commitment
// Option 2: Central contract tracks via fungible tokens
// Option 3: Allowance is separate approval NFT

contract UserBalance(bytes32 tokenCategory) {
    // Balance stored in NFT commitment: bytes6 balance + bytes20 owner
    function transfer(int amount, bytes20 recipientPkh) {
        // Parse current balance from commitment
        bytes commitment = tx.inputs[0].nftCommitment;
        int balance = int(commitment.split(6)[0]);
        bytes20 owner = bytes20(commitment.split(6)[1]);

        // Validate sender owns this UTXO
        require(tx.inputs[1].lockingBytecode ==
                new LockingBytecodeP2PKH(owner));

        // Validate amount
        require(amount > 0);
        require(amount <= balance);

        // Create output with reduced balance (or burn if zero)
        int newBalance = balance - amount;
        if (newBalance > 0) {
            bytes newCommitment = bytes6(newBalance) + owner;
            require(tx.outputs[0].nftCommitment == newCommitment);
        }

        // Create recipient output
        bytes recipientCommitment = bytes6(amount) + recipientPkh;
        require(tx.outputs[1].nftCommitment == recipientCommitment);
    }
}
```

### What Cannot Be Directly Translated

| Solidity Feature | Why Impossible | Alternative |
|-----------------|----------------|-------------|
| Dynamic arrays | No loops over arbitrary length | Fixed-size structures |
| Unbounded mappings | No iteration | Split into multiple UTXOs |
| Reentrancy guards | No reentrancy possible | Not needed (UTXO consumed) |
| `msg.sender` as trust | No inherent sender identity | Signature verification |
| Contract creation | Cannot spawn contracts | Pre-deploy all contracts |
| `selfdestruct` | Contracts are UTXOs | Simply don't replicate |

### Best Practice: Design First, Code Second

When converting multi-contract Solidity:

1. **Identify state** - What mappings/arrays exist?
2. **Map to UTXOs** - Each "record" = one UTXO?
3. **Identify interactions** - Which contracts call which?
4. **Design transaction templates** - What inputs/outputs for each operation?
5. **Then write CashScript** - Code the constraints

Don't try to "port" Solidity line-by-line. Redesign for UTXO model first.
