import type { Request, Response, NextFunction } from 'express';
import { hasEnabledVisionModel, hasEnabledToolsModel } from '../services/router.js';

/**
 * Capability gate middleware.
 *
 * Checks if the request requires vision or tool capabilities and validates
 * that at least one enabled model supports it. Early rejection with clear
 * error messages (#118, #125).
 *
 * NOTE: This middleware is placed after requestValidator and messageNormalizer
 * so req.hasImage and req.wantsTools are available.
 */
export function capabilityGate() {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const hasImage = (req as any).hasImage ?? false;
      const wantsTools = (req as any).wantsTools ?? false;

      if (hasImage && !hasEnabledVisionModel()) {
        res.status(422).json({
          error: {
            message: 'This request includes an image, but no vision-capable model is enabled. Enable a vision model (e.g. Gemini 2.5 Flash, Llama 4 Scout) in the Fallback Chain.',
            type: 'invalid_request_error',
            code: 'no_vision_model',
          },
        });
        return;
      }

      if (wantsTools && !hasEnabledToolsModel()) {
        res.status(422).json({
          error: {
            message: 'This request includes tools, but no tool-capable model is enabled. Enable a tool-calling model (e.g. GPT-OSS 120B, Gemini 3.5 Flash, GLM-4.7) in the Fallback Chain.',
            type: 'invalid_request_error',
            code: 'no_tools_model',
          },
        });
        return;
      }
    } catch {
      // Gate must never block
    }
    next();
  };
}
