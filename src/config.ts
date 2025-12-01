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

  // Phase 2: Code Generation
  phase2: {
    model: process.env.PHASE2_MODEL || 'claude-sonnet-4-5-20250929',
    maxTokens: parseInt(process.env.PHASE2_MAX_TOKENS || '21000', 10),
    maxRetries: parseInt(process.env.PHASE2_MAX_RETRIES || '10', 10),
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
} as const;

// ============================================================================
// VALIDATION
// ============================================================================

function validateConfig() {
  const errors: string[] = [];

  if (!ANTHROPIC_CONFIG.apiKey) {
    errors.push('ANTHROPIC_API_KEY environment variable is required');
  }

  if (ANTHROPIC_CONFIG.phase1.maxTokens < 1000 || ANTHROPIC_CONFIG.phase1.maxTokens > 64000) {
    errors.push('PHASE1_MAX_TOKENS must be between 1000 and 64000');
  }

  if (ANTHROPIC_CONFIG.phase2.maxTokens < 1000 || ANTHROPIC_CONFIG.phase2.maxTokens > 64000) {
    errors.push('PHASE2_MAX_TOKENS must be between 1000 and 64000');
  }

  if (ANTHROPIC_CONFIG.phase2.maxRetries < 1 || ANTHROPIC_CONFIG.phase2.maxRetries > 20) {
    errors.push('PHASE2_MAX_RETRIES must be between 1 and 20');
  }

  if (SERVER_CONFIG.port < 1 || SERVER_CONFIG.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }

  if (errors.length > 0) {
    console.error('[Config] Validation errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    throw new Error('Configuration validation failed');
  }
}

// Validate on module load
validateConfig();
