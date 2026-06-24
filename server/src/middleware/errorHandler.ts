import type { Request, Response, NextFunction } from 'express';
import { isPaymentRequiredError, isModelNotFoundError, isModelAccessForbiddenError } from '../lib/error-classify.js';

/**
 * Map an error to an OpenAI-compatible error type and code.
 *
 * OpenAI error format:
 * {
 *   "error": {
 *     "message": "...",
 *     "type": "invalid_request_error",
 *     "param": null,
 *     "code": "rate_limit_exceeded"
 *   }
 * }
 *
 * Classification:
 * - 429       → type: "rate_limit_error",    code: "rate_limit_exceeded"
 * - 402       → type: "insufficient_quota",  code: "insufficient_quota"
 * - 401       → type: "authentication_error", code: "invalid_api_key"
 * - 403       → type: "permission_error",    code: "model_not_accessible"
 * - 404       → type: "not_found_error",      code: "model_not_found"
 * - 413       → type: "invalid_request_error", code: "payload_too_large"
 * - 400       → type: "invalid_request_error", code: "invalid_request"
 * - 500/502/503 → type: "server_error",        code: "server_error"
 */
function classifyError(err: any): { status: number; type: string; code: string } {
  const status = err?.status ?? 500;
  const msg = (err?.message ?? '').toLowerCase();

  // 1. 429 — Rate limit (highest priority: preserve retryability)
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('queue full')) {
    return { status: 429, type: 'rate_limit_error', code: 'rate_limit_exceeded' };
  }

  // 2. 402 — Payment required / out of credits
  if (status === 402 || isPaymentRequiredError(err)) {
    return { status: 402, type: 'insufficient_quota', code: 'insufficient_quota' };
  }

  // 3. 401 — Authentication failure
  if (status === 401) {
    return { status: 401, type: 'authentication_error', code: 'invalid_api_key' };
  }

  // 4. 403 — Forbidden / model access denied (check status FIRST to avoid msg false-positives)
  if (status === 403 || isModelAccessForbiddenError(err)) {
    return { status: 403, type: 'permission_error', code: 'model_not_accessible' };
  }

  // 5. 404 — Model not found / deprecated upstream
  if (status === 404 || isModelNotFoundError(err)) {
    return { status: 404, type: 'not_found_error', code: 'model_not_found' };
  }

  // 6. 413 — Payload too large
  if (status === 413 || msg.includes('payload too large') || msg.includes('content too large') || msg.includes('request body too large')) {
    return { status: 413, type: 'invalid_request_error', code: 'payload_too_large' };
  }

  // 7. 400 — Invalid request
  if (status === 400) {
    return { status: 400, type: 'invalid_request_error', code: 'invalid_request' };
  }

  // 8. 5xx — Server errors
  if (status >= 500 && status < 600) {
    return { status, type: 'server_error', code: 'server_error' };
  }

  // Default: treat as server error
  return { status: 500, type: 'server_error', code: 'internal_error' };
}

export function errorHandler(err: Error, _req: Request, res: Response, next: NextFunction) {
  // Don't log full stack in production (may leak internal paths)
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    console.error('[Error]', err.message, err.stack ? `\n${err.stack}` : '');
  } else {
    console.error('[Error]', err.message);
  }

  if (res.headersSent) return next(err);

  const { status, type, code } = classifyError(err);
  res.status(status).json({
    error: {
      message: err.message,
      type,
      param: (err as any).param ?? null,
      code,
    },
  });
}
