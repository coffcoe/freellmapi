import type { Request, Response, NextFunction } from 'express';

/**
 * Request sanitizer middleware for /v1 proxy.
 *
 * Redacts sensitive content from the incoming request body so it never
 * accidentally lands in logs. Uses the same redaction patterns as
 * `lib/error-redaction.ts`.
 *
 * Runs before Zod validation so the sanitized copy is also the validated
 * copy — this is a deliberate tradeoff since the sanitizer only rewrites
 * `content` strings and tool arguments, never structural fields.
 */
export function requestSanitizer() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const body = req.body;
      if (!body || typeof body.messages !== 'object' || !Array.isArray(body.messages)) {
        next();
        return;
      }

      let changed = false;
      for (const msg of body.messages) {
        if (!msg || typeof msg !== 'object') continue;

        // Sanitize content strings
        if (typeof (msg as any).content === 'string') {
          (msg as any).content = redactSensitiveStrings((msg as any).content);
          changed = true;
        } else if (Array.isArray((msg as any).content)) {
          for (const block of (msg as any).content) {
            if (block && typeof block.text === 'string') {
              block.text = redactSensitiveStrings(block.text);
              changed = true;
            }
          }
        }

        // Sanitize tool call arguments (JSON strings)
        if (Array.isArray((msg as any).tool_calls)) {
          for (const tc of (msg as any).tool_calls) {
            if (tc && typeof (tc as any).function?.arguments === 'string') {
              (tc as any).function.arguments = redactSensitiveStrings((tc as any).function.arguments);
              changed = true;
            }
          }
        }
      }

      // Only set body if we actually changed something (avoids unnecessary writes)
      if (changed) {
        // body.messages was mutated in-place; req.body stays valid.
      }
    } catch {
      // Sanitizer must never block the request — fail open.
    }
    next();
  };
}

/**
 * Lightweight redaction for arbitrary strings.
 * Matches Bearer tokens, API keys, secrets, etc.
 */
function redactSensitiveStrings(input: string): string {
  return input
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(
      /\b(api[_-]?key|access[_-]?token|token|secret|authorization)(\s*[:=]\s*)(["']?)[^"',\s}\]]+/gi,
      '$1$2$3[redacted]'
    )
    .replace(/["']?(sk-[a-zA-Z0-9]{20,})["']?/g, '[redacted]') // OpenAI-style keys
    .replace(/["']?(gsk_[a-zA-Z0-9]{20,})["']?/g, '[redacted]'); // Groq-style keys
}
