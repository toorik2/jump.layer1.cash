/**
 * Phase 1: Domain Extraction
 * Extracts platform-agnostic domain model from Solidity contracts
 */
import Anthropic from '@anthropic-ai/sdk';
import { DOMAIN_EXTRACTION_PROMPT } from '../prompts/conversion-prompts.js';
import { ANTHROPIC_CONFIG } from '../config.js';
import { insertSemanticAnalysis } from '../database.js';
import type { DomainModel } from '../types/domain-model.js';

// JSON Schema for structured output
export const phase1OutputSchema = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
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
            properties: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string" },
                  description: { type: "string" }
                },
                required: ["name", "type", "description"],
                additionalProperties: false
              }
            },
            lifecycle: { type: "array", items: { type: "string" } },
            identity: { type: "string" },
            mutable: { type: "boolean" }
          },
          required: ["name", "description", "properties", "lifecycle", "identity", "mutable"],
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
                  role: { type: "string" },
                  description: { type: "string" }
                },
                required: ["role", "description"],
                additionalProperties: false
              }
            },
            effects: { type: "array", items: { type: "string" } },
            authorization: { type: "string" },
            preconditions: { type: "array", items: { type: "string" } },
            postconditions: { type: "array", items: { type: "string" } },
            timeConstraints: { type: "string" }
          },
          required: ["name", "description", "participants", "effects", "authorization", "preconditions", "postconditions", "timeConstraints"],
          additionalProperties: false
        }
      },
      invariants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            scope: { type: "string" },
            rule: { type: "string" },
            severity: { type: "string" }
          },
          required: ["scope", "rule", "severity"],
          additionalProperties: false
        }
      },
      relationships: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            type: { type: "string" },
            description: { type: "string" }
          },
          required: ["from", "to", "type", "description"],
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
            assignment: { type: "string" },
            capabilities: { type: "array", items: { type: "string" } }
          },
          required: ["name", "description", "assignment", "capabilities"],
          additionalProperties: false
        }
      }
    },
    required: ["domain", "entities", "transitions", "invariants", "relationships", "roles"],
    additionalProperties: false
  }
} as const;

export interface Phase1Result {
  domainModel: DomainModel;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export async function executeDomainExtraction(
  anthropic: Anthropic,
  conversionId: number,
  solidityContract: string
): Promise<Phase1Result> {
  console.log('[Phase 1] Starting domain extraction (platform-agnostic)...');
  const startTime = Date.now();

  const response = await anthropic.beta.messages.create({
    model: ANTHROPIC_CONFIG.phase1.model,
    max_tokens: ANTHROPIC_CONFIG.phase1.maxTokens,
    betas: [...ANTHROPIC_CONFIG.betas],
    output_format: phase1OutputSchema,
    system: DOMAIN_EXTRACTION_PROMPT,
    messages: [{
      role: 'user',
      content: `Extract the domain model from this smart contract:\n\n${solidityContract}`
    }]
  });

  const responseText = response.content[0].type === 'text'
    ? response.content[0].text
    : '';

  const domainModel = JSON.parse(responseText) as DomainModel;

  // Validate required fields - fail loud if structured output failed
  if (!Array.isArray(domainModel.entities)) {
    throw new Error('Phase 1 returned invalid domain model: entities missing');
  }
  if (!Array.isArray(domainModel.transitions)) {
    throw new Error('Phase 1 returned invalid domain model: transitions missing');
  }
  if (!domainModel.domain) {
    throw new Error('Phase 1 returned invalid domain model: domain missing');
  }

  const duration = Date.now() - startTime;

  // Store in database
  insertSemanticAnalysis({
    conversion_id: conversionId,
    analysis_json: responseText,
    created_at: new Date().toISOString(),
    model_used: ANTHROPIC_CONFIG.phase1.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    response_time_ms: duration
  });

  console.log('[Phase 1] Domain extraction complete:', {
    duration: `${(duration / 1000).toFixed(2)}s`,
    domain: domainModel.domain,
    entities: domainModel.entities.length,
    transitions: domainModel.transitions.length,
    invariants: domainModel.invariants.length
  });

  return {
    domainModel,
    durationMs: duration,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens
  };
}
