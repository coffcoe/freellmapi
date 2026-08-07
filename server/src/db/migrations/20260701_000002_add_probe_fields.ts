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
    db.exec('ALTER TABLE models ADD COLUMN probe_status BOOLEAN DEFAULT 0;');
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
  // SQLite >= 3.35 supports DROP COLUMN (bundled engine is 3.53.1). Both
  // `last_verified_at` and `probe_status` are plain, unindexed columns, so
  // they can be dropped directly. The probe_logs table is dropped first
  // (including its two indexes) because the columns reference nothing but the
  // table itself. All steps are PRAGMA / IF EXISTS guarded so re-running the
  // down is a safe no-op (idempotent).
  db.exec('DROP TABLE IF EXISTS probe_logs;');

  const cols = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  if (cols.some(c => c.name === 'last_verified_at')) {
    db.exec('ALTER TABLE models DROP COLUMN last_verified_at;');
  }
  if (cols.some(c => c.name === 'probe_status')) {
    db.exec('ALTER TABLE models DROP COLUMN probe_status;');
  }
}
