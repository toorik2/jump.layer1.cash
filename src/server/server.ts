/**
 * Express Server - Minimal routing layer
 * All conversion logic extracted to handlers/convert.ts
 */
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { initializeDatabase, closeDatabase, getConversions, getConversionById, getConversionStats, getVisitorAnalytics } from './database.js';
import { loggerMiddleware } from './middleware/logger.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { ANTHROPIC_CONFIG, SERVER_CONFIG } from './config.js';
import { handleConversion } from './handlers/convert.js';

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(loggerMiddleware);
app.use(express.static('dist'));

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_CONFIG.apiKey
});

let knowledgeBase = '';
let activeConversions = 0;

// Middleware to restrict access to localhost or allowed IPs
const ALLOWED_IPS = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '91.129.107.33'];

function localhostOnly(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Check X-Real-IP first (set by nginx for real client IP), then fallback to req.ip
  const realIp = req.headers['x-real-ip'] as string | undefined;
  const ip = realIp || req.ip || req.socket.remoteAddress || '';
  if (!ALLOWED_IPS.includes(ip)) {
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
}

// Client-side error logging
app.post('/api/log-error', (req, res) => {
  const { type, contractName, functionName, reason } = req.body;
  console.error(`[ClientError] ${type}: ${reason} (contract="${contractName}", function="${functionName}")`);
  res.json({ logged: true });
});

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
    await handleConversion(req, res, anthropic, knowledgeBase);
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

app.get('/api/analytics', localhostOnly, (_req, res) => {
  res.json({
    stats: getConversionStats(),
    visitors: getVisitorAnalytics()
  });
});

// Prompts metadata endpoint
app.get('/api/prompts', localhostOnly, async (_req, res) => {
  const phasesDir = join(__dirname, 'phases');
  const [phase1Schema, phase2Schema, phase3Schema, phase4Schema] = await Promise.all([
    readFile(join(phasesDir, 'phase1', 'schema.json'), 'utf-8'),
    readFile(join(phasesDir, 'phase2', 'schema.json'), 'utf-8'),
    readFile(join(phasesDir, 'phase3', 'schema.json'), 'utf-8'),
    readFile(join(phasesDir, 'phase4', 'schema.json'), 'utf-8')
  ]);
  res.json({
    phase1: {
      systemPromptPath: 'src/server/phases/phase1/prompt.ts',
      schemaPath: 'src/server/phases/phase1/schema.json',
      schema: JSON.parse(phase1Schema)
    },
    phase2: {
      systemPromptPath: 'src/server/phases/phase2/prompt.ts',
      schemaPath: 'src/server/phases/phase2/schema.json',
      schema: JSON.parse(phase2Schema)
    },
    phase3: {
      systemPromptPath: 'src/server/phases/phase3/prompt.ts',
      schemaPath: 'src/server/phases/phase3/schema.json',
      schema: JSON.parse(phase3Schema)
    },
    phase4: {
      systemPromptPath: 'src/server/phases/phase4/prompt.ts',
      schemaPath: 'src/server/phases/phase4/schema.json',
      schema: JSON.parse(phase4Schema)
    }
  });
});

// Analytics page (localhost only)
app.get('/analytics', localhostOnly, (_req, res) => {
  res.sendFile(join(process.cwd(), 'dist', 'analytics.html'));
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

  const shutdown = (signal: string) => {
    console.log(`[Server] ${signal} received, shutting down gracefully...`);
    server.close(() => {
      console.log('[Server] HTTP server closed');
      closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}).catch((error) => {
  console.error('[FATAL] Server initialization failed:', error);
  process.exit(1);
});
