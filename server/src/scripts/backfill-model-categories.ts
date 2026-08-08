/**
 * backfill-model-categories — TD-027 one-time data backfill (dry-run by default).
 *
 * Fills `models.category` for rows that carry NULL by reusing the exact same
 * inference the catalog-sync write path uses (`inferModelCategory`), so the
 * script and the live sync can never disagree. Only `source='catalog'` rows
 * are considered — user-owned models are never touched. Rows that cannot be
 * inferred are left NULL and counted (never guessed).
 *
 * Usage:
 *   npx tsx src/scripts/backfill-model-categories.ts            # dry-run only
 *   npx tsx src/scripts/backfill-model-categories.ts --apply    # write changes
 *
 * Idempotent: re-running with --apply after a successful run changes nothing
 * (rows with a category are skipped; NULL rows re-infer to the same value).
 */
import { initDb, getDb } from '../db/index.js';
import { inferModelCategory } from '../services/model-category.js';

const APPLY = process.argv.includes('--apply');

initDb();
const db = getDb();

interface CategoryRow {
  id: number;
  platform: string;
  model_id: string;
  display_name: string;
  supports_vision: number;
  supports_tools: number;
  category: string | null;
}

const rows = db
  .prepare(`
    SELECT id, platform, model_id, display_name, supports_vision, supports_tools, category
      FROM models
     WHERE category IS NULL
       AND source = 'catalog'
     ORDER BY platform, model_id
  `)
  .all() as CategoryRow[];

const byCategory = new Map<string, number>();
const stillNull: CategoryRow[] = [];
const changes: Array<{ platform: string; model_id: string; category: string }> = [];

for (const r of rows) {
  const inferred = inferModelCategory({
    modelId: r.model_id,
    displayName: r.display_name,
    supportsVision: r.supports_vision === 1,
    supportsTools: r.supports_tools === 1,
  });
  if (inferred) {
    byCategory.set(inferred, (byCategory.get(inferred) ?? 0) + 1);
    changes.push({ platform: r.platform, model_id: r.model_id, category: inferred });
  } else {
    stillNull.push(r);
  }
}

console.log(`[td-027] mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} (pass --apply to write)`);
console.log(`[td-027] NULL category rows considered: ${rows.length}`);
console.log(`[td-027] would fill: ${changes.length}`);
console.log(`[td-027] remains NULL (no strong signal): ${stillNull.length}`);

const breakdown = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
console.log(`[td-027] by category:`);
for (const [cat, n] of breakdown) console.log(`  ${cat}: ${n}`);

if (changes.length > 0) {
  console.log(`[td-027] rows:`);
  for (const c of changes) console.log(`  ${c.platform} | ${c.model_id} -> ${c.category}`);
}

if (stillNull.length > 0) {
  console.log(`[td-027] still NULL (left untouched):`);
  for (const r of stillNull) console.log(`  ${r.platform} | ${r.model_id}`);
}

if (!APPLY) {
  console.log(`[td-027] DRY-RUN complete — no rows written. Re-run with --apply to commit.`);
  process.exit(0);
}

const setCategory = db.prepare('UPDATE models SET category = ? WHERE id = ?');
const applyChanges = db.transaction(() => {
  for (const c of changes) {
    const row = db
      .prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?')
      .get(c.platform, c.model_id) as { id: number } | undefined;
    if (!row) continue;
    setCategory.run(c.category, row.id);
  }
});
applyChanges();

// Verify: re-scan what is left NULL after the write.
const after = db
  .prepare(`SELECT COUNT(*) AS n FROM models WHERE category IS NULL AND source = 'catalog'`)
  .get() as { n: number };
console.log(`[td-027] APPLY complete — catalog-owned rows still NULL: ${after.n}`);
console.log(`[td-027] done.`);
