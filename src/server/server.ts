/**
 * Express Server - Minimal routing layer
 * All conversion logic extracted to handlers/convert.ts
 */
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeDatabase, closeDatabase, getConversions, getConversionById, getConversionStats } from './database.js';
import { loggerMiddleware } from './middleware/logger.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { ANTHROPIC_CONFIG, SERVER_CONFIG } from './config.js';
import { handleConversion } from './handlers/convert.js';
import { buildCodeGenerationPrompt } from './prompts/code-generation-prompt.js';

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(loggerMiddleware);
app.use(express.static('dist'));

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_CONFIG.apiKey
});

let knowledgeBase = '';
let systemPrompt = '';
let activeConversions = 0;

// Middleware to restrict access to localhost only
function localhostOnly(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocalhost) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

async function init() {
  console.log('[Server] Initializing database...');
  initializeDatabase();

  console.log('[Server] Loading CashScript knowledge base...');

  const languageRef = await readFile('./BCH_knowledge_base/language/language-reference.md', 'utf-8');
  const multiContractPatterns = await readFile('./BCH_knowledge_base/concepts/multi-contract-architecture.md', 'utf-8');

  knowledgeBase = `${languageRef}

---

# MULTI-CONTRACT ARCHITECTURE PATTERNS

The following patterns are CRITICAL for any conversion involving multiple contracts.
When multiple contracts participate in the SAME transaction, EACH contract's script runs and MUST validate.

${multiContractPatterns}`;

  console.log(`[Server] Knowledge base loaded: ${knowledgeBase.length} characters`);

  systemPrompt = buildCodeGenerationPrompt(knowledgeBase);
}

// Conversion endpoint
app.post('/api/convert-stream', rateLimiter, async (req, res) => {
  if (activeConversions >= SERVER_CONFIG.maxConcurrentConversions) {
    return res.status(503).json({
      error: 'Server busy',
      message: `Maximum ${SERVER_CONFIG.maxConcurrentConversions} concurrent conversions. Please try again in a moment.`
    });
  }

  activeConversions++;
  try {
    await handleConversion(req, res, anthropic, systemPrompt);
  } finally {
    activeConversions--;
  }
});

// History API endpoints (localhost only)
app.get('/api/conversions', localhostOnly, (_req, res) => {
  const limit = Math.min(parseInt(_req.query.limit as string) || 50, 100);
  const offset = parseInt(_req.query.offset as string) || 0;
  res.json(getConversions(limit, offset));
});

app.get('/api/conversions/:id', localhostOnly, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid conversion ID' });
  }
  const result = getConversionById(id);
  if (!result) {
    return res.status(404).json({ error: 'Conversion not found' });
  }
  res.json(result);
});

app.get('/api/stats', localhostOnly, (_req, res) => {
  res.json(getConversionStats());
});

// History page (localhost only)
app.get('/history', localhostOnly, (_req, res) => {
  res.sendFile(join(process.cwd(), 'dist', 'history.html'));
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(join(process.cwd(), 'dist', 'index.html'));
});

// Start server
init().then(() => {
  const server = app.listen(SERVER_CONFIG.port, () => {
    console.log(`[Server] Running on http://localhost:${SERVER_CONFIG.port}`);
  });

  server.timeout = SERVER_CONFIG.timeout;
  server.keepAliveTimeout = SERVER_CONFIG.keepAliveTimeout;
  server.headersTimeout = SERVER_CONFIG.headersTimeout;

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
}).catch((error) => {
  console.error('[FATAL] Server initialization failed:', error);
  process.exit(1);
});
