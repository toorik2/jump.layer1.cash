# CashScript SDK: Transaction Building

## Overview

The CashScript SDK provides powerful transaction building capabilities for interacting with smart contracts. This includes constructing transactions, managing inputs and outputs, handling fees, and broadcasting to the network.

## Transaction Building Methods

### 1. Function-Based Transaction Building

The primary method for building transactions is through contract functions.

```javascript
const txDetails = await contract.functions
    .functionName(arg1, arg2, ...)
    .to(address, amount)
    .send();
```

### 2. Advanced Transaction Builder

For more complex transactions, use the `TransactionBuilder` class.

```javascript
import { TransactionBuilder } from 'cashscript';

const txDetails = await new TransactionBuilder({ provider })
    .addInput(utxo, unlockingScript)
    .addOutput({ to: address, amount: amount })
    .send();
```

### Pay to Script (P2S) Support

Bitcoin Cash supports Pay to Script (P2S) outputs, allowing direct script usage without hashing overhead. P2S is now standard and reduces transaction size by 23-35 bytes per output compared to P2SH. The unlocking bytecode limit is 10,000 bytes, enabling complex contract logic.

## Basic Transaction Building

### Simple Transfer

```javascript
import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'cashscript';

const provider = new ElectrumNetworkProvider('mainnet');
const contract = new Contract(artifact, constructorArgs, { provider });

// Create signature template
const privateKey = 'your-private-key-here';
const sigTemplate = new SignatureTemplate(privateKey);

// Build and send transaction
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to('bitcoincash:qr7gmtgmvsdtuwcskladnsrqrzf24td68qxg9rsqca', 100000n)
    .send();

console.log('Transaction ID:', txDetails.txid);
```

### Multi-Output Transaction

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to('bitcoincash:qr7gmtgmvsdtuwcskladnsrqrzf24td68qxg9rsqca', 50000n)
    .to('bitcoincash:qrhea03074073ff3zv9whh0nggxc7k03ssh8jv9mkx', 30000n)
    .send();
```

## Transaction Options

### Fee Management

#### Default Fee Rate

```javascript
// Uses default fee rate (1.0 sat/byte)
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .send();
```

#### Custom Fee Rate

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withFeePerByte(2.0)  // 2 sat/byte
    .send();
```

#### Hardcoded Fee

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withHardcodedFee(1000n)  // 1000 satoshis
    .send();
```

### Change Management

#### Minimum Change

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withMinChange(5000n)  // Minimum 5000 sat change
    .send();
```

#### No Change Output

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withoutChange()
    .send();
```

### Input Selection

#### Automatic Input Selection

```javascript
// SDK automatically selects UTXOs
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .send();
```

#### Manual Input Selection

```javascript
const utxos = await contract.getUtxos();
const selectedUtxo = utxos[0];

const txDetails = await contract.functions
    .spend(sigTemplate)
    .from(selectedUtxo)
    .to(address, amount)
    .send();
```

## Advanced Transaction Building

### Using TransactionBuilder

```javascript
import { TransactionBuilder, SignatureTemplate } from 'cashscript';

const provider = new ElectrumNetworkProvider('mainnet');
const sigTemplate = new SignatureTemplate(privateKey);

const txDetails = await new TransactionBuilder({ provider })
    .addInput(contractUtxo, contract.unlock.spend(sigTemplate))
    .addOutput({
        to: 'bitcoincash:qr7gmtgmvsdtuwcskladnsrqrzf24td68qxg9rsqca',
        amount: 50000n
    })
    .addOutput({
        to: 'bitcoincash:qrhea03074073ff3zv9whh0nggxc7k03ssh8jv9mkx',
        amount: 30000n
    })
    .setMaxFee(2000n)
    .send();
```

### P2PKH Input Integration

```javascript
const aliceUtxos = await provider.getUtxos(aliceAddress);
const aliceTemplate = new SignatureTemplate(alicePrivateKey);

const txDetails = await new TransactionBuilder({ provider })
    .addInput(contractUtxo, contract.unlock.spend(contractSig))
    .addInput(aliceUtxos[0], aliceTemplate.unlockP2PKH())
    .addOutput({ to: bobAddress, amount: 100000n })
    .send();
```

## OP_RETURN Data

### Simple OP_RETURN

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withOpReturn(['Hello, Bitcoin Cash!'])
    .send();
```

### Protocol-Specific OP_RETURN

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withOpReturn(['0x6d02', 'memo.cash message'])
    .send();
```

### Multiple OP_RETURN Outputs

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withOpReturn(['0x534c5000', 'SLP token data'])
    .withOpReturn(['0x6d02', 'memo.cash message'])
    .send();
```

## CashTokens Integration

Bitcoin Cash supports CashTokens for fungible and non-fungible token functionality. Token commitments can be up to 128 bytes, supporting advanced use cases like BLS12-381 KZG commitments for bilinear pairing-based accumulators.

### Fungible Token Outputs

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to({
        to: address,
        amount: 1000n,
        token: {
            category: tokenCategory,
            amount: 100n
        }
    })
    .send();
```

### NFT Outputs

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to({
        to: address,
        amount: 1000n,
        token: {
            category: tokenCategory,
            nft: {
                capability: 'none',
                commitment: Buffer.from('unique-data')
            }
        }
    })
    .send();
```

### Token Minting

```javascript
const txDetails = await contract.functions
    .mint(sigTemplate, 1000n)
    .to({
        to: address,
        amount: 1000n,
        token: {
            category: tokenCategory,
            amount: 1000n
        }
    })
    .send();
```

## Time Constraints

### Absolute Time Locks

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withTime(1640995200)  // Unix timestamp
    .send();
```

### Relative Time Locks

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withAge(144)  // 144 blocks
    .send();
```

## Transaction Debugging

### Debug Mode

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .debug()  // Shows detailed transaction info
    .send();
```

### BitAuth URI

```javascript
const uri = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .bitauthUri();

console.log('Debug URI:', uri);
```

### Build Without Broadcasting

```javascript
const txHex = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .build();

console.log('Transaction hex:', txHex);
```

## Error Handling

### Transaction Validation

```javascript
try {
    const txDetails = await contract.functions
        .spend(sigTemplate)
        .to(address, amount)
        .send();
} catch (error) {
    if (error.message.includes('insufficient funds')) {
        console.error('Not enough funds in contract');
    } else if (error.message.includes('script failed')) {
        console.error('Contract validation failed');
    } else {
        console.error('Transaction error:', error.message);
    }
}
```

### Network Errors

```javascript
try {
    const txDetails = await contract.functions
        .spend(sigTemplate)
        .to(address, amount)
        .send();
} catch (error) {
    if (error.code === 'ECONNREFUSED') {
        console.error('Network connection failed');
    } else if (error.code === 'TIMEOUT') {
        console.error('Transaction broadcast timeout');
    } else {
        console.error('Network error:', error.message);
    }
}
```

## Complete Examples

### Escrow Contract Transaction

```javascript
import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'cashscript';

const provider = new ElectrumNetworkProvider('mainnet');
const escrowContract = new Contract(escrowArtifact, [
    buyerPubkey,
    sellerPubkey,
    arbiterPubkey,
    escrowAmount
], { provider });

// Buyer and seller complete the escrow
const buyerSig = new SignatureTemplate(buyerPrivateKey);
const sellerSig = new SignatureTemplate(sellerPrivateKey);

const txDetails = await escrowContract.functions
    .complete(buyerSig, sellerSig)
    .to(sellerAddress, escrowAmount)
    .send();
```

### Multi-Path Contract

```javascript
const timeLockContract = new Contract(timeLockArtifact, [
    ownerPubkey,
    lockTime
], { provider });

const ownerSig = new SignatureTemplate(ownerPrivateKey);

// Try immediate spend first
try {
    const txDetails = await timeLockContract.functions
        .spend(ownerSig)
        .to(ownerAddress, amount)
        .send();
} catch (error) {
    // If time lock not expired, wait
    console.log('Time lock not expired, waiting...');
}
```

### Complex Multi-Input Transaction

```javascript
const provider = new ElectrumNetworkProvider('mainnet');

// Multiple contract UTXOs
const contractUtxos = await contract.getUtxos();
const userUtxos = await provider.getUtxos(userAddress);

const userSig = new SignatureTemplate(userPrivateKey);
const contractSig = new SignatureTemplate(contractPrivateKey);

const txDetails = await new TransactionBuilder({ provider })
    .addInput(contractUtxos[0], contract.unlock.spend(contractSig))
    .addInput(contractUtxos[1], contract.unlock.spend(contractSig))
    .addInput(userUtxos[0], userSig.unlockP2PKH())
    .addOutput({ to: recipientAddress, amount: 100000n })
    .addOutput({ to: changeAddress, amount: 50000n })
    .setMaxFee(3000n)
    .send();
```

## Best Practices

### 1. Fee Management

```javascript
// Always set appropriate fees
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .withFeePerByte(1.1)  // Slightly above minimum
    .send();
```

### 2. Input Validation

```javascript
// Validate inputs before transaction
const balance = await contract.getBalance();
const requiredAmount = amount + estimatedFee;

if (balance < requiredAmount) {
    throw new Error('Insufficient contract balance');
}
```

### 3. Error Recovery

```javascript
async function sendTransactionWithRetry(contractTx, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await contractTx.send();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            
            console.log(`Attempt ${i + 1} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}
```

### 4. Transaction Monitoring

```javascript
async function monitorTransaction(txid) {
    const provider = new ElectrumNetworkProvider('mainnet');
    
    while (true) {
        try {
            const tx = await provider.getTransaction(txid);
            if (tx.confirmations >= 1) {
                console.log('Transaction confirmed');
                break;
            }
        } catch (error) {
            console.log('Transaction not found, waiting...');
        }
        
        await new Promise(resolve => setTimeout(resolve, 30000));
    }
}
```

## Common Patterns

### Batch Transactions

```javascript
const transactions = [];

for (const recipient of recipients) {
    const tx = contract.functions
        .spend(sigTemplate)
        .to(recipient.address, recipient.amount)
        .build();
    
    transactions.push(tx);
}

// Send all transactions
const results = await Promise.allSettled(
    transactions.map(tx => provider.sendRawTransaction(tx))
);
```

### Conditional Spending

```javascript
const balance = await contract.getBalance();
const utxos = await contract.getUtxos();

let txBuilder = contract.functions.spend(sigTemplate);

if (balance > 100000n) {
    txBuilder = txBuilder.to(primaryAddress, 50000n);
    txBuilder = txBuilder.to(secondaryAddress, 30000n);
} else {
    txBuilder = txBuilder.to(primaryAddress, balance - 1000n);
}

const txDetails = await txBuilder.send();
```

### Token-Aware Transactions

```javascript
const contractUtxos = await contract.getUtxos();
const tokenUtxo = contractUtxos.find(utxo => utxo.token);

if (tokenUtxo) {
    const txDetails = await contract.functions
        .spend(sigTemplate)
        .to({
            to: recipientAddress,
            amount: 1000n,
            token: {
                category: tokenUtxo.token.category,
                amount: tokenUtxo.token.amount
            }
        })
        .send();
}
```

## Transaction Analysis

### Fee Calculation

```javascript
const txHex = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .build();

const txSize = txHex.length / 2;  // Hex to bytes
const feeRate = 1.0;  // sat/byte
const estimatedFee = txSize * feeRate;

console.log(`Transaction size: ${txSize} bytes`);
console.log(`Estimated fee: ${estimatedFee} satoshis`);
```

### Input/Output Analysis

```javascript
const txDetails = await contract.functions
    .spend(sigTemplate)
    .to(address, amount)
    .send();

console.log('Transaction Analysis:');
console.log('- TXID:', txDetails.txid);
console.log('- Inputs:', txDetails.inputs.length);
console.log('- Outputs:', txDetails.outputs.length);
console.log('- Fee:', txDetails.fee);
```

This comprehensive guide covers all aspects of transaction building with the CashScript SDK, from basic transfers to complex multi-input transactions with CashTokens support.