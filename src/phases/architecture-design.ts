/**
 * Phase 2: UTXO Architecture Design
 * Transforms platform-agnostic domain model into CashScript-specific architecture
 * Using the 6-Role Mental Model derived from ParityUSD research
 */
import Anthropic from '@anthropic-ai/sdk';
import { UTXO_ARCHITECTURE_PROMPT } from '../prompts/conversion-prompts.js';
import { ANTHROPIC_CONFIG } from '../config.js';
import { insertUtxoArchitecture } from '../database.js';
import type { DomainModel } from '../types/domain-model.js';
import type { UTXOArchitecture } from '../types/utxo-architecture.js';

// JSON Schema for structured output - 6-Role Mental Model
export const phase2OutputSchema = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      systemName: { type: "string" },
      systemDescription: { type: "string" },

      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Domain group name (lowercase)" },
            primaryEntity: { type: "string", description: "Primary entity in this group" },
            contracts: { type: "array", items: { type: "string" } },
            functionSubfolder: { type: ["string", "null"] }
          },
          required: ["name", "primaryEntity", "contracts"],
          additionalProperties: false
        }
      },

      tokenCategory: {
        type: "object",
        properties: {
          genesisDescription: { type: "string" },
          capabilities: {
            type: "object",
            properties: {
              "0x02_minting": { type: "string" },
              "0x01_mutable": { type: "string" },
              "0x00_immutable": { type: "string" }
            },
            required: ["0x02_minting", "0x01_mutable", "0x00_immutable"],
            additionalProperties: false
          }
        },
        required: ["genesisDescription", "capabilities"],
        additionalProperties: false
      },

      contracts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Contract name (ParityUSD style, no 'Contract' suffix)" },
            description: { type: "string" },
            role: {
              type: "string",
              enum: ["entity", "sidecar", "function", "factory", "oracle", "utility"]
            },
            group: { type: "string" },
            identity: {
              type: "string",
              enum: ["unique", "singleton", "ephemeral"]
            },
            expectedPosition: { type: ["integer", "null"] },
            coupling: {
              type: "object",
              properties: {
                primary: { type: "string" },
                sidecars: { type: "array", items: { type: "string" } },
                functions: { type: "array", items: { type: "string" } },
                strength: { type: "string", enum: ["tight", "medium", "loose"] },
                authentication: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["origin-proof", "commitment-byte", "category-match", "signature", "none"]
                    },
                    mainPosition: { type: "integer" },
                    selectorByte: { type: "string" },
                    expectedCategory: { type: "string" },
                    signerField: { type: "string" }
                  },
                  required: ["type"],
                  additionalProperties: false
                }
              },
              required: ["strength", "authentication"],
              additionalProperties: false
            },
            validation: {
              type: "object",
              properties: {
                validates: { type: "array", items: { type: "string" } },
                justified: { type: "boolean" }
              },
              required: ["validates", "justified"],
              additionalProperties: false
            },
            nft: {
              type: ["object", "null"],
              properties: {
                capability: { type: "string", enum: ["minting", "mutable", "immutable"] },
                commitment: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      type: { type: "string" },
                      bytes: { type: "integer" },
                      description: { type: "string" },
                      mapsToProperty: { type: "string" }
                    },
                    required: ["name", "type", "bytes", "description"],
                    additionalProperties: false
                  }
                },
                totalBytes: { type: "integer" }
              },
              required: ["capability", "commitment", "totalBytes"],
              additionalProperties: false
            },
            functions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  validationPurpose: { type: "string" },
                  parameters: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        type: { type: "string" },
                        description: { type: "string" },
                        usedFor: { type: "string" }
                      },
                      required: ["name", "type", "description", "usedFor"],
                      additionalProperties: false
                    }
                  },
                  implementsTransition: { type: "string" },
                  expectedInputIndex: { type: "integer" },
                  validations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        category: { type: "string" },
                        description: { type: "string" },
                        requireStatement: { type: "string" },
                        reason: { type: "string" }
                      },
                      required: ["category", "description", "requireStatement", "reason"],
                      additionalProperties: false
                    }
                  },
                  selfReplicates: { type: "boolean" },
                  commitmentChanges: { type: "array", items: { type: "string" } }
                },
                required: ["name", "description", "validationPurpose", "parameters", "implementsTransition", "expectedInputIndex", "validations", "selfReplicates"],
                additionalProperties: false
              }
            },
            constructorParams: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string" },
                  description: { type: "string" },
                  source: { type: "string", enum: ["deployment", "computed"] }
                },
                required: ["name", "type", "description", "source"],
                additionalProperties: false
              }
            },
            deploymentOrder: { type: "integer" }
          },
          required: ["name", "description", "role", "group", "identity", "expectedPosition", "coupling", "validation", "nft", "functions", "constructorParams", "deploymentOrder"],
          additionalProperties: false
        }
      },

      transactionTemplates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            triggeredBy: { type: "string" },
            participants: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  position: { type: "integer" },
                  contract: { type: "string" },
                  role: { type: "string", enum: ["oracle", "entity", "sidecar", "function", "user", "utility"] },
                  provides: { type: "string" },
                  validates: { type: "array", items: { type: "string" } },
                  authentication: {
                    type: "object",
                    properties: {
                      type: { type: "string" },
                      mainPosition: { type: "integer" },
                      selectorByte: { type: "string" },
                      expectedCategory: { type: "string" },
                      signerField: { type: "string" }
                    },
                    required: ["type"],
                    additionalProperties: false
                  },
                  consumed: { type: "boolean" },
                  replicated: { type: "boolean" },
                  replicatedToPosition: { type: "integer" }
                },
                required: ["position", "contract", "role", "provides", "validates", "consumed", "replicated"],
                additionalProperties: false
              }
            },
            stateChanges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entity: { type: "string" },
                  field: { type: "string" },
                  from: { type: "string" },
                  to: { type: "string" },
                  validation: { type: "string" }
                },
                required: ["entity", "field", "from", "to", "validation"],
                additionalProperties: false
              }
            },
            validations: { type: "array", items: { type: "string" } },
            maxOutputs: { type: "integer" }
          },
          required: ["name", "description", "triggeredBy", "participants", "stateChanges", "validations", "maxOutputs"],
          additionalProperties: false
        }
      },

      deployment: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                order: { type: "integer" },
                action: { type: "string" },
                contracts: { type: "array", items: { type: "string" } },
                description: { type: "string" },
                prerequisites: { type: "array", items: { type: "string" } }
              },
              required: ["order", "action", "description", "prerequisites"],
              additionalProperties: false
            }
          },
          dependencies: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } }
        },
        required: ["steps", "dependencies"],
        additionalProperties: false
      },

      patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            appliedTo: { type: "array", items: { type: "string" } },
            reason: { type: "string" }
          },
          required: ["name", "appliedTo", "reason"],
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
    required: ["systemName", "systemDescription", "groups", "tokenCategory", "contracts", "transactionTemplates", "deployment", "patterns", "warnings"],
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
  console.log('[Phase 2] Starting UTXO architecture design (6-Role Mental Model)...');
  const startTime = Date.now();

  const userMessage = `Design a UTXO architecture for this domain model using the 6-Role Mental Model.

DOMAIN MODEL:
${JSON.stringify(domainModel, null, 2)}

Remember:
1. Every contract must have validation.justified: true with real validations
2. Max 2 functions per contract (split into function contracts if needed)
3. Follow position convention (entity:1, sidecar:2, function:3)
4. ParityUSD naming (no "Contract" suffix)
5. Group contracts by domain`;

  const response = await anthropic.beta.messages.create({
    model: ANTHROPIC_CONFIG.phase1.model,
    max_tokens: 16384,
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

  // Validate required fields
  if (!Array.isArray(architecture.contracts)) {
    throw new Error('Phase 2 returned invalid architecture: contracts missing');
  }
  if (!Array.isArray(architecture.transactionTemplates)) {
    throw new Error('Phase 2 returned invalid architecture: transactionTemplates missing');
  }
  if (!Array.isArray(architecture.groups)) {
    throw new Error('Phase 2 returned invalid architecture: groups missing');
  }

  // Validate max 2 functions per contract
  for (const contract of architecture.contracts) {
    if (contract.functions.length > 2 && contract.role !== 'function') {
      console.warn(`[Phase 2] Warning: ${contract.name} has ${contract.functions.length} functions (max 2). Should split into function contracts.`);
    }
    if (!contract.validation?.justified) {
      console.warn(`[Phase 2] Warning: ${contract.name} does not have justified validation`);
    }
  }

  const duration = Date.now() - startTime;

  console.log('[Phase 2] Architecture design complete:', {
    duration: `${(duration / 1000).toFixed(2)}s`,
    groups: architecture.groups.length,
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
