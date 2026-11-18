import { z } from "zod";

/**
 * Event types seen in Claude Code 2.1.x session logs. Lines with any other type are counted as
 * unknown so the office can warn when the log format changes.
 */
export const KNOWN_EVENT_TYPES = new Set([
  "user",
  "assistant",
  "system",
  "summary",
  "attachment",
  "queue-operation",
  "atis-latch",
  "api-request-shape",
  "api-request-blob",
  "api-request",
  "last-prompt",
  "cost-state",
  "file-history-snapshot",
  "file-history-delta",
  "custom-title",
  "ai-title",
  "agent-name",
  "tools-used",
  "mode",
  "bridge-session",
  "permission-mode",
  "relocated",
  "continued-in",
  "agent-setting",
  "artifact-comment-monitor",
  "artifact-autoreact-ledger",
  "frame-link",
]);

export const baseLineSchema = z.looseObject({
  type: z.string(),
  timestamp: z.string().optional(),
  cwd: z.string().optional(),
});

const usageSchema = z.looseObject({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
});

const looseBlockSchema = z.looseObject({ type: z.string() });

export const toolUseBlockSchema = z.looseObject({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
});

export const toolResultBlockSchema = z.looseObject({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.unknown().optional(),
  is_error: z.boolean().optional(),
});

export const textBlockSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
});

export const assistantLineSchema = z.looseObject({
  type: z.literal("assistant"),
  timestamp: z.string().optional(),
  message: z.looseObject({
    id: z.string().optional(),
    model: z.string().optional(),
    content: z.array(looseBlockSchema),
    usage: usageSchema.optional(),
  }),
});

export const userLineSchema = z.looseObject({
  type: z.literal("user"),
  timestamp: z.string().optional(),
  isMeta: z.boolean().optional(),
  message: z.looseObject({
    content: z.union([z.string(), z.array(looseBlockSchema)]),
  }),
});

export const titleLineSchema = z.union([
  z.looseObject({ type: z.literal("custom-title"), customTitle: z.string() }),
  z.looseObject({ type: z.literal("ai-title"), aiTitle: z.string() }),
]);

export const relocatedLineSchema = z.looseObject({
  type: z.literal("relocated"),
  relocatedCwd: z.string(),
});

export const lastPromptLineSchema = z.looseObject({
  type: z.literal("last-prompt"),
  lastPrompt: z.string(),
});

export const subagentMetaSchema = z.looseObject({
  agentType: z.string(),
  description: z.string().optional(),
  toolUseId: z.string().optional(),
  finished: z.boolean().optional(),
});

export type AssistantLine = z.infer<typeof assistantLineSchema>;
export type UserLine = z.infer<typeof userLineSchema>;
export type SubagentMeta = z.infer<typeof subagentMetaSchema>;
