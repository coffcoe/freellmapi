import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
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

export function down(db: Database.Database): void {
  // SQLite doesn't support DROP COLUMN directly, we need to recreate table
  // For simplicity, we'll just drop the table and columns if needed in a real scenario
  // But for this migration, we'll note that downgrade is complex and not implemented
  throw new Error('Downgrade not implemented for this migration');
}
