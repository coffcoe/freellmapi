// Migration: per-endpoint identity for custom relay models (#651)
// Created: 2026-07-29
//
// DOWN: reversible (throws when duplicates exist — see below)
//
// `models` was unique on (platform, model_id). Every custom relay is stored
// under platform = 'custom', so two relays offering the same model id could not
// coexist: the second registration silently rebound the first one's row. One
// enabled flag, one set of ranks, one stats bucket — turning the model off
// because relay A was broken turned it off for relay B as well (#619).
//
// This adds `endpoint_scope` (the endpoint's normalized base_url, '' for every
// catalog platform) and moves uniqueness to (platform, model_id,
// endpoint_scope). Catalog rows all share the '' scope, so their constraint is
// bit-for-bit the old one; only custom rows gain room for a sibling.
//
// SQLite cannot drop a table-level UNIQUE, so `models` is rebuilt. Two details
// make that safe on a live DB:
//   - row ids are copied verbatim, so fallback_config / profile_models /
//     saved fusion configs keep pointing at the same models;
//   - `PRAGMA foreign_keys` is a no-op inside a transaction and the migration
//     runner wraps up() in one, so the child rows are parked in temp tables
//     across the DROP and restored after the rename. Renaming `models` itself
//     is avoided on purpose: with foreign keys on, a rename rewrites the
//     REFERENCES clauses of every child table to the new name.
//
// Schema only — no catalog data.
//
// Column drift note: this migration rebuilds `models`, so it must carry *every*
// column the table currently has — including columns added by migrations that
// run AFTER it (e.g. 20260802 quota guard, 20260812 scene routing). Those are
// derived at runtime from `PRAGMA table_info(models)` rather than hard-coded,
// so a future ALTER downstream can never be silently dropped by this rebuild.

import type { Db } from '../types.js';

// The models table as of this migration, as the literal column block. Kept
// verbatim (not derived) so the rebuilt schema is auditable here and identical
// on every run. MUST stay in sync with BASE_COLUMN_NAMES below.
const MODELS_COLUMNS = `
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      intelligence_rank INTEGER NOT NULL,
      speed_rank INTEGER NOT NULL,
      size_label TEXT NOT NULL DEFAULT '',
      rpm_limit INTEGER,
      rpd_limit INTEGER,
      tpm_limit INTEGER,
      tpd_limit INTEGER,
      monthly_token_budget TEXT NOT NULL DEFAULT '',
      context_window INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      supports_vision INTEGER NOT NULL DEFAULT 0,
      key_id INTEGER,
      supports_tools INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'catalog'`;

// Names of the columns owned by this migration's "base" set. Anything not in
// this list (and not endpoint_scope) is a column added by a later migration and
// must be carried through the rebuild too.
const BASE_COLUMN_NAMES = [
  'id', 'platform', 'model_id', 'display_name', 'intelligence_rank', 'speed_rank',
  'size_label', 'rpm_limit', 'rpd_limit', 'tpm_limit', 'tpd_limit',
  'monthly_token_budget', 'context_window', 'enabled', 'supports_vision', 'key_id',
  'supports_tools', 'source',
];

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

// Rebuild the column definition exactly as SQLite stores it in sqlite_master, so
// the rebuilt table's schema SQL matches the one produced by the upstream ALTER
// chain (and therefore the recorded schema string used by tests).
function columnDefinition(col: ColumnInfo): string {
  let def = `${col.name} ${col.type}`;
  if (col.notnull === 1) def += ' NOT NULL';
  if (col.dflt_value !== null && col.dflt_value !== undefined) def += ` DEFAULT ${col.dflt_value}`;
  return def;
}

// Columns present on `models` that are neither the base set nor endpoint_scope
// — i.e. columns added by migrations that run after this one.
function extraColumnsOf(db: Db): ColumnInfo[] {
  const all = db.prepare('PRAGMA table_info(models)').all() as ColumnInfo[];
  return all.filter(c => !BASE_COLUMN_NAMES.includes(c.name) && c.name !== 'endpoint_scope');
}

// Tables whose rows must survive the DROP. Discovered from the schema rather
// than hard-coded, so a table added later that references models is carried too.
function childTablesOfModels(db: Db): string[] {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'models'
     ORDER BY name
  `).all() as { name: string }[];
  return tables
    .filter(t => (db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all() as { table: string }[])
      .some(fk => fk.table === 'models'))
    .map(t => t.name);
}

function rebuildModels(db: Db, opts: { dropEndpointScope: boolean; unique: string }): void {
  const extras = extraColumnsOf(db);
  const children = childTablesOfModels(db);
  // AUTOINCREMENT's high-water mark. DROP TABLE takes the sqlite_sequence row
  // with it, and copying rows back only pushes the counter to the highest id
  // PRESENT — so a table whose top rows were deleted (catalog sync prunes
  // models routinely) would start handing out ids it has already used. Stale
  // fallback_config / profile_models rows pointing at a deleted model would
  // then silently adopt an unrelated new one.
  const seqRow = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'models'")
    .get() as { seq: number } | undefined;

  // endpoint_scope (when kept) and every later-added column are emitted on a
  // single inline line right after the base block, mirroring the format
  // SQLite itself produces when ALTER ADD COLUMN appends to this table.
  const inlineTail: string[] = [];
  if (!opts.dropEndpointScope) inlineTail.push("endpoint_scope TEXT NOT NULL DEFAULT ''");
  inlineTail.push(...extras.map(columnDefinition));
  const colBlock = `${MODELS_COLUMNS},\n      ${inlineTail.join(', ')}`;

  // Columns copied verbatim from the old table: all base columns plus any later
  // additions. endpoint_scope is never copied (it is re-derived via backfill in
  // up(), and dropped entirely in down()).
  const copyColumns = [...BASE_COLUMN_NAMES, ...extras.map(c => c.name)].join(', ');

  for (const child of children) {
    db.exec(`CREATE TEMP TABLE "_endpoint_identity_${child}" AS SELECT * FROM "${child}"`);
    db.exec(`DELETE FROM "${child}"`);
  }

  if (opts.dropEndpointScope) {
    db.exec(`
      CREATE TABLE models_endpoint_identity (${colBlock},
        ${opts.unique}
      );
      INSERT INTO models_endpoint_identity (${copyColumns})
        SELECT ${copyColumns} FROM models;
      DROP TABLE models;
      ALTER TABLE models_endpoint_identity RENAME TO models;
    `);
  } else {
    db.exec(`
      CREATE TABLE models_endpoint_identity (${colBlock},
        ${opts.unique}
      );
      INSERT INTO models_endpoint_identity (${copyColumns}, endpoint_scope)
        SELECT ${copyColumns}, '' FROM models;
      DROP TABLE models;
      ALTER TABLE models_endpoint_identity RENAME TO models;
    `);
  }

  if (seqRow) {
    // sqlite_sequence has no unique index, so no upsert: update the row the
    // rename carried over, or re-create it if the table was empty.
    const restored = db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'models' AND seq < ?")
      .run(seqRow.seq, seqRow.seq);
    if (restored.changes === 0
      && !db.prepare("SELECT 1 FROM sqlite_sequence WHERE name = 'models'").get()) {
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('models', ?)").run(seqRow.seq);
    }
  }

  for (const child of children) {
    db.exec(`INSERT INTO "${child}" SELECT * FROM "_endpoint_identity_${child}"`);
    db.exec(`DROP TABLE "_endpoint_identity_${child}"`);
  }
}

export function up(db: Db): void {
  rebuildModels(db, { dropEndpointScope: false, unique: 'UNIQUE(platform, model_id, endpoint_scope)' });

  // Backfill: a custom row's scope is the base_url of the key it is bound to.
  // Rows whose key is gone (or that predate per-endpoint binding) keep '' —
  // exactly the identity they have today, so nothing about them changes.
  const bound = db.prepare(`
    SELECT m.id AS id, k.base_url AS base_url
      FROM models m
      JOIN api_keys k ON k.id = m.key_id AND k.platform = 'custom'
     WHERE m.platform = 'custom' AND k.base_url IS NOT NULL AND k.base_url <> ''
  `).all() as { id: number; base_url: string }[];
  const setScope = db.prepare('UPDATE models SET endpoint_scope = ? WHERE id = ?');
  for (const row of bound) {
    setScope.run(row.base_url.trim().replace(/\/+$/, ''), row.id);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_models_endpoint_scope
      ON models(endpoint_scope) WHERE endpoint_scope <> '';
  `);
}

export function down(db: Db): void {
  // Going back means two relays' copies of one model id would have to share a
  // row again, and there is no honest way to pick which endpoint's settings
  // survive. Refuse rather than silently discard one.
  const collisions = db.prepare(`
    SELECT platform, model_id, COUNT(*) AS n
      FROM models GROUP BY platform, model_id HAVING COUNT(*) > 1
  `).all() as { platform: string; model_id: string; n: number }[];
  if (collisions.length > 0) {
    const sample = collisions.slice(0, 3).map(c => `${c.platform}/${c.model_id} (${c.n})`).join(', ');
    throw new Error(
      `Cannot revert per-endpoint model identity: ${collisions.length} model id(s) exist on more than one endpoint — ${sample}. ` +
      'Delete the duplicate rows (or the extra endpoint) first.',
    );
  }

  db.exec('DROP INDEX IF EXISTS idx_models_endpoint_scope;');
  rebuildModels(db, { dropEndpointScope: true, unique: 'UNIQUE(platform, model_id)' });
}
