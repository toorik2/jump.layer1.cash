// ============================================================================
// CONVERSION PROMPTS
// Three-phase pipeline prompts for EVM to CashScript conversion
// Prompts are loaded from external markdown files for easier editing
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptsDir = path.join(__dirname, '../../prompts');

// ============================================================================
// LOAD PROMPTS FROM EXTERNAL FILES
// ============================================================================

export const DOMAIN_EXTRACTION_PROMPT = fs.readFileSync(
  path.join(promptsDir, 'phase1-domain-extraction.md'),
  'utf-8'
);

export const UTXO_ARCHITECTURE_PROMPT = fs.readFileSync(
  path.join(promptsDir, 'phase2-utxo-architecture.md'),
  'utf-8'
);

export const CODE_GENERATION_PROMPT = fs.readFileSync(
  path.join(promptsDir, 'phase3-code-generation.md'),
  'utf-8'
);

// ============================================================================
// JSON SCHEMAS FOR STRUCTURED OUTPUTS
// (Kept in TypeScript for type safety)
// ============================================================================

export const DOMAIN_MODEL_SCHEMA = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      systemPurpose: { type: "string" },
      domain: {
        type: "string",
        enum: ["voting", "token", "crowdfunding", "marketplace", "game", "defi", "governance", "other"]
      },
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            identity: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["per-address", "sequential", "singleton", "composite"] },
                description: { type: "string" }
              },
              required: ["type", "description"],
              additionalProperties: false
            },
            properties: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string", enum: ["number", "boolean", "address", "bytes", "string", "reference"] },
                  description: { type: "string" },
                  referenceTo: { type: "string" },
                  maxBytes: { type: "number" },
                  optional: { type: "boolean" },
                  initialValue: { type: "string" }
                },
                required: ["name", "type", "description"],
                additionalProperties: false
              }
            },
            lifecycle: { type: "array", items: { type: "string" } },
            mutable: { type: "boolean" },
            cardinality: { type: "string", enum: ["one", "fixed", "unbounded"] },
            cardinalityLimit: { type: "number" }
          },
          required: ["name", "description", "identity", "properties", "lifecycle", "mutable", "cardinality"],
          additionalProperties: false
        }
      },
      transitions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            participants: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entity: { type: "string" },
                  role: { type: "string", enum: ["subject", "target", "coordinator", "witness", "beneficiary"] },
                  fromState: { type: "string" },
                  toState: { type: "string" },
                  consumed: { type: "boolean" },
                  created: { type: "boolean" },
                  propertyChanges: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        property: { type: "string" },
                        changeType: { type: "string", enum: ["set", "increment", "decrement", "transfer"] },
                        value: { type: "string" },
                        amount: { type: "string" },
                        from: { type: "string" },
                        to: { type: "string" }
                      },
                      required: ["property", "changeType"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["entity", "role"],
                additionalProperties: false
              }
            },
            effects: { type: "array", items: { type: "string" } },
            authorization: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["identity", "possession", "role", "none"] },
                authorizer: { type: "string" },
                description: { type: "string" }
              },
              required: ["type"],
              additionalProperties: false
            },
            preconditions: { type: "array", items: { type: "string" } },
            postconditions: { type: "array", items: { type: "string" } },
            timeConstraints: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["before", "after", "within"] },
                  reference: { type: "string" },
                  description: { type: "string" }
                },
                required: ["type", "reference", "description"],
                additionalProperties: false
              }
            }
          },
          required: ["name", "description", "participants", "effects", "authorization", "preconditions", "postconditions"],
          additionalProperties: false
        }
      },
      invariants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            scope: { type: "string", enum: ["global", "entity", "relationship"] },
            scopeTarget: { type: "string" },
            rule: { type: "string" },
            description: { type: "string" },
            severity: { type: "string", enum: ["critical", "important", "advisory"] }
          },
          required: ["scope", "rule", "description", "severity"],
          additionalProperties: false
        }
      },
      relationships: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["ownership", "reference", "containment", "delegation"] },
            from: { type: "string" },
            to: { type: "string" },
            cardinality: { type: "string", enum: ["one-to-one", "one-to-many", "many-to-many"] },
            via: { type: "string" },
            bidirectional: { type: "boolean" },
            description: { type: "string" }
          },
          required: ["type", "from", "to", "cardinality", "description"],
          additionalProperties: false
        }
      },
      roles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            assignment: { type: "string", enum: ["constructor", "entity", "dynamic"] },
            canAuthorize: { type: "array", items: { type: "string" } }
          },
          required: ["name", "description", "assignment", "canAuthorize"],
          additionalProperties: false
        }
      },
      unmappedConcepts: { type: "array", items: { type: "string" } }
    },
    required: ["systemPurpose", "domain", "entities", "transitions", "invariants", "relationships", "roles"],
    additionalProperties: false
  }
} as const;

export const UTXO_ARCHITECTURE_SCHEMA = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      systemName: { type: "string" },
      systemDescription: { type: "string" },
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
            name: { type: "string" },
            description: { type: "string" },
            role: { type: "string", enum: ["primary", "helper", "state"] },
            validationPurpose: { type: "string" },
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
            nft: {
              type: "object",
              properties: {
                capability: { type: "string", enum: ["minting", "mutable", "immutable"] },
                commitment: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      type: { type: "string" },
                      bytes: { type: "number" },
                      description: { type: "string" },
                      mapsToProperty: { type: "string" }
                    },
                    required: ["name", "type", "bytes", "description"],
                    additionalProperties: false
                  }
                },
                totalBytes: { type: "number" }
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
                  expectedInputIndex: { type: "number" },
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
            managesEntities: { type: "array", items: { type: "string" } },
            participatesIn: { type: "array", items: { type: "string" } },
            deploymentOrder: { type: "number" }
          },
          required: ["name", "description", "role", "validationPurpose", "constructorParams", "functions", "managesEntities", "participatesIn", "deploymentOrder"],
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
            implementsTransition: { type: "string" },
            inputs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "number" },
                  contract: { type: "string" },
                  nftCapability: { type: "string" },
                  type: { type: "string" },
                  from: { type: "string" },
                  description: { type: "string" },
                  required: { type: "boolean" }
                },
                required: ["index", "type", "from", "description", "required"],
                additionalProperties: false
              }
            },
            outputs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "number" },
                  contract: { type: "string" },
                  nftCapability: { type: "string" },
                  type: { type: "string" },
                  to: { type: "string" },
                  description: { type: "string" },
                  changes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        field: { type: "string" },
                        changeType: { type: "string" },
                        description: { type: "string" }
                      },
                      required: ["field", "changeType", "description"],
                      additionalProperties: false
                    }
                  },
                  required: { type: "boolean" }
                },
                required: ["index", "type", "to", "description", "changes", "required"],
                additionalProperties: false
              }
            },
            maxOutputs: { type: "number" },
            participatingContracts: { type: "array", items: { type: "string" } },
            flowDescription: { type: "string" }
          },
          required: ["name", "description", "implementsTransition", "inputs", "outputs", "maxOutputs", "participatingContracts", "flowDescription"],
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
                order: { type: "number" },
                action: { type: "string" },
                contracts: { type: "array", items: { type: "string" } },
                description: { type: "string" },
                prerequisites: { type: "array", items: { type: "string" } }
              },
              required: ["order", "action", "description", "prerequisites"],
              additionalProperties: false
            }
          },
          dependencies: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } }
          }
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
      warnings: { type: "array", items: { type: "string" } }
    },
    required: ["systemName", "systemDescription", "tokenCategory", "contracts", "transactionTemplates", "deployment", "patterns", "warnings"],
    additionalProperties: false
  }
} as const;
