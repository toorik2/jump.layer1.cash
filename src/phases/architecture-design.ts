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
