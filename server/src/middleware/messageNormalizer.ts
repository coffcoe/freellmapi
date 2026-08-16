import type { Request, Response, NextFunction } from 'express';
import type { ChatMessage } from '@freellmapi/shared/types.js';
import { contentToString } from '../lib/content.js';
import { repairToolArguments, toolSchemaMap } from '../lib/tool-args.js';

/**
 * Message normalizer middleware.
 *
 * Converts the validated chat messages array into ChatMessage[] shape
 * (stripping Zod's parsed structure, coercing empty/null content, merging
 * tool_calls properly). Sets `req.normalisedMessages: ChatMessage[]` on
 * success.
 */
export function messageNormalizer() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validated = req.validated as any;
      if (!validated || !Array.isArray(validated.messages)) {
        next();
        return;
      }

      const messages: ChatMessage[] = validated.messages.map((m: any): ChatMessage => {
        if (m.role === 'assistant') {
          const hasToolCalls = (m.tool_calls?.length ?? 0) > 0;
          const isEmptyContent = m.content == null
            || (typeof m.content === 'string' && m.content.length === 0)
            || (Array.isArray(m.content) && m.content.length === 0);
          const assistantContent = hasToolCalls
            ? (m.content ?? null)
            : (isEmptyContent ? '' : m.content);
          return {
            role: 'assistant',
            content: assistantContent,
            ...(m.name ? { name: m.name } : {}),
            ...(m.tool_calls ? { tool_calls: m.tool_calls.map((tc: any) => ({
              id: tc.id,
              type: tc.type,
              function: tc.function,
              thought_signature: tc.thought_signature,
            })) } : {}),
          };
        }

        if (m.role === 'tool') {
          return {
            role: 'tool',
            content: m.content,
            tool_call_id: m.tool_call_id,
            ...(m.name ? { name: m.name } : {}),
          };
        }

        return {
          role: m.role,
          content: m.content,
          ...(m.name ? { name: m.name } : {}),
        };
      });

      req.normalisedMessages = messages;

      // Also compute hasImage and wantsTools for the capabilityGate
      req.hasImage = messages.some(m => {
        const c = m.content;
        if (!Array.isArray(c)) return false;
        return c.some((b: any) => b?.type === 'image_url' || b?.type === 'image');
      });

      req.wantsTools = (validated.tools?.length ?? 0) > 0;
    } catch {
      // Normalizer must never block the request
    }
    next();
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    normalisedMessages?: ChatMessage[];
    hasImage?: boolean;
    wantsTools?: boolean;
  }
}
