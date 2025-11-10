# CashScript Smart Contract Security

## Overview

Smart contract security is critical when handling value on the Bitcoin Cash blockchain. This guide covers essential security practices, common vulnerabilities, and defensive programming techniques for CashScript contracts.

## Core Security Principles

### 1. Fail-Safe Defaults

Design contracts to fail securely when conditions aren't met.

```cashscript
contract SecureContract(pubkey owner, int threshold) {
    function spend(sig ownerSig, int amount) {
        // Explicit validation required
        require(checkSig(ownerSig, owner));
        require(amount >= threshold);
        
        // Additional safety checks
        require(tx.outputs.length >= 1);
        require(tx.outputs[0].value >= amount);
    }
}
```

### 2. Input Validation

Never trust function arguments - validate everything.

```cashscript
contract InputValidation(pubkey owner) {
    function spend(sig userSig, int amount, bytes data) {
        // Validate signature
        require(checkSig(userSig, owner));
        
        // Validate amount
        require(amount > 0);
        require(amount <= 100000000);  // Max 1 BCH
        
        // Validate data
        require(data.length > 0);
        require(data.length <= 256);  // Reasonable data limit
    }
}
```

### 3. Principle of Least Privilege

Grant minimum necessary permissions.

```cashscript
contract RestrictedAccess(pubkey owner, pubkey operator, int operatorLimit) {
    function ownerSpend(sig ownerSig, int amount) {
        require(checkSig(ownerSig, owner));
        // Owner can spend any amount
    }
    
    function operatorSpend(sig operatorSig, int amount) {
        require(checkSig(operatorSig, operator));
        // Operator has limited spending power
        require(amount <= operatorLimit);
    }
}
```

## Common Vulnerabilities

### 1. Insufficient Input Validation

**Vulnerable Code:**
```cashscript
contract VulnerableContract(pubkey owner) {
    function spend(sig userSig, int amount) {
        require(checkSig(userSig, owner));
        // Missing amount validation!
    }
}
```

**Secure Version:**
```cashscript
contract SecureContract(pubkey owner, int maxAmount) {
    function spend(sig userSig, int amount) {
        require(checkSig(userSig, owner));
        require(amount > 0);
        require(amount <= maxAmount);
    }
}
```

### 2. Time-Based Vulnerabilities

**Vulnerable Code:**
```cashscript
contract VulnerableTimelock(pubkey owner, int lockTime) {
    function spend(sig ownerSig) {
        require(checkSig(ownerSig, owner));
        // Vulnerable to time manipulation
        require(tx.time > lockTime);
    }
}
```

**Secure Version:**
```cashscript
contract SecureTimelock(pubkey owner, int lockTime) {
    function spend(sig ownerSig) {
        require(checkSig(ownerSig, owner));
        // Use >= for time comparisons
        require(tx.time >= lockTime);
        
        // Additional validation
        require(lockTime > 0);
    }
}
```

### 3. Signature Malleability

**Vulnerable Code:**
```cashscript
contract VulnerableMultiSig(pubkey pk1, pubkey pk2) {
    function spend(sig s1, sig s2) {
        // Vulnerable to signature substitution
        require(checkSig(s1, pk1));
        require(checkSig(s2, pk2));
    }
}
```

**Secure Version:**
```cashscript
contract SecureMultiSig(pubkey pk1, pubkey pk2) {
    function spend(sig s1, sig s2) {
        // Use checkMultiSig for proper validation
        require(checkMultiSig([s1, s2], [pk1, pk2]));
    }
}
```

### 4. Reentrancy-Like Issues

**Vulnerable Code:**
```cashscript
contract VulnerableState() {
    function spend(int counter) {
        // No validation of state consistency
        require(counter > 0);
    }
}
```

**Secure Version:**
```cashscript
contract SecureState(bytes32 stateHash) {
    function spend(int counter, bytes stateData) {
        // Validate state integrity
        require(sha256(stateData) == stateHash);
        require(counter > 0);
        
        // Extract and validate counter from state
        int currentCounter = int(stateData.split(4)[0]);
        require(counter == currentCounter + 1);
    }
}
```

## Defensive Programming Patterns

### 1. Bounds Checking

```cashscript
contract BoundsChecker(int minValue, int maxValue) {
    function validate(int value) {
        // Explicit bounds checking
        require(value >= minValue);
        require(value <= maxValue);
        
        // Additional safety for array-like operations
        require(minValue <= maxValue);
    }
}
```

### 2. Overflow Protection

```cashscript
contract OverflowProtection() {
    function safeAdd(int a, int b) {
        // Check for addition overflow
        require(a >= 0);
        require(b >= 0);
        
        int result = a + b;
        require(result >= a);  // Overflow check
        require(result >= b);  // Overflow check
    }
    
    function safeMultiply(int a, int b) {
        // Check for multiplication overflow
        require(a >= 0);
        require(b >= 0);
        
        if (a == 0 || b == 0) {
            // Safe multiplication by zero
            return;
        }
        
        int result = a * b;
        require(result / a == b);  // Overflow check
    }
}
```

### 3. Access Control

```cashscript
contract AccessControl(pubkey admin, pubkey[] operators) {
    function adminAction(sig adminSig) {
        require(checkSig(adminSig, admin));
        // Admin-only actions
    }
    
    function operatorAction(sig operatorSig, pubkey operatorPk) {
        // Validate operator is in authorized list
        bool isAuthorized = false;
        for (int i = 0; i < operators.length; i++) {
            if (operators[i] == operatorPk) {
                isAuthorized = true;
                break;
            }
        }
        
        require(isAuthorized);
        require(checkSig(operatorSig, operatorPk));
    }
}
```

### 4. State Validation

```cashscript
contract StateValidation(bytes32 initialStateHash) {
    function updateState(bytes oldState, bytes newState) {
        // Validate old state
        require(sha256(oldState) == initialStateHash);
        
        // Validate state transition
        require(newState.length == oldState.length);
        require(newState != oldState);  // State must change
        
        // Validate new state format
        require(newState.length >= 32);
    }
}
```

## Transaction Security

### 1. Output Validation

```cashscript
contract OutputValidator(bytes20 authorizedRecipient) {
    function spend(sig ownerSig) {
        require(checkSig(ownerSig, owner));
        
        // Validate transaction structure
        require(tx.outputs.length >= 1);
        
        // Validate recipient
        bytes expectedBytecode = new LockingBytecodeP2PKH(authorizedRecipient);
        require(tx.outputs[0].lockingBytecode == expectedBytecode);
        
        // Validate amount
        require(tx.outputs[0].value >= 1000);
    }
}
```

### 2. Input Validation

```cashscript
contract InputValidator() {
    function spend(sig ownerSig) {
        require(checkSig(ownerSig, owner));
        
        // Validate input count
        require(tx.inputs.length >= 1);
        require(tx.inputs.length <= 10);  // Reasonable limit
        
        // Validate input values
        int totalInput = 0;
        for (int i = 0; i < tx.inputs.length; i++) {
            require(tx.inputs[i].value > 0);
            totalInput += tx.inputs[i].value;
        }
        
        // Ensure sufficient input value
        require(totalInput >= 1000);
    }
}
```

### 3. Fee Validation

```cashscript
contract FeeValidator() {
    function spend(sig ownerSig) {
        require(checkSig(ownerSig, owner));
        
        // Calculate total input and output values
        int totalInput = 0;
        int totalOutput = 0;
        
        for (int i = 0; i < tx.inputs.length; i++) {
            totalInput += tx.inputs[i].value;
        }
        
        for (int i = 0; i < tx.outputs.length; i++) {
            totalOutput += tx.outputs[i].value;
        }
        
        // Validate reasonable fee
        int fee = totalInput - totalOutput;
        require(fee >= 1000);     // Minimum fee
        require(fee <= 100000);   // Maximum fee (prevent fee attacks)
    }
}
```

## Cryptographic Security

### 1. Hash Validation

```cashscript
contract HashValidator(bytes32 expectedHash) {
    function validate(bytes preimage) {
        // Validate preimage length
        require(preimage.length > 0);
        require(preimage.length <= 1024);  // Reasonable limit
        
        // Validate hash
        require(sha256(preimage) == expectedHash);
        
        // Additional validation for sensitive data
        require(preimage[0] != 0x00);  // Prevent null byte attacks
    }
}
```

### 2. Signature Validation

```cashscript
contract SignatureValidator(pubkey trustedKey) {
    function validate(sig signature, bytes message) {
        // Validate signature format
        require(signature.length > 0);
        require(signature != 0x00);  // Prevent null signature
        
        // Validate message
        require(message.length > 0);
        require(message.length <= 256);
        
        // Validate signature
        require(checkDataSig(signature, message, trustedKey));
    }
}
```

### 3. Key Validation

```cashscript
contract KeyValidator() {
    function validateKey(pubkey key) {
        // Validate key format
        require(key.length == 33);  // Compressed public key
        
        // Validate key prefix
        require(key[0] == 0x02 || key[0] == 0x03);  // Valid compressed key prefix
        
        // Prevent all-zero keys
        bool isZero = true;
        for (int i = 1; i < key.length; i++) {
            if (key[i] != 0x00) {
                isZero = false;
                break;
            }
        }
        require(!isZero);
    }
}
```

## CashTokens Security

### 1. Token Validation

```cashscript
contract TokenValidator(bytes32 authorizedCategory) {
    function validateToken() {
        // Validate token category
        require(tx.outputs[0].tokenCategory == authorizedCategory);
        
        // Validate token amount
        require(tx.outputs[0].tokenAmount > 0);
        
        // Prevent token overflow
        require(tx.outputs[0].tokenAmount <= 18446744073709551615);  // Max uint64
    }
}
```

### 2. NFT Security

```cashscript
contract NFTValidator(bytes32 authorizedCategory) {
    function validateNFT(bytes expectedCommitment) {
        // Validate NFT category
        require(tx.outputs[0].tokenCategory == authorizedCategory);
        
        // Validate NFT commitment
        require(tx.outputs[0].nftCommitment == expectedCommitment);
        require(expectedCommitment.length > 0);
        require(expectedCommitment.length <= 128);  // Max commitment size
    }
}
```

## Loop Security

### 1. Loop Termination Validation

**Risk**: Infinite loops or excessive iterations consuming validation resources.

**Secure Pattern**:
```cashscript
contract LoopValidator(int maxIterations) {
    function process(int count) {
        // Validate loop bound before execution
        require(count > 0);
        require(count <= maxIterations);

        int i = 0;
        OP_BEGIN
            // Loop body
            i = i + 1;
        OP_UNTIL(i >= count)
    }
}
```

**Best Practices**:
- Always validate loop counters are non-negative
- Set maximum iteration limits
- Verify loop exit conditions are reachable
- Test with boundary values (0, 1, max)

### 2. Loop State Management

**Risk**: Incorrect state accumulation or overflow in loops.

**Secure Pattern**:
```cashscript
contract SecureLoopSum(int threshold) {
    function sumOutputs() {
        int i = 0;
        int total = 0;

        OP_BEGIN
            int value = tx.outputs[i].value;

            // Validate each iteration
            require(value >= 0);

            // Check for potential overflow before adding
            require(total <= 9223372036854775807 - value);

            total = total + value;
            i = i + 1;
        OP_UNTIL(i >= tx.outputs.length)

        require(total >= threshold);
    }
}
```

**Best Practices**:
- Validate data at each iteration
- Check for arithmetic overflow/underflow
- Ensure loop invariants are maintained
- Test with maximum iteration counts

## Function Security

### 1. Function Immutability

**Security Feature**: Functions cannot be redefined after definition, preventing code mutation attacks.

**Secure Pattern**:
```cashscript
contract ImmutableFunctions(pubkey owner) {
    OP_DEFINE verifySig(sig s, pubkey pk) {
        require(checkSig(s, pk));
    }

    // Function definition is immutable
    // Attempting to redefine causes validation failure

    function spend(sig ownerSig) {
        OP_INVOKE verifySig(ownerSig, owner);
    }
}
```

**Best Practices**:
- Define functions once at contract start
- Review all function definitions during audit
- Test that functions cannot be overwritten
- Document function behavior clearly

### 2. Function Parameter Validation

**Risk**: Functions invoked with invalid parameters.

**Secure Pattern**:
```cashscript
contract SecureFunctions(int minValue, int maxValue) {
    OP_DEFINE validateRange(int value) {
        require(value >= minValue);
        require(value <= maxValue);
        require(value != 0);  // Additional constraint
    }

    function processValue(int input) {
        // Validate before invoking
        OP_INVOKE validateRange(input);

        // Safe to use validated input
        require(tx.outputs[0].value >= input);
    }
}
```

**Best Practices**:
- Validate all function parameters
- Check boundary conditions
- Ensure functions handle edge cases
- Test with invalid inputs

### 3. Recursion Depth Limits

**Risk**: Excessive recursion causing validation failures.

**Secure Pattern**:
```cashscript
contract LimitedRecursion(int maxDepth) {
    OP_DEFINE recurse(int n, int depth) {
        // Limit recursion depth
        require(depth < maxDepth);

        if (n > 0) {
            OP_INVOKE recurse(n - 1, depth + 1);
        }
    }

    function validate(int count) {
        OP_INVOKE recurse(count, 0);
    }
}
```

**Best Practices**:
- Set explicit recursion depth limits
- Track depth through parameters
- Test with maximum depth values
- Prefer iterative solutions when possible

## Bitwise Operation Security

### 1. Shift Amount Validation

**Risk**: Invalid shift amounts causing unexpected results.

**Secure Pattern**:
```cashscript
contract SecureBitwise() {
    function safeShift(int value, int shiftAmount) {
        // Validate shift amount is reasonable
        require(shiftAmount >= 0);
        require(shiftAmount <= 64);  // Max meaningful shift

        int result = value << shiftAmount;
        require(result > 0);  // Validate result as expected
    }
}
```

**Best Practices**:
- Validate shift amounts before operations
- Check for zero shifts
- Verify shift results are as expected
- Test boundary cases (0, 1, max bits)

### 2. Bitwise Operation Overflow

**Risk**: Bitwise operations producing unexpected values.

**Secure Pattern**:
```cashscript
contract BitwiseSecurity(int mask) {
    function processFlags(int flags) {
        // Validate input before bitwise operations
        require(flags >= 0);
        require(flags <= 0xFFFFFFFF);  // 32-bit max

        int result = flags & mask;

        // Verify result is within expected range
        require(result >= 0);
        require(result <= mask);
    }
}
```

**Best Practices**:
- Validate inputs to bitwise operations
- Use appropriate masks for bit ranges
- Check operation results
- Test with edge values (0, max, all bits set)

### 3. Bit Flag Security

**Risk**: Incorrect flag checking allowing unauthorized access.

**Secure Pattern**:
```cashscript
contract FlagValidator(int requiredFlags) {
    function checkPermissions(int userFlags) {
        // Validate flags are set correctly
        require(userFlags >= 0);

        // Check required flags are ALL set
        int result = userFlags & requiredFlags;
        require(result == requiredFlags);

        // Optionally check no extra flags are set
        int allowedFlags = 0xFF;
        require((userFlags & ~allowedFlags) == 0);
    }
}
```

**Best Practices**:
- Validate all required flags are set
- Check for unauthorized flags
- Use explicit flag constants
- Test all flag combinations

## Security Testing

### 1. Boundary Testing

```javascript
describe('Contract Security Tests', () => {
    it('should reject negative amounts', async () => {
        await expect(
            contract.functions
                .spend(sigTemplate, -1)
                .to(address, 1000n)
                .send()
        ).rejects.toThrow();
    });
    
    it('should reject zero amounts', async () => {
        await expect(
            contract.functions
                .spend(sigTemplate, 0)
                .to(address, 1000n)
                .send()
        ).rejects.toThrow();
    });
    
    it('should reject excessive amounts', async () => {
        await expect(
            contract.functions
                .spend(sigTemplate, 2100000000000000n)  // > 21M BCH
                .to(address, 1000n)
                .send()
        ).rejects.toThrow();
    });
});
```

### 2. Attack Simulation

```javascript
describe('Attack Vector Tests', () => {
    it('should prevent signature replay', async () => {
        // Create valid transaction
        const txDetails = await contract.functions
            .spend(sigTemplate)
            .to(address, 1000n)
            .send();
        
        // Attempt to replay same signature
        await expect(
            contract.functions
                .spend(sigTemplate)  // Same signature
                .to(address, 1000n)
                .send()
        ).rejects.toThrow();
    });
});
```

## Security Checklist

### Pre-Deployment

- [ ] All inputs are validated
- [ ] Bounds checking implemented
- [ ] Overflow protection in place
- [ ] Access control properly implemented
- [ ] Time-based logic uses appropriate comparisons
- [ ] Signature validation follows best practices
- [ ] Token validation includes all necessary checks
- [ ] Error cases are handled gracefully

### Testing

- [ ] Unit tests cover all functions
- [ ] Boundary conditions tested
- [ ] Attack vectors simulated
- [ ] Integration tests with real transactions
- [ ] Gas/fee optimization verified
- [ ] Multi-signature scenarios tested

### Production

- [ ] Code audited by security experts
- [ ] Deployed on testnet first
- [ ] Monitoring in place
- [ ] Upgrade/migration plan prepared
- [ ] Emergency procedures documented
- [ ] Insurance or backup funds available

## Emergency Response

### 1. Incident Detection

```javascript
// Monitor contract for suspicious activity
async function monitorContract(contract) {
    const utxos = await contract.getUtxos();
    
    for (const utxo of utxos) {
        // Check for unusual patterns
        if (utxo.satoshis > 1000000) {  // Large amount
            console.warn('Large UTXO detected:', utxo);
        }
        
        if (utxo.token && utxo.token.amount > 1000000) {
            console.warn('Large token amount detected:', utxo);
        }
    }
}
```

### 2. Emergency Procedures

```javascript
// Emergency contract pause (if implemented)
async function emergencyPause(contract, adminKey) {
    const adminSig = new SignatureTemplate(adminKey);
    
    try {
        const txDetails = await contract.functions
            .emergencyPause(adminSig)
            .send();
        
        console.log('Emergency pause activated:', txDetails.txid);
    } catch (error) {
        console.error('Emergency pause failed:', error);
    }
}
```

## Best Practices Summary

1. **Always validate inputs** - Never trust function arguments
2. **Use explicit bounds checking** - Prevent overflow and underflow
3. **Implement proper access control** - Restrict sensitive operations
4. **Validate transaction structure** - Check inputs and outputs
5. **Use secure cryptographic practices** - Proper signature validation
6. **Test thoroughly** - Include boundary and attack vector tests
7. **Monitor in production** - Watch for unusual activity
8. **Plan for emergencies** - Have response procedures ready
9. **Keep contracts simple** - Complexity increases attack surface
10. **Regular security audits** - External review of contract code

Following these security practices will help ensure your CashScript contracts are robust and secure when handling real value on the Bitcoin Cash network.