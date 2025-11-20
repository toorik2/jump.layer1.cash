import type { Request, Response, NextFunction } from 'express';

// ============================================================================
// SIMPLE IN-MEMORY RATE LIMITER
// No external dependencies, sliding window approach
// ============================================================================

interface RateLimitStore {
  [ip: string]: number[]; // IP -> array of timestamps
}

const requestStore: RateLimitStore = {};

// Configuration
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const MAX_REQUESTS = 5; // 5 requests per window
const CLEANUP_INTERVAL = 10 * 60 * 1000; // Cleanup every 10 minutes

// Periodic cleanup of old entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  for (const ip in requestStore) {
    // Remove timestamps older than window
    requestStore[ip] = requestStore[ip].filter(timestamp => timestamp > cutoff);

    // Remove IP entirely if no recent requests
    if (requestStore[ip].length === 0) {
      delete requestStore[ip];
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Rate limiting middleware
 * Limits requests per IP address using sliding window
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Initialize array for new IPs
  if (!requestStore[ip]) {
    requestStore[ip] = [];
  }

  // Remove timestamps outside the current window (sliding window)
  requestStore[ip] = requestStore[ip].filter(timestamp => timestamp > windowStart);

  // Check if limit exceeded
  if (requestStore[ip].length >= MAX_REQUESTS) {
    const oldestRequest = requestStore[ip][0];
    const retryAfterMs = oldestRequest + WINDOW_MS - now;
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);

    res.status(429).json({
      error: 'Too many requests',
      message: `Rate limit exceeded. Maximum ${MAX_REQUESTS} requests per ${WINDOW_MS / 60000} minutes.`,
      retryAfter: retryAfterSec,
    });
    return;
  }

  // Add current request timestamp
  requestStore[ip].push(now);

  next();
}
