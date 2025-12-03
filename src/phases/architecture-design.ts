/**
 * Phase 2: UTXO Architecture Design
 * Transforms platform-agnostic domain model into CashScript-specific architecture
 */
import Anthropic from '@anthropic-ai/sdk';
import { UTXO_ARCHITECTURE_PROMPT } from '../prompts/conversion-prompts.js';
import { ANTHROPIC_CONFIG } from '../config.js';
import { insertUtxoArchitecture } from '../database.js';
import type { DomainModel } from '../types/domain-model.js';
import type { UTXOArchitecture } from '../types/utxo-architecture.js';

// JSON Schema for structured output
export const phase2OutputSchema = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            appliedTo: { type: "string" },
            rationale: { type: "string" }
          },
          required: ["name", "appliedTo", "rationale"],
          additionalProperties: false
        }
      },
      custodyDecisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            entity: { type: "string" },
            custody: { type: "string", description: "Either 'contract' or 'p2pkh'" },
            contractName: { type: "string", description: "Only for custody='contract'. Omit or set to 'NONE' for P2PKH." },
            rationale: { type: "string" },
            ownerFieldInCommitment: { type: "string" }
          },
          required: ["entity", "custody", "rationale"],
          additionalProperties: false
        }
      },
      tokenCategories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            purpose: { type: "string" },
            capability: { type: "string" },
            commitmentLayout: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  bytes: { type: "integer" },
                  description: { type: "string" }
                },
                required: ["field", "bytes", "description"],
                additionalProperties: false
              }
            },
            totalBytes: { type: "integer" }
          },
          required: ["name", "purpose", "capability", "commitmentLayout", "totalBytes"],
          additionalProperties: false
        }
      },
      contracts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            custodies: { type: "string" },
            validates: { type: "string" },
            functions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  validates: { type: "string" },
                  maxOutputs: { type: "integer" }
                },
                required: ["name", "validates", "maxOutputs"],
                additionalProperties: false
              }
            },
            stateFields: { type: "array", items: { type: "string" } }
          },
          required: ["name", "custodies", "validates", "functions", "stateFields"],
          additionalProperties: false
        }
      },
      transactionTemplates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            purpose: { type: "string" },
            inputs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  type: { type: "string" },
                  description: { type: "string" }
                },
                required: ["index", "type", "description"],
                additionalProperties: false
              }
            },
            outputs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  type: { type: "string" },
                  description: { type: "string" }
                },
                required: ["index", "type", "description"],
                additionalProperties: false
              }
            },
            maxOutputs: { type: "integer" }
          },
          required: ["name", "purpose", "inputs", "outputs", "maxOutputs"],
          additionalProperties: false
        }
      },
      invariantEnforcement: {
        type: "array",
        items: {
          type: "object",
          properties: {
            invariant: { type: "string" },
            enforcedBy: { type: "string" },
            mechanism: { type: "string" }
          },
          required: ["invariant", "enforcedBy", "mechanism"],
          additionalProperties: false
        }
      },
      warnings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string" },
            issue: { type: "string" },
            mitigation: { type: "string" }
          },
          required: ["severity", "issue", "mitigation"],
          additionalProperties: false
        }
      }
    },
    required: ["patterns", "custodyDecisions", "tokenCategories", "contracts", "transactionTemplates", "invariantEnforcement", "warnings"],
    additionalProperties: false
  }
} as const;

export interface Phase2Result {
  architecture: UTXOArchitecture;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Detect if a contract spec from Phase 2 indicates no real validation logic
 * These contracts should NOT be sent to Phase 3 for code generation
 */
export function isDocumentationOnlyContract(contract: { name: string; validates?: string; custodies?: string }): boolean {
  const validates = (contract.validates || '').toLowerCase();
  const custodies = (contract.custodies || '').toLowerCase();

  // Patterns that indicate no real validation logic
  const docOnlyPatterns = [
    'documentation only',
    'documentation-only',
    'doc only',
    'no validation',
    'no real validation',
    'freely transferable',
    'freely-transferable',
    'no enforced rules',
    'no constraints',
    'no spending rules',
    'no restrictions',
    'no contract needed',
    'user controlled',
    'user-controlled',
    'p2pkh custody',
    'user p2pkh',
    'standard p2pkh',
    'held at user',
    'user wallet',
    'user\'s wallet',
  ];

  for (const pattern of docOnlyPatterns) {
    if (validates.includes(pattern)) {
      console.log(`[DocOnly Check] ${contract.name}: matched validates pattern '${pattern}'`);
      return true;
    }
  }

  // Custodies patterns that indicate no contract needed
  const noCustodyPatterns = [
    'none',
    'n/a',
    'not applicable',
    'user p2pkh',
    'user wallet',
    'held at user',
    'standard p2pkh',
  ];

  for (const pattern of noCustodyPatterns) {
    if (custodies.includes(pattern)) {
      console.log(`[DocOnly Check] ${contract.name}: matched custodies pattern '${pattern}'`);
      return true;
    }
  }

  return false;
}

/**
 * Filter out documentation-only contracts from architecture
 * Returns the filtered architecture and count of removed contracts
 */
export function filterDocumentationOnlyContracts(architecture: UTXOArchitecture): { filtered: UTXOArchitecture; removedCount: number } {
  if (!Array.isArray(architecture.contracts)) {
    return { filtered: architecture, removedCount: 0 };
  }

  // Build set of entities with P2PKH custody - these should NOT have contracts
  const p2pkhEntities = new Set<string>();
  if (Array.isArray(architecture.custodyDecisions)) {
    for (const decision of architecture.custodyDecisions) {
      if (decision.custody?.toLowerCase() === 'p2pkh') {
        p2pkhEntities.add(decision.entity?.toLowerCase() || '');
        if (decision.contractName) {
          p2pkhEntities.add(decision.contractName.toLowerCase());
        }
      }
    }
  }

  const before = architecture.contracts.length;
  console.log(`[Phase 2 Filter] Evaluating ${before} contract(s)...`);

  const filteredContracts = architecture.contracts.filter(c => {
    const contractNameLower = (c.name || '').toLowerCase();
    console.log(`[Phase 2 Filter] Checking: ${c.name}`);
    console.log(`  - validates: "${c.validates || '(empty)'}"`);
    console.log(`  - custodies: "${c.custodies || '(empty)'}"`);

    // Check 1: Contract corresponds to P2PKH custody entity
    for (const entity of p2pkhEntities) {
      if (contractNameLower.includes(entity) || entity.includes(contractNameLower.replace('contract', ''))) {
        console.log(`  → REMOVED: matches P2PKH entity "${entity}"`);
        return false;
      }
    }

    // Check 2: Documentation-only patterns in validates/custodies fields
    if (isDocumentationOnlyContract(c)) {
      console.log(`  → REMOVED: documentation-only contract`);
      return false;
    }

    console.log(`  → KEPT: has real validation logic`);
    return true;
  });

  const removed = before - filteredContracts.length;
  console.log(`[Phase 2 Filter] Result: ${before - removed}/${before} contracts kept, ${removed} removed`);

  return {
    filtered: { ...architecture, contracts: filteredContracts },
    removedCount: removed
  };
}

export async function executeArchitectureDesign(
  anthropic: Anthropic,
  conversionId: number,
  domainModel: DomainModel
): Promise<Phase2Result> {
  console.log('[Phase 2] Starting UTXO architecture design...');
  const startTime = Date.now();

  const userMessage = `Design a UTXO architecture for this domain model.

DOMAIN MODEL:
${JSON.stringify(domainModel, null, 2)}

Design the UTXO architecture following the patterns and prime directives in the system prompt.`;

  const response = await anthropic.beta.messages.create({
    model: ANTHROPIC_CONFIG.phase1.model, // Use same model as phase 1
    max_tokens: 16384, // Architecture design needs more tokens
    betas: [...ANTHROPIC_CONFIG.betas],
    output_format: phase2OutputSchema,
    system: UTXO_ARCHITECTURE_PROMPT,
    messages: [{
      role: 'user',
      content: userMessage
    }]
  });

  const responseText = response.content[0].type === 'text'
    ? response.content[0].text
    : '';

  const architecture = JSON.parse(responseText) as UTXOArchitecture;

  // Validate required fields - fail loud if structured output failed
  if (!Array.isArray(architecture.contracts)) {
    throw new Error('Phase 2 returned invalid architecture: contracts missing');
  }
  if (!Array.isArray(architecture.transactionTemplates)) {
    throw new Error('Phase 2 returned invalid architecture: transactionTemplates missing');
  }

  const duration = Date.now() - startTime;

  console.log('[Phase 2] Architecture design complete:', {
    duration: `${(duration / 1000).toFixed(2)}s`,
    contracts: architecture.contracts.length,
    transactions: architecture.transactionTemplates.length,
    patterns: architecture.patterns?.map(p => p.name).join(', ') || '(none)'
  });

  // Store Phase 2 architecture in database
  insertUtxoArchitecture({
    conversion_id: conversionId,
    architecture_json: responseText,
    created_at: new Date().toISOString(),
    model_used: ANTHROPIC_CONFIG.phase1.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    response_time_ms: duration
  });

  return {
    architecture,
    durationMs: duration,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens
  };
}
