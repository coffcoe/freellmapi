import type { Db } from '../types.js';

/**
 * Provider verification metadata (2026-08-24).
 *
 * Inspired by free-llm-api-hub schema validation pattern.
 * Adds verification fields to track provider authenticity and constraints:
 * - card_required: whether credit card is needed for signup
 * - phone_required: whether phone verification is needed
 * - commercial_ok: whether free tier allows commercial use
 * - docs_url: link to provider's official pricing/docs page
 * - provider_slug: stable identifier for cross-reference with external datasets
 *
 * These fields enable:
 * 1. Filtering by constraint (no-card, no-phone, commercial-use)
 * 2. Freshness tracking (last_verified_at already exists)
 * 3. Anti-hallucination (⚠️ tag for unverified entries)
 */
export function up(db: Db): void {
  // Add verification columns to models table
  const modelColumns = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];

  if (!modelColumns.some(col => col.name === 'card_required')) {
    db.prepare(
      'ALTER TABLE models ADD COLUMN card_required INTEGER NOT NULL DEFAULT 0'
    ).run();
  }

  if (!modelColumns.some(col => col.name === 'phone_required')) {
    db.prepare(
      'ALTER TABLE models ADD COLUMN phone_required INTEGER NOT NULL DEFAULT 0'
    ).run();
  }

  if (!modelColumns.some(col => col.name === 'commercial_ok')) {
    db.prepare(
      'ALTER TABLE models ADD COLUMN commercial_ok INTEGER'
    ).run();
  }

  if (!modelColumns.some(col => col.name === 'docs_url')) {
    db.prepare(
      'ALTER TABLE models ADD COLUMN docs_url TEXT'
    ).run();
  }

  if (!modelColumns.some(col => col.name === 'provider_slug')) {
    db.prepare(
      'ALTER TABLE models ADD COLUMN provider_slug TEXT'
    ).run();
  }

  // Create index for common filter queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_models_no_card_no_phone
    ON models(card_required, phone_required)
    WHERE card_required = 0 AND phone_required = 0;
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_models_commercial
    ON models(commercial_ok)
    WHERE commercial_ok = 1;
  `);
}

export function down(db: Db): void {
  // SQLite supports DROP COLUMN from 3.35.0; the bundled engine is newer.
  const modelColumns = db.prepare('PRAGMA table_info(models)').all() as { name: string }[];

  // Drop the partial indexes first: they reference these columns, and SQLite
  // rejects DROP COLUMN while a dependent index still exists.
  db.exec('DROP INDEX IF EXISTS idx_models_no_card_no_phone;');
  db.exec('DROP INDEX IF EXISTS idx_models_commercial;');

  if (modelColumns.some(col => col.name === 'card_required')) {
    db.prepare('ALTER TABLE models DROP COLUMN card_required').run();
  }
  if (modelColumns.some(col => col.name === 'phone_required')) {
    db.prepare('ALTER TABLE models DROP COLUMN phone_required').run();
  }
  if (modelColumns.some(col => col.name === 'commercial_ok')) {
    db.prepare('ALTER TABLE models DROP COLUMN commercial_ok').run();
  }
  if (modelColumns.some(col => col.name === 'docs_url')) {
    db.prepare('ALTER TABLE models DROP COLUMN docs_url').run();
  }
  if (modelColumns.some(col => col.name === 'provider_slug')) {
    db.prepare('ALTER TABLE models DROP COLUMN provider_slug').run();
  }
}
