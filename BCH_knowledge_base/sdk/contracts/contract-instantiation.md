# CashScript SDK: Contract Instantiation

## Overview

The CashScript SDK provides a JavaScript/TypeScript interface for interacting with CashScript contracts. Contract instantiation is the process of creating a contract instance from a compiled artifact.

## Installation

```bash
# Install the SDK
npm install cashscript

# Install the compiler (optional, for compilation)
npm install -g cashc
```

## Basic Contract Instantiation

### 1. Contract Class

The `Contract` class represents a CashScript contract instance.

```javascript
import { Contract, ElectrumNetworkProvider } from 'cashscript';

const contract = new Contract(artifact, constructorArgs, options);
```

### 2. Constructor Parameters

```javascript
new Contract(
    artifact,           // Compiled contract artifact
    constructorArgs,    // Constructor arguments array
    options?           // Optional configuration
)
```

## Contract Artifacts

### Compilation Methods

#### Method 1: CLI Compilation

```bash
# Compile to JSON
cashc contract.cash

# Compile to TypeScript
cashc --format ts contract.cash
```

#### Method 2: Programmatic Compilation

```javascript
import { compileFile, compileString } from 'cashc';

// Compile from file
const artifact = compileFile('path/to/contract.cash');

// Compile from string
const contractCode = `
    pragma cashscript ^0.11.0;
    contract SimpleContract(pubkey owner) {
        function spend(sig ownerSig) {
            require(checkSig(ownerSig, owner));
        }
    }
`;
const artifact = compileString(contractCode);
```

#### Method 3: Import JSON Artifact

```javascript
import artifact from './contract.json' with { type: 'json' };
```

## Network Providers

### ElectrumNetworkProvider

Default network provider for Bitcoin Cash.

```javascript
import { ElectrumNetworkProvider } from 'cashscript';

// Mainnet
const provider = new ElectrumNetworkProvider('mainnet');

// Testnet (Chipnet)
const provider = new ElectrumNetworkProvider('chipnet');

// Custom server
const provider = new ElectrumNetworkProvider('mainnet', 'fulcrum.example.com');
```

### Custom Provider Options

```javascript
const provider = new ElectrumNetworkProvider('mainnet', {
    servers: ['electrum.example.com:50001'],
    timeout: 10000,
    retries: 3
});
```

## Contract Options

### Address Type

```javascript
const options = {
    provider: provider,
    addressType: 'p2sh32'  // or 'p2sh20' or 'p2s'
};
```

**Address Types:**
- `p2sh32`: SHA-256 hash (default, more secure)
- `p2sh20`: RIPEMD-160 hash (less secure, legacy)
- `p2s`: Pay to Script - direct script usage without hashing (more efficient, standard)

## Complete Examples

### Simple Contract

```javascript
import { Contract, ElectrumNetworkProvider } from 'cashscript';
import { compileFile } from 'cashc';

// Compile contract
const artifact = compileFile('simple.cash');

// Create provider
const provider = new ElectrumNetworkProvider('mainnet');

// Constructor arguments
const ownerPubkey = Buffer.from('03...', 'hex');
const constructorArgs = [ownerPubkey];

// Create contract instance
const contract = new Contract(artifact, constructorArgs, { provider });

console.log('Contract address:', contract.address);
console.log('Contract balance:', await contract.getBalance());
```

### Multi-Parameter Contract

```javascript
import { Contract, ElectrumNetworkProvider } from 'cashscript';
import artifact from './escrow.json' with { type: 'json' };

const provider = new ElectrumNetworkProvider('mainnet');

// Multiple constructor parameters
const buyerPubkey = Buffer.from('03...', 'hex');
const sellerPubkey = Buffer.from('02...', 'hex');
const arbiterPubkey = Buffer.from('03...', 'hex');
const escrowAmount = 1000000n;  // 0.01 BCH in satoshis

const constructorArgs = [
    buyerPubkey,
    sellerPubkey,
    arbiterPubkey,
    escrowAmount
];

const contract = new Contract(artifact, constructorArgs, { provider });
```

### TypeScript Contract

```javascript
import { Contract, ElectrumNetworkProvider } from 'cashscript';
import { P2PKH } from './p2pkh.js';  // TypeScript artifact

const provider = new ElectrumNetworkProvider('mainnet');
const ownerPkh = Buffer.from('14...', 'hex');  // 20-byte pubkey hash

const contract = new Contract(P2PKH, [ownerPkh], { provider });
```

## Contract Properties

### Basic Properties

```javascript
const contract = new Contract(artifact, constructorArgs, { provider });

// Contract address
console.log('Address:', contract.address);

// Contract bytecode
console.log('Bytecode:', contract.bytecode);

// Contract byte size
console.log('Size:', contract.bytesize);

// Contract functions
console.log('Functions:', Object.keys(contract.functions));
```

### Balance and UTXOs

```javascript
// Get balance
const balance = await contract.getBalance();
console.log('Balance:', balance, 'satoshis');

// Get UTXOs
const utxos = await contract.getUtxos();
console.log('UTXOs:', utxos.length);

// Get specific UTXO
const utxo = utxos[0];
console.log('UTXO value:', utxo.satoshis);
console.log('UTXO txid:', utxo.txid);
```

## Error Handling

### Compilation Errors

```javascript
try {
    const artifact = compileFile('invalid.cash');
} catch (error) {
    console.error('Compilation error:', error.message);
}
```

### Network Errors

```javascript
try {
    const balance = await contract.getBalance();
} catch (error) {
    console.error('Network error:', error.message);
}
```

### Parameter Validation

```javascript
try {
    const contract = new Contract(artifact, invalidArgs, { provider });
} catch (error) {
    console.error('Parameter error:', error.message);
}
```

## Advanced Patterns

### Contract Factory

```javascript
class ContractFactory {
    constructor(artifact, provider) {
        this.artifact = artifact;
        this.provider = provider;
    }
    
    createContract(constructorArgs) {
        return new Contract(this.artifact, constructorArgs, {
            provider: this.provider
        });
    }
}

const factory = new ContractFactory(artifact, provider);
const contract1 = factory.createContract([pubkey1]);
const contract2 = factory.createContract([pubkey2]);
```

### Dynamic Contract Creation

```javascript
function createTimeLockContract(owner, lockTime) {
    const artifact = compileString(`
        pragma cashscript ^0.11.0;
        contract TimeLock(pubkey owner, int lockTime) {
            function spend(sig ownerSig) {
                require(checkSig(ownerSig, owner));
                require(tx.time >= lockTime);
            }
        }
    `);
    
    return new Contract(artifact, [owner, lockTime], { provider });
}

const contract = createTimeLockContract(ownerPubkey, 1640995200);
```

### Contract Monitoring

```javascript
class ContractMonitor {
    constructor(contract) {
        this.contract = contract;
    }
    
    async checkStatus() {
        const balance = await this.contract.getBalance();
        const utxos = await this.contract.getUtxos();
        
        return {
            address: this.contract.address,
            balance: balance,
            utxoCount: utxos.length,
            lastUpdate: new Date()
        };
    }
    
    async startMonitoring(interval = 60000) {
        setInterval(async () => {
            const status = await this.checkStatus();
            console.log('Contract status:', status);
        }, interval);
    }
}

const monitor = new ContractMonitor(contract);
await monitor.startMonitoring();
```

## Best Practices

### 1. Provider Management

```javascript
// Reuse provider instances
const provider = new ElectrumNetworkProvider('mainnet');

// Multiple contracts with same provider
const contract1 = new Contract(artifact1, args1, { provider });
const contract2 = new Contract(artifact2, args2, { provider });
```

### 2. Error Handling

```javascript
async function createContractSafely(artifact, args) {
    try {
        const provider = new ElectrumNetworkProvider('mainnet');
        const contract = new Contract(artifact, args, { provider });
        
        // Validate contract
        await contract.getBalance();
        
        return contract;
    } catch (error) {
        console.error('Contract creation failed:', error.message);
        throw error;
    }
}
```

### 3. Type Safety

```javascript
// Use TypeScript for better type safety
import { Contract, ElectrumNetworkProvider } from 'cashscript';
import type { Artifact } from 'cashscript';

function createTypedContract(
    artifact: Artifact,
    args: any[],
    network: 'mainnet' | 'chipnet' = 'mainnet'
): Contract {
    const provider = new ElectrumNetworkProvider(network);
    return new Contract(artifact, args, { provider });
}
```

### 4. Configuration Management

```javascript
const config = {
    network: process.env.NETWORK || 'mainnet',
    addressType: 'p2sh32',
    timeout: 30000
};

const provider = new ElectrumNetworkProvider(config.network);
const contract = new Contract(artifact, args, {
    provider,
    addressType: config.addressType
});
```

## Common Patterns

### Contract Deployment Helper

```javascript
async function deployContract(artifact, constructorArgs, initialFunding = 0) {
    const provider = new ElectrumNetworkProvider('mainnet');
    const contract = new Contract(artifact, constructorArgs, { provider });
    
    if (initialFunding > 0) {
        // Fund contract logic would go here
        console.log(`Contract ${contract.address} needs ${initialFunding} satoshis`);
    }
    
    return contract;
}
```

### Multi-Network Support

```javascript
class NetworkManager {
    constructor() {
        this.providers = {
            mainnet: new ElectrumNetworkProvider('mainnet'),
            testnet: new ElectrumNetworkProvider('chipnet')
        };
    }
    
    createContract(network, artifact, args) {
        const provider = this.providers[network];
        if (!provider) {
            throw new Error(`Unsupported network: ${network}`);
        }
        
        return new Contract(artifact, args, { provider });
    }
}
```

### Contract Validation

```javascript
async function validateContract(contract) {
    try {
        // Check if contract is accessible
        await contract.getBalance();
        
        // Validate contract structure
        if (!contract.address) {
            throw new Error('Invalid contract address');
        }
        
        if (!contract.functions || Object.keys(contract.functions).length === 0) {
            throw new Error('Contract has no functions');
        }
        
        return true;
    } catch (error) {
        console.error('Contract validation failed:', error.message);
        return false;
    }
}
```

## Troubleshooting

### Common Issues

1. **Network Connection**: Ensure network connectivity to Electrum servers
2. **Invalid Arguments**: Check constructor argument types and order
3. **Compilation Errors**: Verify contract syntax and CashScript version
4. **Provider Issues**: Try different Electrum servers if connection fails

### Debug Information

```javascript
const contract = new Contract(artifact, args, { provider });

console.log('Contract Debug Info:');
console.log('- Address:', contract.address);
console.log('- Bytecode length:', contract.bytecode.length);
console.log('- Functions:', Object.keys(contract.functions));
console.log('- Provider network:', provider.network);
```

This comprehensive guide covers all aspects of CashScript contract instantiation, from basic setup to advanced patterns and troubleshooting.