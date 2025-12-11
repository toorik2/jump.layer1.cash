/**
 * Phase 3 Code Generation Prompts
 * Split into static (cacheable) and dynamic (per-conversion) parts
 */

/**
 * Static instructions that are the same for every conversion.
 * This goes in a separate system message block AFTER the knowledge base.
 */
export function getStaticInstructions(): string {
  return `=== FUNCTION SPECIFICATION FORMAT ===

Each contracts[].functions entry contains EVERYTHING you need:
  "funcName @ txName [inputPos→outputPos]: validation1, validation2, ..."

Example: "vote @ castVote [1→1]: this.activeInputIndex == 1, BallotContract at input[0], hasVoted: 0x00 → 0x01"

This means:
- Function named "vote"
- Part of transaction "castVote"
- Contract is at input position 1, outputs to position 1
- Validations to implement (after the colon):
  * this.activeInputIndex == 1
  * BallotContract at input[0] (→ tokenCategory check)
  * hasVoted: 0x00 → 0x01 (→ state transition)

The validations after the colon ARE your require() statements. Parse and implement them.

=== CROSS-CONTRACT AUTHENTICATION (TWO LAYERS) ===

When a validation says "ContractX at input[N]", implement BOTH authentication layers:

**Layer 1: Category + Capability** (REQUIRED)
Check tokenTopology.sharedCapability to determine the capability byte:
- "mutable" → require(tx.inputs[N].tokenCategory == systemCategory + 0x01);
- "minting" → require(tx.inputs[N].tokenCategory == systemCategory + 0x02);
- "none" → require(tx.inputs[N].tokenCategory == systemCategory);

**Layer 2: Type Discriminator** (REQUIRED when multiple contract types exist)
Use tokenTopology.typeDiscriminators to find the discriminator byte:
- require(tx.inputs[N].nftCommitment.split(1)[0] == 0xNN);

**Complete Example**:
"VoterContract at input[0]" with discriminator 0x01 and sharedCapability "mutable":

  // Layer 1: System membership + mutable capability
  require(tx.inputs[0].tokenCategory == systemCategory + 0x01);
  // Layer 2: Contract type discrimination
  require(tx.inputs[0].nftCommitment.split(1)[0] == 0x01);

Both checks ensure:
1. NFT belongs to our system with correct capability
2. NFT is specifically the expected contract type

CRITICAL: If contract has systemCategory parameter, it MUST be used in at least one require().
All constructor parameters must be used in function bodies or compilation fails.

=== LIFECYCLE PATTERNS ===

- exactly-replicating: Output is identical to input (function contracts)
  * Full 5-point covenant: lockingBytecode, tokenCategory, value, tokenAmount, commitment
- state-mutating: Commitment changes, rest preserved (state containers)
  * 5-point covenant with NEW commitment
- state-and-balance-mutating: Commitment + value change (pools)
  * 5-point covenant with NEW commitment AND updated value
- conditionally-replicating: May be destroyed (loans)
  * Conditional replication based on state

=== CRITICAL COMPILATION RULES ===

1. Always use "pragma cashscript ^0.13.0;"
2. Every function parameter MUST be used in the function body
3. Every function MUST validate this.activeInputIndex
4. Every function MUST limit tx.outputs.length
5. Self-replicating covenants need 5-point validation:
   - lockingBytecode preservation
   - tokenCategory preservation
   - value constraint
   - tokenAmount constraint
   - commitment update
6. The CashScript compiler only accepts ASCII characters.
7. tx.time can ONLY be used in require() statements: require(tx.time >= expr)
   For arithmetic or variable assignments, use tx.locktime instead.

=== MINTING CONTRACT CUSTODY ENFORCEMENT ===

When a minting contract creates NEW NFTs (not self-replicating), it MUST validate the output
lockingBytecode to ensure the newly minted NFT goes to the correct custody contract.

CRITICAL: Check the transactionTemplates[].outputs for outputs that say:
- "to": "SomeContract" (not "P2PKH" or "burned")
- "utxoType": contains "new" or indicates a newly created NFT

For these outputs, the minting contract MUST validate:
  require(tx.outputs[childIdx].lockingBytecode == expectedContractBytecode);

Without this check, minting contracts allow NFTs to be created to arbitrary addresses,
completely bypassing the custody enforcement designed in Phase 2.

**Pattern**: Use the minter's own lockingBytecode if the child goes to the same contract type,
OR pass the target contract's lockingBytecode as a constructor parameter.

Example for minting a child that should go to same contract as parent:
  require(tx.outputs[childIdx].lockingBytecode == tx.inputs[parentIdx].lockingBytecode);

=== ROLE MAPPING ===

Map Phase 2 roles to output schema roles:
- container → primary
- minting → primary
- independent → primary
- sidecar → helper
- function → helper

=== DOCUMENTATION REQUIREMENTS ===

1. NFT STATE BLOCK (before contract declaration):
   For contracts with nftStateType defined:

   /*  --- {ContractName} Mutable NFT State ---
       bytes20 ownerPkh                    // owner's public key hash
       bytes1 hasVoted = 0x00              // 0x00=no, 0x01=yes
   */

   - List ALL state fields with types and default values
   - Derive fields from nftStateTypes[].fields in the architecture

2. FUNCTION DOCUMENTATION (before each function):
   //////////////////////////////////////////////////////////////////////////////////////////
   //  Brief description of what the function does.
   //
   //inputs:
   //  idx   Name                      [TYPE]      (from source)
   //outputs:
   //  idx   Name                      [TYPE]      (to destination)
   //////////////////////////////////////////////////////////////////////////////////////////

   - Derive from transactionTemplates[] inputs/outputs
   - Type annotations: [NFT], [BCH], [FT]

3. INLINE COMMENTS:
   - Explain validation logic: require(x) // Why this check matters
   - Document state transitions: int newCount = old + 1; // Increment vote count

=== JSON CODE FORMATTING ===

CRITICAL: The "code" field is a JSON string. You MUST use \\n escape sequences for newlines.

CORRECT:
"code": "pragma cashscript ^0.13.0;\\n\\ncontract Foo {\\n  function bar() {\\n    require(true);\\n  }\\n}"

WRONG (will cause compilation failure):
"code": "pragma cashscript ^0.13.0; contract Foo { function bar() { require(true); } }"

The CashScript compiler requires proper line breaks. Single-line code will fail.`;
}

/**
 * Build the dynamic user message with contract specs and architecture.
 * This includes the conversion-specific data that cannot be cached.
 */
export function buildUserMessage(
  contracts: { name: string; role: string }[],
  utxoArchitecture: string
): string {
  const contractList = contracts
    .map((c, i) => `${i + 1}. ${c.name} (${c.role})`)
    .join('\n');

  return `Generate exactly ${contracts.length} CashScript contracts:

${contractList}

Each contract MUST:
- Use the EXACT name shown above (CashScript: \`contract ContractName { ... }\`)
- Compile successfully with cashc
- Implement all functions from architecture.contracts[].functions

THE ARCHITECTURE IS AUTHORITATIVE. You must:
- Use exact contract names from architecture.contracts[].name
- Implement exactly the functions listed in contracts[].functions
- Parse validations from each function spec (the comma-separated items after the colon)
- Follow the NFT state layout from nftStateTypes[]
- Use transactionTemplates[] to understand the transaction context

UTXO ARCHITECTURE (follow exactly):
${utxoArchitecture}

GENERATE CashScript code for each contract in architecture.contracts[].
For each function, parse the validation list (after the colon) and implement them.
Use transactionTemplates[] to understand the transaction context.`;
}

// Keep the old function for backward compatibility (deprecated)
export function buildCodeGenerationPrompt(
  knowledgeBase: string,
  contracts: { name: string; role: string }[]
): string {
  const contractList = contracts
    .map((c, i) => `${i + 1}. ${c.name} (${c.role})`)
    .join('\n');

  return `Your task is to generate exactly ${contracts.length} CashScript contracts:

${contractList}

Each contract MUST:
- Use the EXACT name shown above (CashScript: \`contract ContractName { ... }\`)
- Compile successfully with cashc
- Implement all functions from architecture.contracts[].functions

THE ARCHITECTURE IS AUTHORITATIVE. You must:
- Use exact contract names from architecture.contracts[].name
- Implement exactly the functions listed in contracts[].functions
- Parse validations from each function spec (the comma-separated items after the colon)
- Follow the NFT state layout from nftStateTypes[]
- Use transactionTemplates[] to understand the transaction context

${getStaticInstructions()}

=== CASHSCRIPT REFERENCE ===

Use this reference for CashScript syntax and patterns:

${knowledgeBase}`;
}
