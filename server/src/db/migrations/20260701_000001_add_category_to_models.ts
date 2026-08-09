import type { Db } from '../../db/types.js';

export function up(db: Db): void {
  // PRAGMA guard: only add column if it does not already exist.
  // Prevents "duplicate column" errors when this migration is re-run
  // (e.g. registered late after columns were already created on a live DB,
  // or on a fresh clone where the runner applies it for the first time).
  const cols = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  if (!cols.some(c => c.name === 'category')) {
    db.exec('ALTER TABLE models ADD COLUMN category TEXT;');
  }
}

export function down(db: Db): void {
  // SQLite >= 3.35 supports DROP COLUMN (bundled engine is 3.53.1); `category`
  // is a plain, unindexed column with no foreign keys, so it can be dropped
  // directly. PRAGMA-guarded so re-running is a safe no-op (idempotent).
  const cols = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  if (cols.some(c => c.name === 'category')) {
    db.exec('ALTER TABLE models DROP COLUMN category;');
  }
}
