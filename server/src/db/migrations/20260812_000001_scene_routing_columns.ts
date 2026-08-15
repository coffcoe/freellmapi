/**
 * Scene-routing columns: `models.category`, `models.network_tier`, `models.tags`.
 *
 * Re-derived onto the v0.7.0 baseline. The upstream `models` table carries only
 * capability flags (`supports_vision` / `supports_tools`) and rank/label
 * metadata — no place for the scene router's soft-preference labels. This
 * migration declares the three columns scene routing depends on, matching the
 * schema the fork's long-lived DB already carried (added out-of-band, without a
 * migration, so a FRESH install would otherwise throw
 * `SQLITE_ERROR: no such column` on the very first auto-routed request).
 *
 * PRAGMA-guarded so it is a no-op on databases that already have the columns,
 * and reversible (plain, unindexed columns — SQLite >= 3.35 DROP COLUMN).
 *
 * Semantics (mirrored from the fork's scene router):
 *  - category:      'vision' | 'coding' | 'audio' | 'reasoning' |
 *                   'function-calling' | NULL — L2 soft preference. Backfilled
 *                   here from the capability + name hints the DB already
 *                   carries (see services/model-category.ts).
 *  - network_tier:  'domestic' | 'proxy' | 'global' | NULL — matched against
 *                   the client's `X-Network-Tier` header (L1 soft preference).
 *                   NULL by default; set per row by operators / the admin UI.
 *  - tags:          JSON array of strings, e.g. ["free-tier","long-context"]
 *                   — L3 soft preference. Readers must stay tolerant of bare
 *                   CSV and arrays-of-objects shapes written by older rows.
 */

import type { Db } from '../types.js';
import { inferModelCategory } from '../../services/model-category.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'models', 'category')) {
    db.prepare('ALTER TABLE models ADD COLUMN category TEXT').run();
  }
  if (!hasColumn(db, 'models', 'network_tier')) {
    db.prepare('ALTER TABLE models ADD COLUMN network_tier TEXT').run();
  }
  if (!hasColumn(db, 'models', 'tags')) {
    db.prepare('ALTER TABLE models ADD COLUMN tags TEXT').run();
  }

  // Backfill categories for catalog-owned rows that still carry NULL using the
  // capability + name hints the DB already has. User-owned rows are never
  // touched (same conservative rule as the backfill script); rows that cannot
  // be inferred stay NULL (inferModelCategory returns null -> leave NULL).
  const rows = db.prepare(
    "SELECT id, platform, model_id, display_name, supports_vision, supports_tools FROM models WHERE category IS NULL AND source = 'catalog'",
  ).all() as {
    id: number;
    platform: string;
    model_id: string;
    display_name: string;
    supports_vision: number;
    supports_tools: number;
  }[];
  const setCategory = db.prepare('UPDATE models SET category = ? WHERE id = ?');
  for (const row of rows) {
    const category = inferModelCategory({
      modelId: row.model_id,
      displayName: row.display_name,
      supportsVision: row.supports_vision === 1,
      supportsTools: row.supports_tools === 1,
    });
    if (category !== null) setCategory.run(category, row.id);
  }
}

export function down(db: Db): void {
  // SQLite >= 3.35 supports DROP COLUMN; the columns this migration carries are
  // plain and unindexed, so dropping is safe. `category` is deliberately NOT
  // dropped here: it was originally introduced by
  // 20260701_000001_add_category_to_models (whose own down() owns it). If this
  // down() removed it too, the round trip would leave that migration's down()
  // a no-op (column already gone) and fail the round-trip gate.
  for (const col of ['tags', 'network_tier']) {
    if (hasColumn(db, 'models', col)) {
      db.prepare(`ALTER TABLE models DROP COLUMN ${col}`).run();
    }
  }
}
