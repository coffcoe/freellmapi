/**
 * Provider Verification Import Script
 * 
 * Imports provider verification metadata from free-llm-api-hub dataset.
 * Updates card_required, phone_required, commercial_ok, docs_url, provider_slug fields.
 * 
 * Usage:
 *   npx tsx src/scripts/import-provider-meta.ts [path-to-providers.json]
 * 
 * If no path provided, fetches from free-llm-api-hub GitHub.
 */
import { initDb, getDb } from '../db/index.js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { existsSync } from 'fs';

initDb();
const db = getDb();

// ---- Config ----
const DATA_PATH = process.argv[2] || 'data/providers.json';
const OUTPUT_PATH = process.argv[3] || 'logs/provider-meta-import.log';

// ---- Types ----
interface ProviderMeta {
  slug: string;
  platform: string;
  name: string;
  card_required: boolean;
  phone_required: boolean;
  commercial_ok: boolean | null;
  docs_url: string;
  verified: boolean;
  last_verified: string | null;
  notes: string | null;
}

interface ImportResult {
  matched: number;
  updated: number;
  skipped: number;
  errors: Array<{ slug: string; error: string }>;
}

// ---- Platform Mapping (free-llm-api-hub slug -> FreeLLMAPI platform) ----
const PLATFORM_MAP: Record<string, string> = {
  // Ongoing free tier providers
  'google-gemini': 'google',
  'groq': 'groq',
  'openrouter': 'openrouter',
  'cloudflare-workers-ai': 'cloudflare',
  'mistral': 'mistral',
  'cohere': 'cohere',
  'nvidia': 'nvidia',
  'cerebras': 'cerebras',
  'sambanova': 'sambanova',
  'github': 'github',
  'huggingface': 'huggingface',
  'ollama': 'ollama',
  'pollinations': 'pollinations',
  'zhipu': 'zhipu',
  'siliconflow': 'siliconflow',
  'kilo': 'kilo',
  'llm7': 'llm7',
  'opencode': 'opencode',
  'ovh': 'ovh',
  'routeway': 'routeway',
  'bazaarlink': 'bazaarlink',
  'ainative': 'ainative',
  'aion': 'aion',
  'requesty': 'requesty',
  'navy': 'navy',
  'nara': 'nara',
  // Chinese providers
  'zai-glm': 'zhipu',  // Z.ai GLM models
  'deepseek': 'deepseek',
  'moonshot': 'moonshot',
  'qwen': 'qwen',
  // Speech/other
  'deepgram': 'deepgram',
  'assemblyai': 'assemblyai',
  'elevenlabs': 'elevenlabs',
};

// ---- Helpers ----
function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
}

function findModelsByPlatform(db: any, platform: string): any[] {
  return db.prepare(`
    SELECT id, model_id, display_name FROM models 
    WHERE platform = ? AND source = 'catalog'
  `).all(platform) as any[];
}

function updateModelMeta(
  db: any,
  modelId: number,
  meta: Partial<{
    card_required: number;
    phone_required: number;
    commercial_ok: number | null;
    docs_url: string | null;
    provider_slug: string | null;
    last_verified_at: string | null;
  }>
): boolean {
  const updates: string[] = [];
  const values: any[] = [];

  if (meta.card_required !== undefined) {
    updates.push('card_required = ?');
    values.push(meta.card_required);
  }
  if (meta.phone_required !== undefined) {
    updates.push('phone_required = ?');
    values.push(meta.phone_required);
  }
  if (meta.commercial_ok !== undefined) {
    updates.push('commercial_ok = ?');
    values.push(meta.commercial_ok);
  }
  if (meta.docs_url !== undefined) {
    updates.push('docs_url = ?');
    values.push(meta.docs_url);
  }
  if (meta.provider_slug !== undefined) {
    updates.push('provider_slug = ?');
    values.push(meta.provider_slug);
  }
  if (meta.last_verified_at !== undefined) {
    updates.push('last_verified_at = ?');
    values.push(meta.last_verified_at);
  }

  if (updates.length === 0) return false;

  values.push(modelId);
  const sql = `UPDATE models SET ${updates.join(', ')} WHERE id = ?`;
  const result = db.prepare(sql).run(...values);
  return result.changes > 0;
}

// ---- Main ----
function main(): ImportResult {
  const result: ImportResult = {
    matched: 0,
    updated: 0,
    skipped: 0,
    errors: []
  };

  // Load providers data
  let providersData: { providers: ProviderMeta[] };
  
  if (DATA_PATH.startsWith('http')) {
    log(`Fetching from ${DATA_PATH}...`);
    try {
      const https = require('https');
      const data = require('fs').readFileSync(DATA_PATH, 'utf8');
      providersData = JSON.parse(data);
    } catch (e: any) {
      log(`Error fetching data: ${e.message}`);
      throw e;
    }
  } else {
    const filePath = resolve(DATA_PATH);
    if (!existsSync(filePath)) {
      log(`File not found: ${filePath}`);
      throw new Error(`File not found: ${filePath}`);
    }
    const content = readFileSync(filePath, 'utf8');
    providersData = JSON.parse(content);
  }

  log(`Loaded ${providersData.providers.length} providers from dataset`);

  // Process each provider
  for (const provider of providersData.providers) {
    const platform = PLATFORM_MAP[provider.slug];
    
    if (!platform) {
      log(`⚠️  No platform mapping for slug: ${provider.slug}`);
      result.skipped++;
      continue;
    }

    // Check if platform exists in our database
    const models = findModelsByPlatform(db, platform);
    
    if (models.length === 0) {
      log(`⚠️  No models found for platform: ${platform}`);
      result.skipped++;
      continue;
    }

    result.matched += models.length;

    // Update each model
    for (const model of models) {
      try {
        const updated = updateModelMeta(db, model.id, {
          card_required: provider.card_required ? 1 : 0,
          phone_required: provider.phone_required ? 1 : 0,
          commercial_ok: provider.commercial_ok === true ? 1 : provider.commercial_ok === false ? 0 : null,
          docs_url: provider.docs_url || null,
          provider_slug: provider.slug,
          last_verified_at: provider.last_verified || null,
        });

        if (updated) {
          result.updated++;
          log(`✅ Updated ${model.display_name} (${model.model_id})`);
        } else {
          log(`⏭️  No changes for ${model.display_name}`);
          result.skipped++;
        }
      } catch (e: any) {
        log(`❌ Error updating ${model.display_name}: ${e.message}`);
        result.errors.push({ slug: provider.slug, error: e.message });
      }
    }
  }

  // Generate summary report
  const report = {
    timestamp: new Date().toISOString(),
    source: DATA_PATH,
    total_providers: providersData.providers.length,
    matched_platforms: result.matched,
    updated_models: result.updated,
    skipped: result.skipped,
    errors: result.errors.length,
    summary: `Matched ${result.matched} models, updated ${result.updated}, skipped ${result.skipped}, errors ${result.errors.length}`
  };

  // Write log
  const logContent = JSON.stringify(report, null, 2);
  writeFileSync(OUTPUT_PATH, logContent);
  log(`Report written to ${OUTPUT_PATH}`);

  return result;
}

// ---- Run ----
try {
  const result = main();
  console.log('\n=== Import Summary ===');
  console.log(`Matched platforms: ${result.matched}`);
  console.log(`Updated models: ${result.updated}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Errors: ${result.errors.length}`);
  
  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach(e => console.log(`  - ${e.slug}: ${e.error}`));
  }
  
  process.exit(0);
} catch (e: any) {
  console.error('\n❌ Import failed:', e.message);
  process.exit(1);
}
