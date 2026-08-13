/**
 * Scene detection — re-derived business logic, rewritten for the v0.7.0
 * architecture.
 *
 * The v0.7.0 router scores models with a convex bandit combination and exposes
 * a per-model preference hook (`scoreChainEntry`). This module is the
 * *detection* half and is deliberately pure — no DB, no request object — so it
 * is cheap to unit-test. The *scoring* half lives in `services/router.ts`
 * (`sceneBiasScore`), folded into the existing chain scoring exactly like the
 * upstream's model-weight overrides.
 *
 * Three layers, same weights as the original:
 *   L1  network_tier match (from the `X-Network-Tier` header)  +4
 *   L2  category match     (models.category)                   +2
 *   L3  tag match          (models.tags)                       +1 each
 */
import type { ChatMessage } from '@freellmapi/shared/types.js';

export interface SceneSignal {
  /** Mapped DB category for a strong single-match soft preference (+2). */
  category: string | null;
  /** L3 tags: free-tier / long-context / low-latency / compliance (+1 each). */
  tags: string[];
  /** L1 network tier from the X-Network-Tier header (+4). */
  networkTier: string | null;
}

type Block = { type?: string; text?: string };

/** Flatten a message's content (string | block[] | object) into typed blocks. */
function extractBlocks(content: unknown): Block[] {
  if (content == null) return [];
  if (typeof content === 'string') return [{ text: content }];
  if (Array.isArray(content)) {
    return content.map((b): Block => {
      if (typeof b === 'string') return { text: b };
      if (b && typeof b === 'object') {
        const o = b as Record<string, unknown>;
        return {
          type: typeof o.type === 'string' ? o.type : undefined,
          text: typeof o.text === 'string' ? o.text : undefined,
        };
      }
      return {};
    });
  }
  if (typeof content === 'object') {
    const o = content as Record<string, unknown>;
    return [{
      type: typeof o.type === 'string' ? o.type : undefined,
      text: typeof o.text === 'string' ? o.text : undefined,
    }];
  }
  return [];
}

/**
 * Chinese cue lists. Kept out of the regexes on purpose: JS `\b` is defined
 * over [A-Za-z0-9_], so a `\b`-anchored alternation of CJK terms silently
 * never matches — a latent bug in the pre-refactor implementation.
 * `includes()` is the correct primitive for CJK.
 */
const CJK_CODING = ['编程', '写代码', '实现算法', '重构'];
const CJK_LONG_CONTEXT = ['长文档', '论文', '学位论文', '书籍', '手稿', '上下文窗口', '上下文'];
const CJK_AGENT = ['自主', '工具调用', '智能体'];
const CJK_REASONING = ['推理', '逻辑分析'];
const CJK_LOW_LATENCY = ['快速', '低延迟', '实时'];
const CJK_COMPLIANCE = ['国内', '合规', '数据不出境', '境内'];
const CJK_FREE = ['免费'];

const RE_CODING_VERB = /\b(write|implement|refactor|debug|fix)\b/;
const RE_CODING_NOUN = /\b(code|function|class|method|module)\b/;
const RE_LONG_CONTEXT = /\b(long document|paper|thesis|dissertation|book|manuscript|100k|200k|1m)\b/;
const RE_AGENT = /\b(agent|autonomous|self-driving|tool use|function call)\b/;
const RE_REASONING = /\b(reason about|analyze|deduce|why.*happen|explain.*mechanism)\b/;
const RE_LOW_LATENCY = /\b(fast|low latency|realtime|real-time|quick|speedy)\b/;
const RE_COMPLIANCE = /\b(china|domestic|compliant|data residency|sovereignty)\b/;
const RE_FREE = /\b(free|free tier)\b/;

const hasAny = (t: string, cues: string[]) => cues.some(c => t.includes(c));

/**
 * Map a detected scene to an actual DB model category.
 *
 * NOTE: the live catalog currently only carries `chat` / `function-calling` /
 * `vision` / `reasoning` (and NULLs), so the `coding` and `audio` scenes are
 * inert until models are labelled with those categories. That is a *data* gap,
 * not a logic gap — the mapping is kept so enriching the catalog (see
 * services/model-category.ts) is enough to activate them.
 */
function sceneToCategory(scene: string): string | null {
  const map: Record<string, string> = {
    coding: 'coding',
    vision: 'vision',
    audio: 'audio',
    reasoning: 'reasoning',
    agent: 'function-calling',
  };
  return map[scene] || null;
}

/**
 * Detect the dominant scene from message content. Multimodal beats everything;
 * declared tool use implies agent; then code / long-context / agent /
 * reasoning / speed / compliance by keyword (EN + ZH). First match wins.
 */
export function detectCategoryScene(messages: ChatMessage[], hasTools: boolean): string | null {
  if (hasTools) return 'agent';
  for (const msg of messages) {
    for (const b of extractBlocks(msg.content)) {
      if (b.type === 'image_url' || b.type === 'image') return 'vision';
      if (b.type === 'input_audio') return 'audio';
      const t = (b.text ?? '').toLowerCase();
      if (!t) continue;

      if ((RE_CODING_VERB.test(t) && RE_CODING_NOUN.test(t)) || hasAny(t, CJK_CODING)) return 'coding';
      if (RE_LONG_CONTEXT.test(t) || hasAny(t, CJK_LONG_CONTEXT)) return 'long-context';
      if (RE_AGENT.test(t) || hasAny(t, CJK_AGENT)) return 'agent';
      if (RE_REASONING.test(t) || hasAny(t, CJK_REASONING)) return 'reasoning';
      if (RE_LOW_LATENCY.test(t) || hasAny(t, CJK_LOW_LATENCY)) return 'speed';
      if (RE_COMPLIANCE.test(t) || hasAny(t, CJK_COMPLIANCE)) return 'compliance';
    }
  }
  return null;
}

/** Detect L3 scene tags: low-latency / long-context / compliance / free-tier. */
export function detectSceneTags(messages: ChatMessage[]): string[] {
  const tags = new Set<string>();
  for (const msg of messages) {
    for (const b of extractBlocks(msg.content)) {
      const t = (b.text ?? '').toLowerCase();
      if (!t) continue;
      if (RE_LOW_LATENCY.test(t) || hasAny(t, CJK_LOW_LATENCY)) tags.add('low-latency');
      if (RE_LONG_CONTEXT.test(t) || hasAny(t, CJK_LONG_CONTEXT)) tags.add('long-context');
      if (RE_COMPLIANCE.test(t) || hasAny(t, CJK_COMPLIANCE)) tags.add('compliance');
      if (RE_FREE.test(t) || hasAny(t, CJK_FREE)) tags.add('free-tier');
    }
  }
  return [...tags];
}

/** Normalize a raw `X-Network-Tier` header value; unknown tiers are dropped. */
export function normalizeNetworkTier(raw: unknown): string | null {
  const v = (Array.isArray(raw) ? raw[0] : raw);
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  return t === 'domestic' || t === 'proxy' || t === 'global' ? t : null;
}

/** True when the signal carries nothing the router could act on. */
export function isEmptyScene(s: SceneSignal): boolean {
  return !s.category && s.tags.length === 0 && !s.networkTier;
}

/** Pure scene detection from a request's messages + optional network tier. */
export function detectScene(
  messages: ChatMessage[],
  hasTools: boolean,
  networkTier: string | null = null,
): SceneSignal {
  return {
    category: sceneToCategory(detectCategoryScene(messages, hasTools) ?? ''),
    tags: detectSceneTags(messages),
    networkTier,
  };
}
