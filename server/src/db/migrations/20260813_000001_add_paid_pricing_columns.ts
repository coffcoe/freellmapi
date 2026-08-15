import type { Db } from '../../db/types.js';

/**
 * Paid-pricing columns (2026-08-13).
 *
 * Adds per-token paid pricing fields to `models` so the dashboard model list
 * can derive a `tier` (paid vs free) without scraping the catalog. These
 * columns were originally introduced by the custom fork's modified
 * 20260729_000001_custom_model_endpoint_identity migration; they are pulled
 * out into their own guarded migration here so the schema delta is explicit
 * and does not depend on replaying C7's full migration.
 *
 * Guarded by PRAGMA table_info so it is idempotent and safe to re-run (the
 * C7 migration also adds these columns defensively — no conflict either way).
 */
export function up(db: Db): void {
  const columns = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'paid_input_per_m')) {
    db.prepare('ALTER TABLE models ADD COLUMN paid_input_per_m REAL').run();
  }
  if (!columns.some((c) => c.name === 'paid_output_per_m')) {
    db.prepare('ALTER TABLE models ADD COLUMN paid_output_per_m REAL').run();
  }
}

export function down(db: Db): void {
  const columns = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];
  if (columns.some((c) => c.name === 'paid_output_per_m')) {
    db.prepare('ALTER TABLE models DROP COLUMN paid_output_per_m').run();
  }
  if (columns.some((c) => c.name === 'paid_input_per_m')) {
    db.prepare('ALTER TABLE models DROP COLUMN paid_input_per_m').run();
  }
}
