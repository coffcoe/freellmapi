import type { Request, Response, NextFunction } from 'express';
import { contentToString } from '../lib/content.js';

/**
 * Token estimator middleware.
 *
 * Calculates an approximate token count from the inbound messages so the
 * retry loop (see proxy.ts) can do budget-aware routing before committing
 * to the full retry chain. This is a heuristic (~4 chars per token) — it's
 * intentionally fast and does NOT call any upstream API.
 *
 * Sets `req.estimatedTokens: number` on the request.
 */
export function tokenEstimator() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const body = req.validated || req.body;
      if (!body || typeof body.messages !== 'object' || !Array.isArray(body.messages)) {
        req.estimatedTokens = 1000;
        next();
        return;
      }

      const messages = body.messages as Array<Record<string, unknown>>;
      const estimatedInputTokens = messages.reduce((sum, m) => {
        const content = m.content;
        const text = contentToString(content);
        return sum + Math.ceil(text.length / 4);
      }, 0);

      // Add rough per-image cost so budget routing isn't skewed by content
      // the heuristic above (text-only) can't see.
      const IMAGE_TOKEN_ESTIMATE = 1000;
      const imageCount = messages.reduce((n, m) => {
        const content = m.content;
        if (!Array.isArray(content)) return n;
        return n + content.filter((b: any) => b?.type === 'image_url' || b?.type === 'image').length;
      }, 0);

      const maxTokens = (body.max_tokens as number) ?? 1000;
      req.estimatedTokens = estimatedInputTokens + imageCount * IMAGE_TOKEN_ESTIMATE + maxTokens;
    } catch {
      // Estimator must never block the request
      req.estimatedTokens = 1000;
    }
    next();
  };
}

// Extend Express Request type so TypeScript knows about req.estimatedTokens
declare module 'express-serve-static-core' {
  interface Request {
    estimatedTokens?: number;
    tokenValidated?: boolean;
    validatedMessages?: any;
    hasImage?: boolean;
    wantsTools?: boolean;
  }
}
