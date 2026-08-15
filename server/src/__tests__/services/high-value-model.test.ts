import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import {
  filterHighValueIfLarge,
  HIGH_VALUE_INPUT_THRESHOLD,
  routeRequest,
  setRoutingStrategy,
} from '../../services/router.js';

// High-value model protection (P1-b, CUSTOM-PATCHES §3.10): when the estimated
// input is large (> HIGH_VALUE_INPUT_THRESHOLD), the auto chain drops
// `is_high_value=1` models first so their scarce daily quota isn't burned on
// one oversized request. Pinned/manual requests and small inputs are untouched.

// Minimal ChainRow shims for the pure-function tests.
type ChainShim = { model_id: string; is_high_value: number };

function row(modelId: string, isHighValue: number): ChainShim {
  return { model_id: modelId, is_high_value: isHighValue };
}

describe('filterHighValueIfLarge (pure)', () => {
  it('keeps the chain unchanged for a small input', () => {
    const chain = [row('a', 1), row('b', 0)];
    expect(filterHighValueIfLarge(chain as never, 1000)).toBe(chain);
  });

  it('drops high-value models once the input is large', () => {
    const chain = [row('a', 1), row('b', 0), row('c', 1)];
    const out = filterHighValueIfLarge(chain as never, HIGH_VALUE_INPUT_THRESHOLD + 1);
    expect(out.map(r => r.model_id)).toEqual(['b']);
  });

  it('returns the original chain when dropping high-value models would empty it', () => {
    const chain = [row('a', 1), row('b', 1)];
    const out = filterHighValueIfLarge(chain as never, HIGH_VALUE_INPUT_THRESHOLD + 1);
    expect(out).toBe(chain); // never turn a servable request into an exhausted one
  });

  it('treats a request exactly at the threshold as small (not high-value-triggering)', () => {
    const chain = [row('a', 1), row('b', 0)];
    expect(filterHighValueIfLarge(chain as never, HIGH_VALUE_INPUT_THRESHOLD)).toBe(chain);
  });
});

describe('routeRequest high-value integration', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  beforeEach(() => {
    const db = getDb();
    setRoutingStrategy('priority');
    db.prepare('DELETE FROM api_keys').run();
    db.prepare("DELETE FROM settings WHERE key = 'active_profile_id'").run();
  });

  // Pick two enabled models with a large enough context window to hold a
  // HIGH_VALUE_INPUT_THRESHOLD+1 request, on registered providers. The test
  // selects them dynamically so it is robust to catalog changes.
  function pickTwoRoutable(db: any): any[] {
    const rows = db.prepare(`
      SELECT id, model_id, platform, context_window
      FROM models
      WHERE enabled = 1 AND platform IN ('google', 'openrouter', 'groq')
        AND context_window IS NOT NULL AND context_window >= ?
      ORDER BY intelligence_rank ASC
      LIMIT 2
    `).all(HIGH_VALUE_INPUT_THRESHOLD + 2000) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    return rows;
  }

  function addKeyFor(db: any, platform: string): void {
    const { encrypted, iv, authTag } = encrypt('test-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(platform, `key-${platform}`, encrypted, iv, authTag, 'healthy', 1);
  }

  it('routes a large request away from a high-value model onto a normal one', () => {
    const db = getDb();
    const [highValue, normal] = pickTwoRoutable(db);
    db.prepare('UPDATE models SET is_high_value = 1 WHERE id = ?').run(highValue.id);
    db.prepare('UPDATE models SET is_high_value = 0 WHERE id = ?').run(normal.id);

    // High-value model first in the chain, normal model second.
    db.prepare('UPDATE fallback_config SET priority = 1 WHERE model_db_id = ?').run(highValue.id);
    db.prepare('UPDATE fallback_config SET priority = 2 WHERE model_db_id = ?').run(normal.id);
    addKeyFor(db, highValue.platform);
    addKeyFor(db, normal.platform);

    // A large request must skip the high-value model (higher priority) and
    // route to the normal one.
    const result = routeRequest(HIGH_VALUE_INPUT_THRESHOLD + 1);
    expect(result.modelId).toBe(normal.model_id);
  });

  it('still routes a large request to the high-value model when it is the only option', () => {
    const db = getDb();
    const model = db.prepare(`
      SELECT id, model_id, platform, context_window
      FROM models
      WHERE enabled = 1 AND platform IN ('google', 'openrouter', 'groq')
        AND context_window IS NOT NULL AND context_window >= ?
      ORDER BY intelligence_rank ASC LIMIT 1
    `).get(HIGH_VALUE_INPUT_THRESHOLD + 2000) as any;
    expect(model).toBeDefined();

    // Mark it high-value and make it the only model in the chain.
    db.prepare('UPDATE models SET is_high_value = 1').run();
    db.prepare('DELETE FROM fallback_config WHERE model_db_id != ?').run(model.id);
    db.prepare('UPDATE fallback_config SET priority = 1 WHERE model_db_id = ?').run(model.id);
    addKeyFor(db, model.platform);

    // The only model is high-value — the guard must not empty the chain.
    const result = routeRequest(HIGH_VALUE_INPUT_THRESHOLD + 1);
    expect(result.modelId).toBe(model.model_id);
  });
});
