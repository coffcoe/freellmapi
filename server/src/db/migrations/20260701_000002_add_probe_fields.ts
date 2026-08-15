import type { Db } from '../../db/types.js';

export function up(db: Db): void {
  // PRAGMA guard: only add columns if they do not already exist.
  // Prevents "duplicate column" errors when this migration is re-run
  // (e.g. registered late after columns were already created on a live DB,
  // or on a fresh clone where the runner applies it for the first time).
  const cols = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];

  if (!cols.some(c => c.name === 'last_verified_at')) {
    db.exec('ALTER TABLE models ADD COLUMN last_verified_at DATETIME;');
  }
  if (!cols.some(c => c.name === 'probe_status')) {
    // No DEFAULT: NULL means "never probed". The endpoint-identity rebuild
    // (20260729) carries the column without a default anyway, so declaring a
    // DEFAULT here would make a fresh install's column differ from one that
    // went through a rebuild, and a down/up round trip would flip existing
    // rows from NULL to the default. Keep it plain and consistent.
    db.exec('ALTER TABLE models ADD COLUMN probe_status BOOLEAN;');
  }

  // Create probe_logs table (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS probe_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      probed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      success BOOLEAN NOT NULL,
      error_message TEXT,
      latency_ms INTEGER,
      FOREIGN KEY (model_id) REFERENCES models(id)
    );
  `);

  // Create indexes for probe_logs (idempotent)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_probe_logs_model_id ON probe_logs(model_id);
    CREATE INDEX IF NOT EXISTS idx_probe_logs_probed_at ON probe_logs(probed_at);
  `);
}

export function down(db: Db): void {
  // Reversible: drop the probe_logs table/indexes (plain, unindexed columns —
  // SQLite >= 3.35 supports DROP COLUMN), so a down/up round trip is clean.
  db.exec('DROP INDEX IF EXISTS idx_probe_logs_probed_at;');
  db.exec('DROP INDEX IF EXISTS idx_probe_logs_model_id;');
  db.exec('DROP TABLE IF EXISTS probe_logs;');

  const cols = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  const has = (name: string) => cols.some(c => c.name === name);
  if (has('probe_status')) {
    db.prepare('ALTER TABLE models DROP COLUMN probe_status').run();
  }
  if (has('last_verified_at')) {
    db.prepare('ALTER TABLE models DROP COLUMN last_verified_at').run();
  }
}
