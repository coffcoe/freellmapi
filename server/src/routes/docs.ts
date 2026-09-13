import { Router, type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { openapiSpec } from '../docs/openapi.js';
import { DOCS_HTML } from '../docs/docs-page.js';

// Static, unauthenticated API reference for the public `/v1` surface:
//   GET /v1/openapi.json  — the OpenAPI 3.0 spec (served as JSON)
//   GET /v1/docs          — a self-contained viewer that renders that spec
//
// Both are static and expose no secrets, so they are intentionally not gated by
// the unified API key. Mounted before the proxy rate limiter in app.ts so the
// docs stay available and never consume a caller's request budget.
export const docsRouter = Router();

docsRouter.get('/openapi.json', (_req: Request, res: Response) => {
  // Long-cacheable: the spec only changes when the server binary does.
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(openapiSpec);
});

docsRouter.get('/openapi-zh.json', (_req: Request, res: Response) => {
  // Chinese locale spec: serve the static JSON so the zh viewer works.
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.resolve(__dirname, '../docs/openapi-zh.json'));
});

docsRouter.get('/docs', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('html').send(DOCS_HTML);
});
