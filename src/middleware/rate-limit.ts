import type { Request, Response, NextFunction } from 'express';
import { RATE_LIMIT_CONFIG } from '../config.js';

// ============================================================================
// SIMPLE IN-MEMORY RATE LIMITER
// No external dependencies, sliding window approach
// ============================================================================

interface RateLimitStore {
  [ip: string]: number[]; // IP -> array of timestamps
}

const requestStore: RateLimitStore = {};

// Periodic cleanup of old entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_CONFIG.windowMs;

  for (const ip in requestStore) {
    requestStore[ip] = requestStore[ip].filter(timestamp => timestamp > cutoff);
    if (requestStore[ip].length === 0) {
      delete requestStore[ip];
    }
  }
}, RATE_LIMIT_CONFIG.cleanupIntervalMs);

/**
 * Rate limiting middleware
 * Limits requests per IP address using sliding window
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_CONFIG.windowMs;

  if (!requestStore[ip]) {
    requestStore[ip] = [];
  }

  requestStore[ip] = requestStore[ip].filter(timestamp => timestamp > windowStart);

  if (requestStore[ip].length >= RATE_LIMIT_CONFIG.maxRequests) {
    const oldestRequest = requestStore[ip][0];
    const retryAfterMs = oldestRequest + RATE_LIMIT_CONFIG.windowMs - now;
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);

    res.status(429).json({
      error: 'Too many requests',
      message: `Rate limit exceeded. Maximum ${RATE_LIMIT_CONFIG.maxRequests} requests per ${RATE_LIMIT_CONFIG.windowMs / 60000} minutes.`,
      retryAfter: retryAfterSec,
    });
    return;
  }

  requestStore[ip].push(now);
  next();
}
