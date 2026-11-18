/** What an agent is doing right now, as drawn in its room. */
export type AgentState = "idle" | "thinking" | "typing" | "waiting" | "error" | "done";

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface AgentView {
  /** "router" for the main thread, otherwise the subagent's agentId. */
  id: string;
  /** Role name: "router" or the subagent type (designer, coder, ...). */
  role: string;
  model: string | null;
  state: AgentState;
  /** Tool currently running, when state is "typing". */
  currentTool: string | null;
  /** Short task description the router gave this agent. */
  task: string | null;
  lastActivityAt: string | null;
  tokens: TokenTotals;
}

export interface Handoff {
  toolUseId: string;
  role: string;
  description: string;
  startedAt: string;
  finished: boolean;
}

export interface CommitStamp {
  /** Null when `git commit -q` hid git's summary line. */
  hash: string | null;
  message: string;
  /** Agent id that ran the commit ("router" or a subagent id). */
  agentId: string;
  at: string;
}

/** One line of the router's conversation, as shown in the chat panel. */
export interface ChatMessage {
  /** Position in the session's full message list, so older pages can be requested. */
  index: number;
  author: "user" | "router";
  text: string;
  at: string | null;
}

/** Cheap per-session summary built from the start and end of the log file. */
export interface SessionSummary {
  sessionId: string;
  cwd: string;
  title: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  live: boolean;
  /** Raw status from ~/.claude/sessions (busy, idle, ...) while live. */
  liveStatus: string | null;
  /** True while the office's own router process owns this session. */
  ownedByOffice: boolean;
  sizeBytes: number;
}

/** Full view of one session, built by parsing its whole log. */
export interface SessionDetail extends SessionSummary {
  agents: AgentView[];
  handoffs: Handoff[];
  commits: CommitStamp[];
  tokens: TokenTotals;
  /** The most recent chat messages; older ones are fetched on demand. */
  messages: ChatMessage[];
  /** How many messages come before the first one in `messages`. */
  earlierMessageCount: number;
  /** Event types this version of the office doesn't recognise, with counts. */
  unknownEventTypes: Record<string, number>;
  /** Lines that were not valid JSON or failed validation (excluding a half-written last line). */
  malformedLines: number;
}

export interface ProjectSummary {
  /** Normalised cwd, used as the stable key. */
  key: string;
  name: string;
  cwd: string;
  sessions: SessionSummary[];
  live: boolean;
}

export function emptyTokens(): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function addTokens(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}
