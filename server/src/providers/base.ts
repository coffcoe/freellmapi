import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatToolDefinition,
  ChatToolChoice,
  Platform,
} from '@freellmapi/shared/types.js';
import { needsProxy, getProxyAgent, getProxyConfigForProvider, PROXY_CONFIG, type ProxyProviderConfig } from '../lib/proxy-manager.js';

// ──────────────────────────────────────────────
// Proxy hot-swap: per-platform direct-connect test
// If a "needsProxy: true" platform responds faster
// (or at all) without a proxy, remember the decision
// so future requests skip the proxy hop.
// Cache is refreshed every RETEST_INTERVAL_MS.
// ──────────────────────────────────────────────
interface ProxyHotSwapEntry {
  tested: boolean;
  directWon: boolean;       // true = direct connect worked
  testedAt: number;         // timestamp of last test
}
const proxyHotSwapCache = new Map<string, ProxyHotSwapEntry>();
const HOT_SWAP_TEST_TIMEOUT_MS = 5000;   // generous enough for both paths
const HOT_SWAP_RETEST_MS = 6 * 60 * 60 * 1000; // re-test every 6 hours

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  tools?: ChatToolDefinition[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
}

// Global toggle for proxy hot-swap — disables the direct-connect probe that
// fires a *real* fetch before the mocked one can intercept. Useful in tests
// where mocking `global.fetch` should take effect immediately without a
// preliminary real network round-trip. Controlled via the environment variable
// DISABLE_PROXY_HOT_SWAP (e.g. `DISABLE_PROXY_HOT_SWAP=1 vitest run ...`).
const HOT_SWAP_DISABLED = Boolean(process.env.DISABLE_PROXY_HOT_SWAP);

export abstract class BaseProvider {
  abstract readonly platform: Platform;
  abstract readonly name: string;
  /** Providers whose free tier needs no API key (e.g. Kilo's anonymous gateway).
   * When true, the gateway stores a sentinel key row so routing still considers
   * the platform "configured", and the provider omits the Authorization header
   * on outgoing requests. Defaults to false; set by subclasses. */
  keyless = false;

  abstract chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse>;

  abstract streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk>;

  abstract validateKey(apiKey: string): Promise<boolean>;

  protected makeId(): string {
    return `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 带超时的 fetch 请求，支持按平台动态选择代理
   * 新增：海外厂商支持代理热交换（Hot-Swap）——如果直连效果优于走代理，自动切直连。
   * 
   * ⚠️ 关键改动：
   * - 不再依赖全局 HTTP_PROXY 环境变量
   * - 根据平台（如 'custom', 'zhipu', 'openrouter' 等）动态决定是否使用代理
   * - 需要代理的平台通过 getProxyAgent() 获取 Agent；不需要的直连
   * - 代理热交换：首次或缓存过期时，同时测试直连和代理，取更快的路径
   */
  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 15000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let shouldUseProxy: boolean;

    try {
      // ── Proxy Hot-Swap 逻辑 ──────────────────────
      // When HOT_SWAP_DISABLED (e.g. in CI/test), skip the real fetch probe
      // so that mocking `global.fetch` takes effect immediately.
      if (HOT_SWAP_DISABLED) {
        const pc = getProxyConfigForProvider(this.platform);
        shouldUseProxy = Boolean(pc?.needsProxy && PROXY_CONFIG.enabled);
      } else {
        const platformConfig = getProxyConfigForProvider(this.platform);

        if (platformConfig?.needsProxy) {
          // 平台标记为需要代理，但我们先测试直连
          let hsEntry = proxyHotSwapCache.get(this.platform);
          const now = Date.now();
          const stale = !hsEntry || (now - hsEntry.testedAt) > HOT_SWAP_RETEST_MS;

          if (stale) {
            // 首次测试或未测试过 → 尝试直连
            try {
              const proxyInit: RequestInit = { ...init, signal: AbortSignal.timeout(HOT_SWAP_TEST_TIMEOUT_MS) };
              await fetch(url, proxyInit);
              proxyHotSwapCache.set(this.platform, {
                tested: true,
                directWon: true,
                testedAt: now,
              });
              shouldUseProxy = false;
            } catch {
              // 直连失败（超时/连接拒绝）→ 退回走代理
              proxyHotSwapCache.set(this.platform, {
                tested: true,
                directWon: false,
                testedAt: now,
              });
              shouldUseProxy = true;
            }
          } else {
            // 已测试过 → 直接用之前的结果
            shouldUseProxy = !hsEntry.directWon;
          }
        } else {
          // 平台不需要代理 → 直连
          shouldUseProxy = false;
        }
      }

      // ── 构建 fetch ────────────────────────────────
      const proxyAgent = shouldUseProxy ? await getProxyAgent(this.platform) : null;

      const fetchInit: RequestInit = {
        ...init,
        signal: controller.signal,
      };

      if (proxyAgent) {
        (fetchInit as any).agent = proxyAgent;
      }

      return await fetch(url, fetchInit);
    } finally {
      clearTimeout(timeout);
    }
  }

  protected makeId(): string {
    return `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Shared SSE reader for OpenAI-wire streaming endpoints (#231 audit).
   *
   * Hardened against the upstream failure modes observed live:
   *  - Inactivity timeout: fetchWithTimeout's abort timer dies the moment
   *    response HEADERS arrive, so a provider that stalls mid-body used to
   *    hang the client forever. Each read now has its own deadline.
   *  - Abrupt EOF: a stream that ends without `[DONE]` AND without any
   *    `finish_reason` is a truncated generation, not a completion. It used
   *    to end the generator silently (truncation logged as success); it now
   *    throws a retryable error so the proxy can fail over or report it.
   *    Providers that skip `[DONE]` but do send a terminal finish_reason
   *    (several compat shims) still complete normally.
   *
   * Malformed data lines are skipped, matching previous behavior.
   */
  protected async *readSseStream(
    res: Response,
    inactivityTimeoutMs = 90000,
  ): AsyncGenerator<ChatCompletionChunk> {
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let sawFinishReason = false;

    try {
      while (true) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`${this.name} stream stalled: no data for ${inactivityTimeoutMs}ms (timeout)`)),
              inactivityTimeoutMs,
            );
          }),
        ]).finally(() => clearTimeout(timer));

        const { done, value } = result;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;
          try {
            const chunk = JSON.parse(data) as ChatCompletionChunk;
            if (chunk.choices?.some(c => c.finish_reason != null)) sawFinishReason = true;
            yield chunk;
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } finally {
      reader.cancel().catch(() => { /* upstream already gone */ });
    }

    if (!sawFinishReason) {
      throw new Error(`${this.name} stream ended unexpectedly (no [DONE], no finish_reason) — connection reset or truncated upstream`);
    }
  }
}
