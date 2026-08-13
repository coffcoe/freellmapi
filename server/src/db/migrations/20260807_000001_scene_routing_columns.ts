import type { Db } from '../../db/types.js';

/**
 * Declare the two columns scene routing depends on: `models.network_tier` and
 * `models.tags`.
 *
 * Schema-drift repair. Both columns already exist on the long-lived local DB —
 * they were added out-of-band, without a migration — so scene routing worked
 * there while a FRESH install would have thrown
 * `SQLITE_ERROR: no such column: network_tier` on the very first auto-routed
 * request. Declaring them here makes the schema reproducible.
 *
 * PRAGMA-guarded so it is a no-op on databases that already have the columns.
 *
 * Semantics:
 *  - network_tier: 'domestic' | 'proxy' | 'global' — matched against the
 *    client's `X-Network-Tier` header (L1 soft preference).
 *  - tags: JSON array of strings, e.g. ["free-tier","long-context"] (L3 soft
 *    preference). Readers must stay tolerant: rows written before this
 *    migration also carry bare CSV and arrays-of-objects. See
 *    `parseModelTags` in services/router.ts.
 */
export function up(db: Db): void {
  const cols = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  const has = (name: string) => cols.some(c => c.name === name);

  if (!has('network_tier')) {
    db.exec('ALTER TABLE models ADD COLUMN network_tier TEXT;');
  }
  if (!has('tags')) {
    db.exec('ALTER TABLE models ADD COLUMN tags TEXT;');
  }
}

export function down(db: Db): void {
  const cols = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  const has = (name: string) => cols.some(c => c.name === name);

  // SQLite >= 3.35 supports DROP COLUMN; both columns are plain and unindexed.
  if (has('tags')) {
    db.prepare('ALTER TABLE models DROP COLUMN tags').run();
  }
  if (has('network_tier')) {
    db.prepare('ALTER TABLE models DROP COLUMN network_tier').run();
  }
}
