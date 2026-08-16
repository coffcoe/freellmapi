import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';

export const configRouter = Router();

const CLIENT_TEMPLATES: Record<string, { baseUrl: string; instructions: string; extra?: Record<string, string> }> = {
  openai: {
    baseUrl: 'http://localhost:3001/v1',
    instructions: 'Use this as your OpenAI base_url and api_key.',
    extra: { model: 'auto (router picks best available model)' },
  },
  claude: {
    baseUrl: 'http://localhost:3001/v1/messages',
    instructions: 'Set ANTHROPIC_BASE_URL to this value and ANTHROPIC_API_KEY to the key below.',
    extra: { api_version: '2023-06-01' },
  },
  cursor: {
    baseUrl: 'http://localhost:3001/v1',
    instructions: 'In Cursor Settings > Models > OpenAI API Key, paste the api_key. Set base_url to this value.',
    extra: { model: 'auto' },
  },
  continue: {
    baseUrl: 'http://localhost:3001/v1',
    instructions: 'In Continue config.json, set apiBase to this URL and apiKey to the key below.',
    extra: { provider: 'openai', model: 'auto' },
  },
  codex: {
    baseUrl: 'http://localhost:3001/v1',
    instructions: 'Set OPENAI_API_BASE to this URL and OPENAI_API_KEY to the key below.',
    extra: { model: 'auto' },
  },
  gemini_cli: {
    baseUrl: 'http://localhost:3001/v1',
    instructions: 'Use the OpenAI-compatible mode: set OPENAI_BASE_URL and OPENAI_API_KEY.',
    extra: { model: 'auto' },
  },
};

configRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const unifiedKey = db.prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get() as { value: string } | undefined;
  const apiKey = unifiedKey?.value ?? '<your freeapi unified key>';

  const client = String(_req.query.client ?? 'openai').toLowerCase();
  const template = CLIENT_TEMPLATES[client];
  if (!template) {
    res.status(400).json({
      error: {
        message: `Unknown client '${client}'. Supported: ${Object.keys(CLIENT_TEMPLATES).join(', ')}`,
      },
    });
    return;
  }

  // Collect available models grouped by category for recommendations
  const sceneModels: Record<string, string[]> = {};
  const modelRows = db.prepare(
    "SELECT model_id, category FROM models WHERE enabled = 1 AND category IS NOT NULL ORDER BY category"
  ).all() as { model_id: string; category: string }[];
  for (const row of modelRows) {
    (sceneModels[row.category] ??= []).push(row.model_id);
  }

  res.json({
    client,
    base_url: template.baseUrl,
    api_key: apiKey,
    instructions: template.instructions,
    extra: template.extra ?? {},
    // Suggested models by category for this client
    recommended_models: sceneModels,
  });
});

// Also export a simple text version for CLI-friendly output
configRouter.get('/cli', (_req: Request, res: Response) => {
  const db = getDb();
  const unifiedKey = db.prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get() as { value: string } | undefined;
  const apiKey = unifiedKey?.value ?? '<your freeapi unified key>';
  const client = String(_req.query.client ?? 'openai').toLowerCase();
  const template = CLIENT_TEMPLATES[client];
  if (!template) {
    res.status(400).send(`Unknown client: ${client}\n`);
    return;
  }

  const lines = [
    `# FreeLLMAPI Configuration for ${client}`,
    `export OPENAI_BASE_URL="${template.baseUrl}"`,
    `export OPENAI_API_KEY="${apiKey}"`,
  ];
  if (template.extra?.model) lines.push(`# Default model: ${template.extra.model}`);
  if (template.extra?.api_version) lines.push(`# Anthropic API version: ${template.extra.api_version}`);
  lines.push(template.instructions);

  res.type('text/plain').send(lines.join('\n') + '\n');
});