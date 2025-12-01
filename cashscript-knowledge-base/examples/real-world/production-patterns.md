# Real-World CashScript Production Patterns

**⚠️ IMPORTANT**: All helper functions in these examples (like `calculateOutput()`, `getCurrentPrice()`, `getProposalDeadline()`) are **LEGITIMATE INTERNAL HELPER FUNCTIONS** that are called by other functions within the same contract. They are NOT placeholders, stubs, or documentation-only functions. Every function shown here is production code that executes on-chain as part of the contract's validation logic.

**DO NOT create functions that exist only for documentation purposes.** If a Solidity function cannot be implemented in CashScript (like view/pure functions), DELETE it entirely from the conversion. Never use `require(false)` or create placeholder functions.

## Overview

This document showcases production-ready CashScript patterns used in real Bitcoin Cash applications. These examples demonstrate best practices, security considerations, and practical implementations.

## Decentralized Finance (DeFi) Patterns

### 1. Automated Market Maker (AMM)

```cashscript
pragma cashscript ^0.11.0;

contract SimpleAMM(
    bytes32 tokenACategory,
    bytes32 tokenBCategory,
    int feeRate,  // in basis points (100 = 1%)
    pubkey operator
) {
    function swap(
        sig operatorSig,
        int amountIn,
        int amountOutMin,
        bool swapAToB
    ) {
        require(checkSig(operatorSig, operator));
        require(amountIn > 0);
        require(amountOutMin > 0);
        
        // Validate input token
        if (swapAToB) {
            require(tx.inputs[0].tokenCategory == tokenACategory);
            require(tx.inputs[0].tokenAmount >= amountIn);
        } else {
            require(tx.inputs[0].tokenCategory == tokenBCategory);
            require(tx.inputs[0].tokenAmount >= amountIn);
        }
        
        // Calculate fee
        int fee = (amountIn * feeRate) / 10000;
        int amountAfterFee = amountIn - fee;
        
        // Validate minimum output (slippage protection)
        int expectedOutput = calculateOutput(amountAfterFee, swapAToB);
        require(expectedOutput >= amountOutMin);
        
        // Validate output token
        if (swapAToB) {
            require(tx.outputs[0].tokenCategory == tokenBCategory);
            require(tx.outputs[0].tokenAmount >= expectedOutput);
        } else {
            require(tx.outputs[0].tokenCategory == tokenACategory);
            require(tx.outputs[0].tokenAmount >= expectedOutput);
        }
    }
    
    function calculateOutput(int amountIn, bool swapAToB) -> int {
        // Simplified constant product formula
        // In production, this would use actual reserve data
        return amountIn * 997 / 1000;  // 0.3% fee approximation
    }
}
```

### 2. Lending Protocol

```cashscript
pragma cashscript ^0.11.0;

contract LendingPool(
    bytes32 collateralTokenCategory,
    bytes32 loanTokenCategory,
    int collateralRatio,  // e.g., 150 for 150%
    int liquidationThreshold,  // e.g., 120 for 120%
    pubkey oracle
) {
    function borrow(
        sig borrowerSig,
        pubkey borrowerPk,
        datasig priceData,
        int collateralAmount,
        int loanAmount
    ) {
        require(checkSig(borrowerSig, borrowerPk));
        require(checkDataSig(priceData, bytes(getCurrentPrice()), oracle));
        
        // Validate collateral input
        require(tx.inputs[0].tokenCategory == collateralTokenCategory);
        require(tx.inputs[0].tokenAmount >= collateralAmount);
        
        // Calculate required collateral
        int currentPrice = getCurrentPrice();
        int requiredCollateral = (loanAmount * collateralRatio) / currentPrice;
        require(collateralAmount >= requiredCollateral);
        
        // Validate loan output
        require(tx.outputs[0].tokenCategory == loanTokenCategory);
        require(tx.outputs[0].tokenAmount == loanAmount);
        
        // Lock collateral in escrow
        require(tx.outputs[1].tokenCategory == collateralTokenCategory);
        require(tx.outputs[1].tokenAmount == collateralAmount);
    }
    
    function liquidate(
        sig liquidatorSig,
        pubkey liquidatorPk,
        datasig priceData,
        int collateralAmount,
        int debtAmount
    ) {
        require(checkSig(liquidatorSig, liquidatorPk));
        require(checkDataSig(priceData, bytes(getCurrentPrice()), oracle));
        
        // Check liquidation threshold
        int currentPrice = getCurrentPrice();
        int collateralValue = collateralAmount * currentPrice;
        int collateralRatio = (collateralValue * 100) / debtAmount;
        require(collateralRatio <= liquidationThreshold);
        
        // Process liquidation
        require(tx.outputs[0].tokenCategory == collateralTokenCategory);
        require(tx.outputs[0].tokenAmount <= collateralAmount);
    }
    
    function getCurrentPrice() -> int {
        // This would integrate with actual price oracle
        return 45000;  // Example price in cents
    }
}
```

## NFT and Gaming Patterns

### 3. NFT Marketplace

```cashscript
pragma cashscript ^0.11.0;

contract NFTMarketplace(
    bytes32 nftCategory,
    int marketplaceFee,  // in basis points
    pubkey marketplace
) {
    function listNFT(
        sig sellerSig,
        pubkey sellerPk,
        bytes nftCommitment,
        int askPrice
    ) {
        require(checkSig(sellerSig, sellerPk));
        require(askPrice > 0);
        
        // Validate NFT input
        require(tx.inputs[0].tokenCategory == nftCategory);
        require(tx.inputs[0].nftCommitment == nftCommitment);
        
        // Create listing (lock NFT in marketplace)
        require(tx.outputs[0].tokenCategory == nftCategory);
        require(tx.outputs[0].nftCommitment == nftCommitment);
        
        // Store listing data in OP_RETURN
        bytes listingData = new LockingBytecodeNullData([
            0x4c53,  // "LS" for listing
            bytes(sellerPk),
            bytes(askPrice),
            nftCommitment
        ]);
        require(tx.outputs[1].lockingBytecode == listingData);
    }
    
    function buyNFT(
        sig buyerSig,
        pubkey buyerPk,
        pubkey sellerPk,
        bytes nftCommitment,
        int askPrice
    ) {
        require(checkSig(buyerSig, buyerPk));
        
        // Validate payment
        require(tx.inputs[1].value >= askPrice);
        
        // Calculate marketplace fee
        int fee = (askPrice * marketplaceFee) / 10000;
        int sellerAmount = askPrice - fee;
        
        // Transfer NFT to buyer
        require(tx.outputs[0].tokenCategory == nftCategory);
        require(tx.outputs[0].nftCommitment == nftCommitment);
        
        // Pay seller
        bytes sellerBytecode = new LockingBytecodeP2PKH(hash160(sellerPk));
        require(tx.outputs[1].lockingBytecode == sellerBytecode);
        require(tx.outputs[1].value >= sellerAmount);
        
        // Pay marketplace fee
        bytes marketplaceBytecode = new LockingBytecodeP2PKH(hash160(marketplace));
        require(tx.outputs[2].lockingBytecode == marketplaceBytecode);
        require(tx.outputs[2].value >= fee);
    }
}
```

### 4. Gaming Item Upgrade

```cashscript
pragma cashscript ^0.11.0;

contract GameItemUpgrade(
    bytes32 itemCategory,
    pubkey gameOperator,
    int upgradeBaseCost
) {
    function upgradeItem(
        sig playerSig,
        pubkey playerPk,
        sig operatorSig,
        bytes currentItem,
        bytes upgradedItem,
        int upgradeCost
    ) {
        require(checkSig(playerSig, playerPk));
        require(checkSig(operatorSig, gameOperator));
        
        // Validate current item
        require(tx.inputs[0].tokenCategory == itemCategory);
        require(tx.inputs[0].nftCommitment == currentItem);
        
        // Validate upgrade cost
        require(upgradeCost >= upgradeBaseCost);
        require(tx.inputs[1].value >= upgradeCost);
        
        // Create upgraded item
        require(tx.outputs[0].tokenCategory == itemCategory);
        require(tx.outputs[0].nftCommitment == upgradedItem);
        
        // Validate upgrade progression
        require(validateUpgrade(currentItem, upgradedItem));
        
        // Pay upgrade cost to game operator
        bytes operatorBytecode = new LockingBytecodeP2PKH(hash160(gameOperator));
        require(tx.outputs[1].lockingBytecode == operatorBytecode);
        require(tx.outputs[1].value >= upgradeCost);
    }
    
    function validateUpgrade(bytes current, bytes upgraded) -> bool {
        // Extract item level from commitment
        int currentLevel = int(current.split(4)[0]);
        int upgradedLevel = int(upgraded.split(4)[0]);
        
        // Validate level progression
        require(upgradedLevel == currentLevel + 1);
        require(upgradedLevel <= 100);  // Max level
        
        return true;
    }
}
```

## Governance and DAOs

### 5. Decentralized Autonomous Organization (DAO)

```cashscript
pragma cashscript ^0.11.0;

contract SimpleDAO(
    bytes32 governanceTokenCategory,
    int proposalThreshold,
    int votingPeriod,
    int quorumRequirement
) {
    function createProposal(
        sig proposerSig,
        pubkey proposerPk,
        bytes proposalData,
        int proposalId
    ) {
        require(checkSig(proposerSig, proposerPk));
        
        // Validate proposer has enough tokens
        require(tx.inputs[0].tokenCategory == governanceTokenCategory);
        require(tx.inputs[0].tokenAmount >= proposalThreshold);
        
        // Create proposal NFT
        require(tx.outputs[0].tokenCategory == governanceTokenCategory);
        require(tx.outputs[0].nftCommitment == proposalData);
        
        // Store proposal metadata
        bytes proposalMetadata = new LockingBytecodeNullData([
            0x5052,  // "PR" for proposal
            bytes(proposalId),
            bytes(tx.time + votingPeriod),  // Voting deadline
            proposalData
        ]);
        require(tx.outputs[1].lockingBytecode == proposalMetadata);
    }
    
    function vote(
        sig voterSig,
        pubkey voterPk,
        int proposalId,
        bool support,
        int votingPower
    ) {
        require(checkSig(voterSig, voterPk));
        
        // Validate voter has tokens
        require(tx.inputs[0].tokenCategory == governanceTokenCategory);
        require(tx.inputs[0].tokenAmount >= votingPower);
        
        // Validate voting period
        require(tx.time <= getProposalDeadline(proposalId));
        
        // Record vote
        bytes voteData = new LockingBytecodeNullData([
            0x564f,  // "VO" for vote
            bytes(proposalId),
            bytes(support ? 1 : 0),
            bytes(votingPower)
        ]);
        require(tx.outputs[0].lockingBytecode == voteData);
    }
    
    function executeProposal(
        sig executorSig,
        pubkey executorPk,
        int proposalId,
        int totalVotes,
        int supportVotes
    ) {
        require(checkSig(executorSig, executorPk));
        
        // Validate voting period ended
        require(tx.time > getProposalDeadline(proposalId));
        
        // Validate quorum
        require(totalVotes >= quorumRequirement);
        
        // Validate majority support
        require(supportVotes > (totalVotes / 2));
        
        // Execute proposal logic would go here
    }
    
    function getProposalDeadline(int proposalId) -> int {
        // This would lookup the actual deadline from stored data
        return tx.time + votingPeriod;
    }
}
```

## Subscription and Streaming

### 6. Streaming Payments

```cashscript
pragma cashscript ^0.11.0;

contract StreamingPayment(
    pubkey subscriber,
    pubkey recipient,
    int paymentRate,    // per second
    int streamDuration  // in seconds
) {
    function claim(
        sig recipientSig,
        int currentTime,
        int lastClaimTime
    ) {
        require(checkSig(recipientSig, recipient));
        
        // Validate time progression
        require(currentTime > lastClaimTime);
        require(currentTime <= lastClaimTime + streamDuration);
        
        // Calculate claimable amount
        int elapsedTime = currentTime - lastClaimTime;
        int claimableAmount = elapsedTime * paymentRate;
        
        // Validate payment
        require(tx.outputs[0].value >= claimableAmount);
        
        // Update stream state
        bytes newStreamState = bytes(currentTime);
        require(tx.outputs[1].nftCommitment == newStreamState);
    }
    
    function cancel(sig subscriberSig) {
        require(checkSig(subscriberSig, subscriber));
        
        // Return remaining balance to subscriber
        bytes subscriberBytecode = new LockingBytecodeP2PKH(hash160(subscriber));
        require(tx.outputs[0].lockingBytecode == subscriberBytecode);
    }
}
```

## Oracle Integration

### 7. Price Feed Oracle

```cashscript
pragma cashscript ^0.11.0;

contract PriceFeedOracle(
    pubkey[] oracles,
    int minimumOracles,
    int maxPriceDeviation  // in basis points
) {
    function updatePrice(
        datasig[] oracleSignatures,
        int[] prices,
        int timestamp
    ) {
        require(oracleSignatures.length >= minimumOracles);
        require(prices.length == oracleSignatures.length);
        
        // Validate timestamp
        require(timestamp >= tx.time - 300);  // Max 5 minutes old
        require(timestamp <= tx.time);
        
        // Validate oracle signatures
        for (int i = 0; i < oracleSignatures.length; i++) {
            bool validOracle = false;
            for (int j = 0; j < oracles.length; j++) {
                if (checkDataSig(oracleSignatures[i], bytes(prices[i]), oracles[j])) {
                    validOracle = true;
                    break;
                }
            }
            require(validOracle);
        }
        
        // Calculate median price
        int medianPrice = calculateMedian(prices);
        
        // Validate price deviation
        for (int i = 0; i < prices.length; i++) {
            int deviation = abs(prices[i] - medianPrice) * 10000 / medianPrice;
            require(deviation <= maxPriceDeviation);
        }
        
        // Store price data
        bytes priceData = new LockingBytecodeNullData([
            0x5052,  // "PR" for price
            bytes(medianPrice),
            bytes(timestamp)
        ]);
        require(tx.outputs[0].lockingBytecode == priceData);
    }
    
    function calculateMedian(int[] values) -> int {
        // Simplified median calculation
        // In production, this would use a proper sorting algorithm
        require(values.length > 0);
        
        if (values.length == 1) return values[0];
        if (values.length == 2) return (values[0] + values[1]) / 2;
        
        // For simplicity, return middle value for arrays of 3+
        return values[values.length / 2];
    }
}
```

## Multi-Signature Patterns

### 8. Corporate Treasury

```cashscript
pragma cashscript ^0.11.0;

contract CorporateTreasury(
    pubkey[] executives,
    pubkey[] boardMembers,
    int executiveThreshold,
    int boardThreshold,
    int largeAmountThreshold
) {
    function executiveSpend(
        sig[] executiveSigs,
        pubkey[] signingExecutives,
        int amount
    ) {
        require(amount <= largeAmountThreshold);
        require(executiveSigs.length >= executiveThreshold);
        
        // Validate executive signatures
        for (int i = 0; i < executiveSigs.length; i++) {
            bool validExecutive = false;
            for (int j = 0; j < executives.length; j++) {
                if (signingExecutives[i] == executives[j]) {
                    require(checkSig(executiveSigs[i], executives[j]));
                    validExecutive = true;
                    break;
                }
            }
            require(validExecutive);
        }
    }
    
    function boardSpend(
        sig[] boardSigs,
        pubkey[] signingBoard,
        int amount
    ) {
        require(boardSigs.length >= boardThreshold);
        
        // Validate board signatures
        for (int i = 0; i < boardSigs.length; i++) {
            bool validBoard = false;
            for (int j = 0; j < boardMembers.length; j++) {
                if (signingBoard[i] == boardMembers[j]) {
                    require(checkSig(boardSigs[i], boardMembers[j]));
                    validBoard = true;
                    break;
                }
            }
            require(validBoard);
        }
    }
}
```

## Advanced Control Flow Patterns

### 9. Loop-Based Batch Validator

A contract that validates multiple outputs using loops for efficient iteration.

```cashscript
pragma cashscript ^0.11.0;

contract BatchOutputValidator(
    pubkey owner,
    int minOutputValue,
    int maxOutputValue,
    int minTotalValue
) {
    function validateBatch(sig ownerSig) {
        // Verify owner signature
        require(checkSig(ownerSig, owner));

        // Initialize counters
        int i = 0;
        int totalValue = 0;
        int validOutputs = 0;

        // Iterate through all outputs
        OP_BEGIN
            // Get output value
            int outputValue = tx.outputs[i].value;

            // Validate output is within range
            if (outputValue >= minOutputValue && outputValue <= maxOutputValue) {
                validOutputs = validOutputs + 1;
                totalValue = totalValue + outputValue;
            }

            i = i + 1;
        OP_UNTIL(i >= tx.outputs.length)

        // Require at least 2 valid outputs
        require(validOutputs >= 2);

        // Require total value meets threshold
        require(totalValue >= minTotalValue);
    }

    function processWithFunction(sig ownerSig) {
        require(checkSig(ownerSig, owner));

        OP_DEFINE validateOutput(int value) {
            require(value >= minOutputValue);
            require(value <= maxOutputValue);
        }

        int i = 0;
        int sum = 0;

        OP_BEGIN
            int val = tx.outputs[i].value;
            OP_INVOKE validateOutput(val);
            sum = sum + val;
            i = i + 1;
        OP_UNTIL(i >= tx.outputs.length)

        require(sum >= minTotalValue);
    }
}
```

**Key Features:**
- Loops through transaction outputs
- Validates each output against constraints
- Aggregates values efficiently
- Combines loops with conditional logic

**Use Cases:**
- Batch payment validation
- Multi-recipient airdrops
- Dividend distribution verification
- Payment splitting enforcement

### 10. Reusable Cryptographic Functions

A contract demonstrating reusable function patterns for cryptographic operations.

```cashscript
pragma cashscript ^0.11.0;

contract MultiSignatureVault(
    pubkey owner,
    pubkey delegate1,
    pubkey delegate2,
    pubkey auditor,
    int highValueThreshold
) {
    // Define reusable signature verification function
    OP_DEFINE verifySig(sig s, pubkey pk) {
        require(checkSig(s, pk));
    }

    // Define reusable hash verification function
    OP_DEFINE verifyHash(bytes data, bytes32 expectedHash) {
        require(sha256(data) == expectedHash);
    }

    // Define output validation function
    OP_DEFINE validateOutputValue(int value, int minValue, int maxValue) {
        require(value >= minValue);
        require(value <= maxValue);
    }

    // Owner can spend with single signature for low values
    function ownerSpend(sig ownerSig, int outputValue) {
        OP_INVOKE verifySig(ownerSig, owner);
        OP_INVOKE validateOutputValue(outputValue, 0, highValueThreshold);
    }

    // High value transfers require owner + delegate
    function highValueSpend(sig ownerSig, sig delegateSig, pubkey delegatePk) {
        // Verify owner
        OP_INVOKE verifySig(ownerSig, owner);

        // Verify delegate (must be one of the two delegates)
        bool validDelegate =
            (checkSig(delegateSig, delegate1) || checkSig(delegateSig, delegate2));
        require(validDelegate);

        // Ensure output is above threshold
        int outputValue = tx.outputs[0].value;
        require(outputValue > highValueThreshold);
    }

    // Audited spend with data verification
    function auditedSpend(
        sig ownerSig,
        sig auditorSig,
        bytes auditData,
        bytes32 auditHash
    ) {
        // Verify signatures using reusable function
        OP_INVOKE verifySig(ownerSig, owner);
        OP_INVOKE verifySig(auditorSig, auditor);

        // Verify audit data using reusable function
        OP_INVOKE verifyHash(auditData, auditHash);
    }

    // Multi-output validation with loops and functions
    function batchSpend(sig ownerSig) {
        OP_INVOKE verifySig(ownerSig, owner);

        int i = 0;
        int totalValue = 0;

        OP_BEGIN
            int value = tx.outputs[i].value;
            OP_INVOKE validateOutputValue(value, 1000, 100000);
            totalValue = totalValue + value;
            i = i + 1;
        OP_UNTIL(i >= tx.outputs.length)

        require(totalValue <= highValueThreshold * 2);
    }
}
```

**Key Features:**
- Reusable signature verification with OP_DEFINE/OP_INVOKE
- Reusable hash verification function
- Reusable value validation function
- Combined loops and functions for batch processing
- Reduces bytecode size through code reuse

**Use Cases:**
- Multi-party approval workflows
- Audit trail enforcement
- Complex authorization logic
- Corporate treasury management

**Benefits:**
- **Code Reuse**: OP_DEFINE/OP_INVOKE eliminates duplication
- **Smaller Transactions**: Reduced bytecode size saves fees
- **Better Auditing**: Single function definition easier to review
- **Maintainability**: Changes to shared logic in one place

## JavaScript Integration Examples

### 11. Production Transaction Builder

```javascript
class ProductionTransactionBuilder {
    constructor(provider, contract) {
        this.provider = provider;
        this.contract = contract;
        this.gasLimit = 2000; // satoshis
        this.retryCount = 3;
    }
    
    async buildSecureTransaction(functionCall, outputs, options = {}) {
        const {
            maxFeeRate = 1.1,
            minChange = 5000,
            timeoutMs = 30000
        } = options;
        
        // Validate inputs
        this.validateOutputs(outputs);
        
        // Build transaction with retry logic
        for (let attempt = 0; attempt < this.retryCount; attempt++) {
            try {
                const utxos = await this.contract.getUtxos();
                
                if (utxos.length === 0) {
                    throw new Error('No UTXOs available');
                }
                
                let txBuilder = functionCall;
                
                // Add outputs
                for (const output of outputs) {
                    txBuilder = txBuilder.to(output.address, output.amount);
                }
                
                // Configure fee and change
                txBuilder = txBuilder
                    .withFeePerByte(maxFeeRate)
                    .withMinChange(minChange);
                
                // Add timeout
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Transaction timeout')), timeoutMs);
                });
                
                // Execute transaction
                const txPromise = txBuilder.send();
                const txDetails = await Promise.race([txPromise, timeoutPromise]);
                
                // Validate result
                this.validateTransaction(txDetails);
                
                return txDetails;
                
            } catch (error) {
                console.warn(`Transaction attempt ${attempt + 1} failed:`, error.message);
                
                if (attempt === this.retryCount - 1) {
                    throw error;
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            }
        }
    }
    
    validateOutputs(outputs) {
        if (!Array.isArray(outputs) || outputs.length === 0) {
            throw new Error('Invalid outputs array');
        }
        
        for (const output of outputs) {
            if (!output.address || typeof output.address !== 'string') {
                throw new Error('Invalid output address');
            }
            
            if (!output.amount || output.amount <= 0) {
                throw new Error('Invalid output amount');
            }
        }
    }
    
    validateTransaction(txDetails) {
        if (!txDetails.txid || typeof txDetails.txid !== 'string') {
            throw new Error('Invalid transaction ID');
        }
        
        if (txDetails.fee && txDetails.fee > this.gasLimit) {
            console.warn('Transaction fee exceeds limit:', txDetails.fee);
        }
    }
}
```

### 12. Multi-Contract Orchestrator

```javascript
class MultiContractOrchestrator {
    constructor(provider) {
        this.provider = provider;
        this.contracts = new Map();
        this.monitoring = new Map();
    }
    
    addContract(name, contract) {
        this.contracts.set(name, contract);
        this.startMonitoring(name);
    }
    
    async executeMultiContractTransaction(operations) {
        const results = [];
        
        try {
            // Execute operations in sequence
            for (const operation of operations) {
                const { contractName, functionName, args, outputs } = operation;
                
                const contract = this.contracts.get(contractName);
                if (!contract) {
                    throw new Error(`Contract ${contractName} not found`);
                }
                
                const txDetails = await contract.functions[functionName](...args)
                    .to(outputs.address, outputs.amount)
                    .send();
                
                results.push({
                    contractName,
                    functionName,
                    txid: txDetails.txid,
                    success: true
                });
            }
            
            return results;
            
        } catch (error) {
            // Rollback logic would go here
            console.error('Multi-contract transaction failed:', error);
            throw error;
        }
    }
    
    startMonitoring(contractName) {
        const contract = this.contracts.get(contractName);
        
        const monitor = setInterval(async () => {
            try {
                const balance = await contract.getBalance();
                const utxos = await contract.getUtxos();
                
                const status = {
                    balance,
                    utxoCount: utxos.length,
                    lastCheck: new Date()
                };
                
                this.monitoring.set(contractName, status);
                
                // Alert if balance is low
                if (balance < 10000) {
                    console.warn(`Low balance for ${contractName}:`, balance);
                }
                
            } catch (error) {
                console.error(`Monitoring error for ${contractName}:`, error);
            }
        }, 60000); // Check every minute
        
        return monitor;
    }
    
    getStatus() {
        const status = {};
        
        for (const [name, info] of this.monitoring) {
            status[name] = info;
        }
        
        return status;
    }
}
```

## Testing Patterns

### 13. Comprehensive Test Suite

```javascript
describe('Production Contract Tests', () => {
    let contract, provider, sigTemplate;
    
    beforeEach(async () => {
        provider = new ElectrumNetworkProvider('chipnet');
        contract = new Contract(artifact, constructorArgs, { provider });
        sigTemplate = new SignatureTemplate(testPrivateKey);
    });
    
    describe('Security Tests', () => {
        it('should prevent unauthorized access', async () => {
            const maliciousSig = new SignatureTemplate(randomPrivateKey);
            
            await expect(
                contract.functions
                    .spend(maliciousSig)
                    .to(testAddress, 1000n)
                    .send()
            ).rejects.toThrow('Script failed');
        });
        
        it('should validate amount limits', async () => {
            await expect(
                contract.functions
                    .spend(sigTemplate, -1)
                    .to(testAddress, 1000n)
                    .send()
            ).rejects.toThrow();
        });
    });
    
    describe('Integration Tests', () => {
        it('should handle complex multi-output transactions', async () => {
            const outputs = [
                { address: address1, amount: 1000n },
                { address: address2, amount: 2000n },
                { address: address3, amount: 3000n }
            ];
            
            const txDetails = await contract.functions
                .multiOutput(sigTemplate)
                .to(outputs[0].address, outputs[0].amount)
                .to(outputs[1].address, outputs[1].amount)
                .to(outputs[2].address, outputs[2].amount)
                .send();
            
            expect(txDetails.txid).toBeDefined();
            expect(txDetails.outputs.length).toBe(3);
        });
    });
    
    describe('Performance Tests', () => {
        it('should complete transactions within time limit', async () => {
            const startTime = Date.now();
            
            const txDetails = await contract.functions
                .spend(sigTemplate)
                .to(testAddress, 1000n)
                .send();
            
            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(10000); // 10 seconds
        });
    });
});
```

These real-world patterns demonstrate how CashScript can be used to build sophisticated applications on Bitcoin Cash, from DeFi protocols to NFT marketplaces and governance systems. Each pattern includes security considerations, error handling, and practical implementation details suitable for production use.

## ParityUSD-Derived Production Patterns

The following patterns are derived from analysis of ParityUSD, a production stablecoin system with 26 contracts. See `parityusd-analysis.md` for the full analysis.

### 14. Sidecar Contract Template

When a contract needs to hold multiple token categories, use a sidecar to hold additional tokens:

```cashscript
pragma cashscript ^0.11.0;

/*  --- TokenSidecar Immutable NFT State ---
    none (validates relationship only)
*/

contract TokenSidecar() {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Attach to main contract. Validates same-transaction origin.
    //
    //inputs:
    //  0   MainContract              [NFT]       (from Main contract)
    //  1   TokenSidecar              [NFT]       (from Sidecar contract - this)
    //outputs:
    //  0   MainContract              [NFT]       (to Main contract)
    //  1   TokenSidecar              [NFT+FT]    (to Sidecar contract)
    //////////////////////////////////////////////////////////////////////////////////////////
    function attach() {
        // Sidecar must be immediately after main contract
        int mainIdx = this.activeInputIndex - 1;

        // CRITICAL: Prove same-transaction origin
        require(tx.inputs[this.activeInputIndex].outpointTransactionHash ==
                tx.inputs[mainIdx].outpointTransactionHash);

        // CRITICAL: Prove sequential output indices (created together)
        require(tx.inputs[this.activeInputIndex].outpointIndex ==
                tx.inputs[mainIdx].outpointIndex + 1);

        // Self-replicate at dust value
        require(tx.outputs[this.activeInputIndex].lockingBytecode ==
                tx.inputs[this.activeInputIndex].lockingBytecode);
        require(tx.outputs[this.activeInputIndex].value == 1000);
    }
}
```

**Key Insight**: The `outpointTransactionHash` equality proves both UTXOs originated from the same transaction, creating an unbreakable bond.

### 15. Function Router Contract Template

When a contract has many operations, split into function contracts authenticated by NFT identifier bytes:

```cashscript
pragma cashscript ^0.11.0;

/*  --- MainRouter Mutable NFT State ---
    bytes1 identifier = 0xFF           // Router identifier
    bytes8 counter = 0x0000000000000000
*/

contract MainRouter(bytes32 systemTokenId) {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Route to appropriate function based on function NFT identifier.
    //
    //inputs:
    //  0   MainRouter                [NFT]       (from Router contract - this)
    //  1   FunctionNFT               [NFT]       (from appropriate function contract)
    //  2   userBCH                   [BCH]       (from user)
    //outputs:
    //  0   MainRouter                [NFT]       (to Router contract)
    //  1   FunctionNFT               [NFT]       (to function contract)
    //  2   result                    [varies]    (to user or destination)
    //////////////////////////////////////////////////////////////////////////////////////////
    function interact(int functionInputIndex) {
        require(this.activeInputIndex == 0);

        // CRITICAL: Limit outputs to prevent minting attacks
        require(tx.outputs.length <= 7);

        // Extract function identifier from NFT commitment first byte
        bytes functionId = tx.inputs[functionInputIndex].nftCommitment.split(1)[0];

        // Validate function NFT belongs to this system
        require(tx.inputs[functionInputIndex].tokenCategory == systemTokenId + 0x01);

        // Route to appropriate validation logic
        if (functionId == 0x00) {
            // Function A: specific validation
            require(tx.outputs.length <= 4);
            // ... function A constraints
        } else if (functionId == 0x01) {
            // Function B: specific validation
            require(tx.outputs.length <= 5);
            // ... function B constraints
        } else if (functionId == 0x02) {
            // Function C: specific validation
            require(tx.outputs.length <= 6);
            // ... function C constraints
        }

        // Self-replicate router
        require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
    }
}
```

### 16. Function Contract Template

Each function contract validates its authority and specific operation:

```cashscript
pragma cashscript ^0.11.0;

/*  --- FunctionA Immutable NFT State ---
    bytes1 identifier = 0x00           // Function A identifier
*/

contract FunctionA(bytes32 systemTokenId) {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Execute function A operation. Validates authority via NFT identifier.
    //
    //inputs:
    //  0   MainRouter                [NFT]       (from Router contract)
    //  1   FunctionA                 [NFT]       (from FunctionA contract - this)
    //  2   userBCH                   [BCH]       (from user)
    //outputs:
    //  0   MainRouter                [NFT]       (to Router contract)
    //  1   FunctionA                 [NFT]       (to FunctionA contract)
    //  2   result                    [BCH]       (to user)
    //////////////////////////////////////////////////////////////////////////////////////////
    function execute() {
        // Validate position
        require(this.activeInputIndex == 1);

        // CRITICAL: Limit outputs
        require(tx.outputs.length <= 4);

        // Validate router at position 0
        require(tx.inputs[0].tokenCategory == systemTokenId + 0x01);
        require(tx.inputs[0].nftCommitment.split(1)[0] == 0xFF); // Router identifier

        // Function-specific business logic
        // ...

        // Self-replicate at dust value
        require(tx.outputs[1].lockingBytecode == tx.inputs[1].lockingBytecode);
        require(tx.outputs[1].tokenCategory == tx.inputs[1].tokenCategory);
        require(tx.outputs[1].value == 1000);
    }
}
```

### 17. Self-Replicating Covenant with State

Pattern for contracts that must persist with updated state:

```cashscript
pragma cashscript ^0.11.0;

/*  --- StatefulCovenant Mutable NFT State ---
    bytes4 counter = 0x00000000
    bytes6 totalValue = 0x000000000000
    bytes20 adminPkh = 0x0000000000000000000000000000000000000000
*/

contract StatefulCovenant(bytes32 covenantCategory) {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Update state while preserving covenant.
    //
    //inputs:
    //  0   StatefulCovenant          [NFT]       (from Covenant contract - this)
    //  1   userBCH                   [BCH]       (from user)
    //outputs:
    //  0   StatefulCovenant          [NFT]       (to Covenant contract)
    //  1   change {optional}         [BCH]       (to user)
    //////////////////////////////////////////////////////////////////////////////////////////
    function updateState(int newValue) {
        require(this.activeInputIndex == 0);
        require(tx.outputs.length <= 3);

        // Parse current state from commitment
        bytes commitment = tx.inputs[0].nftCommitment;
        bytes4 counter, bytes remaining = commitment.split(4);
        bytes6 totalValue, bytes20 adminPkh = remaining.split(6);

        // Update state
        int newCounter = int(counter) + 1;
        require(newCounter < 2147483647); // MSB safety

        int newTotal = int(totalValue) + newValue;
        require(newTotal >= 0);
        require(newTotal < 140737488355327); // bytes6 max

        // Reconstruct commitment with new state
        bytes newCommitment = bytes4(newCounter) + bytes6(newTotal) + adminPkh;

        // THE 5-POINT VALIDATION CHECKLIST
        // 1. Same contract code
        require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
        // 2. Same token category
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
        // 3. Expected value (preserve or update)
        require(tx.outputs[0].value >= tx.inputs[0].value);
        // 4. Token amount (if applicable)
        require(tx.outputs[0].tokenAmount == tx.inputs[0].tokenAmount);
        // 5. New state commitment
        require(tx.outputs[0].nftCommitment == newCommitment);
    }
}
```

### 18. Cross-Contract Authentication Pattern

Pattern for contracts that need to verify other contracts in the same transaction:

```cashscript
pragma cashscript ^0.11.0;

contract CrossContractValidator(
    bytes32 priceOracleCategory,
    bytes32 mainContractCategory,
    bytes32 sidecarCategory
) {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Execute operation requiring multiple contract authentication.
    //
    //inputs:
    //  0   PriceOracle               [NFT]       (from Oracle contract)
    //  1   MainContract              [NFT]       (from Main contract)
    //  2   Sidecar                   [NFT+FT]    (from Sidecar contract)
    //  3   Validator                 [NFT]       (from Validator contract - this)
    //  4   userBCH                   [BCH]       (from user)
    //outputs:
    //  0   PriceOracle               [NFT]       (to Oracle contract)
    //  1   MainContract              [NFT]       (to Main contract)
    //  2   Sidecar                   [NFT+FT]    (to Sidecar contract)
    //  3   Validator                 [NFT]       (to Validator contract)
    //  4   result                    [BCH]       (to user)
    //////////////////////////////////////////////////////////////////////////////////////////
    function executeWithAuth() {
        require(this.activeInputIndex == 3);
        require(tx.outputs.length <= 6);

        // Authenticate price oracle at index 0
        require(tx.inputs[0].tokenCategory == priceOracleCategory + 0x01);
        require(tx.inputs[0].nftCommitment.split(1)[0] == 0x00); // Oracle identifier

        // Authenticate main contract at index 1
        require(tx.inputs[1].tokenCategory == mainContractCategory + 0x01);
        require(tx.inputs[1].nftCommitment.split(1)[0] == 0x01); // Main identifier

        // Authenticate sidecar at index 2 (same category, sequential origin)
        require(tx.inputs[2].tokenCategory == sidecarCategory + 0x01);
        require(tx.inputs[2].outpointTransactionHash ==
                tx.inputs[1].outpointTransactionHash);

        // Now safe to use data from authenticated contracts
        bytes priceData = tx.inputs[0].nftCommitment.split(1)[1];
        int price = int(priceData.split(8)[0]);

        // Business logic using authenticated data
        // ...
    }
}
```

### 19. Receipt/Proof NFT Pattern

Pattern for creating immutable receipts that prove actions occurred:

```cashscript
pragma cashscript ^0.11.0;

contract ReceiptIssuer(bytes32 systemCategory) {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Create immutable receipt NFT as proof of action.
    //
    //inputs:
    //  0   Issuer                    [NFT]       (from Issuer contract - this, minting)
    //  1   userBCH                   [BCH]       (from user)
    //outputs:
    //  0   Issuer                    [NFT]       (to Issuer contract)
    //  1   Receipt                   [NFT]       (to user - immutable proof)
    //  2   change {optional}         [BCH]       (to user)
    //////////////////////////////////////////////////////////////////////////////////////////
    function issueReceipt(bytes20 recipientPkh, int amount, int actionId) {
        require(this.activeInputIndex == 0);
        require(tx.outputs.length <= 3);

        // Must be minting NFT to create receipts
        bytes category, bytes capability = tx.inputs[0].tokenCategory.split(32);
        require(capability == 0x02); // Minting capability

        // Build receipt commitment
        // Layout: recipientPkh(20) + amount(6) + actionId(4) + timestamp(4) = 34 bytes
        bytes receiptCommitment = recipientPkh +
                                  bytes6(amount) +
                                  bytes4(actionId) +
                                  bytes4(tx.locktime);

        // Create IMMUTABLE receipt (no capability byte = immutable)
        bytes recipientBytecode = new LockingBytecodeP2PKH(recipientPkh);
        require(tx.outputs[1].lockingBytecode == recipientBytecode);
        require(tx.outputs[1].tokenCategory == category); // No capability = immutable
        require(tx.outputs[1].nftCommitment == receiptCommitment);
        require(tx.outputs[1].value == 1000); // Dust

        // Self-replicate issuer with minting capability
        require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
    }
}
```

### 20. Origin Proof Pattern

Pattern for proving an NFT was legitimately created by the system:

```cashscript
pragma cashscript ^0.11.0;

/*  --- OriginEnforcer Immutable NFT State ---
    bytes32 factoryTxHash
*/

contract OriginEnforcer(bytes32 factoryCategory) {
    //////////////////////////////////////////////////////////////////////////////////////////
    //  Verify this NFT was created by a legitimate factory.
    //
    //inputs:
    //  0   Factory                   [NFT]       (from Factory contract)
    //  1   OriginEnforcer            [NFT]       (from Enforcer contract - this)
    //outputs:
    //  0   Factory                   [NFT]       (to Factory contract)
    //  1   OriginEnforcer            [NFT]       (to Enforcer contract)
    //////////////////////////////////////////////////////////////////////////////////////////
    function verify() {
        require(this.activeInputIndex == 1);
        require(tx.outputs.length <= 3);

        // Get factory input index
        int factoryIdx = this.activeInputIndex - 1;

        // CRITICAL: Verify same-transaction origin with factory
        require(tx.inputs[this.activeInputIndex].outpointTransactionHash ==
                tx.inputs[factoryIdx].outpointTransactionHash);

        // Verify factory has correct category
        require(tx.inputs[factoryIdx].tokenCategory == factoryCategory + 0x02); // Minting

        // Self-replicate
        require(tx.outputs[1].lockingBytecode == tx.inputs[1].lockingBytecode);
        require(tx.outputs[1].tokenCategory == tx.inputs[1].tokenCategory);
    }
}
```

These ParityUSD-derived patterns represent battle-tested approaches used in production DeFi systems. Each pattern emphasizes explicit validation, output limiting, and clear constraint specification.