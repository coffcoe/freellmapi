import type { Request, Response, NextFunction } from 'express';
import { chatCompletionSchema, embeddingsBody } from './schemas.js';

/**
 * Request body validation middleware for /v1 proxy endpoints.
 *
 * Validates incoming requests against OpenAI-compatible schemas.
 * On success, stores the parsed result on `req.validated` so the
 * downstream handler can skip re-parsing.
 */
export function requestValidator() {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // GET requests (e.g. /v1/models) have no body to validate.
      if (req.method === 'GET') {
        next();
        return;
      }

      const isEmbeddings = req.path === '/embeddings';
      const isResponses = req.path === '/responses';

      if (isEmbeddings) {
        const parsed = embeddingsBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
              type: 'invalid_request_error',
            },
          });
          return;
        }
        req.validated = parsed.data;
      } else if (isResponses) {
        // Responses API: let responsesRouter parse with its own schema.
        next();
        return;
      } else {
        // Default: chat completions
        const parsed = chatCompletionSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: {
              message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
              type: 'invalid_request_error',
            },
          });
          return;
        }
        req.validated = parsed.data;
      }
    } catch {
      // Validator must never throw
    }
    next();
  };
}

// Extend Express Request type
declare module 'express-serve-static-core' {
  interface Request {
    validated?: Record<string, unknown>;
  }
}
