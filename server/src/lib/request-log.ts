import { getDb } from '../db/index.js';
import { pruneRequestAnalytics } from '../services/request-retention.js';
import { getClientContext } from './client-context.js';
import { noteRequestRowId, type RequestTrace } from './attempt-trace.js';

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
// Status is 'success', 'error', or 'canceled' (#752 — the client hung up
// mid-attempt). A canceled request counts toward request totals — it happened —
// but toward NEITHER success nor error: rates and scoring must read
// success/(success+error), never success/total.
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
  // NULL for rejections that never reached routing (no key was involved),
  // e.g. an over-limit request body turned away at the parser.
  keyId: number | null,
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
  // The model the UPSTREAM claims it served, ONLY when it genuinely differs
  // from the routed model_id after cosmetic normalization (#534 — see
  // lib/served-model.ts). NULL when it matches or the provider reported
  // nothing usable, so the column stays empty in the healthy case.
  servedModel: string | null = null,
) {
  try {
    const db = getDb();
    // Caller identity from the request-scoped context (set by the express
    // middleware); null when logging happens outside an HTTP request.
    const client = getClientContext();
    const tx = db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO requests (platform, model_id, key_id, status, input_tokens, output_tokens, latency_ms, error, ttfb_ms, requested_model, served_model, client_ip, client_user_agent, client_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(platform, modelId, keyId, status, inputTokens, outputTokens, latencyMs, error, ttfbMs, requestedModel, servedModel, client.ip, client.userAgent, client.agent);

      // Report the row id back to the fallback loop's attempt trace (if one is
      // active): the LAST id noted during a loop run is the terminal row the
      // per-attempt batch is keyed to. No-op outside a fallback-loop run.
      if (insert.lastInsertRowid != null) noteRequestRowId(insert.lastInsertRowid);

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

    // Best-effort tracker notification (CUSTOM-PATCHES §3.4): fire-and-forget
    // a non-blocking POST to the local token tracker when a request succeeded
    // and actually consumed tokens, so quota provenance has a live source.
    // Runs AFTER the durable DB write and off the request's latency path;
    // never throws (see notifyTracker). Defaults to the historical
    // http://localhost:3003/api/log tracker, overridable via TOKEN_TRACKER_URL.
    if (status === 'success' && inputTokens + outputTokens > 0) {
      notifyTracker({ platform, modelId, keyId, inputTokens, outputTokens, clientTag: client.agent ?? null });
    }
  } catch (e) {
    console.error('Failed to log request:', e);
  }
}

// ── Token tracker notification (P2-a) ───────────────────────────────────────
// A lightweight, zero-dependency fan-out to an external usage tracker (the
// historical localhost:3003 Flask tracker.py, CUSTOM-PATCHES §3.4). It lets
// quota investigation attribute auto traffic to its source without polling the
// DB. Deliberately non-blocking and best-effort:
//   - fired asynchronously, NOT awaited, so the request path never waits on it;
//   - a 300ms timeout bounds how long the socket may hang before it's dropped;
//   - every failure (unreachable host, timeout, malformed body) is swallowed —
//     a missing tracker must not break or slow the relay;
//   - disabled entirely when TOKEN_TRACKER_URL is set to '' / 'off'.
// The tracker is an external component and not required for the relay to work.
const TRACKER_URL_ENV = 'TOKEN_TRACKER_URL';
const DEFAULT_TRACKER_URL = 'http://localhost:3003/api/log';
const TRACKER_TIMEOUT_MS = 300;

function trackerUrl(): string | null {
  const raw = process.env[TRACKER_URL_ENV];
  if (raw === undefined) return DEFAULT_TRACKER_URL;
  const v = raw.trim();
  return v === '' || v.toLowerCase() === 'off' ? null : v;
}

export interface TrackerPayload {
  platform: string;
  modelId: string;
  keyId: number | null;
  inputTokens: number;
  outputTokens: number;
  clientTag: string | null;
}

/** Test seam: snapshot of the env override so tests can assert the effective
 *  URL is read from TOKEN_TRACKER_URL (or the default) without hitting the
 *  network. */
export function effectiveTrackerUrl(): string | null {
  return trackerUrl();
}

/** Fire-and-forget POST to the token tracker. Never throws; a timeout or any
 *  network error is swallowed so the caller's flow is never disturbed. Exported
 *  for tests, which pass an injectable `send` to assert the payload/headers
 *  without real HTTP. */
export function notifyTracker(
  payload: TrackerPayload,
  send: (url: string, body: string, signal: AbortSignal) => Promise<unknown> = (url, body, signal) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal }),
): void {
  const url = trackerUrl();
  if (url === null) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRACKER_TIMEOUT_MS);
  const body = JSON.stringify({
    platform: payload.platform,
    model: payload.modelId,
    keyId: payload.keyId,
    inputTokens: payload.inputTokens,
    outputTokens: payload.outputTokens,
    totalTokens: payload.inputTokens + payload.outputTokens,
    clientTag: payload.clientTag,
    ts: new Date().toISOString(),
  });
  // Fire-and-forget: we intentionally do not await. Errors and aborts are
  // swallowed so a dead tracker can't surface anywhere on the relay.
  void Promise.resolve()
    .then(() => send(url, body, controller.signal))
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}

// Persist a finished attempt trace as one small insert batch keyed to the
// terminal `requests` row of the failover ladder (the success row, a committed
// mid-stream error row, or the last per-attempt failure row). Called once per
// request by the fallback loop AFTER the response is finished, so the write is
// off the client's latency path. Zero-failure single-attempt successes write
// exactly one 'ok' row. A trace with no parent row writes nothing — since the
// fallback loop logs a 'canceled' row for pure client aborts (#752), that is
// now only the loop-top stop paths, whose failed attempts each wrote their own
// row already.
export function persistRequestAttempts(trace: RequestTrace): void {
  if (trace.records.length === 0 || trace.lastRequestRowId == null) return;
  try {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO request_attempts (request_id, ordinal, platform, model_id, key_ordinal, outcome, start_offset_ms, duration_ms, error_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction(() => {
      for (const r of trace.records) {
        insert.run(trace.lastRequestRowId, r.ordinal, r.platform, r.modelId, r.keyOrdinal, r.outcome, r.startOffsetMs, r.durationMs, r.errorSummary);
      }
    });
    tx();
  } catch (e) {
    console.error('Failed to persist request attempts:', e);
  }
}
