import { z } from 'zod';

/**
 * Shared Zod schemas for OpenAI-compatible API validation.
 *
 * Previously scattered inside proxy.ts — extracted here so both the
 * requestValidator middleware and the handler (after middleware refactoring)
 * can import from a single source of truth.
 */

// ── Content blocks ────────────────────────────────────────────────────────

// Flexible content blocks: accept any object (not just ones with a type field).
// This covers Gemini-lineage agents that send { text } without type, and
// OpenAI-style blocks like { type: 'text', text }. (#200)
const contentBlockSchema = z.record(z.string(), z.unknown());
export const contentSchema = z.union([z.string(), z.array(contentBlockSchema)]);

// ── Messages ─────────────────────────────────────────────────────────────

// Echo-tolerant tool calls: agents replay OUR responses and not all preserve
// strict OpenAI shape. `type` may be dropped (re-added on forward), Gemini-lineage
// agents send `arguments` as an object (not JSON string), and `id` may be
// missing or empty. (#200)
const toolCallSchema = z.object({
  id: z.string().optional(),
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string().min(1),
    arguments: z.union([z.string(), z.record(z.string(), z.unknown())]),
  }),
  thought_signature: z.string().optional(),
});

const systemMessageSchema = z.object({
  role: z.literal('system'),
  content: contentSchema,
  name: z.string().optional(),
});

const userMessageSchema = z.object({
  role: z.literal('user'),
  content: contentSchema,
  name: z.string().optional(),
});

// Assistant turns may carry empty/null content — OpenAI accepts these in
// conversation history. We accept them too and coerce empty/null content to
// "" before forwarding. (#165)
// Assistant tool_calls may be null (aionrs/AionUI session replay) — coerced
// to absent on forward. Also accept reasoning_content echoed back by clients. (#200)
const assistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.union([contentSchema, z.null()]).optional(),
  name: z.string().optional(),
  tool_calls: z.array(toolCallSchema).nullable().optional(),
  reasoning_content: z.string().nullable().optional(),
});

// Developer role is OpenAI's newer name for the system prompt — accept and
// forward as "system" downstream. (#200)
const developerMessageSchema = z.object({
  role: z.literal('developer'),
  content: contentSchema,
  name: z.string().optional(),
});

// Legacy function-calling result — forwarded as a tool message. (#200)
const functionMessageSchema = z.object({
  role: z.literal('function'),
  name: z.string().min(1),
  content: z.union([contentSchema, z.null()]).optional(),
});

// Tool results may arrive with null/missing content and a missing/empty
// tool_call_id (Gemini-lineage agents) — coerced to "" and paired by order. (#200)
const toolMessageSchema = z.object({
  role: z.literal('tool'),
  content: z.union([contentSchema, z.null()]).optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});

// ── Tools ────────────────────────────────────────────────────────────────

// Tool definitions may omit type (agents default it to 'function'). (#200)
const toolDefinitionSchema = z.object({
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required', 'any']),
  z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string().min(1),
    }),
  }),
]);

// ── Top-level request ────────────────────────────────────────────────────

export const chatCompletionSchema = z.object({
  messages: z.array(z.union([
    systemMessageSchema,
    developerMessageSchema,
    userMessageSchema,
    assistantMessageSchema,
    toolMessageSchema,
    functionMessageSchema,
  ])).min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  tools: z.array(toolDefinitionSchema).nullable().optional(),
  tool_choice: toolChoiceSchema.nullable().optional(),
  parallel_tool_calls: z.boolean().nullable().optional(),
});

// ── Embeddings request ───────────────────────────────────────────────────

export const embeddingsBody = z.object({
  model: z.string().optional(),
  input: z.union([z.string(), z.array(z.string())]),
});

// ── Fusion config ──────────────────────────────────────────────────────────

const fusionConfigSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().optional(),
  top_p: z.number().min(0).max(1).optional(),
  // The "panel" and "judge" sub-models (optional — default to auto-pick).
  panel: z.record(z.string(), z.unknown()).optional(),
  judge: z.record(z.string(), z.unknown()).optional(),
});

// Add fusion field to chat completion schema (imported by proxy.ts handler).
// This must stay in sync with the handler's schema or the middleware will 400 first.
export const chatCompletionSchemaWithFusion = chatCompletionSchema.and(
  z.object({ fusion: fusionConfigSchema.optional() })
);
