import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { notifyTracker, effectiveTrackerUrl, type TrackerPayload } from '../../lib/request-log.js';

// Token tracker notification (P2-a, CUSTOM-PATCHES §3.4): a best-effort,
// non-blocking POST to an external usage tracker after successful token-bearing
// requests. These tests drive the injectable `send` (no real network) to assert
// the URL, payload shape, and that failures are swallowed.

const OLD_ENV = { ...process.env };

function makePayload(over: Partial<TrackerPayload> = {}): TrackerPayload {
  return {
    platform: 'groq',
    modelId: 'openai/gpt-oss-120b',
    keyId: 7,
    inputTokens: 120,
    outputTokens: 30,
    clientTag: 'opencode',
    ...over,
  };
}

beforeEach(() => {
  delete process.env.TOKEN_TRACKER_URL;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.useRealTimers();
});

describe('effectiveTrackerUrl', () => {
  it('defaults to the historical localhost:3003 tracker', () => {
    delete process.env.TOKEN_TRACKER_URL;
    expect(effectiveTrackerUrl()).toBe('http://localhost:3003/api/log');
  });

  it('honours a TOKEN_TRACKER_URL override', () => {
    process.env.TOKEN_TRACKER_URL = 'http://127.0.0.1:9999/api/log';
    expect(effectiveTrackerUrl()).toBe('http://127.0.0.1:9999/api/log');
  });

  it("is disabled when TOKEN_TRACKER_URL is '' or 'off'", () => {
    process.env.TOKEN_TRACKER_URL = '';
    expect(effectiveTrackerUrl()).toBeNull();
    process.env.TOKEN_TRACKER_URL = 'off';
    expect(effectiveTrackerUrl()).toBeNull();
    process.env.TOKEN_TRACKER_URL = '  OFF  ';
    expect(effectiveTrackerUrl()).toBeNull();
  });
});

describe('notifyTracker', () => {
  it('POSTs the payload to the tracker URL with a JSON body and abort signal', async () => {
    process.env.TOKEN_TRACKER_URL = 'http://tracker:3003/api/log';
    const send = vi.fn(async () => ({ ok: true }));
    const payload = makePayload();

    notifyTracker(payload, send);

    // Fire-and-forget: wait a tick for the promise chain to run.
    await new Promise(r => setImmediate(r));
    expect(send).toHaveBeenCalledTimes(1);
    const [url, body, signal] = send.mock.calls[0];
    expect(url).toBe('http://tracker:3003/api/log');
    const parsed = JSON.parse(body as string);
    expect(parsed.platform).toBe('groq');
    expect(parsed.model).toBe('openai/gpt-oss-120b');
    expect(parsed.keyId).toBe(7);
    expect(parsed.inputTokens).toBe(120);
    expect(parsed.outputTokens).toBe(30);
    expect(parsed.totalTokens).toBe(150);
    expect(parsed.clientTag).toBe('opencode');
    expect(parsed.ts).toBeDefined();
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('is a no-op (does not call send) when tracking is disabled', async () => {
    process.env.TOKEN_TRACKER_URL = 'off';
    const send = vi.fn(async () => ({}));
    notifyTracker(makePayload(), send);
    await new Promise(r => setImmediate(r));
    expect(send).not.toHaveBeenCalled();
  });

  it('swallows a rejected send so the caller flow is never disturbed', async () => {
    const send = vi.fn(async () => { throw new Error('tracker unreachable'); });
    // Must not throw synchronously or reject the task.
    expect(() => notifyTracker(makePayload(), send)).not.toThrow();
    await new Promise(r => setImmediate(r));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('aborts the request after the 300ms timeout', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const send = vi.fn(async (_url, _body, signal) => { capturedSignal = signal; });
    notifyTracker(makePayload(), send);
    // Flush the microtask so `send` has run and captured the signal.
    await Promise.resolve();
    expect(capturedSignal!).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);
    vi.advanceTimersByTime(301);
    expect(capturedSignal!.aborted).toBe(true);
  });
});
