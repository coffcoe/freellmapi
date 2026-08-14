import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getRequestMaxTokensBudget,
  getMaxConsecutiveUpstreamFails,
  exceedsTokenBudget,
  newBreaker,
  recordBreakerFailure,
} from '../../lib/guardrails.js';

// Mock the settings store so we can drive the getters deterministically.
const settingStore = new Map<string, string>();
vi.mock('../../db/index.js', () => ({
  getSetting: (key: string) => (settingStore.has(key) ? settingStore.get(key) : undefined),
}));

beforeEach(() => {
  settingStore.clear();
});

describe('guardrail setting getters', () => {
  it('default to 0 (unlimited / disabled) when unset', () => {
    expect(getRequestMaxTokensBudget()).toBe(0);
    expect(getMaxConsecutiveUpstreamFails()).toBe(0);
  });

  it('parse a configured budget', () => {
    settingStore.set('request_max_tokens_budget', '8000');
    expect(getRequestMaxTokensBudget()).toBe(8000);
  });

  it('treat a non-numeric / negative budget as 0 (fail-safe)', () => {
    settingStore.set('request_max_tokens_budget', 'abc');
    expect(getRequestMaxTokensBudget()).toBe(0);
    settingStore.set('request_max_tokens_budget', '-5');
    expect(getRequestMaxTokensBudget()).toBe(0);
  });

  it('parse a configured breaker threshold', () => {
    settingStore.set('max_consecutive_upstream_fails', '5');
    expect(getMaxConsecutiveUpstreamFails()).toBe(5);
  });
});

describe('exceedsTokenBudget', () => {
  it('never exceeds when budget is 0 (unlimited)', () => {
    expect(exceedsTokenBudget(1_000_000, 0)).toBe(false);
  });
  it('exceeds when estimate > budget', () => {
    expect(exceedsTokenBudget(9000, 8000)).toBe(true);
  });
  it('does not exceed when estimate <= budget', () => {
    expect(exceedsTokenBudget(8000, 8000)).toBe(false);
    expect(exceedsTokenBudget(7000, 8000)).toBe(false);
  });
});

describe('circuit breaker state machine (v0.7.0 per-request contract)', () => {
  it('is a no-op when disabled (threshold 0)', () => {
    settingStore.set('max_consecutive_upstream_fails', '0');
    const b = newBreaker();
    expect(recordBreakerFailure(b)).toBe(false);
    expect(recordBreakerFailure(b)).toBe(false);
    expect(b.consecutive).toBe(0);
  });

  it('trips after N consecutive failures', () => {
    settingStore.set('max_consecutive_upstream_fails', '3');
    const b = newBreaker();
    expect(recordBreakerFailure(b)).toBe(false);
    expect(recordBreakerFailure(b)).toBe(false);
    expect(recordBreakerFailure(b)).toBe(true);
  });

  it('a fresh newBreaker() starts at zero (per-request state, no shared reset)', () => {
    settingStore.set('max_consecutive_upstream_fails', '2');
    const b = newBreaker();
    expect(recordBreakerFailure(b)).toBe(false);
    // New request → brand-new breaker: previous failures never carry over.
    const fresh = newBreaker();
    expect(fresh.consecutive).toBe(0);
    expect(recordBreakerFailure(fresh)).toBe(false);
  });
});
