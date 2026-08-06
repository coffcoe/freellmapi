import { getDb } from '../db/index.js';
import { pruneRequestAnalytics } from '../services/request-retention.js';

type LogTx = ReturnType<typeof getDb>;

// SQLite stores created_at as 'YYYY-MM-DD HH:MM:SS' (UTC). Truncate to hour
// for the aggregate upsert. Duplicated from the migration helper so this
// module has no import dependency on db/migrations/.
function hourKey(createdAt: string): string {
  return createdAt.slice(0, 13) + ':00:00';
}

function incrementSetting(db: LogTx, key: string, delta: number): void {
  // Read-then-write inside the same transaction; safe because better-sqlite3
  // is synchronous and serialized at the connection level. ON CONFLICT keeps
  // the first ever insert without a prior SELECT.
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT)
  `).run(key, String(delta), delta);
}

function setSettingIfMissing(db: LogTx, key: string, value: string): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run(key, value);
}

// Append a row to the request analytics table. Shared by the chat proxy, the
// responses path, and the fusion panel so every served (or failed) sub-request
// is logged identically. Lives in a neutral lib module to avoid an import cycle
// between the fusion service and the proxy route that both call it.
//
// In addition to the raw row, we update two durable aggregates so analytics
// totals survive the raw-row prune (REQUEST_ANALYTICS_MAX_ROWS):
//   - request_hourly: per-hour bucket counts and tokens (max window = 30d).
//   - settings: lifetime totals (total_requests, total_input_tokens, total_output_tokens)
//     plus first_request_at (set on the first ever logged request).
// All upserts run in the same transaction so the aggregates never disagree
// with the raw row count.
export function logRequest(
  platform: string,
  modelId: string,
  keyId: number,
  status: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  error: string | null,
  ttfbMs: number | null = null,
  // The model id the client pinned; null for auto-routed requests. Lets
  // analytics split pinned vs auto traffic and detect failover overrides
  // (requested_model set but != model_id).
  requestedModel: string | null = null,
  // Calling client/app identifier (from the x-client-tag request header), or
  // null when the client does not self-identify. Used to attribute auto-traffic
  // to its source during quota investigations (P2-a).
  clientTag: string | null = null,
) {
  try {
    const db = getDb();
    const tx = db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO requests (platform, model_id, key_id, status, input_tokens, output_tokens, latency_ms, error, ttfb_ms, requested_model, client_tag)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(platform, modelId, keyId, status, inputTokens, outputTokens, latencyMs, error, ttfbMs, requestedModel, clientTag);

      const createdAt = db.prepare(`SELECT created_at FROM requests WHERE id = ?`).get(insert.lastInsertRowid) as { created_at: string } | undefined;
      const hour = hourKey(createdAt?.created_at ?? new Date().toISOString().slice(0, 19).replace('T', ' '));
      const isSuccess = status === 'success' ? 1 : 0;
      const isError = status === 'error' ? 1 : 0;

      db.prepare(`
        INSERT INTO request_hourly (hour, total_requests, success_count, error_count, input_tokens, output_tokens)
        VALUES (?, 1, ?, ?, ?, ?)
        ON CONFLICT(hour) DO UPDATE SET
          total_requests = total_requests + 1,
          success_count  = success_count + ?,
          error_count    = error_count + ?,
          input_tokens   = input_tokens + ?,
          output_tokens  = output_tokens + ?
      `).run(hour, isSuccess, isError, inputTokens, outputTokens, isSuccess, isError, inputTokens, outputTokens);

      incrementSetting(db, 'total_requests', 1);
      incrementSetting(db, 'total_input_tokens', inputTokens);
      incrementSetting(db, 'total_output_tokens', outputTokens);
      if (createdAt?.created_at) {
        setSettingIfMissing(db, 'first_request_at', createdAt.created_at);
      }
    });
    tx();

    pruneRequestAnalytics({ db });

    // Fire-and-forget POST to local token tracker (port 3003).
    // Only for successful completions with actual token data; errors and
    // zero-token entries are skipped. Non-blocking — never slows the caller.
    if (status === 'success' && (inputTokens > 0 || outputTokens > 0)) {
      notifyTracker(platform, modelId, inputTokens, outputTokens);
    }
  } catch (e) {
    console.error('Failed to log request:', e);
  }
}

/**
 * Fire-and-forget POST to the local tracker.py Flask server.
 * Deliberately non-blocking: we do not await the fetch, and a 300ms
 * timeout caps the overhead. If the tracker is not running, the request
 * silently fails after 300ms with zero impact on the proxy.
 */
function notifyTracker(
  platform: string,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const url = 'http://localhost:3003/api/log';
  const body = JSON.stringify({
    platform,
    model: modelId,
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
  });

  // Fire-and-forget via AbortController with a 300ms timeout.
  // Promise is explicitly un-awaited — the caller never blocks.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: controller.signal,
  }).catch(() => {}).finally(() => clearTimeout(timer));
}
