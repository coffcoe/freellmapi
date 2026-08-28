import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// #592: the null-limits exhaustion heuristic (getCooldownDecisionForLimit) must
// only fire on an actual provider quota signal (a real 429 / rate-limit-classified
// error). Before the fix, ANY retryable failure — a timeout on a slow local
// generation, a 5xx blip — fed the "2+ hits in an hour = daily-exhausted"
// counter and escalated the bench 2m→10m→1h→24h, 429-ing every request on what
// is often the user's only route. Also covers the cooldownHits ladder decay on
// success: two back-to-back failures used to keep their ladder step for 24h
// even after successful requests proved the quota alive.

import { initDb } from '../../db/index.js';
import { cooldownDecisionForError, recordRetryableFailure } from '../../lib/fallback-loop.js';
import {
  getNextCooldownDuration,
  recordRequest,
  recentHitCount,
} from '../../services/ratelimit.js';
import type { RouteResult } from '../../services/router.js';
import type { FallbackState } from '../../lib/fallback-loop.js';

const MINUTE = 60_000;
const TRANSIENT = 90_000;

// Distinct keyId AND modelDbId per fake route: the cooldown/ladder maps are
// module-global, so shared ids would leak state across tests.
let keySeq = 640_000;
function nullLimitRoute(): RouteResult {
  const n = ++keySeq;
  return {
    provider: {} as any, modelId: `null-limit-model-${n}`, modelDbId: 592_000 + n,
    apiKey: 'k', keyId: n, platform: 'ollama', displayName: 'Null-Limit Model',
    rpdLimit: null, tpdLimit: null,
  };
}

const timeoutErr = () => Object.assign(
  new Error('Request timeout after 120000ms'), { name: 'TimeoutError' },
);
const serverErr = () => Object.assign(
  new Error('Ollama API error 500: Internal Server Error'), { status: 500 },
);
const real429 = () => Object.assign(
  new Error('429 Too Many Requests'), { status: 429 },
);

beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  initDb(':memory:');
});

let route: RouteResult;
beforeEach(() => { route = nullLimitRoute(); });

describe('null-limits heuristic only fires on quota signals (#592)', () => {
  it('repeated timeouts stay on the short transient bench — no ladder', () => {
    for (let i = 0; i < 4; i++) {
      const decision = cooldownDecisionForError(route, timeoutErr());
      expect(decision.durationMs).toBe(TRANSIENT);
      expect(decision.source).toBe('heuristic');
    }
    // No hits recorded → the heuristic counter never sees a timeout.
    expect(recentHitCount(route.platform, route.modelId, route.keyId, Date.now())).toBe(0);
  });

  it('repeated 5xx stay on the short transient bench — no ladder', () => {
    for (let i = 0; i < 4; i++) {
      expect(cooldownDecisionForError(route, serverErr()).durationMs).toBe(TRANSIENT);
    }
    expect(recentHitCount(route.platform, route.modelId, route.keyId, Date.now())).toBe(0);
  });

  it('a timeout does not inherit escalation started by real 429s', () => {
    const state = { skipKeys: new Set<string>(), skipModels: new Set<number>() };
    recordRetryableFailure(route, real429(), state);
    recordRetryableFailure(route, real429(), state);
    // After 2x 429, heuristic kicks in → 10min bench (not 90s).
    expect(cooldownDecisionForError(route, real429()).durationMs).toBeGreaterThan(60_000);
    // A timeout right after must NOT shrink the bench to 90s.
    recordRetryableFailure(route, timeoutErr(), state);
    const afterTimeout = cooldownDecisionForError(route, timeoutErr()).durationMs;
    expect(afterTimeout).toBeGreaterThan(60_000); // preserved, not reset to 90s
    // Hit count reflects the initial threshold crossing (1 recorded before existing cooldown check).
    // The 10min bench IS persisted in DB, preventing timeout from resetting to 90s.
  });

  it('real 429s still escalate — the Ollama-Cloud opaque-quota protection holds', () => {
    const state = { skipKeys: new Set<string>(), skipModels: new Set<number>() };
    // 1st 429 → transient (no signal yet), 2nd → 10min cap.
    // The 10min cap prevents unbounded escalation to 24h for null-limit providers.
    recordRetryableFailure(route, real429(), state);
    recordRetryableFailure(route, real429(), state);
    expect(cooldownDecisionForError(route, real429()).durationMs).toBeGreaterThan(60_000);
    recordRetryableFailure(route, real429(), state);
    expect(cooldownDecisionForError(route, real429()).durationMs).toBeGreaterThan(60_000);
  });
});

describe('cooldownHits ladder decays on success (#592)', () => {
  it('a successful request resets the escalation ladder', () => {
    const { platform, modelId, keyId } = nullLimitRoute();
    expect(getNextCooldownDuration(platform, modelId, keyId)).toBe(2 * MINUTE);
    expect(getNextCooldownDuration(platform, modelId, keyId)).toBe(10 * MINUTE);
    // A served request proves the quota is alive — ladder starts over.
    recordRequest(platform, modelId, keyId);
    expect(getNextCooldownDuration(platform, modelId, keyId)).toBe(2 * MINUTE);
  });

  it('without a success the ladder keeps escalating (documented contract intact)', () => {
    const { platform, modelId, keyId } = nullLimitRoute();
    expect(getNextCooldownDuration(platform, modelId, keyId)).toBe(2 * MINUTE);
    expect(getNextCooldownDuration(platform, modelId, keyId)).toBe(10 * MINUTE);
    expect(getNextCooldownDuration(platform, modelId, keyId)).toBe(60 * MINUTE);
    expect(getNextCooldownDuration(platform, modelId, keyId)).toBe(24 * 60 * MINUTE);
  });
});
