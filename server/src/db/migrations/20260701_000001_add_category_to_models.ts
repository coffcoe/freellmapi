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
  // SQLite doesn't support DROP COLUMN directly, we need to recreate table
  // However, for simplicity in this context, we'll just note that downgrade is not supported
  // In a real scenario, you would create a new table without the column and copy data
  throw new Error('Downgrade not implemented for this migration');
};
