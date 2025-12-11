// ============================================================================
// BACKEND CONFIGURATION
// Server-side configuration with environment variable overrides
// Note: This file is for Node.js backend only, not for browser frontend
// Frontend config is in config.frontend.ts
// ============================================================================

// ============================================================================
// ANTHROPIC API CONFIGURATION
// ============================================================================

export const ANTHROPIC_CONFIG = {
  apiKey: process.env.ANTHROPIC_API_KEY || '',

  // Phase 1: Semantic Analysis
  phase1: {
    model: process.env.PHASE1_MODEL || 'claude-sonnet-4-5-20250929',
    maxTokens: parseInt(process.env.PHASE1_MAX_TOKENS || '21000', 10),
  },

  // Phase 2: UTXO Architecture Design
  phase2: {
    model: process.env.PHASE2_MODEL || 'claude-sonnet-4-5-20250929',
    maxTokens: parseInt(process.env.PHASE2_MAX_TOKENS || '21000', 10),
  },

  // Phase 3: Code Generation
  // Note: max_tokens > 21333 requires streaming mode per Anthropic API
  phase3: {
    model: process.env.PHASE3_MODEL || 'claude-sonnet-4-5-20250929',
    maxTokens: parseInt(process.env.PHASE3_MAX_TOKENS || '21333', 10),
  },

  // Phase 4: Validation + Fix Loop
  phase4: {
    model: process.env.PHASE4_MODEL || 'claude-sonnet-4-5-20250929',
    maxTokens: parseInt(process.env.PHASE4_MAX_TOKENS || '21000', 10),
    maxRetries: parseInt(process.env.PHASE4_MAX_RETRIES || '10', 10),
  },

  // Prompt Caching
  cache: {
    ttl: '1h' as const,
    type: 'ephemeral' as const,
  },

  // Beta Features
  betas: ['structured-outputs-2025-11-13'],
} as const;

// ============================================================================
// SERVER CONFIGURATION
// ============================================================================

export const SERVER_CONFIG = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || 'localhost',

  // Timeouts (in milliseconds)
  timeout: parseInt(process.env.SERVER_TIMEOUT_MS || '600000', 10), // 10 minutes
  keepAliveTimeout: parseInt(process.env.KEEP_ALIVE_TIMEOUT_SEC || '610', 10) * 1000,
  headersTimeout: parseInt(process.env.HEADERS_TIMEOUT_SEC || '615', 10) * 1000,

  // Concurrency
  maxConcurrentConversions: parseInt(process.env.MAX_CONCURRENT_CONVERSIONS || '100', 10),
} as const;

// ============================================================================
// RATE LIMITING CONFIGURATION
// ============================================================================

export const RATE_LIMIT_CONFIG = {
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '300000', 10), // 5 minutes
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '20', 10),
  cleanupIntervalMs: parseInt(process.env.RATE_LIMIT_CLEANUP_MS || '600000', 10), // 10 minutes
} as const;

