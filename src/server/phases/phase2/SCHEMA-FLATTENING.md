# Phase 2 Schema Flattening - Technical Reference

## Problem

The Anthropic Structured Output API returned error:
```
The compiled grammar is too large
```

This occurs when the JSON schema has too much nesting depth or complexity. Anthropic's grammar compilation compounds exponentially with nesting depth.

## Root Cause Analysis

| Metric | Phase 1 (WORKS) | Phase 2 (FAILED) |
|--------|-----------------|------------------|
| Lines | 180 | 232 |
| Max nesting | 3 levels | **4 levels** |
| Arrays-in-arrays | Simple | Complex objects |

The problematic 4-level nesting patterns:
- `contracts[].functions[].validates[]`
- `transactionTemplates[].inputs[].validates[]`

## Solution: Hybrid Flattening

Keep **transactions structured** (they are PRIMARY), flatten everything else to strings.

Target structure:
```
top-level object
  └── array of objects (level 1)
        └── array of objects (level 2) ← ONLY for transaction inputs/outputs
              └── primitive values only (level 3)
```

---

## Changes by File

### 1. schema-v2.json (232 lines → 156 lines)

#### KEPT STRUCTURED: Transaction Templates

Transaction inputs and outputs remain structured because they are the PRIMARY design artifact:

```json
"transactionTemplates": [{
  "name": "string",
  "purpose": "string",
  "inputs": [{
    "index": "integer",
    "from": "string",
    "utxoType": "string",
    "stateRequired": "string",
    "validates": "string"  // ← CHANGED: was array, now comma-separated string
  }],
  "outputs": [{
    "index": "integer",
    "to": "string",
    "utxoType": "string",
    "stateProduced": "string",
    "covenantChecklist": "string"
  }]
}]
```

#### FLATTENED: NFT State Types

**Before:**
```json
"nftStateTypes": [{
  "name": "VoterState",
  "derivedFrom": "Voter entity",
  "fields": [
    { "name": "ownerPkh", "type": "bytes20", "purpose": "Owner authorization" },
    { "name": "hasVoted", "type": "bytes1", "purpose": "0x00=no, 0x01=yes" }
  ],
  "totalBytes": 21,
  "transitions": ["vote (hasVoted: 0x00 → 0x01)"]
}]
```

**After:**
```json
"nftStateTypes": [{
  "name": "VoterState",
  "derivedFrom": "Voter entity",
  "fields": "ownerPkh:bytes20:Owner authorization|hasVoted:bytes1:0x00=no, 0x01=yes",
  "totalBytes": 21,
  "transitions": ["vote (hasVoted: 0x00 → 0x01)"]
}]
```

**Format:** `name:type:purpose|name:type:purpose|...`

#### FLATTENED: Contract Functions

**Before:**
```json
"contracts": [{
  "name": "VoterContract",
  "functions": [{
    "name": "vote",
    "transaction": "castVote",
    "inputPosition": 1,
    "outputPosition": 1,
    "validates": [
      "this.activeInputIndex == 1",
      "BallotContract at input[0]",
      "Owner authorized via input[2]"
    ]
  }]
}]
```

**After:**
```json
"contracts": [{
  "name": "VoterContract",
  "functions": [
    "vote @ castVote [1→1]: this.activeInputIndex == 1, BallotContract at input[0], Owner authorized via input[2]"
  ]
}]
```

**Format:** `funcName @ txName [inputPos→outputPos]: validation1, validation2, ...`

#### FLATTENED: Token Topology

**Before:**
```json
"tokenTopology": {
  "baseCategory": "systemCategory",
  "typeDiscriminators": [
    { "discriminator": "0x00", "contract": "BallotContract" },
    { "discriminator": "0x01", "contract": "VoterContract" }
  ],
  "capabilities": [
    { "contract": "BallotContract", "capability": "mutable" },
    { "contract": "VoterContract", "capability": "mutable" }
  ],
  "authentication": [...]
}
```

**After:**
```json
"tokenTopology": {
  "baseCategory": "systemCategory",
  "typeDiscriminators": [
    "0x00=BallotContract",
    "0x01=VoterContract"
  ],
  "capabilities": [
    "BallotContract:mutable",
    "VoterContract:mutable"
  ],
  "authentication": [...]
}
```

**Formats:**
- typeDiscriminators: `0xNN=ContractName`
- capabilities: `ContractName:capability`

#### FLATTENED: Custody Decisions

**Before:**
```json
"custodyDecisions": [
  { "entity": "Voter", "custody": "contract", "contractName": "VoterContract", "rationale": "Must enforce one-vote rule" },
  { "entity": "Badge", "custody": "p2pkh", "rationale": "No rules, user owns freely" }
]
```

**After:**
```json
"custodyDecisions": [
  "Voter: contract(VoterContract) - Must enforce one-vote rule",
  "Badge: p2pkh - No rules, user owns freely"
]
```

**Format:** `Entity: contract(ContractName) - rationale` or `Entity: p2pkh - rationale`

#### FLATTENED: Contract Count Decisions

**Before:**
```json
"contractCountRationale": {
  "total": 2,
  "breakdown": "2 containers, 0 sidecars, 0 functions",
  "decisions": [
    { "entity": "Ballot", "contracts": 1, "reason": "state tracking" },
    { "entity": "Voter", "contracts": 1, "reason": "vote enforcement" }
  ]
}
```

**After:**
```json
"contractCountRationale": {
  "total": 2,
  "breakdown": "2 containers, 0 sidecars, 0 functions",
  "decisions": [
    "Ballot: 1 - state tracking",
    "Voter: 1 - vote enforcement"
  ]
}
```

**Format:** `Entity: N - reason`

---

### 2. prompt.md

Updated all examples to use the new string formats:

- Step 1: NFT State Types - shows pipe-delimited fields
- Step 3: Contract Derivation - shows function string format
- Step 4: Token Topology - shows flattened typeDiscriminators and capabilities

Added format descriptions after each example.

---

### 3. utxo-architecture.ts

#### Removed Interfaces (no longer needed)
- `NFTStateField` - fields is now a string
- `ContractFunction` - functions is now string[]
- `TypeDiscriminator` - typeDiscriminators is now string[]
- `CapabilityMapping` - capabilities is now string[]
- `CustodyDecision` - custodyDecisions is now string[]
- `ContractCountDecision` - decisions is now string[]

#### Updated Interfaces

```typescript
// NFTStateType.fields: NFTStateField[] → string
export interface NFTStateType {
  name: string;
  derivedFrom: string;
  fields: string; // Pipe-delimited: "name:type:purpose|..."
  totalBytes: number;
  transitions?: string[];
}

// TransactionInput.validates: string[] → string
export interface TransactionInput {
  index: number;
  from: string;
  utxoType: string;
  stateRequired?: string;
  validates?: string; // Comma-separated
}

// UTXOContract.functions: ContractFunction[] → string[]
export interface UTXOContract {
  name: string;
  role: 'container' | 'sidecar' | 'function' | 'minting' | 'independent';
  lifecycle: 'exactly-replicating' | 'state-mutating' | 'state-and-balance-mutating' | 'conditionally-replicating';
  nftStateType?: string;
  holdsBch: boolean;
  holdsNft: boolean;
  holdsFungible: boolean;
  functions: string[]; // Each: "funcName @ txName [inputPos→outputPos]: validations"
  relationships?: string;
  stateLayout?: string;
}

// TokenTopology: flattened arrays
export interface TokenTopology {
  baseCategory: string;
  typeDiscriminators: string[]; // Each: "0x00=ContractName"
  capabilities: string[]; // Each: "ContractName:mutable"
  authentication: string[];
}

// ContractCountRationale.decisions: ContractCountDecision[] → string[]
export interface ContractCountRationale {
  total: number;
  breakdown: string;
  decisions: string[]; // Each: "Entity: N - reason"
}

// UTXOArchitecture.custodyDecisions: CustodyDecision[] → string[]
export interface UTXOArchitecture {
  nftStateTypes: NFTStateType[];
  transactionTemplates: TransactionTemplate[];
  contracts: UTXOContract[];
  tokenTopology: TokenTopology;
  custodyDecisions: string[]; // Each: "Entity: contract(Name) - rationale"
  contractCountRationale: ContractCountRationale;
  warnings: string[];
}
```

---

### 4. src/client/types.ts

Mirrored the `validates` change:
```typescript
export type TransactionInput = {
  index: number;
  from: string;
  utxoType: string;
  stateRequired?: string;
  validates?: string; // Changed from string[]
};
```

---

## Rollback Options

If you need more structure back, here's what could potentially be restored (in order of grammar impact, lowest first):

### Low Risk (Try First)
1. **custodyDecisions** - Simple objects, rarely more than 5 items
2. **contractCountRationale.decisions** - Simple objects, rarely more than 10 items

### Medium Risk
3. **tokenTopology.typeDiscriminators** - Simple objects
4. **tokenTopology.capabilities** - Simple objects

### High Risk (Avoid)
5. **contracts[].functions** - This was the main problem area
6. **nftStateTypes[].fields** - Nested array of objects
7. **transactionTemplates[].inputs[].validates** - 4-level nesting

### Do NOT Restore
- Anything that creates 4-level nesting
- Multiple nested arrays of objects at the same level

---

## Testing Grammar Size

There's no direct way to test grammar size before hitting the API. Best approach:
1. Compare line count and nesting depth to Phase 1 schema (180 lines, 3 levels)
2. Keep total schema under 200 lines
3. Never exceed 3 levels of array nesting

---

## String Format Reference

| Field | Format | Example |
|-------|--------|---------|
| `nftStateTypes[].fields` | `name:type:purpose\|...` | `ownerPkh:bytes20:Auth\|balance:bytes8:Amount` |
| `contracts[].functions[]` | `func @ tx [in→out]: validations` | `vote @ castVote [1→1]: check1, check2` |
| `tokenTopology.typeDiscriminators[]` | `0xNN=Contract` | `0x00=BallotContract` |
| `tokenTopology.capabilities[]` | `Contract:cap` | `VoterContract:mutable` |
| `custodyDecisions[]` | `Entity: type(name) - reason` | `Voter: contract(VoterContract) - enforce rules` |
| `contractCountRationale.decisions[]` | `Entity: N - reason` | `Voter: 1 - state tracking` |
| `transactionTemplates[].inputs[].validates` | `check1, check2, check3` | `index == 1, auth check, state valid` |
