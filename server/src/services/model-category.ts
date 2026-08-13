/**
 * models.category inference — TD-027, re-derived onto v0.7.0.
 *
 * The live catalog historically never populated `models.category`, so the
 * scene router's L2 layer (category match, +2) only ever hit the rows some
 * out-of-band process had labelled `chat` / `function-calling` / `vision` /
 * `reasoning` — and, critically, `coding` / `audio` were always empty, making
 * those two scenes inert no matter how well `detectCategoryScene` mapped them
 * (see lib/scene.ts `sceneToCategory`).
 *
 * This module derives a category from the catalog metadata the DB already
 * carries (capability flags + model id/display name), so enriching the catalog
 * is a pure data/backfill operation — no new upstream field, no manual
 * labelling, no guessing. It is written in the v0.7.0 style of the model
 * modules: a small, pure, dependency-free helper the migration and the
 * catalog sync both call, so the "infer from capability + name" rule lives in
 * exactly one place. The mapping is deliberately conservative:
 *
 *   1. `supports_vision`      -> 'vision'          (explicit capability flag)
 *   2. code-tuned id/name     -> 'coding'          (qwen3-coder / codestral / …)
 *   3. audio-tuned id/name    -> 'audio'           (whisper / tts / voice / omni / …)
 *   4. reasoning-tuned id/name-> 'reasoning'       (thinking / r1 / o-series / …)
 *   5. `supports_tools`       -> 'function-calling'(explicit capability flag)
 *   6. otherwise              -> null              (STAY NULL — never invent a value)
 *
 * Order matters: an explicit capability flag outranks a name hint, and a
 * name hint outranks the generic tool-capable fallback. The final NULL escape
 * satisfies TD-027's "cannot infer -> leave NULL and count it, do not guess".
 */

/** Catalog metadata that can drive a category inference, without a DB row. */
export interface CategoryInferenceSource {
  modelId: string;
  displayName: string;
  supportsVision: boolean;
  supportsTools: boolean;
}

// Code-tuned families. Case-insensitive substring match against the
// lower-cased `model_id + display_name`. The list is deliberately narrow so a
// generic "coder" substring in unrelated names cannot hijack the category.
const CODE_HINTS = [
  'qwen3-coder',
  'qwen-coder',
  'codestral',
  'devstral',
  'coder-next',
  'coder next',
];

// Audio-capable families: transcription (whisper/stt), speech synthesis
// (tts/voice/speech), and omni-modality models (audio in + audio out).
const AUDIO_HINTS = [
  'whisper',
  'tts',
  'voice',
  'speech',
  'audio',
  'stt',
  'omni',
];

// Reasoning-tuned families. `r1` matches both `deepseek-r1` and `-r1-`;
// thinking matches kimi-k2-thinking / lfm-*-thinking; o-series (o1/o3/o4)
// covers the OpenAI reasoning family. All matched as whole tokens so a
// substring like `reasonably` can never hijack the category.
const REASONING_HINTS = [
  'thinking',
  'reasoning',
  'r1',
  'o1',
  'o3',
  'o4',
];

/**
 * Whole-token substring match (ASCII). Anchors on non-alphanumeric
 * boundaries so `reason` does not match `reasonably` and `o3` does not match
 * `foo-o3x`. This is the primitive the CJK-safe `includes` replaced in
 * lib/scene.ts only because CJK has no word boundaries; the hints here are
 * all ASCII, so `\b`-style anchoring is sound.
 */
function hasAnyHint(haystack: string, hints: string[]): boolean {
  return hints.some(hint => new RegExp(`(?:^|[^a-z0-9])${hint}(?:[^a-z0-9]|$)`).test(haystack));
}

/**
 * Infer a `models.category` value for a model from its catalog metadata.
 * Returns `null` when no signal is strong enough — callers must leave the row
 * NULL and surface the count, never fabricate a default.
 */
export function inferModelCategory(source: CategoryInferenceSource): string | null {
  if (source.supportsVision) return 'vision';

  const haystack = `${source.modelId} ${source.displayName}`.toLowerCase();

  if (hasAnyHint(haystack, CODE_HINTS)) return 'coding';
  if (hasAnyHint(haystack, AUDIO_HINTS)) return 'audio';
  if (hasAnyHint(haystack, REASONING_HINTS)) return 'reasoning';

  if (source.supportsTools) return 'function-calling';

  return null;
}
