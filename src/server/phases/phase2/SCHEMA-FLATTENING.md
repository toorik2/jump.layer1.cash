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

## Solution: Hybrid Flattening + Selective Restoration

Initial approach: Flatten everything to strings.
Refined approach: Restore structures that don't exceed 3-level nesting.

**Current schema: 197 lines** (Phase 1 reference: 180 lines)

### Current State

| Structure | Status | Nesting | Grammar Risk |
|-----------|--------|---------|--------------|
| `nftStateTypes[].fields` | ✅ RESTORED | 2-level | LOW (no enum) |
| `typeDiscriminators` | ✅ RESTORED | 2-level | LOW |
| `custodyDecisions` | ✅ RESTORED | 2-level | LOW |
| `contracts[].functions` | ✅ RESTORED | 2-level | LOW |
| `inputs[].validates` | ✅ RESTORED | object | LOW (object, not array) |
| `functions[].validates` | ✅ RESTORED | object | LOW (object, not array) |
| `capabilities` | ⚠️ FLATTENED | - | LOW |
| `decisions` | ⚠️ FLATTENED | - | LOW |

Target structure:
```
top-level object
  └── array of objects (level 1)
        └── array of objects (level 2) ← transactions, fields, typeDiscriminators
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

#### ✅ RESTORED: NFT State Types

Originally flattened to pipe-delimited strings. **Now restored** to structured array:

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

**Why restored:** Phase 3 needs field names for variable declarations, field types for byte sizes in `split()` operations, and field order for cumulative offsets. Structured data eliminates parsing errors.

**Grammar safety:** `type` field kept as plain string (not enum) to avoid grammar multiplication.

#### ✅ RESTORED: Contract Functions

Functions are now structured objects with `validates` as a comma-separated string (not an array):

```json
"contracts": [{
  "name": "VoterContract",
  "functions": [{
    "name": "vote",
    "transaction": "castVote",
    "inputPos": 1,
    "outputPos": 1,
    "validates": "this.activeInputIndex == 1, BallotContract at input[0], Owner authorized via input[2]"
  }]
}]
```

**Why this works:** The key insight is that the grammar explosion was caused by `validates[]` being an array (creating 3 levels of array nesting). By keeping `validates` as a comma-separated string, we stay at 2 levels - the same pattern as `nftStateTypes[].fields[]` which works.

**Phase 3 benefit:** Typed fields (`name`, `transaction`, `inputPos`, `outputPos`) eliminate regex parsing. Only `validates` needs `.split(',')` parsing.

#### Token Topology (Partial Restoration)

**typeDiscriminators** - ✅ RESTORED to structured objects:
```json
"typeDiscriminators": [
  { "discriminator": "0x00", "contract": "BallotContract" },
  { "discriminator": "0x01", "contract": "VoterContract" }
]
```

**Why restored:** Phase 3 needs discriminator bytes for category arithmetic. Structured format is unambiguous.

**capabilities** - ⚠️ STILL FLATTENED as strings:
```json
"capabilities": [
  "BallotContract:mutable",
  "VoterContract:mutable"
]
```

**Format:** `ContractName:capability`

**Why still flat:** Low Phase 3 impact. Easy to parse with `.split(':')`. Could be restored if needed.

#### ✅ RESTORED: Custody Decisions

Originally flattened to strings. **Now restored** to structured objects:

```json
"custodyDecisions": [
  { "entity": "Voter", "custody": "contract", "contractName": "VoterContract", "rationale": "Must enforce one-vote rule" },
  { "entity": "Badge", "custody": "p2pkh", "rationale": "No rules, user owns freely" }
]
```

**Why restored:** Phase 3 needs to know entity → custody mapping to determine locking script. Structured format is unambiguous.

#### ⚠️ FLATTENED: Contract Count Decisions

Still flattened as strings:
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

**Why still flat:** Zero Phase 3 impact. This is purely informational/documentation. Easy to parse if ever needed.

---

### 2. prompt.md

Updated all examples to use the new string formats:

- Step 1: NFT State Types - shows pipe-delimited fields
- Step 3: Contract Derivation - shows function string format
- Step 4: Token Topology - shows flattened typeDiscriminators and capabilities

Added format descriptions after each example.

---

### 3. utxo-architecture.ts

#### Interface Status

**✅ RESTORED Interfaces:**
- `NFTStateField` - fields is structured array again
- `TypeDiscriminator` - typeDiscriminators is structured array again
- `CustodyDecision` - custodyDecisions is structured array again

**✅ NOW RESTORED:**
- `ContractFunction` - functions is structured array (validates kept as string)

**⚠️ Still Removed (strings in use):**
- `CapabilityMapping` - capabilities is string[] (low priority)
- `ContractCountDecision` - decisions is string[] (zero Phase 3 impact)

#### Current Interfaces

```typescript
// ✅ RESTORED - Structured array of fields
export interface NFTStateField {
  name: string;
  type: string;  // Plain string, not enum (grammar safety)
  purpose: string;
}

export interface NFTStateType {
  name: string;
  derivedFrom: string;
  fields: NFTStateField[];  // ✅ RESTORED
  totalBytes: number;
  transitions?: string[];
}

// ✅ RESTORED - Structured discriminator objects
export interface TypeDiscriminator {
  discriminator: string;
  contract: string;
}

// ✅ RESTORED - Structured custody objects
export interface CustodyDecision {
  entity: string;
  custody: 'contract' | 'p2pkh';
  contractName?: string;
  rationale: string;
}

// ⚠️ STILL FLATTENED - validates is comma-separated string
export interface TransactionInput {
  index: number;
  from: string;
  utxoType: string;
  stateRequired?: string;
  validates?: string; // Comma-separated (cannot restore: 4-level nesting)
}

// ✅ RESTORED - Structured function objects (validates kept as string)
export interface ContractFunction {
  name: string;
  transaction: string;
  inputPos: number;
  outputPos: number;
  validates: string; // Comma-separated (keeping as string avoids 3-level nesting)
}

export interface UTXOContract {
  name: string;
  role: 'container' | 'sidecar' | 'function' | 'minting' | 'independent';
  lifecycle: 'exactly-replicating' | 'state-mutating' | 'state-and-balance-mutating' | 'conditionally-replicating';
  nftStateType?: string;
  holdsBch: boolean;
  holdsNft: boolean;
  holdsFungible: boolean;
  functions: ContractFunction[];  // ✅ RESTORED
  relationships?: string;
  stateLayout?: string;
}

// Partial restoration
export interface TokenTopology {
  baseCategory: string;
  typeDiscriminators: TypeDiscriminator[];  // ✅ RESTORED
  capabilities: string[];  // ⚠️ Still flat: "ContractName:mutable"
  authentication: string[];
}

// ⚠️ STILL FLATTENED - decisions is string[]
export interface ContractCountRationale {
  total: number;
  breakdown: string;
  decisions: string[]; // Each: "Entity: N - reason"
}

// Partial restoration
export interface UTXOArchitecture {
  nftStateTypes: NFTStateType[];
  transactionTemplates: TransactionTemplate[];
  contracts: UTXOContract[];
  tokenTopology: TokenTopology;
  custodyDecisions: CustodyDecision[];  // ✅ RESTORED
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

## Restoration Status

### ✅ Successfully Restored (Safe, 2 level nesting)

| Structure | Lines Added | Status |
|-----------|-------------|--------|
| `custodyDecisions` | +12 | Done |
| `typeDiscriminators` | +8 | Done |
| `nftStateTypes[].fields` | +13 | Done |
| `contracts[].functions` | +11 | Done (validates is string) |

### ⚠️ Could Restore (Low Priority)

| Structure | Reason Still Flat |
|-----------|-------------------|
| `capabilities` | Easy to parse with `.split(':')`, low Phase 3 impact |
| `decisions` | Zero Phase 3 impact (informational only) |

### ✅ RESTORED: Validates Object (December 2024)

Originally a comma-separated string to avoid 3-level nesting. **Now restored** to a structured object:

```json
"validates": {
  "indexCheck": 1,
  "categoryChecks": "0:+0x00",
  "authCheck": "2:ownerPkh",
  "stateTransition": "hasVoted:0x00→0x01",
  "covenantOutput": 1,
  "other": ""
}
```

**Why this works:** Objects with primitive values don't count as array nesting. The nesting analysis:
- `transactionTemplates[]` = level 1
- `inputs[]` = level 2
- `validates.{fields}` = object with primitives, NOT a 3rd level

**ValidatesObject fields:**
| Field | Type | Purpose |
|-------|------|---------|
| `indexCheck` | integer | `this.activeInputIndex == N`, -1 if none |
| `categoryChecks` | string | `inputIdx:+0xNN` format, comma-separated |
| `authCheck` | string | `inputIdx:fieldName` for auth source |
| `stateTransition` | string | `field:from→to` state change |
| `covenantOutput` | integer | Output index for 5-point covenant, -1 if none |
| `other` | string | Catch-all for additional checks |

**Phase 3 benefit:** Typed fields eliminate regex parsing. Only `categoryChecks` needs `.split(',')` for multiple checks.

---

## Testing Grammar Size

There's no direct way to test grammar size before hitting the API. Best approach:
1. Compare line count and nesting depth to Phase 1 schema (180 lines, 3 levels)
2. Keep total schema under 200 lines
3. Never exceed 3 levels of array nesting

---

## String Format Reference (Remaining Flattened Fields)

| Field | Format | Example | Phase 3 Parser |
|-------|--------|---------|----------------|
| `tokenTopology.capabilities[]` | `Contract:cap` | `VoterContract:mutable` | `.split(':')` |
| `contractCountRationale.decisions[]` | `Entity: N - reason` | `Voter: 1 - state tracking` | N/A (informational) |
| `*.validates` | `check1, check2, check3` | `index == 1, auth check, state valid` | `.split(',')` |

**Note:** `nftStateTypes[].fields`, `typeDiscriminators`, `custodyDecisions`, and `contracts[].functions` are now structured objects.
