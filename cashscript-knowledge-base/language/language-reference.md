# CashScript Language Reference

## TYPE SYSTEM

| Type | Operations | Methods | Conversions | Size | Constraints |
|------|-----------|---------|-------------|------|-------------|
| `bool` | `! && || == !=` | - | - | 1 bit | - |
| `int` | `+ - * / % < <= > >= == !=` | - | `bytes(int)` `bytesN(int)` | Variable | Integer-only, div/0 fails, underscores OK: `1_000_000`, scientific: `1e6` |
| `string` | `+ == !=` | `.length` `.reverse()` `.split(i)` | `bytes(string)` | Variable | UTF-8 encoded |
| `bytes` | `+ == != & | ^` | `.length` `.reverse()` `.split(i)` | Variable | Hex: `0x1234abcd` |
| `bytesN` | Same as bytes | Same as bytes | `bytesN(any)` | N bytes (1-64) | Fixed length, N=1-64, `byte` alias for `bytes1` |
| `pubkey` | `== !=` | - | Auto to bytes | 33 bytes | Bitcoin public key |
| `sig` | `== !=` | - | Auto to bytes | ~65 bytes | Transaction signature |
| `datasig` | `== !=` | - | Auto to bytes | ~64 bytes | Data signature |

**Common bytesN**: `bytes1` (byte), `bytes4` (prefix), `bytes20` (hash160), `bytes32` (sha256), `bytes64` (signature)

## FUNCTION REFERENCE

| Function | Signature | Returns | Notes |
|----------|-----------|---------|-------|
| `abs` | `(int)` | `int` | Absolute value |
| `min` | `(int, int)` | `int` | Minimum of two |
| `max` | `(int, int)` | `int` | Maximum of two |
| `within` | `(int x, int lower, int upper)` | `bool` | `x >= lower && x < upper` (upper exclusive) |
| `sha256` | `(any)` | `bytes32` | SHA-256 hash |
| `sha1` | `(any)` | `bytes20` | SHA-1 hash |
| `ripemd160` | `(any)` | `bytes20` | RIPEMD-160 hash |
| `hash160` | `(any)` | `bytes20` | SHA-256 then RIPEMD-160 |
| `hash256` | `(any)` | `bytes32` | Double SHA-256 |
| `checkSig` | `(sig, pubkey)` | `bool` | Transaction signature. NULLFAIL: invalid=fail, `0x`=false |
| `checkMultiSig` | `(sig[], pubkey[])` | `bool` | Multi-sig. NOT in TypeScript SDK |
| `checkDataSig` | `(datasig, bytes, pubkey)` | `bool` | Data signature. NULLFAIL applies |
| `bytes` | `(any)` | `bytes` | Type conversion |
| `bytesN` | `(any)` | `bytesN` | Fixed-length conversion (pads/truncates) |

## GLOBAL VARIABLES

| Variable | Type | Description | Constraint |
|----------|------|-------------|------------|
| `tx.time` | `int` | Absolute time lock (nLocktime) | <500M=block height, ≥500M=Unix timestamp. Use: `require(tx.time >= expr)` |
| `this.age` | `int` | Relative UTXO age (nSequence) | Blocks only (SDK limitation). Use: `require(this.age >= expr)` |
| `tx.version` | `int` | Transaction version | Typically 2 |
| `tx.locktime` | `int` | Transaction locktime | 0 or timestamp/block |
| `tx.inputs` | `Input[]` | Transaction inputs array | Check `.length` before access |
| `tx.outputs` | `Output[]` | Transaction outputs array | Check `.length` before access |
| `tx.inputs[i].value` | `int` | Input satoshi amount | Bounds: `i < tx.inputs.length` |
| `tx.inputs[i].lockingBytecode` | `bytes` | Input scriptPubKey | - |
| `tx.inputs[i].unlockingBytecode` | `bytes` | Input scriptSig | - |
| `tx.inputs[i].outpointTransactionHash` | `bytes32` | UTXO source tx hash | - |
| `tx.inputs[i].outpointIndex` | `int` | UTXO source output index | - |
| `tx.inputs[i].sequenceNumber` | `int` | nSequence value | Relative timelock in v2 tx only |
| `tx.inputs[i].tokenCategory` | `bytes32` | Input token category | CashTokens. Unreversed byte order |
| `tx.inputs[i].nftCommitment` | `bytes` | Input NFT commitment | CashTokens, max 40 bytes |
| `tx.inputs[i].tokenAmount` | `int` | Input fungible tokens | CashTokens |
| `tx.outputs[i].value` | `int` | Output satoshi amount | Bounds: `i < tx.outputs.length` |
| `tx.outputs[i].lockingBytecode` | `bytes` | Output script bytecode | - |
| `tx.outputs[i].tokenCategory` | `bytes32` | Output token category | CashTokens. Unreversed byte order |
| `tx.outputs[i].nftCommitment` | `bytes` | Output NFT commitment | CashTokens, max 40 bytes |
| `tx.outputs[i].tokenAmount` | `int` | Output fungible tokens | CashTokens |
| `this.activeInputIndex` | `int` | Current input being evaluated | - |
| `this.activeBytecode` | `bytes` | Current input's locking bytecode | For covenants |

**Locking Bytecode Constructors**:
- `new LockingBytecodeP2PKH(bytes20 pkHash)` - Pay to public key hash
- `new LockingBytecodeP2SH20(bytes20 scriptHash)` - Pay to script hash (20-byte)
- `new LockingBytecodeP2SH32(bytes32 scriptHash)` - Pay to script hash (32-byte)
- `new LockingBytecodeNullData(bytes[] chunks)` - OP_RETURN data output

## OP_RETURN OUTPUTS

**Purpose**: Data storage, event logging (Solidity events → OP_RETURN)
**Size limit**: 223 bytes total per transaction across all OP_RETURN outputs
**Spendability**: Provably unspendable (funds sent to OP_RETURN are burned)

**Usage patterns**:
1. **Contract enforcement** (covenant requires specific OP_RETURN):
   ```cashscript
   require(tx.outputs[i].lockingBytecode == new LockingBytecodeNullData([eventData]));
   ```

2. **SDK usage** (add OP_RETURN without contract enforcement):
   ```javascript
   .withOpReturn(['0x6d02', 'Event data', address, amount])
   ```

**Solidity events → CashScript translation**:
- `emit MyEvent(args)` → OP_RETURN output with event data
- Contract typically does NOT enforce OP_RETURN (SDK adds it)
- Alternative: Contract enforces via `LockingBytecodeNullData` for critical events

## STATE VARIABLES (Solidity → CashScript)

**CRITICAL**: BCH is UTXO-based (stateless), NOT account-based like Ethereum.

**Solidity updatable state → CashScript covenant pattern**:
```solidity
// Solidity (account model - state persists)
string public message;
function update(string newMessage) { message = newMessage; }
```
→
```cashscript
// CashScript (UTXO model - enforce recreation)
contract Message(bytes message) {
    function update(bytes newMessage, sig ownerSig) {
        require(checkSig(ownerSig, owner));
        // Enforce output creates NEW contract instance
        require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2SH32(hash256(/* new contract with newMessage */)));
        require(tx.outputs[0].value >= tx.inputs[this.activeInputIndex].value - 1000);
    }
}
```

**Key differences**:
- Constructor params = "state" (immutable per UTXO)
- "Update" = spend old UTXO, create new UTXO with new constructor params
- Covenant enforces output constraints (new contract instance, preserve value)
- Read functions unnecessary (inspect constructor params off-chain)

## OPERATORS

| Category | Operators | Valid Types | Notes |
|----------|-----------|-------------|-------|
| Arithmetic | `+ - * / %` | `int` | Integer only, div/0 fails |
| Comparison | `< <= > >= == !=` | `int` `bool` `bytes` `string` | - |
| Logical | `! && ||` | `bool` | NO short-circuit (all operands evaluated) |
| Bitwise | `& | ^` | `int` `bytes` | AND, OR, XOR only. No shift or invert operators |
| Concatenation | `+` | `string` `bytes` | - |
| Unary | `+ - !` | `int` `bool` | - |

## UNITS

| BCH Units | Value | Time Units | Value |
|-----------|-------|------------|-------|
| `sats` | 1 | `seconds` | 1 |
| `finney` | 100,000 | `minutes` | 60 |
| `bits` | 100 | `hours` | 3,600 |
| `bitcoin` | 100,000,000 | `days` | 86,400 |
| - | - | `weeks` | 604,800 |

## SYNTAX PATTERNS

### Contract Structure
```cashscript
pragma cashscript ^0.13.0;

contract MyContract(params) {
    function spend() { /* ... */ }
}
```
**Pragma**: Specifies compiler version. Uses SemVer (e.g., `^0.13.0`, `>= 0.7.0 < 0.9.3`)

### Type Conversions
```cashscript
int i = 42;
bytes b = bytes(i);              // Explicit conversion
bytes4 b4 = bytes4(i);           // Fixed-length (pads/truncates)

pubkey pk = 0x03...;
bytes pkBytes = pk;              // Implicit conversion (specialized types)

string s = "Hello";
bytes sBytes = bytes(s);         // UTF-8 encoding
```

### Collections
```cashscript
// Arrays (limited, mainly for checkMultiSig)
sig[] sigs = [sig1, sig2];
pubkey[] pks = [pk1, pk2, pk3];
require(checkMultiSig(sigs, pks));

// Tuples (from split operations)
bytes part1, bytes part2 = data.split(5);
string s1, string s2 = text.split(10);
```

### Control Flow: Loops
```cashscript
// do-while loop (CashScript 0.13.0+)
int inputIndex = 0;
do {
    require(tx.inputs[inputIndex].tokenCategory == 0x);
    inputIndex = inputIndex + 1;
} while (inputIndex < tx.inputs.length);
```
**Behavior**: Executes body first, then tests condition. Continues while condition is true. Beta feature in 0.13.0

### Bitwise Operations
```cashscript
// Supported: AND, OR, XOR (on bytes and int)
bytes flags = 0xFF;
bytes masked = flags & 0x0F;     // AND for masking
bytes combined = a | b;          // OR for combining
bytes toggled = a ^ b;           // XOR for toggling

int intFlags = 15;
int result = intFlags & 7;       // Bitwise AND on integers
```
**Note**: CashScript does NOT support shift operators (`<<`, `>>`) or bitwise NOT (`~`)

### Array Bounds
```cashscript
// ALWAYS validate length before access
require(tx.outputs.length > index);
require(tx.outputs[index].value >= amount);
```

## MASTER EXAMPLE

```cashscript
pragma cashscript ^0.13.0;

contract MasterReference(
    pubkey owner,
    pubkey delegate,
    bytes32 secretHash,
    int threshold,
    int timeout,
    bytes32 tokenCategory
) {
    // Hash lock path
    function hashPath(sig ownerSig, bytes preimage) {
        require(checkSig(ownerSig, owner));
        require(sha256(preimage) == secretHash);
        require(hash160(preimage) != 0x0000000000000000000000000000000000000000);
    }

    // Time lock path with relative age
    function timePath(sig ownerSig) {
        require(checkSig(ownerSig, owner));
        require(tx.time >= timeout);
        require(this.age >= 144);  // ~24 hours in blocks
    }

    // Covenant: enforce output constraints
    function covenantPath(sig ownerSig) {
        require(checkSig(ownerSig, owner));

        // Validate outputs length
        require(tx.outputs.length >= 2);

        // Output 0: payment with minimum amount
        require(tx.outputs[0].value >= threshold);
        bytes20 pkh = hash160(owner);
        require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2PKH(pkh));

        // Output 1: OP_RETURN data
        bytes data = bytes(threshold) + bytes(tx.time);
        require(tx.outputs[1].lockingBytecode == new LockingBytecodeNullData([data]));
    }

    // Token path: validate CashTokens
    function tokenPath(sig ownerSig) {
        require(checkSig(ownerSig, owner));
        require(tx.outputs[0].tokenCategory == tokenCategory);
        require(tx.outputs[0].tokenAmount >= 100);
    }

    // Loop: aggregate input values
    function aggregatePath(sig delegateSig) {
        require(checkSig(delegateSig, delegate));

        int i = 0;
        int totalInput = 0;
        do {
            totalInput = totalInput + tx.inputs[i].value;
            i = i + 1;
        } while (i < tx.inputs.length);

        require(totalInput >= threshold * 2);
    }

    // Bitwise: flag validation using AND/OR/XOR
    function flagPath(sig ownerSig, int flags) {
        require(checkSig(ownerSig, owner));

        int requiredFlags = 0x07;  // Binary: 00000111
        require((flags & requiredFlags) == requiredFlags);

        // Use multiplication for doubling (no shift operators)
        int doubled = threshold * 2;
        require(tx.outputs[0].value >= doubled);
    }

    // Multi-signature with oracle data
    function oraclePath(
        sig ownerSig,
        datasig oracleSig,
        bytes priceData,
        pubkey oraclePk
    ) {
        require(checkSig(ownerSig, owner));
        require(checkDataSig(oracleSig, priceData, oraclePk));

        // Type conversion
        int price = int(bytes4(priceData));
        require(price >= threshold);
    }
}
```

## CONSTRAINTS

### Compile-Time Errors
- Type mismatch: `int x = "text";`
- Invalid operation: `bool + int`
- Undefined variable reference
- Wrong function arity
- Invalid type in operation: `string * int`

### Runtime Failures
- Division by zero: `int / 0`
- Array out of bounds: `tx.outputs[i]` when `i >= tx.outputs.length`
- Invalid signature format (non-NULLFAIL context)
- Failed `require()` statement
- Overflow/underflow (follows Bitcoin Script rules)
- Invalid locking bytecode construction

### Type System Rules
- All variables must be explicitly typed
- No implicit numeric conversions (`int` ↔ `string`)
- Specialized types (`sig`, `pubkey`, `datasig`) auto-convert to `bytes`
- Fixed-length types: `bytesN` where N ∈ [1, 64]
- Collections: arrays limited (mainly `sig[]`, `pubkey[]` for checkMultiSig)
- Tuples: only from `split()` operations

### Operational Limits
- `tx.time` semantics: <500,000,000 = block height, ≥500,000,000 = Unix timestamp. Only use with `require(tx.time >= expr)`
- `this.age` encoding: blocks only (SDK limitation, not 512-sec chunks). Only use with `require(this.age >= expr)`
- Array access: ALWAYS validate `.length` before indexing
- Integer arithmetic: no decimals, integer division only
- `checkMultiSig`: NOT supported in TypeScript SDK (compile-time only)
- NFT commitment: max 40 bytes currently
- String/bytes operations: `.split(index)` returns tuple, requires destructuring
- Bitwise operators: Only `&`, `|`, `^` supported. NO shift (`<<`, `>>`) or invert (`~`)
- Loops: `do {} while ()` syntax, beta in CashScript 0.13.0. Body executes at least once
- Token category byte order: Returned in unreversed order
- Compound assignment: NOT supported (`+=`, `-=`, etc.)

### Best Practices for AI Agents
- Always check array bounds before access
- Use fixed-length types (`bytes20`, `bytes32`) for hash outputs
- Validate inputs at function entry
- Use `within(x, lower, upper)` for range checks (`x >= lower && x < upper`, upper is exclusive)
- Use bitwise `&`, `|`, `^` for flag operations and masking
- Store reused bytecode in variables vs. reconstructing
- Extract common validation logic into separate contract functions
- Check both `tx.time` and `this.age` for robust time locks
- Validate token category AND amount for CashTokens
- Use NULLFAIL behavior: empty sig `0x` returns false without failure
