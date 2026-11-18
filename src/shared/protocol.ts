import { z } from "zod";
import type { ProjectSummary, SessionDetail } from "./model";

/** Models offered in the router's model picker. Aliases resolve to the latest of each family. */
export const ROUTER_MODELS = ["opus", "sonnet", "haiku", "fable"] as const;
export type RouterModel = (typeof ROUTER_MODELS)[number];

/** Messages the browser sends. Validated on the server, because anything can open the socket. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    sessionIds: z.array(z.string().min(1).max(100)).max(20),
  }),
  z.object({
    type: z.literal("chat.send"),
    cwd: z.string().min(1).max(1000),
    /** Continue this session; omit to start a new one. */
    sessionId: z.string().min(1).max(100).nullable(),
    text: z.string().min(1).max(100_000),
    model: z.enum(ROUTER_MODELS).nullable(),
  }),
  z.object({
    type: z.literal("chat.stop"),
    cwd: z.string().min(1).max(1000),
  }),
  z.object({
    type: z.literal("chat.clearQueue"),
    cwd: z.string().min(1).max(1000),
  }),
  z.object({
    type: z.literal("permission.answer"),
    requestId: z.string().min(1).max(200),
    allow: z.boolean(),
  }),
  z.object({
    type: z.literal("settings.sound"),
    muted: z.boolean(),
    volume: z.number().min(0).max(1),
  }),
]);

export interface SoundSettings {
  muted: boolean;
  /** 0 to 1. */
  volume: number;
}

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Response of GET /api/sessions/:id/messages. */
export const chatMessageListSchema = z.array(
  z.object({
    index: z.number().int().min(0),
    author: z.enum(["user", "router"]),
    text: z.string(),
    at: z.string().nullable(),
  }),
);

/** One permission request from a router process, waiting on the user. */
export interface PermissionRequest {
  requestId: string;
  cwd: string;
  sessionId: string | null;
  /** "router" or the subagent id that asked. */
  agentId: string;
  role: string;
  toolName: string;
  /** One-line summary: the command, file path, or URL. */
  summary: string;
  /** Why the office did not approve it automatically. */
  reason: string;
  createdAt: string;
}

export type RouterPhase = "starting" | "working" | "idle" | "stopped" | "interrupted" | "error";

/** State of the office-run router for one project folder. */
export interface RouterStatus {
  cwd: string;
  sessionId: string | null;
  phase: RouterPhase;
  model: RouterModel | null;
  /** Messages sent while the router was busy, in order. */
  queued: string[];
  /** Agent handoffs in the current request, against the cap. */
  handoffsThisRequest: number;
  handoffCap: number;
  /** Set when the router stopped and needs the user (cap reached, error, question). */
  attention: string | null;
  error: string | null;
}

const SERVER_MESSAGE_TYPES = new Set([
  "projects",
  "session",
  "routers",
  "permissions",
  "taskDone",
  "notice",
  "settings",
]);

/**
 * The client trusts the shape of messages from its own server (same build), but still refuses
 * anything that isn't one of the known message kinds.
 */
export function isServerMessage(value: unknown): value is ServerMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    SERVER_MESSAGE_TYPES.has(value.type)
  );
}

export type ServerMessage =
  | { type: "projects"; projects: ProjectSummary[] }
  | { type: "session"; detail: SessionDetail }
  | { type: "routers"; routers: RouterStatus[] }
  | { type: "permissions"; requests: PermissionRequest[] }
  /** A router turn finished with nothing left pending; the client plays the "done" sound. */
  | { type: "taskDone"; cwd: string }
  | { type: "settings"; sound: SoundSettings }
  | { type: "notice"; level: "info" | "error"; message: string };
