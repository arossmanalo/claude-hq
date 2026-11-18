import { z } from "zod";

/**
 * Messages the headless CLI writes to stdout with --output-format stream-json. Only the fields
 * the office uses are listed; everything else passes through untouched.
 */
const contentBlockSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
});

export const cliMessageSchema = z.discriminatedUnion("type", [
  z.looseObject({
    type: z.literal("system"),
    subtype: z.string(),
    session_id: z.string().optional(),
    task_id: z.string().optional(),
    subagent_type: z.string().optional(),
  }),
  z.looseObject({
    type: z.literal("assistant"),
    parent_tool_use_id: z.string().nullable().optional(),
    agent_id: z.string().optional(),
    message: z.looseObject({ content: z.array(contentBlockSchema).default([]) }),
  }),
  z.looseObject({
    type: z.literal("user"),
    parent_tool_use_id: z.string().nullable().optional(),
    agent_id: z.string().optional(),
    subagent_type: z.string().optional(),
  }),
  z.looseObject({
    type: z.literal("result"),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    session_id: z.string().optional(),
  }),
  z.looseObject({
    type: z.literal("control_request"),
    request_id: z.string(),
    request: z.looseObject({
      subtype: z.string(),
      tool_name: z.string().optional(),
      input: z.record(z.string(), z.unknown()).optional(),
      tool_use_id: z.string().optional(),
      agent_id: z.string().optional(),
    }),
  }),
  z.looseObject({
    type: z.literal("control_response"),
  }),
  z.looseObject({
    type: z.literal("rate_limit_event"),
  }),
  z.looseObject({
    type: z.literal("stream_event"),
  }),
]);

export type CliMessage = z.infer<typeof cliMessageSchema>;

export function parseCliLine(line: string): CliMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  const result = cliMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}

/** Messages the office writes to the CLI's stdin. */
export const cliInput = {
  initialize: (requestId: string) => ({
    type: "control_request",
    request_id: requestId,
    request: { subtype: "initialize" },
  }),
  interrupt: (requestId: string) => ({
    type: "control_request",
    request_id: requestId,
    request: { subtype: "interrupt" },
  }),
  userMessage: (text: string) => ({
    type: "user",
    message: { role: "user", content: text },
  }),
  allow: (requestId: string, input: Record<string, unknown>) => ({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: { behavior: "allow", updatedInput: input },
    },
  }),
  deny: (requestId: string, message: string) => ({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: { behavior: "deny", message },
    },
  }),
};
