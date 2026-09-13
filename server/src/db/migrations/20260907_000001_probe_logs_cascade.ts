import type { Db } from '../types.js';

/**
 * probe_logs 外键 ON DELETE CASCADE 修复 (2026-09-07).
 *
 * 背景：probe_logs 是本地 CUSTOM-PATCHES（free-model-audit 探测日志）引入的表，
 * 其外键 `REFERENCES models(id)` 无 ON DELETE CASCADE。而 catalog-sync（上游逻辑）
 * prune 时 `DELETE FROM models WHERE id=?`，只要待删 model 存在探测记录即触发
 * FOREIGN KEY constraint failed，整个事务回滚 → catalog_applied_version 卡死
 * （Windows 08.11 / macOS 08.01，2026-08-13 起）。
 *
 * 语义：model 被 catalog 移除后，其探测日志无保留价值，级联删除合理。
 * 本迁移通过重建表方式将外键改为 ON DELETE CASCADE（SQLite 不支持 ALTER 改外键）。
 * 幂等守卫：仅当外键 on_delete != CASCADE 时重建。
 */
export function up(db: Db): void {
  const fks = db
    .prepare('PRAGMA foreign_key_list(probe_logs)')
    .all() as { table: string; from: string; to: string; on_delete: string }[];

  const needsRebuild = fks.some(fk => fk.table === 'models' && fk.on_delete !== 'CASCADE');
  if (!needsRebuild) return;

  db.exec(`
    CREATE TABLE probe_logs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      probed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      success BOOLEAN NOT NULL,
      error_message TEXT,
      latency_ms INTEGER,
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
    );
    INSERT INTO probe_logs_new (id, model_id, probed_at, success, error_message, latency_ms)
      SELECT id, model_id, probed_at, success, error_message, latency_ms FROM probe_logs;
    DROP TABLE probe_logs;
    ALTER TABLE probe_logs_new RENAME TO probe_logs;
    CREATE INDEX IF NOT EXISTS idx_probe_logs_model_id ON probe_logs(model_id);
    CREATE INDEX IF NOT EXISTS idx_probe_logs_probed_at ON probe_logs(probed_at);
  `);
}

export function down(db: Db): void {
  const fks = db
    .prepare('PRAGMA foreign_key_list(probe_logs)')
    .all() as { table: string; from: string; to: string; on_delete: string }[];

  const needsRebuild = fks.some(fk => fk.table === 'models' && fk.on_delete === 'CASCADE');
  if (!needsRebuild) return;

  db.exec(`
    CREATE TABLE probe_logs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      probed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      success BOOLEAN NOT NULL,
      error_message TEXT,
      latency_ms INTEGER,
      FOREIGN KEY (model_id) REFERENCES models(id)
    );
    INSERT INTO probe_logs_new (id, model_id, probed_at, success, error_message, latency_ms)
      SELECT id, model_id, probed_at, success, error_message, latency_ms FROM probe_logs;
    DROP TABLE probe_logs;
    ALTER TABLE probe_logs_new RENAME TO probe_logs;
    CREATE INDEX IF NOT EXISTS idx_probe_logs_model_id ON probe_logs(model_id);
    CREATE INDEX IF NOT EXISTS idx_probe_logs_probed_at ON probe_logs(probed_at);
  `);
}
