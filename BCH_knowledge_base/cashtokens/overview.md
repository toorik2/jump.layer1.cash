# CashTokens Integration with CashScript

## Overview

CashTokens is a native token system on Bitcoin Cash that provides fungible and non-fungible token (NFT) capabilities. CashScript provides comprehensive support for CashTokens through both language features and SDK integration.

## CashTokens Fundamentals

### Token Categories

Every CashToken belongs to a **token category** identified by a 32-byte category ID.

```cashscript
bytes32 tokenCategory = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
```

### Token Types

#### 1. Fungible Tokens (FT)
- Divisible tokens with amounts
- Similar to ERC-20 tokens
- Represented by `tokenAmount` property

#### 2. Non-Fungible Tokens (NFT)
- Unique tokens with capabilities and commitments
- Can have minting, mutable, or no capabilities
- Represented by `nftCommitment` and capability flags

## CashScript Language Support

### Transaction Introspection

Access token properties through transaction introspection:

```cashscript
contract TokenValidator(bytes32 expectedCategory) {
    function validateToken() {
        // Check token category
        require(tx.outputs[0].tokenCategory == expectedCategory);
        
        // Check token amount (for fungible tokens)
        require(tx.outputs[0].tokenAmount >= 100);
        
        // Check NFT commitment (for NFTs)
        require(tx.outputs[0].nftCommitment.length > 0);
    }
}
```

### Token Properties

Available token properties in CashScript:

```cashscript
// Token category (32 bytes)
bytes32 category = tx.outputs[0].tokenCategory;

// Fungible token amount
int amount = tx.outputs[0].tokenAmount;

// NFT commitment data
bytes commitment = tx.outputs[0].nftCommitment;

// Check if output has tokens
bool hasTokens = tx.outputs[0].tokenCategory != 0x;
```

### Token Validation Patterns

#### Fungible Token Transfer

```cashscript
contract FungibleTokenTransfer(bytes32 tokenCategory, int minimumAmount) {
    function transfer(sig ownerSig, pubkey ownerPk) {
        require(checkSig(ownerSig, ownerPk));
        
        // Ensure correct token category
        require(tx.outputs[0].tokenCategory == tokenCategory);
        
        // Ensure minimum amount
        require(tx.outputs[0].tokenAmount >= minimumAmount);
    }
}
```

#### NFT Ownership Transfer

```cashscript
contract NFTTransfer(bytes32 tokenCategory, bytes expectedCommitment) {
    function transfer(sig ownerSig, pubkey ownerPk) {
        require(checkSig(ownerSig, ownerPk));
        
        // Ensure correct token category
        require(tx.outputs[0].tokenCategory == tokenCategory);
        
        // Ensure specific NFT commitment
        require(tx.outputs[0].nftCommitment == expectedCommitment);
    }
}
```

## CashScript SDK Integration

### Token Output Creation

#### Fungible Token Output

```javascript
const txDetails = await contract.functions
    .transfer(sigTemplate)
    .to({
        to: 'bitcoincash:qr7gmtgmvsdtuwcskladnsrqrzf24td68qxg9rsqca',
        amount: 1000n,  // BCH amount in satoshis
        token: {
            category: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            amount: 100n  // Token amount
        }
    })
    .send();
```

#### NFT Output

```javascript
const txDetails = await contract.functions
    .transfer(sigTemplate)
    .to({
        to: 'bitcoincash:qr7gmtgmvsdtuwcskladnsrqrzf24td68qxg9rsqca',
        amount: 1000n,
        token: {
            category: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            nft: {
                capability: 'none',  // 'none', 'mutable', 'minting'
                commitment: Buffer.from('unique-data-here')
            }
        }
    })
    .send();
```

### Token UTXO Management

#### Finding Token UTXOs

```javascript
const utxos = await contract.getUtxos();

// Find fungible token UTXOs
const tokenUtxos = utxos.filter(utxo => 
    utxo.token && utxo.token.amount > 0
);

// Find NFT UTXOs
const nftUtxos = utxos.filter(utxo => 
    utxo.token && utxo.token.nft
);

// Find specific token category
const specificTokens = utxos.filter(utxo => 
    utxo.token && utxo.token.category === targetCategory
);
```

#### Token Balance Calculation

```javascript
function calculateTokenBalance(utxos, tokenCategory) {
    return utxos
        .filter(utxo => utxo.token && utxo.token.category === tokenCategory)
        .reduce((total, utxo) => total + (utxo.token.amount || 0n), 0n);
}

const balance = calculateTokenBalance(utxos, tokenCategory);
console.log('Token balance:', balance.toString());
```

## Advanced CashTokens Patterns

### Token Minting Contract

```cashscript
contract TokenMinting(pubkey minter, bytes32 tokenCategory) {
    function mint(sig minterSig, int amount) {
        require(checkSig(minterSig, minter));
        
        // Ensure minting to correct category
        require(tx.outputs[0].tokenCategory == tokenCategory);
        
        // Ensure positive amount
        require(amount > 0);
        require(tx.outputs[0].tokenAmount == amount);
    }
}
```

### NFT Minting with Metadata

```cashscript
contract NFTMinting(pubkey minter, bytes32 tokenCategory) {
    function mint(sig minterSig, bytes commitment) {
        require(checkSig(minterSig, minter));
        
        // Ensure correct token category
        require(tx.outputs[0].tokenCategory == tokenCategory);
        
        // Ensure NFT has commitment
        require(tx.outputs[0].nftCommitment == commitment);
        require(commitment.length > 0);
    }
}
```

### Token Burning

```cashscript
contract TokenBurning(pubkey owner, bytes32 tokenCategory) {
    function burn(sig ownerSig, int amount) {
        require(checkSig(ownerSig, owner));
        
        // Ensure input has tokens to burn
        require(tx.inputs[0].tokenCategory == tokenCategory);
        require(tx.inputs[0].tokenAmount >= amount);
        
        // Ensure no token outputs (burning)
        require(tx.outputs[0].tokenCategory == 0x || tx.outputs[0].tokenAmount == 0);
    }
}
```

## Token State Management

### NFT-Based State Storage

```cashscript
contract StatefulContract(bytes32 stateTokenCategory) {
    function updateState(sig ownerSig, bytes newState) {
        require(checkSig(ownerSig, owner));
        
        // Input must have current state NFT
        require(tx.inputs[0].tokenCategory == stateTokenCategory);
        
        // Output must have updated state NFT
        require(tx.outputs[0].tokenCategory == stateTokenCategory);
        require(tx.outputs[0].nftCommitment == newState);
    }
}
```

### Token-Gated Access

```cashscript
contract TokenGatedAccess(bytes32 requiredTokenCategory, int minimumAmount) {
    function access(sig userSig, pubkey userPk) {
        require(checkSig(userSig, userPk));
        
        // User must hold minimum token amount
        bool hasRequiredTokens = false;
        
        // Check all inputs for required tokens
        for (int i = 0; i < tx.inputs.length; i++) {
            if (tx.inputs[i].tokenCategory == requiredTokenCategory) {
                if (tx.inputs[i].tokenAmount >= minimumAmount) {
                    hasRequiredTokens = true;
                    break;
                }
            }
        }
        
        require(hasRequiredTokens);
    }
}
```

## Real-World Examples

### Decentralized Exchange (DEX)

```cashscript
contract SimpleTokenSwap(
    bytes32 tokenACategory,
    bytes32 tokenBCategory,
    int exchangeRate
) {
    function swap(sig traderSig, pubkey traderPk, int amountA) {
        require(checkSig(traderSig, traderPk));
        
        // Calculate required amount B
        int amountB = amountA * exchangeRate;
        
        // Ensure input has token A
        require(tx.inputs[0].tokenCategory == tokenACategory);
        require(tx.inputs[0].tokenAmount >= amountA);
        
        // Ensure output has token B
        require(tx.outputs[0].tokenCategory == tokenBCategory);
        require(tx.outputs[0].tokenAmount >= amountB);
    }
}
```

### Token Vesting

```cashscript
contract TokenVesting(
    pubkey beneficiary,
    bytes32 tokenCategory,
    int vestingPeriod,
    int totalAmount
) {
    function claim(sig beneficiarySig, int claimAmount) {
        require(checkSig(beneficiarySig, beneficiary));
        
        // Calculate vested amount based on time
        int vestedAmount = (tx.time * totalAmount) / vestingPeriod;
        
        // Ensure claim doesn't exceed vested amount
        require(claimAmount <= vestedAmount);
        
        // Ensure correct token output
        require(tx.outputs[0].tokenCategory == tokenCategory);
        require(tx.outputs[0].tokenAmount == claimAmount);
    }
}
```

### Multi-Token Portfolio

```javascript
// SDK example for managing multiple tokens
class TokenPortfolio {
    constructor(contract, provider) {
        this.contract = contract;
        this.provider = provider;
    }
    
    async getTokenBalances() {
        const utxos = await this.contract.getUtxos();
        const balances = new Map();
        
        for (const utxo of utxos) {
            if (utxo.token && utxo.token.amount > 0) {
                const category = utxo.token.category;
                const current = balances.get(category) || 0n;
                balances.set(category, current + utxo.token.amount);
            }
        }
        
        return balances;
    }
    
    async transferToken(tokenCategory, amount, recipient) {
        const sigTemplate = new SignatureTemplate(this.privateKey);
        
        return await this.contract.functions
            .transfer(sigTemplate)
            .to({
                to: recipient,
                amount: 1000n,
                token: {
                    category: tokenCategory,
                    amount: amount
                }
            })
            .send();
    }
}
```

## CashTokens Best Practices

### 1. Token Category Validation

```cashscript
// Always validate token categories
contract TokenValidator(bytes32 expectedCategory) {
    function validate() {
        require(tx.outputs[0].tokenCategory == expectedCategory);
        // Additional validation...
    }
}
```

### 2. Amount Validation

```javascript
// Validate token amounts in SDK
function validateTokenAmount(amount) {
    if (amount <= 0n) {
        throw new Error('Token amount must be positive');
    }
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Token amount too large');
    }
}
```

### 3. NFT Commitment Handling

```cashscript
contract NFTHandler() {
    function handleNFT(bytes commitment) {
        // Ensure commitment is not empty
        require(commitment.length > 0);

        // Validate commitment format
        require(commitment.length <= 128);  // Max commitment size

        // Process commitment...
    }
}
```

### 4. Token Conservation

```cashscript
contract TokenConservation(bytes32 tokenCategory) {
    function conserveTokens() {
        int inputAmount = 0;
        int outputAmount = 0;
        
        // Sum input token amounts
        for (int i = 0; i < tx.inputs.length; i++) {
            if (tx.inputs[i].tokenCategory == tokenCategory) {
                inputAmount += tx.inputs[i].tokenAmount;
            }
        }
        
        // Sum output token amounts
        for (int i = 0; i < tx.outputs.length; i++) {
            if (tx.outputs[i].tokenCategory == tokenCategory) {
                outputAmount += tx.outputs[i].tokenAmount;
            }
        }
        
        // Ensure tokens are conserved
        require(inputAmount >= outputAmount);
    }
}
```

## Common Pitfalls

### 1. Category ID Format

```javascript
// Wrong - string instead of hex
const category = 'my-token-category';

// Right - 32-byte hex string
const category = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
```

### 2. Token Amount Type

```javascript
// Wrong - regular number
const amount = 100;

// Right - BigInt
const amount = 100n;
```

### 3. NFT Capability Values

```javascript
// Wrong - invalid capability
const capability = 'readonly';

// Right - valid capabilities
const capability = 'none';     // or 'mutable' or 'minting'
```

### 4. Commitment Size

```javascript
// Wrong - commitment too large
const commitment = Buffer.alloc(200);

// Right - commitment within limits
const commitment = Buffer.from('metadata', 'utf8');  // Max 128 bytes
```

## Testing CashTokens

### Unit Testing

```javascript
describe('Token Contract', () => {
    it('should transfer tokens correctly', async () => {
        const txDetails = await contract.functions
            .transfer(sigTemplate)
            .to({
                to: recipientAddress,
                amount: 1000n,
                token: {
                    category: tokenCategory,
                    amount: 50n
                }
            })
            .send();
        
        expect(txDetails.txid).toBeDefined();
        
        // Verify token transfer
        const recipientUtxos = await provider.getUtxos(recipientAddress);
        const tokenUtxo = recipientUtxos.find(utxo => 
            utxo.token && utxo.token.category === tokenCategory
        );
        
        expect(tokenUtxo.token.amount).toBe(50n);
    });
});
```

### Integration Testing

```javascript
describe('Token Integration', () => {
    it('should handle multi-token transactions', async () => {
        // Create transaction with multiple token types
        const txDetails = await new TransactionBuilder({ provider })
            .addInput(tokenAUtxo, contract.unlock.swap(sigTemplate))
            .addOutput({
                to: userAddress,
                amount: 1000n,
                token: {
                    category: tokenBCategory,
                    amount: 100n
                }
            })
            .send();
        
        // Verify swap occurred
        const userUtxos = await provider.getUtxos(userAddress);
        const newTokens = userUtxos.filter(utxo => 
            utxo.token && utxo.token.category === tokenBCategory
        );
        
        expect(newTokens.length).toBeGreaterThan(0);
    });
});
```

This comprehensive guide covers CashTokens integration with CashScript, providing both language-level and SDK-level examples for working with fungible and non-fungible tokens on Bitcoin Cash.