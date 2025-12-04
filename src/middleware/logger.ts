import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RequestMetadata } from '../types/logging.js';

// Extend Express Request type to include metadata
declare global {
  namespace Express {
    interface Request {
      metadata?: RequestMetadata;
    }
  }
}

// Type for requests that have been processed by loggerMiddleware
export type RequestWithMetadata = Request & { metadata: RequestMetadata };

export function loggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Generate or retrieve session ID from cookie/header
  let sessionId = req.cookies?.session_id || req.headers['x-session-id'] as string;

  if (!sessionId) {
    sessionId = uuidv4();
    // Set session cookie (expires in 24 hours)
    res.cookie('session_id', sessionId, {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'strict'
    });
  }

  // Extract IP address (handle proxies)
  const ip = (
    req.headers['x-forwarded-for'] as string ||
    req.headers['x-real-ip'] as string ||
    req.socket.remoteAddress ||
    'unknown'
  ).split(',')[0].trim();

  // Extract user agent
  const userAgent = req.headers['user-agent'] || 'unknown';

  // Attach metadata to request object
  req.metadata = {
    session_id: sessionId,
    ip_address: ip,
    user_agent: userAgent,
  };

  next();
}
