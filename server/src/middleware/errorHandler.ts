import type { Request, Response, NextFunction } from 'express';
import { isPaymentRequiredError, isModelNotFoundError, isModelAccessForbiddenError } from '../lib/error-classify.js';
import { logRequest } from '../lib/request-log.js';

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
    return { status: 413, type: 'invalid_request_error', code: 'request_too_large' };
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

// The inference wire surfaces whose over-limit bodies deserve an analytics
// row — the dashboard renders them like any failed request instead of the
// rejection being visible only in the container log.
const INFERENCE_PATH_PREFIXES = ['/v1', '/v1beta', '/mcp'];

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  // Don't log full stack in production (may leak internal paths)
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    console.error('[Error]', err.message, err.stack ? `\n${err.stack}` : '');
  } else {
    console.error('[Error]', err.message);
  }

  if (res.headersSent) return next(err);

  const { status, type, code } = classifyError(err);

  // body-parser rejects bodies over the configured limit with its own error
  // shape ('PayloadTooLargeError', type 'entity.too.large'). Agents reading
  // the OpenAI error contract saw an opaque 413; normalize it, and record the
  // rejection in request analytics so it shows up in the dashboard like the
  // upstream-413 path that the fallback loop already logs.
  if ((err as any).type === 'entity.too.large' || status === 413) {
    const limit = (err as any).limit;
    const received = (err as any).length ?? (err as any).expected;
    const message = `Request body too large${typeof received === 'number' ? ` (${received} bytes)` : ''}` +
      `${typeof limit === 'number' ? ` for the ${limit}-byte limit` : ''}. ` +
      'Vision requests embed base64 images in the body; raise REQUEST_BODY_LIMIT_MB (default 25) to accept larger payloads.';
    if (INFERENCE_PATH_PREFIXES.some(prefix => req.path.startsWith(prefix))) {
      logRequest('proxy', 'payload-too-large', null, 'error', 0, 0, 0, message);
    }
    res.status(413).json({
      error: {
        message,
        type: 'invalid_request_error',
        code: 'request_too_large',
      },
    });
    return;
  }

  res.status(status).json({
    error: {
      message: err.message,
      type,
      param: (err as any).param ?? null,
      code,
    },
  });
}
