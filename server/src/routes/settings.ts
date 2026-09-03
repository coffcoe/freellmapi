import { Router } from 'express';
import type { Request, Response } from 'express';
import { getUnifiedApiKey, regenerateUnifiedKey, getSetting, setSetting } from '../db/index.js';
import { getRequestMaxTokensBudget, getMaxConsecutiveUpstreamFails, SETTING_REQUEST_MAX_TOKENS_BUDGET, SETTING_MAX_CONSECUTIVE_UPSTREAM_FAILS, REQUEST_MAX_TOKENS_BUDGET_SETTING, MAX_CONSECUTIVE_UPSTREAM_FAILS_SETTING } from '../lib/guardrails.js';
import { applyProxyUrl, applyProxyEnabled, applyProxyBypass, isProxyActive, getProxyUrl, isProxyEnabled, getProxyBypassPlatforms } from '../lib/proxy.js';
import { getSavedFusionConfig, setSavedFusionConfig, savedFusionConfigSchema, getFusionMaxK } from '../services/fusion.js';
import { isUnifyEnabled, setUnifyEnabled, getUnifyOverrides, setUnifyOverrides, unifyOverridesSchema } from '../services/model-groups.js';
import { getClaudeModelMap, setClaudeModelMap } from '../services/anthropic-map.js';
import { UNIFIED_MAX_TOKENS_SETTING, UNIFIED_MAX_TOKENS_AUTO, unifiedMaxTokensCap } from '../lib/sampling-params.js';
import {
  compressionUpdateSchema,
  getCompressionConfig,
  setCompressionConfig,
} from '../services/compression/config.js';
import { z } from 'zod';

export const settingsRouter = Router();

settingsRouter.get('/compression', (_req: Request, res: Response) => {
  res.json(getCompressionConfig());
});

settingsRouter.put('/compression', (req: Request, res: Response) => {
  const parsed = compressionUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = parsed.error.errors
      .map(e => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message))
      .slice(0, 5)
      .join(', ');
    res.status(400).json({
      error: { message: `Invalid compression settings: ${detail}`, type: 'invalid_request_error' },
    });
    return;
  }
  res.json(setCompressionConfig(parsed.data));
});

// Get the model-unification setting: the global toggle (default ON) plus any
// merge/split overrides. Governs the dashboard grouping, /v1/models grouping,
// and cross-provider pin failover.
settingsRouter.get('/unify', (_req: Request, res: Response) => {
  res.json({ enabled: isUnifyEnabled(), overrides: getUnifyOverrides() });
});

const unifyPutSchema = z.object({
  enabled: z.boolean().optional(),
  overrides: unifyOverridesSchema.optional(),
});

// Update the unify toggle and/or overrides. Partial: send just `enabled` to
// flip the switch, or `overrides` to adjust grouping, or both.
settingsRouter.put('/unify', (req: Request, res: Response) => {
  const parsed = unifyPutSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = parsed.error.errors.map(e => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message)).slice(0, 5).join(', ');
    res.status(400).json({ error: { message: `Invalid unify settings: ${detail}`, type: 'invalid_request_error' } });
    return;
  }
  if (parsed.data.enabled !== undefined) setUnifyEnabled(parsed.data.enabled);
  if (parsed.data.overrides) setUnifyOverrides(parsed.data.overrides);
  res.json({ enabled: isUnifyEnabled(), overrides: getUnifyOverrides() });
});

// Get the saved fusion default config (panel mode, models, judge, k, strategy).
settingsRouter.get('/fusion', (_req: Request, res: Response) => {
  res.json({ config: getSavedFusionConfig(), maxK: getFusionMaxK() });
});

// Save the fusion default config. A request's inline `fusion` field still
// overrides this per call (see services/fusion.ts resolveEffectiveConfig).
settingsRouter.put('/fusion', (req: Request, res: Response) => {
  const parsed = savedFusionConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = parsed.error.errors.map(e => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message)).slice(0, 5).join(', ');
    res.status(400).json({ error: { message: `Invalid fusion config: ${detail}`, type: 'invalid_request_error' } });
    return;
  }
  const saved = setSavedFusionConfig(parsed.data);
  res.json({ config: saved, maxK: getFusionMaxK() });
});

// Get the Claude Code model map (opus/sonnet/haiku/default → 'auto' | model_id).
// Drives how the Anthropic /v1/messages route resolves Claude Code's built-in
// model names against the free pool.
settingsRouter.get('/anthropic-map', (_req: Request, res: Response) => {
  res.json({ map: getClaudeModelMap() });
});

// Update the Claude Code model map. Partial: send just the families you want to
// change; each value is 'auto' or a catalog model_id.
settingsRouter.put('/anthropic-map', (req: Request, res: Response) => {
  try {
    res.json({ map: setClaudeModelMap(req.body) });
  } catch (err: any) {
    const detail = err?.errors
      ? err.errors.map((e: any) => (e.path?.length ? `${e.path.join('.')}: ${e.message}` : e.message)).slice(0, 5).join(', ')
      : (err?.message ?? 'invalid');
    res.status(400).json({ error: { message: `Invalid anthropic model map: ${detail}`, type: 'invalid_request_error' } });
  }
});

// Get the request guardrails (per-request token budget + failover circuit
// breaker). Both default to 0 = disabled; see lib/guardrails.ts.
settingsRouter.get('/guardrails', (_req: Request, res: Response) => {
  res.json({
    requestMaxTokensBudget: getRequestMaxTokensBudget(),
    maxConsecutiveUpstreamFails: getMaxConsecutiveUpstreamFails(),
  });
});

const guardrailsPutSchema = z.object({
  requestMaxTokensBudget: z.number().int().min(0).optional(),
  maxConsecutiveUpstreamFails: z.number().int().min(0).optional(),
});

// Update the guardrails. Partial: send just the knob you want to change.
// Takes effect on the next request — no restart needed. 0 disables a knob.
settingsRouter.put('/guardrails', (req: Request, res: Response) => {
  const parsed = guardrailsPutSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = parsed.error.errors.map(e => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message)).slice(0, 5).join(', ');
    res.status(400).json({ error: { message: `Invalid guardrail settings: ${detail}`, type: 'invalid_request_error' } });
    return;
  }
  if (parsed.data.requestMaxTokensBudget !== undefined) {
    setSetting(REQUEST_MAX_TOKENS_BUDGET_SETTING, String(parsed.data.requestMaxTokensBudget));
  }
  if (parsed.data.maxConsecutiveUpstreamFails !== undefined) {
    setSetting(MAX_CONSECUTIVE_UPSTREAM_FAILS_SETTING, String(parsed.data.maxConsecutiveUpstreamFails));
  }
  res.json({
    requestMaxTokensBudget: getRequestMaxTokensBudget(),
    maxConsecutiveUpstreamFails: getMaxConsecutiveUpstreamFails(),
  });
});

// Get the unified API key
settingsRouter.get('/api-key', (_req: Request, res: Response) => {
  res.json({ apiKey: getUnifiedApiKey() });
});

// Regenerate the unified API key
settingsRouter.post('/api-key/regenerate', (_req: Request, res: Response) => {
  const newKey = regenerateUnifiedKey();
  res.json({ apiKey: newKey });
});

// Get the proxy settings
settingsRouter.get('/proxy', (_req: Request, res: Response) => {
  res.json({
    proxyUrl: getProxyUrl(),
    enabled: isProxyEnabled(),
    bypassPlatforms: getProxyBypassPlatforms(),
    active: isProxyActive(),
  });
});

// Get the routing guardrails (策略 24 / 循环工程：反 Goodhart 护栏).
//  - request_max_tokens_budget: 单请求 token 成本天花板 (0 = 不限制)
//  - max_consecutive_upstream_fails: 连续上游失败断路器阈值 (0 = 不启用)
settingsRouter.get('/guardrails', (_req: Request, res: Response) => {
  res.json({
    requestMaxTokensBudget: getRequestMaxTokensBudget(),
    maxConsecutiveUpstreamFails: getMaxConsecutiveUpstreamFails(),
  });
});

// Set the routing guardrails. Both fields optional; send either to patch.
settingsRouter.put('/guardrails', (req: Request, res: Response) => {
  const { requestMaxTokensBudget, maxConsecutiveUpstreamFails } = req.body as {
    requestMaxTokensBudget?: number;
    maxConsecutiveUpstreamFails?: number;
  };
  if (typeof requestMaxTokensBudget === 'number') {
    if (!Number.isFinite(requestMaxTokensBudget) || requestMaxTokensBudget < 0) {
      res.status(400).json({ error: { message: 'requestMaxTokensBudget must be a non-negative integer', type: 'invalid_request_error' } });
      return;
    }
    setSetting(SETTING_REQUEST_MAX_TOKENS_BUDGET, String(Math.floor(requestMaxTokensBudget)));
  }
  if (typeof maxConsecutiveUpstreamFails === 'number') {
    if (!Number.isFinite(maxConsecutiveUpstreamFails) || maxConsecutiveUpstreamFails < 0) {
      res.status(400).json({ error: { message: 'maxConsecutiveUpstreamFails must be a non-negative integer', type: 'invalid_request_error' } });
      return;
    }
    setSetting(SETTING_MAX_CONSECUTIVE_UPSTREAM_FAILS, String(Math.floor(maxConsecutiveUpstreamFails)));
  }
  res.json({
    requestMaxTokensBudget: getRequestMaxTokensBudget(),
    maxConsecutiveUpstreamFails: getMaxConsecutiveUpstreamFails(),
  });
});

// Set the proxy settings. Accepts partial updates: proxyUrl, enabled, bypassPlatforms.
settingsRouter.put('/proxy', (req: Request, res: Response) => {
  const { proxyUrl, enabled, bypassPlatforms } = req.body as {
    proxyUrl?: string;
    enabled?: boolean;
    bypassPlatforms?: string[];
  };

  // --- proxyUrl ---
  if (typeof proxyUrl === 'string') {
    const trimmed = proxyUrl.trim();
    if (trimmed) {
      try {
        const u = new URL(trimmed);
        if (!['http:', 'https:', 'socks5:', 'socks4:'].includes(u.protocol)) {
          res.status(400).json({
            error: { message: 'Proxy URL must use http, https, socks5, or socks4 scheme', type: 'invalid_request_error' },
          });
          return;
        }
      } catch {
        res.status(400).json({
          error: { message: 'Invalid proxy URL — must be a valid URL like socks5://host:port', type: 'invalid_request_error' },
        });
        return;
      }
      setSetting('proxy_url', trimmed);
    } else {
      setSetting('proxy_url', '');
    }
    applyProxyUrl(trimmed);
  }

  // --- enabled ---
  if (typeof enabled === 'boolean') {
    setSetting('proxy_enabled', enabled ? '1' : '0');
    applyProxyEnabled(enabled);
  }

  // --- bypassPlatforms ---
  if (Array.isArray(bypassPlatforms)) {
    const csv = bypassPlatforms.map(s => s.trim()).filter(Boolean).join(',');
    setSetting('proxy_bypass', csv);
    applyProxyBypass(csv);
  }

  res.json({
    proxyUrl: getProxyUrl(),
    enabled: isProxyEnabled(),
    bypassPlatforms: getProxyBypassPlatforms(),
    active: isProxyActive(),
  });
});

// The unified output-token cap as the dashboard sees it. `mode` is exactly
// what PUT accepts back — 'off', 'auto', or the integer itself, never a
// stringified number — so a read/modify/write round trip can't 400 on its own
// output. A stored value that unifiedMaxTokensCap() doesn't understand is
// reported as 'off', which is how it actually behaves (effectiveCap null).
function outputLimitState(): { mode: 'off' | 'auto' | number; effectiveCap: number | null; autoValue: number } {
  const raw = (getSetting(UNIFIED_MAX_TOKENS_SETTING) ?? '').trim().toLowerCase();
  const effectiveCap = unifiedMaxTokensCap();
  const mode = raw === 'auto' ? 'auto' as const : (effectiveCap ?? 'off' as const);
  return { mode, effectiveCap, autoValue: UNIFIED_MAX_TOKENS_AUTO };
}

// Get the unified output-token cap ('off' = disabled, 'auto' = 32768, or an
// explicit integer). See lib/sampling-params.ts unifiedMaxTokensCap().
settingsRouter.get('/output-limit', (_req: Request, res: Response) => {
  res.json(outputLimitState());
});

const outputLimitPutSchema = z.object({
  mode: z.union([
    z.literal('off'),
    z.literal('auto'),
    z.number().int().min(1),
  ]),
});

// Update the unified output-token cap. 'off' restores pass-through behaviour;
// 'auto' clamps every request's max_tokens to UNIFIED_MAX_TOKENS_AUTO; an
// integer clamps to that value. Takes effect on the next request.
settingsRouter.put('/output-limit', (req: Request, res: Response) => {
  const parsed = outputLimitPutSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = parsed.error.errors
      .map(e => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message))
      .slice(0, 5)
      .join(', ');
    res.status(400).json({ error: { message: `Invalid output limit: ${detail}`, type: 'invalid_request_error' } });
    return;
  }
  setSetting(UNIFIED_MAX_TOKENS_SETTING, String(parsed.data.mode));
  res.json(outputLimitState());
});
