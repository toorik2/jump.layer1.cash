# CashScript Quick Reference Guide

## Language Syntax

### Contract Structure
```cashscript
pragma cashscript ^0.11.0;

contract ContractName(Type param1, Type param2) {
    // Define reusable functions
    OP_DEFINE helperFunction(Type arg) {
        require(condition);
    }

    function functionName(Type arg1, Type arg2) {
        // Use loops
        int i = 0;
        OP_BEGIN
            // Loop body
            i = i + 1;
        OP_UNTIL(i >= 5)

        // Invoke defined functions
        OP_INVOKE helperFunction(arg1);

        require(condition);
    }
}
```

### Data Types
| Type | Description | Example |
|------|-------------|---------|
| `bool` | Boolean | `true`, `false` |
| `int` | Integer | `42`, `-100`, `1_000_000` |
| `string` | UTF-8 string | `"Hello World"` |
| `bytes` | Byte sequence | `0x1234abcd` |
| `bytes4` | Fixed 4 bytes | `0x12345678` |
| `bytes20` | Fixed 20 bytes | Hash160 result |
| `bytes32` | Fixed 32 bytes | SHA256 result |
| `pubkey` | Public key | `0x03...` (33 bytes) |
| `sig` | Signature | Transaction signature |
| `datasig` | Data signature | Message signature |

### Operators
| Category | Operators |
|----------|-----------|
| Arithmetic | `+`, `-`, `*`, `/`, `%` |
| Comparison | `<`, `<=`, `>`, `>=`, `==`, `!=` |
| Logical | `!`, `&&`, `||` |
| Bitwise | `&`, `|`, `^`, `~`, `<<`, `>>` |

### Built-in Functions

#### Arithmetic
```cashscript
abs(int a) -> int
min(int a, int b) -> int
max(int a, int b) -> int
within(int x, int lower, int upper) -> bool
```

#### Hash Functions
```cashscript
sha256(any x) -> bytes32
sha1(any x) -> bytes20
ripemd160(any x) -> bytes20
hash160(any x) -> bytes20
hash256(any x) -> bytes32
```

#### Signature Functions
```cashscript
checkSig(sig s, pubkey pk) -> bool
checkMultiSig(sig[] sigs, pubkey[] pks) -> bool
checkDataSig(datasig s, bytes msg, pubkey pk) -> bool
```

#### Control Flow Operations
```cashscript
OP_BEGIN               // Loop entry point
    // Loop body
OP_UNTIL(condition)    // Loop while condition is false

OP_DEFINE funcName(args) { body }  // Define reusable function
OP_INVOKE funcName(args)           // Invoke defined function
```

#### Bitwise Operations
```cashscript
~value                 // Bitwise NOT (OP_INVERT)
value << n             // Left shift by n bits
value >> n             // Right shift by n bits
```

### Global Variables

#### Time Variables
```cashscript
tx.time        // Absolute time lock
tx.age         // Relative time lock (UTXO age)
```

#### Transaction Introspection
```cashscript
tx.version     // Transaction version
tx.locktime    // Transaction locktime
tx.inputs      // Array of inputs
tx.outputs     // Array of outputs
```

#### Contract Context
```cashscript
this.activeInputIndex    // Current input index
this.activeBytecode     // Current input bytecode
```

#### Input/Output Properties
```cashscript
// Input/Output properties
.value              // Satoshi amount
.lockingBytecode    // Script bytecode
.tokenCategory      // CashToken category
.nftCommitment      // NFT commitment
.tokenAmount        // Token amount
```

### Locking Bytecode Constructors
```cashscript
new LockingBytecodeP2PKH(bytes20 pkHash)
new LockingBytecodeP2SH20(bytes20 scriptHash)
new LockingBytecodeP2SH32(bytes32 scriptHash)
new LockingBytecodeNullData(bytes[] chunks)
```

### Units
```cashscript
// BCH Units
1 * sats         // 1 satoshi
1 * finney       // 0.001 BCH
1 * bits         // 0.000001 BCH
1 * bitcoin      // 1 BCH

// Time Units
1 * seconds      // 1 second
1 * minutes      // 60 seconds
1 * hours        // 3600 seconds
1 * days         // 86400 seconds
1 * weeks        // 604800 seconds
```

## JavaScript/TypeScript SDK

### Installation
```bash
npm install cashscript  # SDK
npm install -g cashc    # Compiler
```

### Basic Imports
```javascript
import { 
    Contract, 
    ElectrumNetworkProvider, 
    SignatureTemplate, 
    TransactionBuilder 
} from 'cashscript';
import { compileFile, compileString } from 'cashc';
```

### Contract Compilation
```javascript
// Compile from file
const artifact = compileFile('contract.cash');

// Compile from string
const artifact = compileString(contractCode);

// Import JSON artifact
import artifact from './contract.json' with { type: 'json' };
```

### Contract Instantiation
```javascript
const provider = new ElectrumNetworkProvider('mainnet');
const contract = new Contract(artifact, constructorArgs, { provider });
```

### Basic Transaction
```javascript
const sigTemplate = new SignatureTemplate(privateKey);

const txDetails = await contract.functions
    .functionName(arg1, arg2)
    .to('bitcoincash:address', amount)
    .send();
```

### Advanced Transaction Builder
```javascript
const txDetails = await new TransactionBuilder({ provider })
    .addInput(utxo, unlockingScript)
    .addOutput({ to: address, amount: amount })
    .setMaxFee(1000n)
    .send();
```

### Transaction Options
```javascript
contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withFeePerByte(1.1)           // Custom fee rate
    .withHardcodedFee(1000n)       // Fixed fee
    .withMinChange(5000n)          // Minimum change
    .withoutChange()               // No change output
    .withOpReturn(['data'])        // OP_RETURN output
    .withTime(timestamp)           // Time lock
    .withAge(blocks)               // Age lock
    .send();
```

## CashTokens Integration

*Token commitments support up to 128 bytes (BLS12-381 compatible). Unlocking bytecode limit: 10,000 bytes.*

### Token Output (SDK)
```javascript
// Fungible Token
.to({
    to: address,
    amount: 1000n,
    token: {
        category: tokenCategory,
        amount: 100n
    }
})

// NFT
.to({
    to: address,
    amount: 1000n,
    token: {
        category: tokenCategory,
        nft: {
            capability: 'none',  // 'none', 'mutable', 'minting'
            commitment: Buffer.from('data')
        }
    }
})
```

### Token Validation (Contract)
```cashscript
// Check token category
require(tx.outputs[0].tokenCategory == expectedCategory);

// Check fungible token amount
require(tx.outputs[0].tokenAmount >= 100);

// Check NFT commitment
require(tx.outputs[0].nftCommitment == expectedCommitment);
```

## Common Patterns

### Simple Transfer
```cashscript
contract SimpleTransfer(pubkey owner) {
    function spend(sig ownerSig) {
        require(checkSig(ownerSig, owner));
    }
}
```

### Time Lock
```cashscript
contract TimeLock(pubkey owner, int lockTime) {
    function spend(sig ownerSig) {
        require(checkSig(ownerSig, owner));
        require(tx.time >= lockTime);
    }
}
```

### Hash Lock
```cashscript
contract HashLock(pubkey owner, bytes32 secretHash) {
    function spend(sig ownerSig, bytes secret) {
        require(checkSig(ownerSig, owner));
        require(sha256(secret) == secretHash);
    }
}
```

### Multi-Signature
```cashscript
contract MultiSig(pubkey pk1, pubkey pk2, pubkey pk3) {
    function spend(sig s1, sig s2) {
        require(checkMultiSig([s1, s2], [pk1, pk2, pk3]));
    }
}
```

### Covenant (Output Restriction)
```cashscript
contract Covenant(bytes20 targetAddress) {
    function spend() {
        require(tx.outputs[0].lockingBytecode == 
                new LockingBytecodeP2PKH(targetAddress));
        require(tx.outputs[0].value >= 1000);
    }
}
```

### Oracle Integration
```cashscript
contract Oracle(pubkey oraclePk) {
    function spend(datasig oracleData, int price) {
        require(checkDataSig(oracleData, bytes(price), oraclePk));
        require(price >= 1000);
    }
}
```

## Error Handling

### Common Errors
| Error | Cause | Solution |
|-------|-------|----------|
| Script failed | `require()` condition failed | Check contract logic |
| Insufficient funds | Not enough BCH in contract | Fund contract or reduce amount |
| Invalid signature | Wrong private key or format | Verify signature creation |
| Network error | Connection issues | Check network/provider |
| Compilation error | Syntax errors in contract | Fix CashScript syntax |

### Debug Techniques
```javascript
// Debug transaction
const debugInfo = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .debug();

// Build without sending
const txHex = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .build();

// Generate debug URI
const uri = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .bitauthUri();
```

## Security Checklist

### Contract Security
- [ ] Validate all function inputs
- [ ] Use proper access control
- [ ] Implement bounds checking
- [ ] Handle overflow/underflow
- [ ] Validate transaction structure
- [ ] Use appropriate time comparisons
- [ ] Implement proper signature validation

### SDK Security
- [ ] Validate network connections
- [ ] Use appropriate fee rates
- [ ] Implement retry logic
- [ ] Validate transaction results
- [ ] Handle errors gracefully
- [ ] Monitor contract activity

## Network Configuration

### Providers
```javascript
// Mainnet
new ElectrumNetworkProvider('mainnet')

// Testnet (Chipnet)
new ElectrumNetworkProvider('chipnet')

// Custom server
new ElectrumNetworkProvider('mainnet', 'server.example.com')
```

### Address Types
```javascript
// P2SH32 (default, more secure)
{ addressType: 'p2sh32' }

// P2SH20 (legacy, less secure)
{ addressType: 'p2sh20' }
```

## Version Compatibility

### CashScript Versions
- `^0.11.0` - Latest stable
- `>=0.10.0` - Minimum supported
- `^0.8.0` - Legacy support

### Pragma Directive
```cashscript
pragma cashscript ^0.11.0;  // Compatible with 0.11.x
pragma cashscript >=0.10.0; // 0.10.0 and above
```

## Useful Resources

### Documentation
- [CashScript Docs](https://cashscript.org/docs/)
- [Bitcoin Cash Docs](https://developer.bitcoin.com/)
- [CashTokens Spec](https://cashtokens.org/docs/spec/)

### Tools
- [CashScript Playground](https://playground.cashscript.org/)
- [Bitcoin Cash Explorer](https://explorer.bitcoin.com/)
- [Electrum Cash](https://electroncash.org/)

### Libraries
- `cashscript` - Main SDK
- `cashc` - Compiler
- `bitcore-lib-cash` - Bitcoin Cash utilities
- `bip39` - Mnemonic generation

## CLI Commands

### Compilation
```bash
# Compile to JSON
cashc contract.cash

# Compile to TypeScript
cashc --format ts contract.cash

# Specify output file
cashc --output artifact.json contract.cash

# Show help
cashc --help
```

### Version Check
```bash
cashc --version
```

This quick reference provides a comprehensive overview of CashScript syntax, SDK usage, and common patterns for rapid development and debugging.