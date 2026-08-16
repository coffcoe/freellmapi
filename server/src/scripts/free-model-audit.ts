/**
 * Free Model Audit — Batch probe all models and write results to DB.
 * Usage: npx tsx src/scripts/free-model-audit.ts [--scope all|enabled-only|disabled-only|platform:<name>|top-usage:N]
 *
 *   --scope top-usage:N   Probe the N most-called models first (ranked by request
 *                          count in the requests table). Use this to fix the
 *                          "priority inversion" — verify the workhorses you actually
 *                          depend on, not the long-tail. Default N = 25.
 *
 * Output:
 *   - Updates probe_status / last_verified_at in models table
 *   - Inserts records into probe_logs table
 *   - Generates Y:/KnowledgeBase-V2/freellmapi-audit-<YYYY-MM-DD>.md
 */
import { initDb, getDb } from '../db/index.js';
import { decrypt } from '../lib/crypto.js';
import { getProvider, hasProvider } from '../providers/index.js';
import { writeFileSync } from 'fs';

initDb();
const db = getDb();

// ---- Config ----
const SCOPE = process.argv.includes('--scope') 
  ? process.argv[process.argv.indexOf('--scope') + 1] 
  : 'all';
const OUTPUT_REPORT = process.argv.includes('--report');
const DRY_RUN = process.argv.includes('--dry-run');

// ---- Types ----
interface ModelRow {
  id: number;
  platform: string;
  model_id: string;
  display_name: string;
  enabled: number;
  network_tier: string | null;
  probe_status: number | null;
}

interface ProbeResult {
  modelId: number;
  platform: string;
  modelIdStr: string;
  displayName: string;
  enabled: boolean;
  ok: boolean;
  ms: number;
  errorType: string;
  errorMessage: string;
  reply?: string;
}

// ---- Helpers ----
function classifyError(err: any): { type: string; message: string } {
  const msg = String(err?.message ?? err).slice(0, 200);
  const lower = msg.toLowerCase();
  
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return { type: 'auth_failed', message: msg };
  }
  if (lower.includes('403') || lower.includes('forbidden') || lower.includes('payment')) {
    return { type: 'auth_failed', message: msg };
  }
  if (lower.includes('404') || lower.includes('not found') || lower.includes('no such model')) {
    return { type: 'model_not_found', message: msg };
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota exceeded')) {
    return { type: 'rate_limited', message: msg };
  }
  if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('upstream error')) {
    return { type: 'upstream_error', message: msg };
  }
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('socket hang up')) {
    return { type: 'network_timeout', message: msg };
  }
  if (lower.includes('econnreset') || lower.includes('enotfound') || lower.includes('network unreachable')) {
    return { type: 'network_unreachable', message: msg };
  }
  if (lower.includes('keyless') || lower.includes('no key')) {
    return { type: 'no_key', message: msg };
  }
  return { type: 'unknown_error', message: msg };
}

function getApiKey(platform: string): string | null {
  const row = db.prepare(`
    SELECT encrypted_key, iv, auth_tag FROM api_keys
     WHERE platform = ? AND enabled = 1 ORDER BY id LIMIT 1
  `).get(platform) as { encrypted_key: string; iv: string; auth_tag: string } | undefined;
  
  if (!row) {
    console.log(`  [debug] ${platform}: no key row in api_keys`);
    return null;
  }
  try {
    const key = decrypt(row.encrypted_key, row.iv, row.auth_tag);
    console.log(`  [debug] ${platform}: key decrypted successfully, length=${key.length}`);
    return key;
  } catch (err) {
    console.log(`  [debug] ${platform}: decrypt FAILED: ${err}`);
    return null;
  }
}

function getKeylessSentinel(platform: string): string | null {
  // For keyless platforms, use a sentinel value
  // The provider's authHeader() will omit Authorization if keyless=true
  const sentinels: Record<string, string> = {
    'pollinations': 'no-key',
    'kilo': 'no-key',
    'ovh': 'no-key',
  };
  return sentinels[platform] || 'no-key';
}

// ---- Load models ----
let query = `
  SELECT m.id, m.platform, m.model_id, m.display_name, m.enabled, m.network_tier, m.probe_status
    FROM models m
`;
const params: any[] = [];

if (SCOPE === 'enabled-only') {
  query += ' WHERE m.enabled = 1';
} else if (SCOPE === 'disabled-only') {
  query += ' WHERE m.enabled = 0';
} else if (SCOPE.startsWith('platform:')) {
  const platform = SCOPE.split(':')[1];
  query += ' WHERE m.platform = ?';
  params.push(platform);
} else if (SCOPE === 'unverified') {
  query += ' WHERE m.probe_status IS NULL OR m.probe_status = 0';
} else if (SCOPE.startsWith('top-usage')) {
  // Priority-inversion fix: rank by real usage, not by catalog order.
  const topN = parseInt(SCOPE.split(':')[1] || '25', 10) || 25;
  query = `
    SELECT m.id, m.platform, m.model_id, m.display_name, m.enabled, m.network_tier, m.probe_status
    FROM models m
    JOIN (SELECT model_id, COUNT(*) AS cnt FROM requests GROUP BY model_id ORDER BY cnt DESC LIMIT ${topN}) r
      ON r.model_id = m.model_id
    WHERE m.enabled = 1
    ORDER BY r.cnt DESC
  `;
}

if (!SCOPE.startsWith('top-usage')) {
  query += ' ORDER BY m.platform, m.intelligence_rank';
}

const models = db.prepare(query).all(...params) as ModelRow[];
console.log(`\n=== Free Model Audit ===`);
console.log(`Scope: ${SCOPE}`);
console.log(`Models to probe: ${models.length}\n`);

if (models.length === 0) {
  console.log('No models match scope. Exiting.');
  process.exit(0);
}

// ---- Probe loop ----
const results: ProbeResult[] = [];
let verified = 0, unverified = 0, confirmedDead = 0;

for (const model of models) {
  const provider = getProvider(model.platform as any);
  if (!provider) {
    results.push({
      modelId: model.id,
      platform: model.platform,
      modelIdStr: model.model_id,
      displayName: model.display_name,
      enabled: !!model.enabled,
      ok: false,
      ms: 0,
      errorType: 'no_provider',
      errorMessage: `Provider not registered for platform: ${model.platform}`,
    });
    confirmedDead++;
    continue;
  }

  // Get API key
  let apiKey = getApiKey(model.platform);
  if (!apiKey && provider.keyless) {
    apiKey = getKeylessSentinel(model.platform);
  }
  if (!apiKey && model.platform !== 'custom') {
    results.push({
      modelId: model.id,
      platform: model.platform,
      modelIdStr: model.model_id,
      displayName: model.display_name,
      enabled: !!model.enabled,
      ok: false,
      ms: 0,
      errorType: 'no_key',
      errorMessage: `No API key configured for platform: ${model.platform}`,
    });
    unverified++;
    continue;
  }

  // Probe
  const start = Date.now();
  try {
    const res = await provider.chatCompletion(
      apiKey!,
      [{ role: 'user', content: 'hi' }],
      model.model_id,
      { max_tokens: 5, temperature: 0, timeoutMs: 60000 }
    );
    const raw = res.choices?.[0]?.message?.content;
    const reply = typeof raw === 'string' ? raw.slice(0, 40) : '';
    
    results.push({
      modelId: model.id,
      platform: model.platform,
      modelIdStr: model.model_id,
      displayName: model.display_name,
      enabled: !!model.enabled,
      ok: true,
      ms: Date.now() - start,
      reply,
      errorType: '',
      errorMessage: '',
    });
    verified++;
  } catch (err: any) {
    const { type, message } = classifyError(err);
    results.push({
      modelId: model.id,
      platform: model.platform,
      modelIdStr: model.model_id,
      displayName: model.display_name,
      enabled: !!model.enabled,
      ok: false,
      ms: Date.now() - start,
      errorType: type,
      errorMessage: message,
    });
    
    // rate_limited / network_timeout / no_key -> unverified (may recover)
    if (['rate_limited', 'network_timeout', 'network_unreachable', 'no_key', 'upstream_error'].includes(type)) {
      unverified++;
    } else {
      confirmedDead++;
    }
  }
}

// ---- Output results ----
const pad = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);

console.log('\n=== Probe Results ===\n');
for (const r of results) {
  const status = r.ok ? '🟢' : (['rate_limited', 'network_timeout', 'network_unreachable', 'no_key', 'upstream_error'].includes(r.errorType) ? '🟡' : '🔴');
  console.log(`${status} ${pad(r.platform, 12)} ${pad(r.modelIdStr, 50)} ${String(r.ms).padStart(5)}ms  ${r.ok ? `"${r.reply}"` : r.errorType}`);
}

console.log(`\n=== Summary ===`);
console.log(`🟢 Verified:       ${verified}`);
console.log(`🟡 Unverified:     ${unverified}`);
console.log(`🔴 Confirmed dead: ${confirmedDead}`);
console.log(`Total:             ${results.length}`);

// ---- Write to DB ----
if (!DRY_RUN) {
  console.log('\nWriting results to database...');
  const updateStmt = db.prepare(`
    UPDATE models 
       SET probe_status = ?, 
           last_verified_at = datetime('now')
     WHERE id = ?
  `);
  
  const logStmt = db.prepare(`
    INSERT INTO probe_logs (model_id, success, latency_ms, error_message, probed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  for (const r of results) {
    const probeStatus = r.ok ? 1 : 0;
    updateStmt.run(probeStatus, r.modelId);
    logStmt.run(r.modelId, r.ok ? 1 : 0, r.ms, r.errorMessage);
  }
  
  console.log(`Updated ${results.length} models in database.`);
}

// ---- Generate report ----
if (OUTPUT_REPORT && !DRY_RUN) {
  console.log('\nGenerating audit report...');
  
  const verifiedModels = results.filter(r => r.ok);
  const unverifiedModels = results.filter(r => !r.ok && ['rate_limited', 'network_timeout', 'network_unreachable', 'no_key', 'upstream_error'].includes(r.errorType));
  const deadModels = results.filter(r => !r.ok && !['rate_limited', 'network_timeout', 'network_unreachable', 'no_key', 'upstream_error'].includes(r.errorType));
  
  // Platform stats
  const platformStats: Record<string, { total: number; verified: number; unverified: number; dead: number }> = {};
  for (const r of results) {
    if (!platformStats[r.platform]) {
      platformStats[r.platform] = { total: 0, verified: 0, unverified: 0, dead: 0 };
    }
    platformStats[r.platform].total++;
    if (r.ok) platformStats[r.platform].verified++;
    else if (['rate_limited', 'network_timeout', 'network_unreachable', 'no_key', 'upstream_error'].includes(r.errorType)) {
      platformStats[r.platform].unverified++;
    } else {
      platformStats[r.platform].dead++;
    }
  }

  const date = new Date().toISOString().split('T')[0];
  const reportPath = `Y:/KnowledgeBase-V2/freellmapi-audit-${date}.md`;
  
  let md = `# FreeLLMAPI 模型探活审计报告\n\n`;
  md += `**审计时间**：${new Date().toISOString()}\n`;
  md += `**审计范围**：${SCOPE}\n`;
  md += `**总模型数**：${results.length}\n\n`;
  md += `## 摘要\n\n`;
  md += `| 状态 | 数量 |\n`;
  md += `|------|------|\n`;
  md += `| 🟢 Verified | ${verifiedModels.length} |\n`;
  md += `| 🟡 Unverified | ${unverifiedModels.length} |\n`;
  md += `| 🔴 Confirmed Dead | ${deadModels.length} |\n\n`;
  
  if (verifiedModels.length > 0) {
    md += `## 🟢 Verified Models\n\n`;
    md += `| 平台 | 模型 | 延迟 | 回复 |\n`;
    md += `|------|------|------|------|\n`;
    for (const r of verifiedModels) {
      md += `| ${r.platform} | ${r.modelIdStr} | ${r.ms}ms | ${r.reply || ''} |\n`;
    }
    md += '\n';
  }
  
  if (unverifiedModels.length > 0) {
    md += `## 🟡 Unverified Models\n\n`;
    md += `| 平台 | 模型 | 错误类型 | 说明 |\n`;
    md += `|------|------|----------|------|\n`;
    for (const r of unverifiedModels) {
      md += `| ${r.platform} | ${r.modelIdStr} | ${r.errorType} | ${r.errorMessage.slice(0, 50)} |\n`;
    }
    md += '\n';
  }
  
  if (deadModels.length > 0) {
    md += `## 🔴 Confirmed Dead Models\n\n`;
    md += `| 平台 | 模型 | 错误类型 | 说明 |\n`;
    md += `|------|------|----------|------|\n`;
    for (const r of deadModels) {
      md += `| ${r.platform} | ${r.modelIdStr} | ${r.errorType} | ${r.errorMessage.slice(0, 50)} |\n`;
    }
    md += '\n';
  }
  
  md += `## Platform Stats\n\n`;
  md += `| 平台 | 总数 | Verified | Unverified | Dead |\n`;
  md += `|------|------|----------|------------|------|\n`;
  for (const [platform, stats] of Object.entries(platformStats).sort((a, b) => b[1].total - a[1].total)) {
    md += `| ${platform} | ${stats.total} | ${stats.verified} | ${stats.unverified} | ${stats.dead} |\n`;
  }
  md += '\n';
  
  md += `## Recommendations\n\n`;
  md += `1. **Verified models**: Consider enabling them in routing\n`;
  md += `2. **Unverified models**: Re-test in different network conditions\n`;
  md += `3. **Dead models**: Remove from routing (keep in DB for history)\n`;
  md += `4. **No-key models**: Configure API keys for platforms that require them\n`;
  
  try {
    writeFileSync(reportPath, md, 'utf-8');
    console.log(`Report written to: ${reportPath}`);
  } catch (err) {
    console.error(`Failed to write report: ${err}`);
  }
}

process.exit(0);
