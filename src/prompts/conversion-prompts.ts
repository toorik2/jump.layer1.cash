/**
 * Conversion Prompts
 * Loaded from external markdown files for easier editing
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptsDir = path.join(__dirname, '../../prompts');

export const DOMAIN_EXTRACTION_PROMPT = fs.readFileSync(
  path.join(promptsDir, 'phase1-domain-extraction.md'),
  'utf-8'
);

export const UTXO_ARCHITECTURE_PROMPT = fs.readFileSync(
  path.join(promptsDir, 'phase2-utxo-architecture.md'),
  'utf-8'
);
