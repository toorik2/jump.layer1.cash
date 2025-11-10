import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileString } from 'cashc';

const app = express();
app.use(express.json());
app.use(express.static('dist'));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

let knowledgeBase = '';

async function init() {
  console.log('Loading CashScript language reference...');
  knowledgeBase = await readFile('./cashscript-knowledge-base/language/language-reference.md', 'utf-8');
  console.log(`Knowledge base loaded: ${knowledgeBase.length} characters`);
}

function validateContract(code: string): { valid: boolean; error?: string; bytecodeSize?: number; artifact?: any } {
  try {
    const artifact = compileString(code);
    const bytecodeSize = artifact.bytecode.length / 2;
    return { valid: true, bytecodeSize, artifact };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}

app.post('/api/convert', async (req, res) => {
  console.log('Received conversion request');
  const { contract } = req.body;

  const systemPrompt = `You are a CashScript expert. Convert EVM (Solidity) smart contracts to CashScript.

CashScript Language Reference:
${knowledgeBase}

IMPORTANT: Always use "pragma cashscript ^0.12.0;" at the top of every CashScript contract.

Respond with valid JSON in this structure:
{
  "primaryContract": "string - the best CashScript translation (code only)",
  "explanation": "string - brief explanation of the translation approach",
  "considerations": ["array of strings - key differences between EVM and CashScript"],
  "alternatives": [
    {
      "name": "string - name of alternative approach",
      "contract": "string - alternative CashScript code",
      "rationale": "string - why this alternative exists"
    }
  ]
}

Use your best judgment to pick the optimal translation as primaryContract. Include 1-3 alternatives if multiple valid approaches exist.`;

  // Initial attempt
  console.log('Calling Anthropic API (initial attempt)...');
  let message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: contract
      },
      {
        role: 'assistant',
        content: '{'
      }
    ]
  });

  let response = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonString = '{' + response;
  let parsed = JSON.parse(jsonString);

  // Validate primary contract
  console.log('Validating primary contract...');
  const validation = validateContract(parsed.primaryContract);

  if (!validation.valid) {
    console.log('Validation failed, retrying with error feedback...');

    // Retry with validation error
    message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Original EVM contract:\n${contract}\n\nYour previous CashScript translation has a syntax error:\n${validation.error}\n\nPlease fix the syntax error and provide a corrected translation.`
        },
        {
          role: 'assistant',
          content: '{'
        }
      ]
    });

    response = message.content[0].type === 'text' ? message.content[0].text : '';
    const retryJsonString = '{' + response;
    parsed = JSON.parse(retryJsonString);

    // Validate retry attempt
    const retryValidation = validateContract(parsed.primaryContract);

    if (!retryValidation.valid) {
      console.log('Retry validation failed');
      return res.status(400).json({
        error: 'Contract validation failed after retry',
        validationError: retryValidation.error
      });
    }

    console.log('Retry validation successful');
    parsed.validated = true;
    parsed.bytecodeSize = retryValidation.bytecodeSize;
    parsed.artifact = retryValidation.artifact;
  } else {
    console.log('Initial validation successful');
    parsed.validated = true;
    parsed.bytecodeSize = validation.bytecodeSize;
    parsed.artifact = validation.artifact;
  }

  console.log('Conversion complete');
  res.json(parsed);
});

app.get('*', (req, res) => {
  res.sendFile(join(process.cwd(), 'dist', 'index.html'));
});

init().then(() => {
  app.listen(3001, () => {
    console.log('Server running on http://localhost:3001');
  });
});
