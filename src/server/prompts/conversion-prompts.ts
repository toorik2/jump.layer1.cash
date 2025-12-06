/**
 * Conversion Prompts
 * Loaded from external markdown files + JSON schemas
 *
 * Schema files contain full Anthropic structured output format:
 * { "type": "json_schema", "schema": { ... } }
 *
 * For prompts, we extract just the inner "schema" part for clarity.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptsDir = __dirname;

const phase1Prompt = fs.readFileSync(path.join(promptsDir, 'phase1-domain-extraction.md'), 'utf-8');
const phase1SchemaFull = JSON.parse(fs.readFileSync(path.join(promptsDir, 'phase1-schema.json'), 'utf-8'));
const phase1SchemaForPrompt = JSON.stringify(phase1SchemaFull.schema, null, 2);

const phase2Prompt = fs.readFileSync(path.join(promptsDir, 'phase2-utxo-architecture.md'), 'utf-8');
const phase2SchemaFull = JSON.parse(fs.readFileSync(path.join(promptsDir, 'phase2-schema.json'), 'utf-8'));
const phase2SchemaForPrompt = JSON.stringify(phase2SchemaFull.schema, null, 2);

export const DOMAIN_EXTRACTION_PROMPT = phase1Prompt.replace('{{SCHEMA}}', phase1SchemaForPrompt);
export const UTXO_ARCHITECTURE_PROMPT = phase2Prompt.replace('{{SCHEMA}}', phase2SchemaForPrompt);
