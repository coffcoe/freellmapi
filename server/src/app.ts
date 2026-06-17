import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { keysRouter } from './routes/keys.js';
import { modelsRouter } from './routes/models.js';
import { proxyRouter } from './routes/proxy.js';
import { responsesRouter } from './routes/responses.js';
import { fallbackRouter } from './routes/fallback.js';
import { embeddingsRouter } from './routes/embeddings.js';
import { analyticsRouter } from './routes/analytics.js';
import { healthRouter } from './routes/health.js';
import { settingsRouter } from './routes/settings.js';
import { authRouter } from './routes/auth.js';
import { requireAuth } from './middleware/requireAuth.js';
import { createProxyRateLimiter } from './middleware/rateLimit.js';
import { proxyAuth } from './middleware/proxyAuth.js';
import { requestSanitizer } from './middleware/requestSanitizer.js';
import { requestValidator } from './middleware/requestValidator.js';
import { messageNormalizer } from './middleware/messageNormalizer.js';
import { tokenEstimator } from './middleware/tokenEstimator.js';
import { capabilityGate } from './middleware/capabilityGate.js';
import { errorHandler } from './middleware/errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_DASHBOARD_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
];

function getAllowedCorsOrigins() {
  const configuredOrigins = (process.env.DASHBOARD_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_DASHBOARD_ORIGINS, ...configuredOrigins]);
}

/**
 * Feature flags: each new middleware has its own flag so we can
 * disable individual pieces without touching the handler.
 * Set DISABLE_ALL_MIDDLEWARE=true to skip ALL new middleware.
 */
const DISABLE_ALL = process.env.DISABLE_ALL_MIDDLEWARE === 'true';
const ENABLE_PROXY_AUTH = !DISABLE_ALL && process.env.ENABLE_PROXY_AUTH !== 'false';
const ENABLE_SANITIZER = !DISABLE_ALL && process.env.ENABLE_SANITIZER !== 'false';
const ENABLE_VALIDATOR = !DISABLE_ALL && process.env.ENABLE_VALIDATOR !== 'false';
const ENABLE_NORMALIZER = !DISABLE_ALL && process.env.ENABLE_NORMALIZER !== 'false';
const ENABLE_TOKEN_ESTIMATOR = !DISABLE_ALL && process.env.ENABLE_TOKEN_ESTIMATOR !== 'false';
const ENABLE_CAPABILITY_GATE = !DISABLE_ALL && process.env.ENABLE_CAPABILITY_GATE !== 'false';

// Build the /v1 middleware chain respecting feature flags.
// Order matters: auth → sanitize → validate → normalize → estimate → gate
function buildProxyMiddlewareChain(): Array<express.RequestHandler> {
  const mws: Array<express.RequestHandler> = [createProxyRateLimiter()];

  if (ENABLE_PROXY_AUTH) mws.push(proxyAuth());
  if (ENABLE_SANITIZER) mws.push(requestSanitizer());
  if (ENABLE_VALIDATOR) mws.push(requestValidator());
  if (ENABLE_NORMALIZER) mws.push(messageNormalizer());
  if (ENABLE_TOKEN_ESTIMATOR) mws.push(tokenEstimator());
  if (ENABLE_CAPABILITY_GATE) mws.push(capabilityGate());

  return mws;
}

export function createApp() {
  const app = express();
  const allowedCorsOrigins = getAllowedCorsOrigins();

  // CSP intentionally disabled — the SPA bundles inline styles and the OG
  // image is loaded from the same origin; enabling helmet's default CSP
  // breaks the React build's hashed-asset loader. HSTS off because this is
  // a single-user local proxy, served over HTTP on localhost. Both should
  // stay disabled unless someone serves the proxy over HTTPS publicly
  // (which is also not a supported deployment — see README).
  app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
  app.use(cors({
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      callback(null, !origin || allowedCorsOrigins.has(origin));
    },
  }));
  // 10mb: code agents (OpenCode, AionUI, Qwen Code) ship very large system
  // prompts + tool schemas + repo context; 1mb cut their sessions off
  // mid-conversation with an opaque 413. (#200)
  app.use(express.json({ limit: '10mb' }));

  // Dashboard auth (#35): /api/auth/{status,setup,login} bootstrap without a
  // session; everything else under /api/* requires a logged-in dashboard user.
  // The /v1 proxy keeps its own unified-API-key auth and is NOT gated here.
  app.use('/api/auth', authRouter);

  // API routes — all admin endpoints sit behind requireAuth.
  app.use('/api/keys', requireAuth, keysRouter);
  app.use('/api/models', requireAuth, modelsRouter);
  app.use('/api/fallback', requireAuth, fallbackRouter);
  app.use('/api/embeddings', requireAuth, embeddingsRouter);
  app.use('/api/analytics', requireAuth, analyticsRouter);
  app.use('/api/health', requireAuth, healthRouter);
  app.use('/api/settings', requireAuth, settingsRouter);

  // OpenAI-compatible proxy. The new middleware chain is built with feature
  // flags so each piece can be toggled independently.
  app.use('/v1', ...buildProxyMiddlewareChain());
  app.use('/v1', proxyRouter);
  // OpenAI Responses API shim (Codex CLI requires wire_api="responses"; see #96)
  app.use('/v1', responsesRouter);

  // Health check
  app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Error handler (for API routes)
  app.use(errorHandler);

  // Serve client static files (after API error handler). CLIENT_DIST lets
  // embedders relocate the built dashboard (e.g. the desktop app ships it in
  // extraResources, where the __dirname-relative path can't reach).
  const clientDist = process.env.CLIENT_DIST
    ? path.resolve(process.env.CLIENT_DIST)
    : path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback — serve index.html for non-API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}
