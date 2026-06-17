import type { Response } from 'express';
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolDefinition,
  ChatToolChoice,
} from '@freellmapi/shared/types.js';
import type { RouteResult } from '../services/router.js';
import { recordSuccess } from '../services/router.js';
import {
  recordTokens,
  setCooldown,
  getCooldownDurationForLimit,
} from '../services/ratelimit.js';
import { setStickyModel } from './sticky-session.js';
import { contentToString, normalizeOutboundContent } from '../lib/content.js';
import { repairToolArguments, toolSchemaMap } from '../lib/tool-args.js';

/**
 * Shared streaming handler for OpenAI-compatible /v1/chat/completions.
 * Writes SSE chunks directly to the response.
 */
export async function handleStreamRoute(
  res: Response,
  route: RouteResult,
  messages: ChatMessage[],
  modelId: string,
  opts: { temperature?: number; max_tokens?: number; top_p?: number; tools?: ChatToolDefinition[]; tool_choice?: ChatToolChoice; parallel_tool_calls?: boolean },
  ctx: {
    start: number;
    estimatedInputTokens: number;
    attempt: number;
    recordTokens: typeof recordTokens;
    recordSuccess: typeof recordSuccess;
    setStickyModel: typeof setStickyModel;
    setCooldown: typeof import('../services/ratelimit.js').setCooldown;
    isRetryableError: (err: any) => boolean;
    isPaymentRequiredError: (err: any) => boolean;
    logRequest: (platform: string, modelId: string, keyId: number, status: string, inputTokens: number, outputTokens: number, latencyMs: number, error: string | null) => void;
    getCooldownDurationForLimit: typeof import('../services/ratelimit.js').getCooldownDurationForLimit;
    getEstimatedInputTokens: typeof import('./proxy.js').getEstimatedInputTokens;
  },
): Promise<void> {
  const { start, estimatedInputTokens, attempt, recordTokens: rt, recordSuccess: rs, setStickyModel: ssm,
    setCooldown: sc, isRetryableError: ire, isPaymentRequiredError: ipre, logRequest: lr,
    getCooldownDurationForLimit: gcdfl, getEstimatedInputTokens: geteit } = ctx;

  const gen = route.provider.streamChatCompletion(route.apiKey, messages, modelId, {
    temperature: opts.temperature,
    max_tokens: opts.max_tokens,
    top_p: opts.top_p,
    tools: opts.tools,
    tool_choice: opts.tool_choice,
    parallel_tool_calls: opts.parallel_tool_calls,
  });

  let outputIndex = 0;
  let msgItemId: string | null = null;
  let msgText = '';
  const toolAcc = new Map<number, { outputIndex: number; itemId: string; callId: string; name: string; args: string }>();
  let totalOutputTokens = 0;
  let streamStarted = false;

  const sse = (event: string, payload: Record<string, unknown>) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  for await (const chunk of gen) {
    if (!streamStarted) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
      if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
      const skeleton = {
        id: `chatcmpl-${Date.now()}`, object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000), model: modelId,
      };
      sse('stream_start', skeleton);
      streamStarted = true;
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    const text = delta.content ?? '';
    if (text) {
      if (msgItemId === null) {
        msgItemId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        sse('text_delta', { item_id: msgItemId, delta: text });
      }
      msgText += text;
      totalOutputTokens += Math.ceil(text.length / 4);
    }

    for (const tc of delta.tool_calls ?? []) {
      const idx = (tc as any).index ?? 0;
      let acc = toolAcc.get(idx);
      if (!acc) {
        if (msgItemId !== null && msgText.length > 0) {
          sse('finalize_text', { item_id: msgItemId });
          msgItemId = null;
        }
        outputIndex = toolAcc.size + (msgText.length > 0 ? 1 : 0);
        acc = { outputIndex, itemId: `fc_${Date.now()}`, callId: tc.id || `call_${Date.now()}`, name: tc.function?.name ?? '', args: '' };
        toolAcc.set(idx, acc);
      }
      const argFrag = tc.function?.arguments ?? '';
      if (tc.function?.name && !acc.name) acc.name = tc.function.name;
      if (argFrag) {
        acc.args += argFrag;
        sse('tool_arg_delta', { item_id: acc.itemId, delta: argFrag });
      }
    }
  }

  if (msgText.length === 0 && toolAcc.size === 0) {
    lr(route.platform, route.modelId, route.keyId, 'error', estimatedInputTokens, 0, Date.now() - start, 'empty completion');
    res.end();
    throw new Error(`empty completion from ${route.displayName}`);
  }

  if (msgItemId !== null) {
    sse('finalize_text', { item_id: msgItemId });
  }

  const finalToolCalls: ChatToolCall[] = [];
  for (const acc of toolAcc.values()) {
    const repairedArgs = repairToolArguments(acc.args, toolSchemaMap(opts.tools ?? []).get(acc.name));
    sse('finalize_tool', { item_id: acc.itemId, name: acc.name, arguments: repairedArgs });
    finalToolCalls.push({ id: acc.callId, type: 'function', function: { name: acc.name, arguments: repairedArgs } });
  }

  sse('done', { output_text: msgText });
  res.end();

  rt(route.platform, route.modelId, route.keyId, estimatedInputTokens + totalOutputTokens);
  rs(route.modelDbId);
  ssm(messages, route.modelDbId);
  lr(route.platform, route.modelId, route.keyId, 'success', estimatedInputTokens, totalOutputTokens, Date.now() - start, null);
}

/**
 * Shared non-streaming handler for OpenAI-compatible /v1/chat/completions.
 * Returns a complete JSON response.
 */
export async function handleNonStreamRoute(
  res: Response,
  route: RouteResult,
  messages: ChatMessage[],
  modelId: string,
  opts: { temperature?: number; max_tokens?: number; top_p?: number; tools?: ChatToolDefinition[]; tool_choice?: ChatToolChoice; parallel_tool_calls?: boolean },
  ctx: {
    start: number;
    attempt: number;
    logRequest: typeof import('./proxy.js').logRequest;
    recordTokens: typeof recordTokens;
    recordSuccess: typeof recordSuccess;
    setStickyModel: typeof setStickyModel;
    repairToolArguments: typeof repairToolArguments;
    toolSchemaMap: typeof toolSchemaMap;
    normalizeOutboundContent: typeof normalizeOutboundContent;
    contentToString: typeof contentToString;
  },
): Promise<void> {
  const { start, attempt, logRequest: lr, recordTokens: rt, recordSuccess: rs, setStickyModel: ssm,
    repairToolArguments: rta, toolSchemaMap: tsm,
    normalizeOutboundContent: nob, contentToString: cts } = ctx;

  const result = await route.provider.chatCompletion(route.apiKey, messages, modelId, {
    temperature: opts.temperature,
    max_tokens: opts.max_tokens,
    top_p: opts.top_p,
    tools: opts.tools,
    tool_choice: opts.tool_choice,
    parallel_tool_calls: opts.parallel_tool_calls,
  });

  const msg = result.choices[0]?.message;
  let text = cts(msg?.content ?? '');
  text = nob(text);
  const toolCalls = (msg?.tool_calls ?? []).map((tc) => ({
    ...tc,
    function: { ...tc.function, arguments: rta(tc.function.arguments, tsm(opts.tools ?? []).get(tc.function.name)) },
  }));
  const promptTokens = result.usage?.prompt_tokens ?? 0;
  const completionTokens = result.usage?.completion_tokens ?? Math.ceil(text.length / 4);

  if (!text && toolCalls.length === 0) {
    lr(route.platform, route.modelId, route.keyId, 'error', 0, 0, Date.now() - start, 'empty completion');
    throw new Error(`empty completion from ${route.displayName}`);
  }

  rt(route.platform, route.modelId, route.keyId, result.usage?.total_tokens ?? 0);
  rs(route.modelDbId);
  ssm(messages, route.modelDbId);

  res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
  if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
  res.json({
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text, tool_calls: toolCalls.length > 0 ? toolCalls : undefined },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  });

  lr(route.platform, route.modelId, route.keyId, 'success', promptTokens, completionTokens, Date.now() - start, null);
}
