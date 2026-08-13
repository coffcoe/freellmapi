import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  detectCategoryScene, detectSceneTags, detectScene, normalizeNetworkTier, isEmptyScene,
  type SceneSignal,
} from '../../lib/scene.js';
import {
  routeRequest, setRoutingStrategy, sceneBiasScore, parseModelTags, loadSceneAttrs,
  type ChainRow, type ModelSceneAttrs,
} from '../../services/router.js';
import * as ratelimit from '../../services/ratelimit.js';
import { getDb, initDb } from '../../db/index.js';

vi.mock('../../services/ratelimit.js', async () => {
  const actual = await vi.importActual('../../services/ratelimit.js');
  return {
    ...actual,
    canMakeRequest: vi.fn(() => true),
    canUseTokens: vi.fn(() => true),
    isOnCooldown: vi.fn(() => false),
  };
});

vi.mock('../../lib/crypto.js', async () => {
  const actual = await vi.importActual('../../lib/crypto.js');
  return { ...actual, decrypt: vi.fn(() => 'mocked-api-key') };
});

const msg = (text: string) => ({ role: 'user' as const, content: text });

// ─────────────────────────── L0: detection (pure) ───────────────────────────

describe('scene detection', () => {
  it('declared tool use short-circuits to the agent scene', () => {
    expect(detectCategoryScene([msg('hello')], true)).toBe('agent');
  });

  it('detects multimodal blocks before any keyword', () => {
    const withImage = [{ role: 'user' as const, content: [{ type: 'image_url', image_url: { url: 'x' } }] as any }];
    const withAudio = [{ role: 'user' as const, content: [{ type: 'input_audio' }] as any }];
    expect(detectCategoryScene(withImage, false)).toBe('vision');
    expect(detectCategoryScene(withAudio, false)).toBe('audio');
  });

  it('detects coding only when a verb AND a code noun co-occur', () => {
    expect(detectCategoryScene([msg('implement a function that sorts')], false)).toBe('coding');
    // "fix" alone is not enough — avoids hijacking every bug report.
    expect(detectCategoryScene([msg('please fix my flight booking')], false)).toBeNull();
  });

  it('detects the remaining English scenes', () => {
    expect(detectCategoryScene([msg('summarize this long document')], false)).toBe('long-context');
    expect(detectCategoryScene([msg('build an autonomous agent')], false)).toBe('agent');
    expect(detectCategoryScene([msg('reason about this proof')], false)).toBe('reasoning');
    expect(detectCategoryScene([msg('I need a fast reply')], false)).toBe('speed');
    expect(detectCategoryScene([msg('must be china domestic')], false)).toBe('compliance');
  });

  it('returns null when nothing matches', () => {
    expect(detectCategoryScene([msg('hello there')], false)).toBeNull();
    expect(detectCategoryScene([], false)).toBeNull();
  });

  // Regression: the pre-refactor implementation wrapped the Chinese cues in
  // /\b(...)\b/. JS word boundaries are defined over [A-Za-z0-9_], so that
  // alternation could never fire and every CJK prompt fell through.
  it('detects Chinese cues (regression: \\b never matches CJK)', () => {
    expect(detectCategoryScene([msg('帮我写代码')], false)).toBe('coding');
    expect(detectCategoryScene([msg('帮我读这篇论文')], false)).toBe('long-context');
    expect(detectCategoryScene([msg('做一个智能体')], false)).toBe('agent');
    expect(detectCategoryScene([msg('请做逻辑分析')], false)).toBe('reasoning');
    expect(detectCategoryScene([msg('需要低延迟')], false)).toBe('speed');
    expect(detectCategoryScene([msg('必须数据不出境')], false)).toBe('compliance');
  });

  it('walks nested content blocks and later messages', () => {
    const messages = [
      msg('hi'),
      { role: 'user' as const, content: [{ type: 'text', text: 'refactor this class' }] as any },
    ];
    expect(detectCategoryScene(messages, false)).toBe('coding');
  });
});

describe('scene tags', () => {
  it('collects every matching L3 tag, de-duplicated', () => {
    const tags = detectSceneTags([msg('a fast free answer about this long document, china domestic'), msg('quick')]);
    expect(new Set(tags)).toEqual(new Set(['low-latency', 'long-context', 'compliance', 'free-tier']));
    expect(tags.length).toBe(4);
  });

  it('collects Chinese tags', () => {
    expect(detectSceneTags([msg('要免费的，低延迟')])).toEqual(
      expect.arrayContaining(['free-tier', 'low-latency']),
    );
  });

  it('returns nothing for a neutral prompt', () => {
    expect(detectSceneTags([msg('hello there')])).toEqual([]);
  });
});

describe('detectScene / helpers', () => {
  it('maps the agent scene onto the function-calling category', () => {
    expect(detectScene([msg('hi')], true).category).toBe('function-calling');
  });

  it('leaves scenes with no DB category unmapped', () => {
    // 'speed' / 'compliance' / 'long-context' are tag-only signals.
    expect(detectScene([msg('I need a fast reply')], false).category).toBeNull();
  });

  it('normalizes the X-Network-Tier header and drops unknown values', () => {
    expect(normalizeNetworkTier('Domestic')).toBe('domestic');
    expect(normalizeNetworkTier([' PROXY '])).toBe('proxy');
    expect(normalizeNetworkTier('global')).toBe('global');
    expect(normalizeNetworkTier('lan')).toBeNull();
    expect(normalizeNetworkTier(undefined)).toBeNull();
  });

  it('flags a signal the router cannot act on', () => {
    expect(isEmptyScene({ category: null, tags: [], networkTier: null })).toBe(true);
    expect(isEmptyScene({ category: null, tags: ['free-tier'], networkTier: null })).toBe(false);
  });
});

// ───────────────────── L1/L2/L3: bias scoring (pure) ─────────────────────

const chainEntry = (id: number, priority = 1): ChainRow => ({
  model_db_id: id, priority, enabled: 1,
  platform: 'p', model_id: `m${id}`, display_name: `M${id}`,
  intelligence_rank: 1, size_label: 'Medium', monthly_token_budget: '0',
  rpm_limit: null, rpd_limit: null, tpm_limit: null, tpd_limit: null,
  supports_vision: 0, supports_tools: 0, context_window: 8000, key_id: null,
});

const attrsOf = (a: Partial<ModelSceneAttrs>): Map<number, ModelSceneAttrs> =>
  new Map([[1, { category: null, networkTier: null, tags: [], ...a }]]);

const sceneOf = (s: Partial<SceneSignal>): SceneSignal =>
  ({ category: null, tags: [], networkTier: null, ...s });

describe('parseModelTags', () => {
  // The live catalog carries three incompatible shapes; the pre-refactor
  // JSON.parse-or-[] made shapes 2 and 3 silently contribute nothing.
  it('parses a JSON array of strings', () => {
    expect(parseModelTags('["free-tier", "long-context"]')).toEqual(['free-tier', 'long-context']);
  });

  it('parses a bare CSV string (regression: used to throw and yield [])', () => {
    expect(parseModelTags('free-tier,long-context')).toEqual(['free-tier', 'long-context']);
    expect(parseModelTags('low-latency, compliance ')).toEqual(['low-latency', 'compliance']);
  });

  it('drops non-string members of an object array instead of yielding junk', () => {
    expect(parseModelTags('[{"platform_policy":"x"}]')).toEqual([]);
    expect(parseModelTags('["free-tier", {"platform_policy":"x"}]')).toEqual(['free-tier']);
  });

  it('never throws on null / empty / malformed input', () => {
    expect(parseModelTags(null)).toEqual([]);
    expect(parseModelTags('')).toEqual([]);
    expect(parseModelTags('   ')).toEqual([]);
    expect(parseModelTags('[not json')).toEqual([]);
    expect(parseModelTags(42)).toEqual([]);
  });
});

describe('sceneBiasScore', () => {
  const e = chainEntry(1);

  it('is zero without a scene or without attributes', () => {
    expect(sceneBiasScore(e, undefined, attrsOf({ category: 'coding' }))).toBe(0);
    expect(sceneBiasScore(e, sceneOf({ category: 'coding' }), undefined)).toBe(0);
    expect(sceneBiasScore(e, sceneOf({ category: 'coding' }), new Map())).toBe(0);
  });

  it('weights network tier (L1) above category (L2) above tags (L3)', () => {
    expect(sceneBiasScore(e, sceneOf({ networkTier: 'domestic' }), attrsOf({ networkTier: 'domestic' }))).toBe(4);
    expect(sceneBiasScore(e, sceneOf({ category: 'coding' }), attrsOf({ category: 'coding' }))).toBe(2);
    expect(sceneBiasScore(e, sceneOf({ tags: ['free-tier'] }), attrsOf({ tags: ['free-tier'] }))).toBe(1);
  });

  it('adds one point per matching tag and ignores unmatched ones', () => {
    const scene = sceneOf({ tags: ['free-tier', 'long-context', 'compliance'] });
    expect(sceneBiasScore(e, scene, attrsOf({ tags: ['free-tier', 'long-context'] }))).toBe(2);
  });

  it('accumulates all three layers', () => {
    const scene = sceneOf({ networkTier: 'domestic', category: 'reasoning', tags: ['free-tier'] });
    const attrs = attrsOf({ networkTier: 'domestic', category: 'reasoning', tags: ['free-tier'] });
    expect(sceneBiasScore(e, scene, attrs)).toBe(7);
  });

  it('scores zero when the scene and the model disagree', () => {
    const scene = sceneOf({ networkTier: 'domestic', category: 'coding', tags: ['free-tier'] });
    const attrs = attrsOf({ networkTier: 'global', category: 'vision', tags: ['long-context'] });
    expect(sceneBiasScore(e, scene, attrs)).toBe(0);
  });
});

// ───────────────────── End-to-end through routeRequest ─────────────────────

const ORIGINAL_DEV_MODE = process.env.DEV_MODE;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function addModel(opts: {
  platform: string; modelId: string; priority: number;
  category?: string | null; networkTier?: string | null; tags?: string | null;
}): number {
  const db = getDb();
  db.prepare(`
    INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank,
                        size_label, monthly_token_budget, enabled, category, network_tier, tags)
    VALUES (?, ?, ?, 1, 1, 'Medium', '0', 1, ?, ?, ?)
  `).run(opts.platform, opts.modelId, opts.modelId,
    opts.category ?? null, opts.networkTier ?? null, opts.tags ?? null);
  const id = (db.prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?')
    .get(opts.platform, opts.modelId) as { id: number }).id;
  db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)')
    .run(id, opts.priority);
  db.prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, 'k', 'enc', 'iv', 'tag', 'healthy', 1)
  `).run(opts.platform);
  return id;
}

describe('scene routing end to end (priority strategy)', () => {
  beforeEach(() => {
    process.env.DEV_MODE = 'true';
    process.env.NODE_ENV = 'test';
    initDb(':memory:');
    getDb().exec('DELETE FROM fallback_config; DELETE FROM api_keys; DELETE FROM models; DELETE FROM requests;');
    vi.clearAllMocks();
    (ratelimit.canMakeRequest as any).mockReturnValue(true);
    (ratelimit.canUseTokens as any).mockReturnValue(true);
    (ratelimit.isOnCooldown as any).mockReturnValue(false);
    setRoutingStrategy('priority');
  });

  afterEach(() => {
    if (ORIGINAL_DEV_MODE === undefined) delete process.env.DEV_MODE; else process.env.DEV_MODE = ORIGINAL_DEV_MODE;
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it('the migration declares network_tier and tags on models', () => {
    const cols = (getDb().prepare('PRAGMA table_info(models)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('network_tier');
    expect(cols).toContain('tags');
  });

  it('keeps plain priority order when no scene is supplied', () => {
    addModel({ platform: 'google', modelId: 'first', priority: 1 });
    addModel({ platform: 'groq', modelId: 'second', priority: 2, category: 'reasoning' });
    expect(routeRequest(100).modelId).toBe('first');
  });

  // Regression: priority mode sorts ASCENDING (lower wins), so the bias must be
  // subtracted. Adding it demoted exactly the models the scene preferred.
  it('promotes a category match over a better raw priority', () => {
    addModel({ platform: 'google', modelId: 'first', priority: 1 });
    addModel({ platform: 'groq', modelId: 'second', priority: 2, category: 'reasoning' });
    const scene = detectScene([msg('reason about this proof')], false);
    expect(scene.category).toBe('reasoning');
    expect(routeRequest(100, undefined, undefined, false, false, undefined, undefined, false, undefined, scene).modelId)
      .toBe('second');
  });

  it('lets a network-tier match (+4) outrank a category match (+2)', () => {
    addModel({ platform: 'google', modelId: 'by-category', priority: 1, category: 'reasoning' });
    addModel({ platform: 'groq', modelId: 'by-tier', priority: 2, networkTier: 'domestic' });
    const scene: SceneSignal = { category: 'reasoning', tags: [], networkTier: 'domestic' };
    // by-category: 1 - 2 = -1 ; by-tier: 2 - 4 = -2 → by-tier wins.
    expect(routeRequest(100, undefined, undefined, false, false, undefined, undefined, false, undefined, scene).modelId)
      .toBe('by-tier');
  });

  it('honours CSV-shaped tags, which used to be silently ignored', () => {
    addModel({ platform: 'google', modelId: 'first', priority: 1 });
    // Two matching tags = -2, so priority 2 beats priority 1 (2-2 = 0 < 1).
    addModel({ platform: 'groq', modelId: 'second', priority: 2, tags: 'free-tier,long-context' });
    const scene: SceneSignal = { category: null, tags: ['free-tier', 'long-context'], networkTier: null };
    expect(routeRequest(100, undefined, undefined, false, false, undefined, undefined, false, undefined, scene).modelId)
      .toBe('second');
  });

  it('loads scene attributes straight from the models table', () => {
    const id = addModel({
      platform: 'groq', modelId: 'm', priority: 1,
      category: 'vision', networkTier: 'proxy', tags: '["free-tier"]',
    });
    const attrs = loadSceneAttrs(getDb(), [chainEntry(id)]);
    expect(attrs.get(id)).toEqual({ category: 'vision', networkTier: 'proxy', tags: ['free-tier'] });
  });

  it('never lets the bias drop a model out of the chain', () => {
    addModel({ platform: 'google', modelId: 'only', priority: 1 });
    const scene: SceneSignal = { category: 'vision', tags: ['free-tier'], networkTier: 'domestic' };
    expect(routeRequest(100, undefined, undefined, false, false, undefined, undefined, false, undefined, scene).modelId)
      .toBe('only');
  });
});
