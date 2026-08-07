import type { Db } from '../../db/types.js';

/**
 * Quota-guard schema columns (2026-08-02).
 *
 * 1. `models.is_high_value` — flags Frontier/Large-tier free models whose
 *    upstream daily quota is scarce. The auto-router's context-grading step
 *    (router.ts) avoids routing very large inputs (>20k tokens) onto these,
 *    conserving their limited quota for smaller, high-value requests.
 * 2. `requests.client_tag` — records the calling client/app (from the
 *    x-client-tag request header) so auto-traffic can be attributed to its
 *    source for quota investigation. NULL when the client does not identify.
 *
 * Both are added defensively (guarded by PRAGMA table_info) so the migration
 * is idempotent and safe to re-run.
 */
export function up(db: Db): void {
  const modelColumns = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  if (!modelColumns.some(col => col.name === 'is_high_value')) {
    db.prepare('ALTER TABLE models ADD COLUMN is_high_value INTEGER NOT NULL DEFAULT 0').run();
  }

  const requestColumns = db.prepare('PRAGMA table_info(requests)').all() as { name: string }[];
  if (!requestColumns.some(col => col.name === 'client_tag')) {
    db.prepare('ALTER TABLE requests ADD COLUMN client_tag TEXT').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_requests_client_tag ON requests(client_tag)').run();
  }
}

export function down(db: Db): void {
  // SQLite supports DROP COLUMN from 3.35.0; the bundled engine is newer.
  const modelColumns = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  if (modelColumns.some(col => col.name === 'is_high_value')) {
    db.prepare('ALTER TABLE models DROP COLUMN is_high_value').run();
  }

  const requestColumns = db.prepare('PRAGMA table_info(requests)').all() as { name: string }[];
  if (requestColumns.some(col => col.name === 'client_tag')) {
    db.prepare('DROP INDEX IF EXISTS idx_requests_client_tag').run();
    db.prepare('ALTER TABLE requests DROP COLUMN client_tag').run();
  }
}
