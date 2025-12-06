/**
 * Conversion Prompts
 * Loaded from external markdown files + JSON schemas
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptsDir = __dirname;

const phase1Prompt = fs.readFileSync(path.join(promptsDir, 'phase1-domain-extraction.md'), 'utf-8');
const phase1Schema = fs.readFileSync(path.join(promptsDir, 'phase1-schema.json'), 'utf-8');

const phase2Prompt = fs.readFileSync(path.join(promptsDir, 'phase2-utxo-architecture.md'), 'utf-8');
const phase2Schema = fs.readFileSync(path.join(promptsDir, 'phase2-schema.json'), 'utf-8');

export const DOMAIN_EXTRACTION_PROMPT = phase1Prompt.replace('{{SCHEMA}}', phase1Schema);
export const UTXO_ARCHITECTURE_PROMPT = phase2Prompt.replace('{{SCHEMA}}', phase2Schema);
