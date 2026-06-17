import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/index.js';
import { getUnifiedApiKey } from '../db/index.js';

/**
 * Proxy authentication middleware for /v1 endpoints.
 *
 * Authenticates with the unified API key (same logic as the original
 * proxy.ts handler).  On success, sets `req.tokenValidated = true` so
 * downstream middleware/handler can rely on the request being authenticated.
 */
export function proxyAuth() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // GET requests (like /v1/models) skip unified-key auth to maintain
    // compatibility with the original handler which used inline auth only
    // on POST endpoints.
    if (req.method === 'GET') {
      next();
      return;
    }
    try {
      const token = extractApiToken(req);
      const unifiedKey = getUnifiedApiKey();
      if (!token || !timingSafeStringEqual(token, unifiedKey)) {
        res.status(401).json({
          error: {
            message: 'Invalid API key',
            type: 'authentication_error',
          },
        });
        return;
      }
      req.tokenValidated = true;
    } catch {
      // Auth must never throw — fail open
    }
    next();
  };
}

/**
 * Extract the unified API key from an incoming request.
 * Accepts both the OpenAI-style `Authorization: Bearer <key>` header and
 * the Anthropic-style `x-api-key` header.
 */
export function extractApiToken(req: Request): string | undefined {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;

  const apiKeyHeader = req.headers['x-api-key'];
  const xApiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  const trimmed = xApiKey?.trim();
  return trimmed || undefined;
}

/**
 * Constant-time string comparison for the unified API key.
 * Prevents timing attacks that could recover the key byte-by-byte.
 */
import crypto from 'crypto';
export function timingSafeStringEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const compareA = a.length === b.length ? a : Buffer.alloc(b.length);
  return crypto.timingSafeEqual(compareA, b) && a.length === b.length;
}
