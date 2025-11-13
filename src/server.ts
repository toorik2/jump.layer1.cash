import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileString } from 'cashc';
import { initializeDatabase, closeDatabase } from './database.js';
import { loggerMiddleware } from './middleware/logger.js';
import {
  logConversionStart,
  logConversionComplete,
  logApiCallStart,
  logApiCallComplete,
  logAlternatives,
  logConsiderations,
  logValidationResult,
  logRetryAttempt,
  logError,
} from './services/logging.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(loggerMiddleware);
app.use(express.static('dist'));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

let knowledgeBase = '';

async function init() {
  console.log('[Server] Initializing database...');
  initializeDatabase();

  console.log('[Server] Loading CashScript language reference...');
  knowledgeBase = await readFile('./cashscript-knowledge-base/language/language-reference.md', 'utf-8');
  console.log(`[Server] Knowledge base loaded: ${knowledgeBase.length} characters`);
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
  const startTime = Date.now();
  let conversionId: number | undefined;

  try {
    console.log('[Conversion] Received conversion request');
    const { contract } = req.body;
    const metadata = req.metadata!;

    // Log conversion start (async, but wait for ID)
    conversionId = await logConversionStart(metadata, contract);
    console.log(`[Conversion] Started with ID ${conversionId}`);

    const systemPrompt = `You are a CashScript expert. Convert EVM (Solidity) smart contracts to CashScript.

CashScript Language Reference:
${knowledgeBase}

IMPORTANT: Always use "pragma cashscript ^0.13.0;" at the top of every CashScript contract.

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
    console.log('[Conversion] Calling Anthropic API (initial attempt)...');
    const apiCallStartTime = Date.now();
    const apiCallId = await logApiCallStart(conversionId, 1, 'claude-sonnet-4-5-20250929', 8000, systemPrompt, contract);

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

    // Log API call completion (don't wait)
    logApiCallComplete(apiCallId, apiCallStartTime, true, response).catch(err =>
      console.error('[Logging] Failed to log API call completion:', err)
    );

    let parsed = JSON.parse(jsonString);

    // Validate primary contract
    console.log('[Conversion] Validating primary contract...');
    const validation = validateContract(parsed.primaryContract);

    // Log initial validation result (don't wait)
    logValidationResult(conversionId, validation.valid, validation.error, validation.bytecodeSize).catch(err =>
      console.error('[Logging] Failed to log validation result:', err)
    );

    if (!validation.valid) {
      console.log('[Conversion] Validation failed, retrying with error feedback...');

      // Retry with validation error
      const retryApiCallStartTime = Date.now();
      const retryMessage = `Original EVM contract:\n${contract}\n\nYour previous CashScript translation has a syntax error:\n${validation.error}\n\nPlease fix the syntax error and provide a corrected translation.`;

      const retryApiCallId = await logApiCallStart(conversionId, 2, 'claude-sonnet-4-5-20250929', 8000, systemPrompt, retryMessage);

      message = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: retryMessage
          },
          {
            role: 'assistant',
            content: '{'
          }
        ]
      });

      response = message.content[0].type === 'text' ? message.content[0].text : '';
      const retryJsonString = '{' + response;

      // Log retry API call completion (don't wait)
      logApiCallComplete(retryApiCallId, retryApiCallStartTime, true, response).catch(err =>
        console.error('[Logging] Failed to log retry API call completion:', err)
      );

      parsed = JSON.parse(retryJsonString);

      // Validate retry attempt
      const retryValidation = validateContract(parsed.primaryContract);

      // Log retry attempt (don't wait)
      logRetryAttempt(conversionId, retryValidation.valid).catch(err =>
        console.error('[Logging] Failed to log retry attempt:', err)
      );

      // Log retry validation result (don't wait)
      logValidationResult(conversionId, retryValidation.valid, retryValidation.error, retryValidation.bytecodeSize).catch(err =>
        console.error('[Logging] Failed to log retry validation result:', err)
      );

      if (!retryValidation.valid) {
        console.log('[Conversion] Retry validation failed');

        // Log error (don't wait)
        logError('validation_error', retryValidation.error || 'Unknown validation error', conversionId).catch(err =>
          console.error('[Logging] Failed to log error:', err)
        );

        // Log conversion completion (don't wait)
        logConversionComplete(conversionId, startTime, 'validation_failed').catch(err =>
          console.error('[Logging] Failed to log conversion completion:', err)
        );

        return res.status(400).json({
          error: 'Contract validation failed after retry',
          validationError: retryValidation.error
        });
      }

      console.log('[Conversion] Retry validation successful');
      parsed.validated = true;
      parsed.bytecodeSize = retryValidation.bytecodeSize;
      parsed.artifact = retryValidation.artifact;
    } else {
      console.log('[Conversion] Initial validation successful');
      parsed.validated = true;
      parsed.bytecodeSize = validation.bytecodeSize;
      parsed.artifact = validation.artifact;
    }

    // Log alternatives and considerations (don't wait)
    if (parsed.alternatives && parsed.alternatives.length > 0) {
      logAlternatives(conversionId, parsed.alternatives).catch(err =>
        console.error('[Logging] Failed to log alternatives:', err)
      );
    }

    if (parsed.considerations && parsed.considerations.length > 0) {
      logConsiderations(conversionId, parsed.considerations).catch(err =>
        console.error('[Logging] Failed to log considerations:', err)
      );
    }

    // Log conversion completion (don't wait)
    logConversionComplete(conversionId, startTime, 'success', parsed.primaryContract, parsed.explanation).catch(err =>
      console.error('[Logging] Failed to log conversion completion:', err)
    );

    console.log('[Conversion] Complete');
    res.json(parsed);

  } catch (error) {
    console.error('[Conversion] Error:', error);

    // Log error (don't wait)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stackTrace = error instanceof Error ? error.stack : undefined;

    if (conversionId) {
      logError('unknown_error', errorMessage, conversionId, stackTrace).catch(err =>
        console.error('[Logging] Failed to log error:', err)
      );

      logConversionComplete(conversionId, startTime, 'error').catch(err =>
        console.error('[Logging] Failed to log conversion completion:', err)
      );
    } else {
      logError('unknown_error', errorMessage, undefined, stackTrace).catch(err =>
        console.error('[Logging] Failed to log error:', err)
      );
    }

    res.status(500).json({
      error: 'Internal server error',
      message: errorMessage
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(join(process.cwd(), 'dist', 'index.html'));
});

init().then(() => {
  const server = app.listen(3001, () => {
    console.log('[Server] Running on http://localhost:3001');
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down gracefully...');
    server.close(() => {
      console.log('[Server] HTTP server closed');
      closeDatabase();
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('[Server] SIGINT received, shutting down gracefully...');
    server.close(() => {
      console.log('[Server] HTTP server closed');
      closeDatabase();
      process.exit(0);
    });
  });
});
