import { describe, it, expect } from 'vitest';
import { inferModelCategory, type CategoryInferenceSource } from '../../services/model-category.js';

const src = (over: Partial<CategoryInferenceSource> = {}): CategoryInferenceSource => ({
  modelId: 'some/model',
  displayName: 'Some Model',
  supportsVision: false,
  supportsTools: false,
  ...over,
});

describe('inferModelCategory (TD-027)', () => {
  it('maps explicit vision capability before anything else', () => {
    expect(inferModelCategory(src({ supportsVision: true, supportsTools: true }))).toBe('vision');
    // A vision-capable row is vision even when the name smells like audio/code.
    expect(inferModelCategory(src({ modelId: 'qwen3-coder', supportsVision: true }))).toBe('vision');
  });

  it('maps code-tuned families to coding', () => {
    expect(inferModelCategory(src({ modelId: 'qwen/qwen3-coder:free' }))).toBe('coding');
    expect(inferModelCategory(src({ modelId: 'mistral/codestral-latest' }))).toBe('coding');
    expect(inferModelCategory(src({ modelId: 'mistral/devstral-latest' }))).toBe('coding');
    expect(inferModelCategory(src({ modelId: 'ollama/qwen3-coder:480b' }))).toBe('coding');
    // Display name alone is enough when the id is opaque.
    expect(inferModelCategory(src({ modelId: 'vendor-x/abc', displayName: 'Qwen3 Coder Next (HF)' }))).toBe('coding');
  });

  it('maps audio-capable families to audio', () => {
    expect(inferModelCategory(src({ modelId: 'whisper-large-v3' }))).toBe('audio');
    expect(inferModelCategory(src({ modelId: 'openai/whisper' }))).toBe('audio');
    expect(inferModelCategory(src({ modelId: 'tts-1' }))).toBe('audio');
    expect(inferModelCategory(src({ modelId: 'nvidia/nemotron-3-nano-omni-30b' }))).toBe('audio');
    expect(inferModelCategory(src({ modelId: 'x/voice-model' }))).toBe('audio');
  });

  it('maps reasoning-tuned families to reasoning', () => {
    expect(inferModelCategory(src({ modelId: 'deepseek-ai/deepseek-r1-distill' }))).toBe('reasoning');
    expect(inferModelCategory(src({ modelId: 'ollama/kimi-k2-thinking' }))).toBe('reasoning');
    expect(inferModelCategory(src({ modelId: 'openai/gpt-o3' }))).toBe('reasoning');
    expect(inferModelCategory(src({ modelId: 'liquid/lfm-2.5-1.2b-thinking' }))).toBe('reasoning');
  });

  it('falls back to function-calling for tool-capable rows', () => {
    expect(inferModelCategory(src({ supportsTools: true }))).toBe('function-calling');
    // Tool-capable beats nothing, but explicit hints still win over it.
    expect(inferModelCategory(src({ modelId: 'mistral/codestral-latest', supportsTools: true }))).toBe('coding');
    expect(inferModelCategory(src({ supportsVision: true, supportsTools: true }))).toBe('vision');
  });

  it('leaves un-inferable rows NULL instead of guessing a default', () => {
    expect(inferModelCategory(src())).toBeNull();
    expect(inferModelCategory(src({ modelId: 'gemma-4-26b', supportsTools: false }))).toBeNull();
    expect(inferModelCategory(src({ modelId: '', displayName: '' }))).toBeNull();
  });

  it('is case-insensitive on ids and display names', () => {
    expect(inferModelCategory(src({ modelId: 'Mistral/CodeStral-Latest' }))).toBe('coding');
    expect(inferModelCategory(src({ modelId: 'WHISPER-v3' }))).toBe('audio');
    expect(inferModelCategory(src({ displayName: 'KIMI K2 THINKING' }))).toBe('reasoning');
  });

  it('never matches a bare substring of a generic word', () => {
    // 'coder' is only matched as a family hint token, not inside arbitrary ids.
    expect(inferModelCategory(src({ modelId: 'recorder-3000' }))).toBeNull();
    expect(inferModelCategory(src({ modelId: 'reasonably-priced' }))).toBeNull();
  });
});
