import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '@freellmapi/shared/types.js';
import { BaseProvider, providerHttpError, type CompletionOptions } from './base.js';
import { flattenMessageContent } from '../lib/content.js';

const API_BASE = 'https://api.cohere.ai/compatibility/v1';

export class CohereProvider extends BaseProvider {
  readonly platform = 'cohere' as const;
  readonly name = 'Cohere';

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse> {
    // Build body defensively: skip null/undefined values to avoid sending
    // null primitives to strict providers
    const body: Record<string, unknown> = {
      model: modelId,
      messages: flattenMessageContent(messages),
    };
    if (options?.temperature != null) body.temperature = options.temperature;
    if (options?.max_tokens != null) body.max_tokens = options.max_tokens;
    if (options?.top_p != null) body.top_p = options.top_p;
    if (options?.tools != null && options.tools.length > 0) body.tools = options.tools;
    if (options?.tool_choice != null) body.tool_choice = options.tool_choice;

    const res = await this.fetchWithTimeout(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw providerHttpError(res, `Cohere API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const data = await res.json() as ChatCompletionResponse;
    data._routed_via = { platform: 'cohere', model: modelId };
    return data;
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk> {
    const body: Record<string, unknown> = {
      model: modelId,
      messages: flattenMessageContent(messages),
      stream: true,
    };
    if (options?.temperature != null) body.temperature = options.temperature;
    if (options?.max_tokens != null) body.max_tokens = options.max_tokens;
    if (options?.top_p != null) body.top_p = options.top_p;
    if (options?.tools != null && options.tools.length > 0) body.tools = options.tools;
    if (options?.tool_choice != null) body.tool_choice = options.tool_choice;

    const res = await this.fetchWithTimeout(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw providerHttpError(res, `Cohere API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    yield* this.readSseStream(res);
  }

  async validateKey(apiKey: string): Promise<boolean> {
    // Transport errors propagate — health.ts marks status='error' without
    // counting toward auto-disable. Only confirmed 401/403 disables a key.
    const res = await this.fetchWithTimeout(`${API_BASE}/models`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }, 10000);
    return res.status !== 401 && res.status !== 403;
  }
}
