# CashScript Language Reference

## TYPE SYSTEM

| Type | Operations | Methods | Conversions | Size | Constraints |
|------|-----------|---------|-------------|------|-------------|
| `bool` | `! && || == !=` | - | - | 1 bit | - |
| `int` | `+ - * / % < <= > >= == !=` | - | `bytes(int)` `bytesN(int)` | Variable | Integer-only, div/0 fails, underscores OK: `1_000_000`, scientific: `1e6` |
| `string` | `+ == !=` | `.length` `.reverse()` `.split(i)` `.slice(start,end)` | `bytes(string)` | Variable | UTF-8 encoded |
| `bytes` | `+ == != & | ^` | `.length` `.reverse()` `.split(i)` `.slice(start,end)` | Variable | Hex: `0x1234abcd` |
| `bytesN` | Same as bytes | Same as bytes | `bytesN(any)` | N bytes (1-64) | Fixed length, N=1-64, `byte` alias for `bytes1` |
| `pubkey` | `== !=` | - | Auto to bytes | 33 bytes | Bitcoin public key |
| `sig` | `== !=` | - | Auto to bytes | ~65 bytes | Transaction signature |
| `datasig` | `== !=` | - | Auto to bytes | ~64 bytes | Data signature |

**Common bytesN**: `bytes1` (byte), `bytes4` (prefix), `bytes20` (hash160), `bytes32` (sha256), `bytes64` (signature)

### CRITICAL: Script Number Minimal Encoding

**BCH Script requires minimal encoding for integers**. The most significant bit (MSB) of the last byte indicates sign. Production contracts must validate upper bounds:

```cashscript
// PATTERN: Validate values don't exceed bytesN capacity (minus MSB)
require(pledgeAmount <= 140737488355327);  // Max bytes6: 2^47 - 1 (MSB reserved)
require(newPledgeID != 2147483647);        // Max bytes4: 2^31 - 1 (MSB reserved)
require(campaignID != 0xFFFFFFFFFF);       // Sentinel value check (bytes5)
```

**Maximum values by byte size (CRITICAL - MSB constraint):**
- `bytes1`: 127 (2^7 - 1)
- `bytes2`: 32,767 (2^15 - 1)
- `bytes4`: 2,147,483,647 (2^31 - 1)
- `bytes5`: 549,755,813,887 (2^39 - 1)
- `bytes6`: 140,737,488,355,327 (2^47 - 1)
- `bytes8`: 9,223,372,036,854,775,807 (2^63 - 1)

**Why MSB matters**: In Script Number encoding, the MSB indicates sign. If you use the full byte range, you risk creating values that get interpreted as negative. Always subtract 1 bit from max capacity.

### CRITICAL: int Type Casting Limit

Only `bytes1` through `bytes8` can be cast to `int`. Larger bounded bytes types cause a compile error:

| Type | Cast to int | Error |
|------|-------------|-------|
| `bytes1-bytes8` | ✅ `int(value)` | - |
| `bytes9-bytes64` | ❌ | "Type 'bytesN' is not castable to type 'int'" |

```cashscript
// OK - bytes8 or smaller
bytes8 amount = bytes8(commitment.slice(0, 8));
require(int(amount) > 0);

// COMPILE ERROR - bytes16 cannot cast to int
bytes16 liquidity = bytes16(commitment.slice(0, 16));
require(int(liquidity) > 0);  // ❌ Error!
```

**Auto-increment pattern with overflow check:**
```cashscript
bytes4 currentID = bytes4(tx.inputs[0].nftCommitment.split(4)[0]);
int newID = int(currentID) + 1;
require(newID != 2147483647);  // Check BEFORE using new value
require(tx.outputs[0].nftCommitment == bytes4(newID) + restOfCommitment);
```

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
| `checkMultiSig` | `([sig, ...], [pubkey, ...])` | `bool` | Multi-sig. INLINE arrays only: `checkMultisig([s1,s2], [pk1,pk2,pk3])`. NOT in TypeScript SDK |
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
| `tx.inputs[i].tokenCategory` | `bytes` | Input token category | 32-byte ID + optional capability (0x01=mutable, 0x02=minting) |
| `tx.inputs[i].nftCommitment` | `bytes` | Input NFT commitment | CashTokens, max 128 bytes |
| `tx.inputs[i].tokenAmount` | `int` | Input fungible tokens | CashTokens, max 64-bit |
| `tx.outputs[i].value` | `int` | Output satoshi amount | Bounds: `i < tx.outputs.length` |
| `tx.outputs[i].lockingBytecode` | `bytes` | Output script bytecode | - |
| `tx.outputs[i].tokenCategory` | `bytes` | Output token category | 32-byte ID + optional capability (0x01=mutable, 0x02=minting) |
| `tx.outputs[i].nftCommitment` | `bytes` | Output NFT commitment | CashTokens, max 128 bytes |
| `tx.outputs[i].tokenAmount` | `int` | Output fungible tokens | CashTokens |
| `this.activeInputIndex` | `int` | Current input being evaluated | - |
| `this.activeBytecode` | `bytes` | Current input's locking bytecode | For covenants |

**Locking Bytecode Constructors**:
- `new LockingBytecodeP2PKH(bytes20 pkHash)` - Pay to public key hash
- `new LockingBytecodeP2SH20(bytes20 scriptHash)` - Pay to script hash (20-byte)
- `new LockingBytecodeP2SH32(bytes32 scriptHash)` - Pay to script hash (32-byte)
- `new LockingBytecodeNullData(bytes[] chunks)` - OP_RETURN data output

### CRITICAL: P2SH32 Address Type (HARDCODED CONTRACT ADDRESSES)

When storing contract addresses for **cross-contract validation** (multi-contract systems), ALWAYS use `bytes32` type. This is a CRITICAL rule:

```cashscript
// ✓ CORRECT - bytes32 type for P2SH32 addresses
bytes32 votingBoothAddress = 0x1234567890123456789012345678901234567890123456789012345678901234;
require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2SH32(votingBoothAddress));

// ✗ WRONG - bytes type will cause compilation error!
bytes votingBoothAddress = 0x1234567890123456789012345678901234567890123456789012345678901234;
require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2SH32(votingBoothAddress));
// Error: Found parameters (bytes) where (bytes32) expected

// ✗ WRONG - operations that lose type precision!
bytes someData = 0x00...;  // 33 bytes total
bytes32 addressHash = someData.split(1)[1];  // Results in bytes31, NOT bytes32!
require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2SH32(addressHash));
// Error: Type 'bytes31' can not be assigned to variable of type 'bytes32'

// ✓ CORRECT - explicit bytes32 cast or direct literal
bytes32 addressHash = bytes32(someData.split(1)[1]);  // Explicit cast to bytes32
// OR better: use direct literal assignment
bytes32 votingBoothHash = 0x1234...;  // Hardcode the address directly

// ✓ CORRECT - bytes20 type for P2PKH addresses
bytes20 chairpersonPkh = 0x1234567890123456789012345678901234567890;
require(tx.inputs[1].lockingBytecode == new LockingBytecodeP2PKH(chairpersonPkh));
```

**Why this matters**: Multi-contract systems (like BCHess, CashStarter, voting systems) embed other contract addresses for validation. Using the wrong type (`bytes` instead of `bytes32`) causes a type mismatch error that will fail compilation.

**Production pattern** (from BCHess/CashStarter):
```cashscript
// In contracts that reference other contracts by address:
contract BallotInitializer(bytes20 chairpersonPkh) {
    function initialize(...) {
        // Hardcoded contract address (deployed first)
        bytes32 votingBoothHash = 0xabc...;  // Must be bytes32!
        require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2SH32(votingBoothHash));
    }
}
```

**CashToken Capabilities**:
- **Immutable** (no capability byte): Cannot modify NFT commitment when spent
- **Mutable** (0x01): Can create ONE replacement NFT per spending, can downgrade to immutable
- **Minting** (0x02): Can create unlimited NFTs, can downgrade to mutable or immutable

**Token Constraints**:
- One NFT per output maximum
- All tokens in output must share same category
- Fungible token amount: 1 to 9,223,372,036,854,775,807 (64-bit)
- tokenCategory returns `0x` when no tokens present
- Category byte order: unreversed (OP_HASH256 format, NOT wallet/explorer format)

## NFT COMMITMENT DATA STORAGE

**CRITICAL**: BCH has no global state. Store data in NFT commitments (local transferrable state).

**Size limits**:
- 128 bytes (since May 2025 upgrade)

**Pattern**: Contract introspects input commitment, enforces output commitment with updated state.
```cashscript
contract StatefulContract(bytes32 stateTokenCategory) {
    function updateState(sig ownerSig, bytes newState) {
        require(checkSig(ownerSig, owner));
        // Read current state from input NFT commitment
        require(tx.inputs[0].tokenCategory == stateTokenCategory);
        bytes currentState = tx.inputs[0].nftCommitment;
        // Enforce updated state in output NFT commitment
        require(tx.outputs[0].tokenCategory == stateTokenCategory);
        require(tx.outputs[0].nftCommitment == newState);
    }
}
```

**Key concepts**:
- **Local transferrable state**: NFT commitments persist across transactions
- **Local transferrable functions**: Store function logic in 128-byte commitments (post-May 2025)
- **NOT OP_RETURN**: OP_RETURN is provably unspendable (funds burned), not for storage

## OP_RETURN OUTPUTS

**CRITICAL**: In UTXO model, the transaction itself IS the observable event. UTXO consumption/creation is inherently visible on-chain - no separate event emission needed.

**OP_RETURN purpose**: Optional off-chain metadata broadcasting (NOT "Solidity events")
**Size limit**: 223 bytes total per transaction
**Spendability**: Provably unspendable (funds BURNED)

**When to use OP_RETURN**:
- App-specific metadata for off-chain indexers (Chronik, Chaingraph)
- Protocol-specific data (e.g., social apps, token metadata)
- NOT for state change notifications (UTXO changes are already observable)
- NOT for data storage (use NFT commitments)

```cashscript
// Optional: Add metadata for indexers
require(tx.outputs[1].lockingBytecode == new LockingBytecodeNullData([appData]));
```

**Solidity events vs BCH UTXO model**:
- Solidity `emit Transfer(from, to, amount)` → logs state change explicitly
- BCH: The UTXO with updated NFT commitment IS the state change - no explicit event needed
- Transaction structure itself communicates what happened

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

## STRUCTURED COMMITMENT PACKING

**128-byte NFT commitments require careful layout planning**. Production contracts pack multiple values with explicit byte positions:

```cashscript
// PRODUCTION PATTERN: Pack multiple values into 128-byte commitment
// Layout: userPkh(20) + reserved(18) + lockBlocks(2) = 40 bytes total
bytes20 userPkh = 0xaabbccdd...;  // 20 bytes
int lockBlocks = 1000;             // Will become 2 bytes

// WRITE: Pack into commitment
require(tx.outputs[0].nftCommitment == userPkh + bytes18(0) + bytes2(lockBlocks));

// READ: Unpack from commitment
bytes20 storedPkh = bytes20(tx.inputs[0].nftCommitment.split(20)[0]);
bytes stakeBlocks = bytes2(tx.inputs[0].nftCommitment.split(38)[1]);  // Skip 38, take last 2
int blocks = int(stakeBlocks);
```

### CRITICAL: Chained Split Operations and Tuple Destructuring

**Production contracts use chained splits for complex layouts:**

```cashscript
// PATTERN: Extract multiple values from middle of commitment
// Layout: [other(31) + pledgeID(4) + campaignID(5)] = 40 bytes

// Chained split: skip 31 bytes, then split remaining 9 bytes at position 4
bytes4 pledgeID, bytes5 campaignID = tx.inputs[0].nftCommitment.split(31)[1].split(4);

// Another example: extract middle field
// Layout: [prefix(26) + endBlock(4) + suffix(10)]
bytes4 endBlock = tx.inputs[0].nftCommitment.split(26)[1].split(4)[0];  // Skip 26, take next 4
```

**Tuple destructuring syntax (CRITICAL - often overlooked):**
```cashscript
// SINGLE split returns TWO parts - assign both at once
bytes left, bytes right = someBytes.split(10);  // Generic
bytes4 id, bytes5 rest = data.split(4);         // Typed destructuring
bytes20 addr, bytes remaining = commitment.split(20);  // Common pattern
```

### Partial Commitment Preservation

**Modify specific bytes while keeping rest intact:**
```cashscript
// PATTERN: Update only the last N bytes of commitment
bytes restCommitment = tx.inputs[0].nftCommitment.split(31)[0];  // Keep first 31 bytes
int newPledgeID = int(pledgeID) + 1;
require(tx.outputs[0].nftCommitment == restCommitment + bytes4(newPledgeID) + campaignID);

// PATTERN: Update only the first N bytes
bytes existingTail = tx.inputs[0].nftCommitment.split(2)[1];  // Keep last 38 bytes
require(tx.outputs[0].nftCommitment == bytes2(newFee) + existingTail);
```

**Common layouts (128 bytes)**:
```
[pubkeyhash(20) + fee(2) + adminPkh(18)]                    // Admin contract
[pubkeyhash(20) + reserved(18) + blocks(2)]                 // Time-locked
[pledgeAmt(6) + padding(21) + endBlock(4) + id(4) + campaignID(5)]  // Receipt NFT
[prefix(31) + pledgeID(4) + campaignID(5)]                  // Campaign state
```

**Byte-size reference**:
- `bytes2` = 0-65535 (sufficient for block counts, small fees)
- `bytes4` = 0-4,294,967,295 (timestamps, larger values)
- `bytes5` = 0-1,099,511,627,775 (5-byte IDs, up to ~1 trillion)
- `bytes6` = 0-281,474,976,710,655 (6-byte amounts)
- `bytes8` = int max range (Script Number limit)
- `bytes20` = pubkeyhash (P2PKH address)
- `bytes32` = token category ID, hashes

**CRITICAL**: Plan your commitment layout BEFORE writing code. Changing layout breaks existing UTXOs.

### slice() vs split() - Byte Extraction Guide

CashScript provides TWO methods for byte extraction:

| Method | Signature | Returns | Use Case |
|--------|-----------|---------|----------|
| `split(index)` | `.split(i)` | `(bytes, bytes)` tuple | Head/tail separation |
| `slice(start, end)` | `.slice(s, e)` | `bytes` | Extract from middle |

**CRITICAL: When to use which:**
- **split()** - Best for extracting from START or END, or sequential destructuring
- **slice()** - Best for extracting bytes from the MIDDLE of a commitment

```cashscript
// WRONG: Chained splits produce wrong sizes!
// To extract 8 bytes at offset 64:
int reserve = int(commitment.split(72)[0].split(8)[1]);
// split(72)[0] → bytes72 (first 72 bytes)
// .split(8)[1] → bytes64 (72-8=64 bytes!), NOT bytes8!
// ERROR: "Type 'bytes64' is not castable to type 'int'"

// CORRECT: Use slice() for middle extraction
bytes8 reserveBytes = bytes8(commitment.slice(64, 72));  // bytes 64-71
int reserve = int(reserveBytes);

// CORRECT: Use split() for head extraction
bytes20 ownerPkh = bytes20(commitment.split(20)[0]);  // first 20 bytes

// CORRECT: Use split() for tail extraction (40-byte commitment)
bytes4 suffix = bytes4(commitment.split(36)[1]);  // last 4 bytes

// CORRECT: Sequential destructuring with split()
bytes20 owner, bytes rest = commitment.split(20);
bytes8 balance, bytes rest2 = rest.split(8);
bytes4 timestamp = bytes4(rest2.split(4)[0]);
```

**Common extraction patterns by position:**
```
Commitment: [field0(20) | field1(8) | field2(32) | field3(4)] = 64 bytes

Field 0 (offset 0, size 20):   bytes20(commitment.split(20)[0])
Field 1 (offset 20, size 8):   bytes8(commitment.slice(20, 28))
Field 2 (offset 28, size 32):  bytes32(commitment.slice(28, 60))
Field 3 (offset 60, size 4):   bytes4(commitment.split(60)[1])
```

## DUST AND FEE ACCOUNTING

**BCH requires explicit fee management**. Unlike EVM gas abstraction, you must account for every satoshi:

```cashscript
// CRITICAL: Minimum dust amounts
require(tx.outputs[0].value == 1000);  // Minimum dust for token UTXO (546 technically, 1000 safe)
require(amount >= 5000);               // Ensure enough for future fees

// PATTERN: Explicit fee subtraction
require(tx.outputs[0].value == tx.inputs[0].value - 3000);  // 3000 = miner fee + 2x dust UTXOs

// PATTERN: Fee collection into contract
bytes2 stakeFee = bytes2(tx.inputs[0].nftCommitment.split(2)[0]);
require(tx.outputs[0].value == tx.inputs[0].value + int(stakeFee));

// PATTERN: Withdraw accumulated fees
require(tx.outputs[1].value == tx.inputs[0].value + tx.inputs[1].value - 2000);
```

**Production fee constants**:
- **546 sats** - Absolute minimum dust (rarely used)
- **1000 sats** - Safe dust for token UTXOs
- **1000-2000 sats** - Typical miner fee per KB
- **5000+ sats** - Minimum lock amounts (covers future unlock fees)

**Key insight**: Every output costs ~34 bytes (8 value + 26 script). Fee = tx_size * rate. Plan outputs carefully.

## INTER-CONTRACT TRUST MODEL

**CashScript contracts can interact securely via shared token categories**. This enables composable DeFi protocols:

```cashscript
// CONTRACT A: Primary contract (e.g., CashStarter)
contract PrimaryContract() {
    function doSomething() {
        require(this.activeInputIndex == 0);  // This is input 0
        // ... primary logic
    }

    // Allow external contracts to interact
    function externalFunction() {
        require(this.activeInputIndex == 1);  // This contract is input 1
        // Trust verified by input 0 having minting NFT from shared category
        bytes masterCategory = 0x64c9ea104e07d9099bc3cdcb2a0035286773790c40dbcb0ae67068b1b8453748;
        require(tx.inputs[0].tokenCategory == masterCategory + 0x02);  // Other contract has minting NFT
    }
}

// CONTRACT B: Extension contract (deployed alongside)
contract ExtensionContract() {
    function extendedLogic() {
        require(this.activeInputIndex == 0);  // This is input 0
        bytes masterCategory = 0x64c9ea104e07d9099bc3cdcb2a0035286773790c40dbcb0ae67068b1b8453748;
        require(tx.inputs[0].tokenCategory == masterCategory + 0x02);  // Has minting NFT
        require(tx.inputs[1].tokenCategory == masterCategory + 0x02);  // Primary also has minting NFT
        // Now both contracts trust each other
    }
}
```

**Trust mechanism**:
1. Deploy contracts together, share same minting NFTs
2. Minting NFTs (0x02 capability) should NEVER exist outside trusted contracts
3. Contract verifies other input has minting NFT = trusted partner
4. `this.activeInputIndex` determines which contract executes

**Use cases**:
- Plugin/extension architecture
- Protocol upgrades without migration
- Cross-contract composability
- Shared state management

**CRITICAL**: This pattern requires careful deployment. Minting NFTs are the "keys to the kingdom". Never let them escape to untrusted addresses.

## IMPLICIT NFT BURNING

**NFTs are burned by NOT including them in transaction outputs**. This is a fundamental UTXO pattern:

```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Stop a campaign after deadline. Burns campaign NFT if no pledges.
//
//inputs:
//  0   helperMasterNFT           [NFT]       (from Stop contract)
//  1   campaignNFT               [NFT]       (from Main contract)
//  2   creatorBCH                [BCH]       (from campaign creator)
//outputs:
//  0   helperMasterNFT           [NFT]       (to Stop contract)
//  1   campaignNFT {if pledges}  [NFT]       (to Main contract)
//  ?   creatorBCH                [BCH]       (to campaign creator)
//////////////////////////////////////////////////////////////////////////////////////////
function stop() {
    require(this.activeInputIndex == 0);
    require(tx.inputs.length == 2);

    // Recreate masterNFT (input 0)
    require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
    require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
    // ... other validations

    if (tx.inputs[1].value == 1000) {  // No pledges made
        require(tx.outputs.length == 1);  // ONLY masterNFT recreated
        // Campaign NFT (input 1) is IMPLICITLY BURNED - not in any output!
    } else {
        // Recreate campaign NFT with modified state
        require(tx.outputs[1].lockingBytecode == tx.inputs[1].lockingBytecode);
        // ...
    }
}
```

**Key insight**: In UTXO model, anything not explicitly recreated is destroyed. Use output count to control burn behavior.

## NFT CAPABILITY AS STATE MACHINE

**Token capabilities encode contract state, not just permissions**:

```
MINTING (0x02)     →    MUTABLE (0x01)      →    IMMUTABLE (0x)
Active state            Stopped state            Final state
Can modify freely       Can modify once more     Proof/receipt only

Examples:
- Active campaign       - Cancelled campaign     - Receipt NFT
- Master controller     - Restricted campaign    - Proof of pledge
```

**State transition pattern:**
```cashscript
// Downgrade from minting to mutable (stop/cancel campaign)
require(tx.outputs[1].tokenCategory == tx.inputs[1].tokenCategory.split(32)[0] + 0x01);

// Downgrade from minting to immutable (create receipt)
require(tx.outputs[1].tokenCategory == tx.inputs[0].tokenCategory.split(32)[0]);  // No capability byte

// Verify state
bytes category, bytes capability = tx.inputs[1].tokenCategory.split(32);
require(capability == 0x02);  // Must be minting (active)
require(capability != 0x);     // Must NOT be immutable (receipt)
```

**State machine benefits**:
- Capability = State indicator visible to all contracts
- Irreversible state transitions (can't upgrade capability)
- Receipt NFTs are permanent proof of action

## RECEIPT NFT PATTERN

**Immutable NFTs serve as cryptographic receipts/proofs**:

```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Accept a pledge from a backer. Issues an immutable receipt NFT as proof.
//
//inputs:
//  0   masterNFT                 [NFT]       (from Manager contract)
//  1   backerBCH                 [BCH]       (from backer)
//  2   campaignNFT               [NFT]       (from Main contract)
//outputs:
//  0   masterNFT                 [NFT]       (to Manager contract)
//  1   pledgeReceipt             [NFT]       (to backer)
//  2   campaignNFT               [NFT]       (to Main contract)
//  3   change {optional}         [BCH]       (to backer)
//////////////////////////////////////////////////////////////////////////////////////////
function pledge(int pledgeAmount) {
    // ... validation ...

    // Create IMMUTABLE receipt NFT (proof of pledge)
    require(tx.outputs[1].tokenCategory == tx.inputs[0].tokenCategory.split(32)[0]);  // No capability
    require(tx.outputs[1].lockingBytecode == tx.inputs[1].lockingBytecode);  // To user
    require(tx.outputs[1].value == 1000);  // Dust
    require(tx.outputs[1].tokenAmount == 0);  // No fungible tokens

    // Receipt contains proof data
    require(tx.outputs[1].nftCommitment ==
        bytes6(pledgeAmount) +      // What was pledged
        bytes21(0) +                // Padding
        endBlock +                  // Campaign deadline
        bytes4(pledgeID) +          // Unique pledge ID
        campaignID                  // Which campaign
    );
}

//////////////////////////////////////////////////////////////////////////////////////////
//  Refund a backer after campaign failure. Validates receipt NFT authenticity.
//
//inputs:
//  0   helperMasterNFT           [NFT]       (from Refund contract)
//  1   campaignNFT               [NFT]       (from Main contract)
//  2   pledgeReceipt             [NFT]       (from backer)
//  3   backerBCH                 [BCH]       (from backer)
//outputs:
//  0   helperMasterNFT           [NFT]       (to Refund contract)
//  1   campaignNFT               [NFT]       (to Main contract)
//  2   refundPayment             [BCH]       (to backer)
//////////////////////////////////////////////////////////////////////////////////////////
function refund() {
    bytes category2, bytes capability2 = tx.inputs[2].tokenCategory.split(32);
    require(category2 == masterCategory);  // Same token family
    require(capability2 == 0x);             // MUST be immutable (receipt)

    bytes campaignID = tx.inputs[1].nftCommitment.split(35)[1];
    bytes refundID = tx.inputs[2].nftCommitment.split(35)[1];
    require(campaignID == refundID);  // Receipt matches campaign

    int pledgeAmount = int(tx.inputs[2].nftCommitment.split(6)[0]);
    // Process refund based on receipt...
}
```

**Use cases**: Pledge receipts, voting proofs, subscription tickets, access tokens

## VALUE-BASED STATE DETECTION

**Satoshi amount can indicate contract state**:

```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Cancel a campaign before deadline. Behavior depends on whether pledges exist.
//
//inputs:
//  0   helperMasterNFT           [NFT]       (from Cancel contract)
//  1   campaignNFT               [NFT]       (from Main contract)
//  2   creatorBCH                [BCH]       (from campaign creator)
//outputs:
//  0   helperMasterNFT           [NFT]       (to Cancel contract)
//  1   campaignNFT {if pledges}  [NFT]       (to Main contract)
//  1   creatorBCH                [BCH]       (to campaign creator)
//  2   creatorBCH {if pledges}   [BCH]       (to campaign creator)
//////////////////////////////////////////////////////////////////////////////////////////
function cancel() {
    // Initial campaign has exactly 1000 sats (dust for existence)
    // After pledges, value increases

    if (tx.inputs[1].value == 1000) {  // No pledges = initial state
        // Burn campaign, refund user
        require(tx.outputs.length == 2);
        require(tx.outputs[1].value == tx.inputs[2].value);

    } else {  // Has pledges = modified state
        // Preserve campaign with downgraded capability
        require(tx.outputs[1].value == tx.inputs[1].value - 1000);
        require(tx.outputs[2].value == tx.inputs[2].value);
    }
}
```

**Patterns**:
- `value == 1000`: Initial/empty state (dust only)
- `value > initial`: Modified state (has accumulated funds)
- `value <= pledgeAmount`: Last pledge (will empty contract)

**Key insight**: BCH value is part of contract state. Design initial values to be identifiable.

## SERVICE PROVIDER FEE PATTERNS

**Built-in protocol monetization for frontends**:

```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Initialize a new campaign with optional service provider fee.
//
//inputs:
//  0   masterNFT                 [NFT]       (from Manager contract)
//  1   creatorBCH                [BCH]       (from campaign creator)
//outputs:
//  0   masterNFT                 [NFT]       (to Manager contract)
//  1   campaignNFT               [NFT]       (to Main contract)
//  2   serviceFee {optional}     [BCH]       (to service provider)
//  ?   change {optional}         [BCH]       (to campaign creator)
//////////////////////////////////////////////////////////////////////////////////////////
function initialize(bytes20 servicePKH, int serviceFee) {
    require(serviceFee <= 1000000);  // Max 0.01 BCH absolute cap
    require(tx.outputs[2].lockingBytecode == new LockingBytecodeP2PKH(servicePKH));
    require(tx.outputs[2].value == serviceFee);
    require(tx.outputs[2].tokenCategory == 0x);  // Pure BCH
}

//////////////////////////////////////////////////////////////////////////////////////////
//  Claim successful campaign funds with capped service provider fee.
//
//inputs:
//  0   helperMasterNFT           [NFT]       (from Claim contract)
//  1   campaignNFT               [NFT]       (from Main contract)
//  2   creatorBCH                [BCH]       (from campaign creator)
//outputs:
//  0   helperMasterNFT           [NFT]       (to Claim contract)
//  1   campaignFunds             [BCH]       (to campaign creator)
//  2   serviceFee                [BCH]       (to service provider)
//////////////////////////////////////////////////////////////////////////////////////////
function claim(bytes20 servicePKH, int serviceFee) {
    // Integer percentage: value * numerator / denominator
    require(serviceFee <= tx.inputs[1].value * 50 / 1000);  // Max 5% of campaign

    require(tx.outputs[2].lockingBytecode == new LockingBytecodeP2PKH(servicePKH));
    require(tx.outputs[2].value == serviceFee);
    require(tx.outputs[2].tokenCategory == 0x);
}
```

**Percentage math patterns**:
- `value * 50 / 1000` = 5%
- `value * 10 / 1000` = 1%
- `value * 1 / 100` = 1%
- `value / 100` = 1% (simplest)

**Benefits**: Incentivizes frontend development, decentralizes service provision

## MULTI-CONTRACT DEPLOYMENT PATTERNS

**Complex protocols require coordinated contract deployment**:

```cashscript
// CONTRACT 1: Manager (creates campaigns)
contract Manager() {
    function initialize() {
        // Hardcode target contract address at compile time
        require(tx.outputs[1].lockingBytecode ==
            new LockingBytecodeP2SH32(0xe3cab0f5a4aa3b8898d4708dbfa3b4126a723d5d982ac4c2691e33841fa8371f));
    }
}

// CONTRACT 2: Main (holds campaigns)
contract Main() {
    function externalFunction() {
        require(this.activeInputIndex == 1);  // I am input 1
        require(tx.inputs[0].tokenCategory == masterCategory + 0x02);  // Trust input 0
    }
}

// CONTRACT 3-N: Helpers (cancel, claim, refund, stop)
contract Helper() {
    function action() {
        // Each helper has its OWN masterNFT
        require(tx.inputs[0].nftCommitment.split(35)[1] == 0xFFFFFFFFFF);  // Sentinel ID
        // Main contract NFT is input 1
        require(tx.inputs[1].tokenCategory == masterCategory + 0x02);
    }
}
```

**Distributed masterNFT pattern**:
- Each contract in system gets ONE masterNFT with sentinel ID (0xFFFFFFFFFF)
- MasterNFTs stay in their respective contracts forever
- Contracts identify each other by shared token category
- Sentinel value distinguishes master from data NFTs

**Deployment checklist**:
1. Deploy all contracts (get P2SH32 addresses)
2. Hardcode addresses in source where needed
3. Recompile with addresses
4. Create token category (genesis transaction)
5. Mint masterNFTs for each contract
6. Send masterNFTs to their contracts

**CRITICAL**: Contracts are immutable after deployment. All inter-contract addresses must be correct at compile time.

## PERMISSIONLESS (CONSTRAINT-ONLY) CONTRACTS

**Some protocols require NO authorization at all**. Anyone can execute if they construct valid transactions:

```cashscript
// BCHess: ZERO signatures, ZERO authorization checks
contract King() {  // Empty constructor
    function move() {
        // No checkSig, no UTXO ownership check
        // Pure constraint validation only

        int turnCounter = int(tx.inputs[2].nftCommitment);
        int colorTurn = turnCounter % 2;  // Whose turn is it?

        // Verify source piece belongs to current team
        byte sourceTeam = tx.inputs[3].nftCommitment.split(6)[1].split(1)[0];
        require(int(sourceTeam) == colorTurn);

        // Validate movement rules (king moves 1 square any direction)
        require(abs(deltaX) <= 1 && abs(deltaY) <= 1);
        require(deltaX != 0 || deltaY != 0);  // Must actually move
    }
}
```

**When to use permissionless contracts:**
- Games (chess, checkers) - state determines valid moves
- Public goods - anyone can contribute/participate
- Open protocols - no gatekeeping required
- Deterministic state machines - rules enforce validity

**Key insight**: Authorization via constraints, not signatures. If transaction structure is valid, the action is valid.

## STATELESS LOGIC CONTRACTS

**Separate validation logic from state management**. Logic contracts have NO constructor parameters:

```cashscript
// STATE CONTRACT: Holds and manages data
contract ChessMaster(bytes squareCategory, bytes pieceCategory) {
    function move() {
        // Validate state transitions
        int turnCounter = int(tx.inputs[2].nftCommitment);
        int newTurnCounter = turnCounter + 1;
        require(tx.outputs[2].nftCommitment == bytes8(newTurnCounter));
    }
}

// LOGIC CONTRACT: Pure validation rules (NO constructor params)
contract Pawn() {  // Empty!
    function move() {
        // ONLY validates movement rules
        byte piece = tx.inputs[3].nftCommitment.split(7)[1].split(1)[0];
        require(piece == 0x01);  // Must be pawn

        // Forward movement validation
        require(deltaX == 0 && deltaY == 1);  // One square forward
    }
}
```

**Benefits:**
- **Modularity**: Add new piece types without changing state contract
- **Reusability**: Same logic contract used across multiple games
- **Testability**: Logic isolated from state management
- **Upgradability**: Deploy new logic contract, same state

**Pattern**: State contracts embed category IDs. Logic contracts are pure validators.

## UTXO ORDERING AS DATA STRUCTURE

**Input position in transaction encodes information**. Sequential UTXOs represent paths or sequences:

```cashscript
// BCHess: Rook movement path validation
// Inputs represent: source -> empty squares -> destination

function checkEmpty() {
    // Get previous square coordinates
    byte prevX = tx.inputs[this.activeInputIndex - 1].nftCommitment.split(4)[1].split(1)[0];
    byte prevY = tx.inputs[this.activeInputIndex - 1].nftCommitment.split(5)[1].split(1)[0];

    // Get current square coordinates
    byte thisX = tx.inputs[this.activeInputIndex].nftCommitment.split(4)[1].split(1)[0];
    byte thisY = tx.inputs[this.activeInputIndex].nftCommitment.split(5)[1].split(1)[0];

    // Get next square coordinates
    byte nextX = tx.inputs[this.activeInputIndex + 1].nftCommitment.split(4)[1].split(1)[0];
    byte nextY = tx.inputs[this.activeInputIndex + 1].nftCommitment.split(5)[1].split(1)[0];

    // Verify stepping pattern (must maintain direction)
    int stepToPrevX = int(thisX) - int(prevX);
    int stepToNextX = int(nextX) - int(thisX);
    require(stepToPrevX == stepToNextX);  // Same direction

    // Verify this square is empty
    byte currentTeam = tx.inputs[this.activeInputIndex].nftCommitment.split(6)[1].split(1)[0];
    require(currentTeam == 0x02);  // Empty square
}
```

**Use cases:**
- Path validation (chess pieces moving through squares)
- Sequential approval chains
- Multi-step processes
- Graph traversal validation

**Critical pattern**: `tx.inputs[this.activeInputIndex ± 1]` accesses neighboring inputs.

## DISTRIBUTED STATE ACROSS MULTIPLE UTXOs

**Complex state split across many NFTs**. BCHess uses 64 UTXOs for chess board:

```cashscript
// Each square NFT commitment (8 bytes):
// [startingTeam(1) + startingPiece(1) + x(1) + y(1) + currentTeam(1) + currentPiece(1)]

// Square 0,0 (white rook): 0x00040000 + 0x0004 (white, rook at start; white, rook now)
// Square 3,4 (empty):      0x02000304 + 0x0200 (empty at start; empty now)

function reset() {
    // After king capture, reset ALL 64 squares in one transaction
    require(tx.inputs.length == 66);   // ChessMaster + user + 64 squares
    require(tx.outputs.length == 66);

    // Each square resets to starting configuration
    bytes teamPiece, bytes xy = tx.inputs[this.activeInputIndex].nftCommitment.split(2);
    require(tx.outputs[this.activeInputIndex].nftCommitment == teamPiece + xy + teamPiece);
}
```

**Immutable + Mutable in one NFT:**
```
Bytes 0-3: Immutable (starting position, coordinates)
Bytes 4-5: Mutable (current state)
```
Immutable fields enable reset to known good state.

**Benefits:**
- Parallel state updates (all squares in one tx)
- Granular state tracking
- Reset via immutable field copying
- Distributed validation load

## CONSTRUCTOR PARAMETERS AS TRUST ANCHORS

**Embed token category IDs at compile time** for cross-contract validation:

```cashscript
contract Squares(
    bytes chessMasterCategory01,  // Category ID embedded at deployment
    bytes squareCategory01,
    bytes pieceCategory00
) {
    function move() {
        // Validate other contracts by embedded category IDs
        require(tx.inputs[1].tokenCategory == pieceCategory00);          // Piece logic
        require(tx.inputs[2].tokenCategory == chessMasterCategory01);   // Game master
        require(tx.inputs[3].tokenCategory == squareCategory01);        // Source square

        // Multiple validation layers via constructor params
        bytes srcCategory = tx.inputs[3].tokenCategory.split(32)[0];
        require(srcCategory == squareCategory01.split(32)[0]);
    }
}
```

**Trust anchor flow:**
1. Deploy all contracts (get addresses)
2. Create token categories (genesis txs)
3. Recompile contracts with category IDs in constructors
4. Deploy with embedded trust anchors
5. Contracts validate each other by hardcoded categories

**Key insight**: Constructor parameters are compile-time constants that enable trustless cross-contract validation.

## VARIABLE-LENGTH INPUT PATTERNS

**Dynamic input counts for arbitrary-length operations**:

```cashscript
function move() {
    // Minimum inputs: user + piece + master + source + destination
    require(tx.inputs.length >= 5);

    // Can have more for longer paths (rook, bishop, queen)
    // Each additional input is an empty square along the path

    // Process all inputs between source and destination
    int i = 4;  // Start after source square
    do {
        // Validate each intermediate square is empty
        byte team = tx.inputs[i].nftCommitment.split(6)[1].split(1)[0];
        require(team == 0x02);  // Empty
        i = i + 1;
    } while (i < tx.inputs.length - 1);  // Stop before destination

    // Last input is always destination
    bytes destCommitment = tx.inputs[tx.inputs.length - 1].nftCommitment;
}
```

**Patterns:**
- `tx.inputs.length` for conditional logic
- `tx.inputs[tx.inputs.length - 1]` for last input
- Loop through variable number of inputs
- Different path lengths for different operations

**Use cases:**
- Movement paths of varying length
- Multi-signature with variable signers
- Batch operations
- Chain validation with arbitrary depth

## FUNCTION VISIBILITY & AUTHORIZATION

**CRITICAL**: CashScript has NO visibility modifiers (public/private/internal/external).

**All functions are callable by anyone** who can construct a valid transaction. Access control must be explicit via `require` statements.

| Solidity | CashScript | Notes |
|----------|-----------|-------|
| `public` | All functions | No keyword - all functions exposed |
| `private` | Authorization pattern | Gate with signature OR UTXO ownership check |
| `internal` | N/A | No contract inheritance in CashScript |
| `external` | All functions | All functions externally callable |
| `view/pure` | N/A | All validation on-chain, no read-only functions |

### Authorization Pattern 1: Signature-Based (Explicit)
```cashscript
contract SignatureAuth(pubkey ownerPk) {
    function ownerOnly(sig s) {
        require(checkSig(s, ownerPk));  // Must prove key ownership
        // ... restricted logic
    }
}
```
**Use when**: Known fixed set of authorized keys (admin, oracle)

### Authorization Pattern 2: UTXO-Based (Implicit) - PRODUCTION PREFERRED
```cashscript
contract UTXOAuth() {
    function userAction(bytes20 userPkh) {
        // NO signature check needed!
        // User proves ownership by spending their UTXO
        require(tx.inputs[1].lockingBytecode == new LockingBytecodeP2PKH(userPkh));
        // ... action authorized by UTXO ownership
    }
}
```
**Use when**: Any user can participate, authorization via UTXO spending

### Authorization Pattern 3: Commitment-Stored Admin
```cashscript
contract CommitmentAuth() {
    function adminOnly() {
        // Admin pubkeyhash stored in NFT commitment
        bytes20 adminPkh = bytes20(tx.inputs[0].nftCommitment.split(20)[1]);
        bytes adminBytecode = new LockingBytecodeP2PKH(adminPkh);
        require(tx.inputs[1].lockingBytecode == adminBytecode);  // Admin must provide input
    }
}
```
**Use when**: Admin changeable, stored in contract state

### Critical: `this.activeInputIndex` Validation
```cashscript
function anyFunction() {
    // ALWAYS validate which input executes the contract
    require(this.activeInputIndex == 0);  // Contract must be input 0
    require(tx.inputs.length == 2);        // Exact input count
    // ... rest of logic
}
```
**Why critical**: Multi-input transactions can have different contracts executing. This ensures your contract code runs as expected input position.

**Key insight**: UTXO-based authorization is more flexible and gas-efficient than signature-based. User proves they control funds by spending them.

## OPERATORS

| Category | Operators | Valid Types | Notes |
|----------|-----------|-------------|-------|
| Arithmetic | `+ - * / %` | `int` | Integer only, div/0 fails |
| Comparison | `< <= > >= == !=` | `int` `bool` `bytes` `string` | - |
| Logical | `! && ||` | `bool` | NO short-circuit (all operands evaluated) |
| Bitwise | `& | ^` | `bytes` only | AND, OR, XOR only. NOT supported on int. No shift or invert |
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
// Supported: AND, OR, XOR (on bytes ONLY, NOT int)
bytes flags = 0xFF;
bytes masked = flags & 0x0F;     // AND for masking
bytes combined = a | b;          // OR for combining
bytes toggled = a ^ b;           // XOR for toggling

// For bit flag validation, use bytes types:
bytes1 configFlags = 0x05;       // Example: active=1, paused=0, borrowEnabled=1
require((configFlags & 0x01) == 0x01);  // Check bit 0 is set
require((configFlags & 0x04) == 0x00);  // Check bit 2 is clear
```
**Note**: CashScript does NOT support:
- Bitwise operators on `int` types (use `bytes` instead)
- Shift operators (`<<`, `>>`)
- Bitwise NOT (`~`)

### Array Bounds
```cashscript
// ALWAYS validate length before access
require(tx.outputs.length > index);
require(tx.outputs[index].value >= amount);
```

## MASTER EXAMPLE

**Production-grade contract demonstrating real-world patterns:**

```cashscript
pragma cashscript ^0.13.0;

// PRODUCTION PATTERN: Empty constructor with hardcoded values (common for deployed contracts)
contract MasterReference() {

    // PATTERN 1: Stateful NFT Management with Structured Commitment
    // Input layout: [0] masterNFT (from contract), [1] userUTXO (from user)
    // Output layout: [0] masterNFT (to contract), [1] lockNFT (to contract), [2] optional change
    function lock(int amount, int lockBlocks, bytes20 userPkh) {
        // CRITICAL: Always validate this contract is the expected input
        require(this.activeInputIndex == 0);

        // CRITICAL: Exact input/output validation (not >=, exact counts)
        require(tx.inputs.length == 2);
        require(tx.outputs.length <= 3);

        // Business logic constraints
        require(lockBlocks <= 65536);
        require(amount >= 5000);  // Minimum dust for unlock fees

        // PATTERN: Hardcoded token category + capability check
        bytes masterCategory = 0xd7ff0a63d5c1cbe1ced509314fe3caca563a73095be37734744c40dbce6e2f24;
        require(tx.inputs[0].tokenCategory == masterCategory + 0x02);  // Must be minting NFT
        require(tx.inputs[1].tokenCategory == 0x);  // User input must be pure BCH

        // PATTERN: UTXO-based authorization (NO checkSig needed!)
        // User proves ownership by spending their UTXO
        require(tx.inputs[1].lockingBytecode == new LockingBytecodeP2PKH(userPkh));

        // PATTERN: Structured 128-byte commitment packing
        // Layout: userPkh(20) + reserved(18) + lockBlocks(2) = 40 bytes
        bytes lockLength = bytes2(lockBlocks);
        require(tx.outputs[1].nftCommitment == userPkh + bytes18(0) + lockLength);

        // PATTERN: Read fee from master NFT commitment (first 2 bytes)
        bytes2 stakeFee = bytes2(tx.inputs[0].nftCommitment.split(2)[0]);

        // PATTERN: Contract self-preservation with fee collection
        require(tx.outputs[0].value == tx.inputs[0].value + int(stakeFee));
        require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
        require(tx.outputs[0].nftCommitment == tx.inputs[0].nftCommitment);

        // PATTERN: Calculate rewards and deduct from master
        int reward = amount * lockBlocks / 100000000;
        require(reward >= 1);
        require(tx.outputs[0].tokenAmount == tx.inputs[0].tokenAmount - reward);

        // PATTERN: Create child NFT with different capability
        // Strip minting capability (32 bytes), add mutable (0x01)
        require(tx.outputs[1].lockingBytecode == tx.inputs[0].lockingBytecode);
        require(tx.outputs[1].tokenCategory == tx.inputs[0].tokenCategory.split(32)[0] + 0x01);
        require(tx.outputs[1].value == amount);
        require(tx.outputs[1].tokenAmount == reward);

        // PATTERN: Optional output handling
        if (tx.outputs.length == 3) {
            require(tx.outputs[2].lockingBytecode == tx.inputs[1].lockingBytecode);
            require(tx.outputs[2].tokenCategory == 0x);  // Change must be pure BCH
        }
    }

    // PATTERN 2: Time-locked redemption with commitment unpacking
    function unlock() {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length == 1);
        require(tx.outputs.length == 3);

        bytes masterCategory = 0xd7ff0a63d5c1cbe1ced509314fe3caca563a73095be37734744c40dbce6e2f24;
        require(tx.inputs[0].tokenCategory == masterCategory + 0x01);  // Must be mutable NFT

        // PATTERN: Unpack structured commitment
        // Layout: userPkh(20) + reserved(18) + lockBlocks(2)
        bytes stakeBlocks = bytes2(tx.inputs[0].nftCommitment.split(38)[1]);
        require(tx.age >= int(stakeBlocks));  // Time lock validation

        bytes20 payoutAddress = bytes20(tx.inputs[0].nftCommitment.split(20)[0]);
        bytes payoutBytecode = new LockingBytecodeP2PKH(payoutAddress);

        // PATTERN: Distribute tokens to user
        require(tx.outputs[0].lockingBytecode == payoutBytecode);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory.split(32)[0]);  // Strip to immutable
        require(tx.outputs[0].value == 1000);  // Dust for token UTXO
        require(tx.outputs[0].tokenAmount == tx.inputs[0].tokenAmount);

        // PATTERN: Create receipt NFT with computed commitment
        require(tx.outputs[1].lockingBytecode == payoutBytecode);
        require(tx.outputs[1].tokenCategory == tx.inputs[0].tokenCategory.split(32)[0]);
        require(tx.outputs[1].value == 1000);
        bytes commitment = 0x0000 + bytes(tx.inputs[0].tokenAmount);
        require(tx.outputs[1].nftCommitment == commitment);

        // PATTERN: Fee accounting (explicit dust subtraction)
        require(tx.outputs[2].lockingBytecode == payoutBytecode);
        require(tx.outputs[2].tokenCategory == 0x);
        require(tx.outputs[2].value == tx.inputs[0].value - 3000);  // Miner fee + dust UTXOs
    }

    // PATTERN 3: Admin function with UTXO-based authorization
    function withdraw(int newFee) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length == 2);
        require(tx.outputs.length == 2);

        bytes masterCategory = 0xd7ff0a63d5c1cbe1ced509314fe3caca563a73095be37734744c40dbce6e2f24;
        require(tx.inputs[0].tokenCategory == masterCategory + 0x02);
        require(tx.inputs[1].tokenCategory == 0x);

        // PATTERN: Admin authorization via commitment-stored pubkeyhash
        bytes20 adminAddress = bytes20(tx.inputs[0].nftCommitment.split(20)[1]);
        bytes payoutBytecode = new LockingBytecodeP2PKH(adminAddress);
        require(tx.inputs[1].lockingBytecode == payoutBytecode);  // Admin must provide input1

        // PATTERN: Withdraw accumulated fees
        require(tx.outputs[1].tokenCategory == 0x);
        require(tx.outputs[1].value == tx.inputs[0].value + tx.inputs[1].value - 2000);

        // PATTERN: Update commitment state (modify first N bytes, preserve rest)
        require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
        require(tx.outputs[0].value == 1000);
        require(tx.outputs[0].tokenAmount == tx.inputs[0].tokenAmount);
        bytes restCommitment = tx.inputs[0].nftCommitment.split(2)[1];
        require(tx.outputs[0].nftCommitment == bytes2(newFee) + restCommitment);
    }
}
```

**Key Production Patterns Demonstrated:**
1. **`this.activeInputIndex`** - Always validate which input is executing the contract
2. **Exact counts** - Use `==` not `>=` for input/output validation
3. **UTXO authorization** - Prove ownership by spending UTXOs, not signatures
4. **Structured commitments** - Pack multiple values into 128-byte commitment with clear layout
5. **Capability manipulation** - `.split(32)[0] + 0x01` to change NFT capabilities
6. **Fee accounting** - Explicit dust (1000 sats) and fee subtraction
7. **Optional outputs** - Use `if` blocks for variable output counts

## UNSUPPORTED SOLIDITY FEATURES

**CRITICAL**: CashScript is stack-based, not storage-based. Many Solidity concepts do not exist.

| Solidity Feature | CashScript | Notes |
|-----------------|-----------|-------|
| `import` | N/A | No code modularity - single file contracts only |
| `interface/abstract` | N/A | No abstract contracts or interfaces |
| `library` | N/A | No reusable library contracts |
| `enum` | int constants | Use `int` values: `int PENDING = 0; int ACTIVE = 1;` |
| `struct` | bytes + `.split()` | Pack data into bytes, unpack with split() |
| `mapping` | NFT commitments | NO O(1) lookups - fundamentally different model |
| `storage/memory/calldata` | N/A | Stack-based execution, no data locations |
| `assert` | `require()` | Single error handler, no assert/revert distinction |
| `revert` | `require()` | Transaction fails if require() is false |
| `tx.origin` | N/A | No transaction originator - signature-based authorization |
| `address` | `bytes20` or `pubkey` | Hash160 for addresses, pubkey for keys |
| `constant` keyword | Literals only | Constructor params are immutable per UTXO |
| `++/--/+=` | Manual operations | `x = x + 1;` not `x++;` |
| `for/while` loops | `do {} while()` | Beta in v0.13.0, body executes first |

**Key paradigm shifts:**
- **No persistent state** - State lives in NFT commitments (128 bytes)
- **No O(1) lookups** - Must loop over UTXOs, no hash tables
- **No code reuse** - No import/library/inheritance mechanisms
- **Fee = tx size** - Cost based on bytes, not opcodes (no "gas optimization")
- **Stack-based** - All operations ephemeral, no storage slots

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
- NFT commitment: max 128 bytes (since May 2025 upgrade)
- String/bytes operations: `.split(index)` returns tuple, requires destructuring
- Bitwise operators: Only `&`, `|`, `^` supported. NO shift (`<<`, `>>`) or invert (`~`)
- Loops: `do {} while ()` syntax, beta in CashScript 0.13.0. Body executes at least once
- Token category byte order: Returned in unreversed order
- Compound assignment: NOT supported (`+=`, `-=`, etc.)

### Best Practices for AI Agents
- **DATA STORAGE**: Use NFT commitments for persistent state, NOT OP_RETURN (which is unspendable)
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

## PROFESSIONAL CONTRACT DOCUMENTATION

**MANDATORY**: ALL CashScript contracts MUST include professional documentation following BCHess production standards.

### NFT STATE DOCUMENTATION BLOCK

**Location**: BEFORE contract declaration
**Format**:
```cashscript
/*  --- [ContractName] [Mutable/Immutable] NFT State ---
    [type] [variableName] = [defaultValue]        // [optional comment]
*/
```

**Rules**:
- Use "**Mutable**" if contract modifies `nftCommitment` during execution
- Use "**Immutable**" if contract has fixed parameters only (constructor params)
- Use "**none**" if no NFT state exists in the contract
- List ALL state variables with types and default values
- Add inline comments for enum-style values

**BCHess Examples**:

```cashscript
/*  --- ChessMaster Mutable NFT State ---
    bytes8 turnCounter = 0x0000000000000000
    byte deadKing = 0x00
*/

/*  --- Squares Mutable NFT State ---
    byte startingTeam = 0x00
    byte startingPiece = 0x00
    bytes2 x = 0x0000
    bytes2 y = 0x0000
    byte team = 0x00            // 0x00 white, 0x01 black, 0x02 empty
    byte pieceType = 0x00       // 0x01 pawn, 0x02 knight, 0x03 bishop, 0x04 rook, 0x05 queen, 0x06 king
*/

/*  --- King Immutable NFT State ---
    none
*/
```

**CashStarter Example**:
```cashscript
/*  --- Campaign Mutable NFT State ---
    bytes4 pledgeCount = 0x00000000
    bytes6 totalPledged = 0x000000000000        // Satoshis pledged
    bytes4 deadline = 0x00000000                 // Block height deadline
    byte status = 0x00                           // 0x00 active, 0x01 funded, 0x02 refunding
*/
```

### FUNCTION DOCUMENTATION BLOCK

**Location**: BEFORE each function declaration
**Format**:
```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  [Brief description of what the function does and why]
//
//inputs:
//  [idx]   [Name]                [TYPE]      (from [source])
//  ...
//outputs:
//  [idx]   [Name]                [TYPE]      (to [destination])
//  ...
//////////////////////////////////////////////////////////////////////////////////////////
function functionName(...) { }
```

**Separator Rules**:
- Use forward slashes (`/`) for header and footer separators
- **Dynamic length**: Minimum 78 characters, extend to match longest line if needed
- Count from start of comment to end of longest input/output line
- Maintain visual balance and readability

**Column Alignment**:
- **Index**: Position 4 after `//  ` (2 spaces after comment marker)
- **Name**: Align at column ~30 (pad with spaces)
- **Type**: Align at column ~42 (in brackets `[TYPE]`)
- **Source/Destination**: After type, in parentheses

**Index Notation**:
- **Fixed positions**: `0`, `1`, `2`, `3`, etc. - Explicit numeric indexes
- **Variable quantity**: `?` - Optional or variable number of inputs/outputs
- **Last position**: `N` - Calculated last index (when total is variable)
- **Ranges**: `2-65` - Multiple sequential UTXOs
- **Optional elements**: Add `{optional}` tag to name

**Type Annotations**:
- `[NFT]` - Non-fungible token (CashTokens NFT)
- `[BCH]` - Pure satoshi UTXO (no tokens)
- `[FT]` - Fungible tokens (if applicable)

**Source/Destination Notation**:
- **Format**: `(from [location])` and `(to [location])`
- **Locations**: Contract name, "user", "P2PKH address", etc.
- **ALWAYS specify** - Never leave blank

**BCHess Examples**:

```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Reset all squares to new game state.
//
//inputs:
//  0       ChessMaster         [NFT]       (from ChessMaster contract)
//  1       userBCH             [BCH]       (from user)
//  2-65    Squares             [NFT]       (from Squares contract)
//outputs:
//  0       ChessMaster         [NFT]       (to ChessMaster contract)
//  1       userBCH             [BCH]       (to user)
//  2-65    Squares             [NFT]       (to Squares contract)
//////////////////////////////////////////////////////////////////////////////////////////
function reset() { ... }

//////////////////////////////////////////////////////////////////////////////////////////
//  Move a piece, overwrites any existing piece on the destination square.
//
//inputs:
//  0   userBCH                   [BCH]       (from user)
//  1   PieceLogic                [NFT]       (from PieceLogic contract)
//  2   ChessMaster               [NFT]       (from ChessMaster contract)
//  3   SourceSquare              [NFT]       (from Squares contract)
//  ?   CheckEmptySquare(s)       [NFT]       (from Squares contract)
//  N   DestinationSquare         [NFT]       (from Squares contract)
//outputs:
//  0   userBCH                   [BCH]       (to user)
//  1   PieceLogic                [NFT]       (to PieceLogic contract)
//  2   ChessMaster               [NFT]       (to ChessMaster contract)
//  3   SourceSquare              [NFT]       (to Squares contract)
//  ?   CheckEmptySquare(s)       [NFT]       (to Squares contract)
//  N   DestinationSquare         [NFT]       (to Squares contract)
//////////////////////////////////////////////////////////////////////////////////////////
function move() { ... }

//////////////////////////////////////////////////////////////////////////////////////////
//  Check if a square is empty. Used with non-knight pieces that move multiple squares
//  in a single move to verify they don't pass through other pieces.
//
//inputs:
//  0   PieceNFT                  [NFT]       (from PieceLogic contract)
//  1   ChessMasterNFT            [NFT]       (from ChessMaster contract)
//  2   SourceSquare              [NFT]       (from Squares contract)
//  ?   CheckEmptySquare(s)       [NFT]       (from Squares contract)
//  3   DestinationSquare         [NFT]       (from Squares contract)
//  4   userBCH                   [BCH]       (from user)
//outputs:
//  0   PieceNFT                  [NFT]       (to PieceLogic contract)
//  1   ChessMasterNFT            [NFT]       (to ChessMaster contract)
//  2   SourceSquare              [NFT]       (to Squares contract)
//  3   DestinationSquare         [NFT]       (to Squares contract)
//  4   change {optional}         [BCH]       (to user)
//////////////////////////////////////////////////////////////////////////////////////////
function checkEmpty() { ... }
```

### COMPLETE CONTRACT TEMPLATE

```cashscript
pragma cashscript ^0.13.0;

/*  --- [ContractName] [Mutable/Immutable] NFT State ---
    [type] [varName] = [default]        // [optional comment]
*/

contract [ContractName]([constructorParams]) {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  [Brief description of what this function does and why it's important]
    //
    //inputs:
    //  [0]     [InputName1]            [TYPE]      (from [source])
    //  [1]     [InputName2]            [TYPE]      (from [source])
    //  [?]     [OptionalInputs]        [TYPE]      (from [source])
    //  [N]     [LastInput]             [TYPE]      (from [source])
    //outputs:
    //  [0]     [OutputName1]           [TYPE]      (to [destination])
    //  [1]     [OutputName2]           [TYPE]      (to [destination])
    //  [N]     [LastOutput]            [TYPE]      (to [destination])
    //  [?]     [change {optional}]     [BCH]       (to user)
    //////////////////////////////////////////////////////////////////////////////////////////
    function functionName([params]) {
        require(this.activeInputIndex == 0);        // Validate which input is executing
        require(tx.inputs.length == 3);              // Fixed input count
        require(tx.outputs.length >= 2);             // Variable output count

        // Business logic with inline comments explaining WHY
        bytes nftCommitment = tx.inputs[0].nftCommitment;
        bytes4 counter = bytes4(nftCommitment.split(4)[0]);
        int newCounter = int(counter) + 1;
        require(newCounter < 2147483647);            // Prevent overflow

        // Recreate NFT with updated state
        require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
        require(tx.outputs[0].nftCommitment == bytes4(newCounter) + restOfCommitment);
        require(tx.outputs[0].value == 1000);        // Preserve dust
    }
}
```

### MULTI-CONTRACT DOCUMENTATION PATTERNS

When generating multi-contract systems, show clear UTXO flow between contracts:

**Example: Voting System with 3 Contracts**

```cashscript
// ===== CONTRACT 1: VotingBooth (PRIMARY) =====
/*  --- VotingBooth Mutable NFT State ---
    bytes4 activeVotes = 0x00000000
    byte votingOpen = 0x01
*/

contract VotingBooth() {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Cast a vote. Routes to appropriate ProposalCounter contract.
    //
    //inputs:
    //  0   votingBoothNFT            [NFT]       (from VotingBooth contract)
    //  1   voterAuth                 [BCH]       (from user)
    //  2   proposalCounter           [NFT]       (from ProposalCounter contract)
    //outputs:
    //  0   votingBoothNFT            [NFT]       (to VotingBooth contract)
    //  1   voterAuth                 [BCH]       (to user)
    //  2   proposalCounter           [NFT]       (to ProposalCounter contract)
    //////////////////////////////////////////////////////////////////////////////////////////
    function vote(int proposalId) { ... }
}

// ===== CONTRACT 2: ProposalCounter (HELPER) =====
/*  --- ProposalCounter Mutable NFT State ---
    bytes4 proposalId = 0x00000000
    bytes4 voteCount = 0x00000000
    bytes32 proposalName = 0x00...
*/

contract ProposalCounter() {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Increment vote count for this proposal.
    //
    //inputs:
    //  0   proposalNFT               [NFT]       (from ProposalCounter contract)
    //  1   votingBoothNFT            [NFT]       (from VotingBooth contract)
    //  2   voterAuth                 [BCH]       (from user)
    //outputs:
    //  0   proposalNFT               [NFT]       (to ProposalCounter contract)
    //  1   votingBoothNFT            [NFT]       (to VotingBooth contract)
    //  2   voterAuth                 [BCH]       (to user)
    //////////////////////////////////////////////////////////////////////////////////////////
    function increment() { ... }
}

// ===== CONTRACT 3: VoterRegistry (STATE) =====
/*  --- VoterRegistry Mutable NFT State ---
    bytes voterList = 0x                // Packed list of voter PKHs (20 bytes each)
*/

contract VoterRegistry() {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Add a new eligible voter to the registry.
    //
    //inputs:
    //  0   registryNFT               [NFT]       (from VoterRegistry contract)
    //  1   adminAuth                 [BCH]       (from admin)
    //outputs:
    //  0   registryNFT               [NFT]       (to VoterRegistry contract)
    //  1   adminAuth                 [BCH]       (to admin)
    //////////////////////////////////////////////////////////////////////////////////////////
    function addVoter(bytes20 voterPkh) { ... }
}
```

**Example: CashStarter Crowdfunding with 6 Contracts**

```cashscript
// ===== CONTRACT 1: Manager (PRIMARY) =====
/*  --- Manager Mutable NFT State ---
    bytes4 campaignCount = 0x00000000
    bytes20 adminPkh = 0x0000000000000000000000000000000000000000
*/

contract Manager(bytes32 mainContractAddress) {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Initialize a new crowdfunding campaign. Creates campaign NFT in Main contract.
    //
    //inputs:
    //  0   managerNFT                [NFT]       (from Manager contract)
    //  1   creatorBCH                [BCH]       (from campaign creator)
    //outputs:
    //  0   managerNFT                [NFT]       (to Manager contract)
    //  1   campaignNFT               [NFT]       (to Main contract)
    //  2   serviceFee {optional}     [BCH]       (to service provider)
    //  ?   change {optional}         [BCH]       (to campaign creator)
    //////////////////////////////////////////////////////////////////////////////////////////
    function initialize(int goal, int deadline, bytes20 servicePkh, int serviceFee) { ... }
}

// ===== CONTRACT 2: Main (PRIMARY) =====
/*  --- Campaign Mutable NFT State ---
    bytes5 campaignId = 0x0000000000
    bytes6 goalAmount = 0x000000000000
    bytes4 deadline = 0x00000000                 // Block height deadline
    bytes4 pledgeCount = 0x00000000
    bytes6 totalPledged = 0x000000000000
    byte status = 0x00                           // 0x00 active, 0x01 funded, 0x02 cancelled
    bytes20 creatorPkh = 0x0000000000000000000000000000000000000000
*/

contract Main() {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Accept a pledge from a backer. Issues an immutable receipt NFT as proof.
    //
    //inputs:
    //  0   campaignNFT               [NFT]       (from Main contract)
    //  1   backerBCH                 [BCH]       (from backer)
    //outputs:
    //  0   campaignNFT               [NFT]       (to Main contract)
    //  1   pledgeReceipt             [NFT]       (to backer)
    //  2   change {optional}         [BCH]       (to backer)
    //////////////////////////////////////////////////////////////////////////////////////////
    function pledge(bytes20 backerPkh, int pledgeAmount) { ... }
}

// ===== CONTRACT 3: Cancel (HELPER) =====
/*  --- CancelHelper Immutable NFT State ---
    bytes5 sentinelId = 0xFFFFFFFFFF           // Sentinel value identifying helper master
*/

contract Cancel() {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Cancel a campaign before deadline. Burns campaign NFT if no pledges exist.
    //
    //inputs:
    //  0   cancelMasterNFT           [NFT]       (from Cancel contract)
    //  1   campaignNFT               [NFT]       (from Main contract)
    //  2   creatorBCH                [BCH]       (from campaign creator)
    //outputs:
    //  0   cancelMasterNFT           [NFT]       (to Cancel contract)
    //  1   campaignNFT {if pledges}  [NFT]       (to Main contract)
    //  ?   creatorRefund             [BCH]       (to campaign creator)
    //////////////////////////////////////////////////////////////////////////////////////////
    function cancel() { ... }
}

// ===== CONTRACT 4: Claim (HELPER) =====
/*  --- ClaimHelper Immutable NFT State ---
    bytes5 sentinelId = 0xFFFFFFFFFF
*/

contract Claim() {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Claim successful campaign funds after reaching goal and passing deadline.
    //
    //inputs:
    //  0   claimMasterNFT            [NFT]       (from Claim contract)
    //  1   campaignNFT               [NFT]       (from Main contract)
    //  2   creatorBCH                [BCH]       (from campaign creator)
    //outputs:
    //  0   claimMasterNFT            [NFT]       (to Claim contract)
    //  1   campaignFunds             [BCH]       (to campaign creator)
    //  2   serviceFee {optional}     [BCH]       (to service provider)
    //////////////////////////////////////////////////////////////////////////////////////////
    function claim(bytes20 servicePkh, int serviceFee) { ... }
}

// ===== CONTRACT 5: Refund (HELPER) =====
/*  --- RefundHelper Immutable NFT State ---
    bytes5 sentinelId = 0xFFFFFFFFFF
*/

contract Refund() {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Refund a backer after campaign failure. Validates receipt NFT authenticity.
    //
    //inputs:
    //  0   refundMasterNFT           [NFT]       (from Refund contract)
    //  1   campaignNFT               [NFT]       (from Main contract)
    //  2   pledgeReceipt             [NFT]       (from backer)
    //  3   backerBCH                 [BCH]       (from backer)
    //outputs:
    //  0   refundMasterNFT           [NFT]       (to Refund contract)
    //  1   campaignNFT               [NFT]       (to Main contract)
    //  2   refundPayment             [BCH]       (to backer)
    //  3   change {optional}         [BCH]       (to backer)
    //////////////////////////////////////////////////////////////////////////////////////////
    function refund() { ... }
}

// ===== CONTRACT 6: Stop (HELPER) =====
/*  --- StopHelper Immutable NFT State ---
    bytes5 sentinelId = 0xFFFFFFFFFF
*/

contract Stop() {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Stop a campaign after deadline passes without reaching goal.
    //
    //inputs:
    //  0   stopMasterNFT             [NFT]       (from Stop contract)
    //  1   campaignNFT               [NFT]       (from Main contract)
    //  2   creatorBCH                [BCH]       (from campaign creator)
    //outputs:
    //  0   stopMasterNFT             [NFT]       (to Stop contract)
    //  1   campaignNFT {if pledges}  [NFT]       (to Main contract)
    //  ?   creatorRefund             [BCH]       (to campaign creator)
    //////////////////////////////////////////////////////////////////////////////////////////
    function stop() { ... }
}
```

**CashStarter System Architecture**:
- **Manager**: Creates new campaigns (primary initialization contract)
- **Main**: Core campaign logic (pledge acceptance)
- **Cancel/Claim/Refund/Stop**: Each helper has its own masterNFT with sentinel ID (0xFFFFFFFFFF)
- **UTXO Flow**: Helper contracts validate Main contract's minting NFT, enabling trustless cross-contract operations
- **Receipt Pattern**: Pledge function creates immutable NFT receipts for later refund validation

### COMMON PATTERNS BY USE CASE

**Simple Token Contract (Single UTXO)**:
```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Transfer tokens to a new owner.
//
//inputs:
//  0   tokenNFT                  [NFT]       (from Token contract)
//  1   ownerAuth                 [BCH]       (from current owner)
//outputs:
//  0   tokenNFT                  [NFT]       (to Token contract)
//  1   change {optional}         [BCH]       (to current owner)
//////////////////////////////////////////////////////////////////////////////////////////
function transfer(bytes20 newOwner) { ... }
```

**Crowdfunding (Variable Pledges)**:
```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Accept a new pledge from a backer. Updates campaign state.
//
//inputs:
//  0   campaignNFT               [NFT]       (from Campaign contract)
//  1   pledge                    [BCH]       (from backer)
//outputs:
//  0   campaignNFT               [NFT]       (to Campaign contract)
//  1   pledgeReceipt             [NFT]       (to backer)
//  2   change {optional}         [BCH]       (to backer)
//////////////////////////////////////////////////////////////////////////////////////////
function pledge(bytes20 backerPkh) { ... }
```

**Time-Locked Release**:
```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Release funds after deadline. Requires time validation.
//
//inputs:
//  0   lockedFunds               [BCH]       (from TimeRelease contract)
//outputs:
//  0   releasedFunds             [BCH]       (to beneficiary)
//////////////////////////////////////////////////////////////////////////////////////////
function release() {
    require(tx.time >= deadline);               // Enforce time lock
    ...
}
```

**Batch Operations (Variable Inputs)**:
```cashscript
//////////////////////////////////////////////////////////////////////////////////////////
//  Process multiple NFTs in a single transaction for gas efficiency.
//
//inputs:
//  0       masterNFT             [NFT]       (from Master contract)
//  1-N     batchNFTs             [NFT]       (from Batch contract)
//outputs:
//  0       masterNFT             [NFT]       (to Master contract)
//  1-N     batchNFTs             [NFT]       (to Batch contract)
//////////////////////////////////////////////////////////////////////////////////////////
function batchProcess() {
    require(tx.inputs.length >= 2);             // At least master + 1 batch
    require(tx.inputs.length <= 66);            // Max 65 batch items
    ...
}
```

### INLINE CODE COMMENTS

In addition to input/output documentation, include inline comments explaining:

**Validation Logic**:
```cashscript
require(tx.inputs[0].tokenCategory == campaignCategory);    // Verify correct campaign
require(int(weight) > 0);                                    // Must have voting rights
require(voted == 0x00);                                      // Hasn't voted yet
```

**State Transitions**:
```cashscript
bytes4 currentCount = bytes4(commitment.split(4)[0]);       // Extract counter
int newCount = int(currentCount) + 1;                       // Increment
require(newCount <= 2147483647);                             // Max bytes4 (MSB safety)
```

**Mathematical Operations**:
```cashscript
int feeAmount = pledgeValue / 100;                          // 1% fee
require(feeAmount <= 10000);                                 // Max 10k sat fee cap
int netPledge = pledgeValue - feeAmount;                    // After fee deduction
```

**NFT Recreation**:
```cashscript
require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);    // Same contract
require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);        // Same category
require(tx.outputs[0].value == 1000);                                      // Preserve dust
```

### DOCUMENTATION QUALITY CHECKLIST

Before finalizing any contract, verify:

- [ ] NFT state block present and accurate (Mutable/Immutable/none)
- [ ] All state variables listed with types and defaults
- [ ] All functions have input/output documentation
- [ ] Separator length appropriate (78+ chars, matches content)
- [ ] Column alignment correct (index @4, name @30, type @42)
- [ ] Index notation appropriate (0-N, ?, ranges)
- [ ] All inputs have type annotations ([NFT], [BCH], [FT])
- [ ] All inputs have source specification (from X)
- [ ] All outputs have destination specification (to X)
- [ ] Optional outputs marked with {optional}
- [ ] Function description explains WHAT and WHY
- [ ] Inline comments explain validation logic
- [ ] Multi-contract systems show clear UTXO flow
- [ ] Consistent terminology across related contracts

**MANDATORY FOR ALL CONTRACTS**: Every generated CashScript contract must meet ALL these documentation standards before being returned to the user.

## CONTRACT DESIGN PRINCIPLES

### The Validation Rule

**Before creating ANY contract, answer: "What does this contract validate?"**

Every CashScript contract exists to add CONSTRAINTS to a transaction. If a contract adds no constraints, it should not exist.

**Questions to ask:**
1. What would go wrong if this contract didn't exist?
2. What relationship does this contract prove?
3. What attack does this contract's validation prevent?

If you cannot answer these questions, the contract should be deleted or merged into another.

### The Minimum Viable Contract

The smallest legitimate contract is NOT empty. Even a "sidecar" contract has real validation:

```cashscript
contract MinimumViableContract() {
    function attach() {
        int mainIdx = this.activeInputIndex - 1;

        // VALIDATES: Same-transaction origin
        require(tx.inputs[this.activeInputIndex].outpointTransactionHash ==
                tx.inputs[mainIdx].outpointTransactionHash);

        // VALIDATES: Sequential creation
        require(tx.inputs[this.activeInputIndex].outpointIndex ==
                tx.inputs[mainIdx].outpointIndex + 1);

        // VALIDATES: Self-preservation
        require(tx.outputs[this.activeInputIndex].lockingBytecode ==
                tx.inputs[this.activeInputIndex].lockingBytecode);
    }
}
```

This is NOT a placeholder - it validates three critical relationships.

### What Each Contract Type Validates

| Contract Type | Core Validation Purpose |
|--------------|------------------------|
| **Main Contract** | State transitions, business logic |
| **Sidecar Contract** | Same-origin bond with main |
| **Function Contract** | Authority to execute specific operation |
| **Router Contract** | Transaction structure matches operation |
| **Oracle Contract** | External data authenticity |
| **Receipt/Proof Contract** | Immutable record of completed action |

### Anti-Placeholder Philosophy

**OLD THINKING** (wrong): "I need to implement this Solidity function in CashScript"

**NEW THINKING** (correct): "What constraint does this contract add to valid transactions?"

The shift is from:
- ~~Code structure~~ -> **Transaction structure**
- ~~Function implementation~~ -> **Constraint specification**
- ~~What code runs~~ -> **What must be true**

### Empty Contracts = Code Smell

If you find yourself writing:
- A function with no `require()` statements
- A contract that just "exists"
- Logic that "will be implemented later"

**STOP.** Ask: "What does this validate?" If nothing, delete it.

### The Output Count Rule

**CRITICAL**: Every contract MUST limit output count to prevent unauthorized minting.

```cashscript
function anyOperation() {
    // ALWAYS include this
    require(tx.outputs.length <= 7);  // Appropriate limit for operation

    // ... rest of logic
}
```

Without this, attackers can add arbitrary outputs minting unauthorized tokens.

### Validation Checklist

Before any contract is complete, verify it has:

- [ ] At least one meaningful `require()` statement
- [ ] Input position validation (`this.activeInputIndex == N`)
- [ ] Output count limit (`tx.outputs.length <= N`)
- [ ] Self-replication validation (if covenant)
- [ ] Cross-contract authentication (if multi-contract)

### The Contract Purpose Test

For every contract, complete this sentence:

**"This contract validates that _______________."**

Examples:
- "This contract validates that the sidecar was created in the same transaction as the main contract."
- "This contract validates that only authorized function NFTs can trigger state changes."
- "This contract validates that the price data was signed by the oracle."
- "This contract validates that output count cannot exceed 5 to prevent minting attacks."

If you cannot complete the sentence, the contract should not exist.