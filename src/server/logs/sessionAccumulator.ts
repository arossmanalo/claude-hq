import {
  addTokens,
  emptyTokens,
  type AgentState,
  type AgentView,
  type ChatMessage,
  type CommitStamp,
  type Handoff,
  type SessionDetail,
  type SessionSummary,
  type TokenTotals,
} from "../../shared/model";
import {
  KNOWN_EVENT_TYPES,
  assistantLineSchema,
  baseLineSchema,
  relocatedLineSchema,
  textBlockSchema,
  titleLineSchema,
  toolResultBlockSchema,
  toolUseBlockSchema,
  userLineSchema,
  type AssistantLine,
  type SubagentMeta,
  type UserLine,
} from "./logSchema";
import { maskSecrets } from "../../shared/maskSecrets";
import { isGitCommitCommand, parseCommit } from "./gitCommit";

export const ROUTER_ID = "router";
const HANDOFF_TOOLS = new Set(["Agent", "Task"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
/** How many recent chat messages a snapshot carries. */
export const RECENT_MESSAGE_LIMIT = 500;

type LastKind = "prompt" | "tool-result" | "text" | "tool-use";

interface PendingCommit {
  agentId: string;
  command: string;
}

class AgentAccumulator {
  model: string | null = null;
  tokens: TokenTotals = emptyTokens();
  lastActivityAt: string | null = null;
  lastKind: LastKind | null = null;
  lastErrored = false;
  /** toolUseId -> tool name, for tools that have started but not returned. */
  readonly pendingTools = new Map<string, string>();
  private readonly countedMessageIds = new Set<string>();

  countUsage(messageId: string | undefined, usage: AssistantLine["message"]["usage"]): void {
    if (!usage) return;
    // Each content block of one API message is logged as its own line with the same usage.
    if (messageId) {
      if (this.countedMessageIds.has(messageId)) return;
      this.countedMessageIds.add(messageId);
    }
    this.tokens = addTokens(this.tokens, {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    });
  }
}

export interface SnapshotContext {
  summary: SessionSummary;
  /** Agent ids with a permission request waiting on the user. */
  waitingAgentIds?: ReadonlySet<string>;
}

/**
 * Folds the lines of one session's logs (main thread plus subagent files) into the state the
 * office draws. Pure: it never touches the file system, so it can be fed fixture lines in tests.
 */
export class SessionAccumulator {
  cwd: string | null = null;
  title: string | null = null;
  startedAt: string | null = null;
  updatedAt: string | null = null;
  malformedLines = 0;
  readonly unknownEventTypes = new Map<string, number>();

  private hasCustomTitle = false;
  private readonly router = new AgentAccumulator();
  private readonly subagents = new Map<string, AgentAccumulator>();
  private readonly subagentMeta = new Map<string, SubagentMeta>();
  private readonly handoffs = new Map<string, Handoff>();
  private readonly commits: CommitStamp[] = [];
  /** Shell calls that ran `git commit`, waiting for their result. */
  private readonly pendingCommits = new Map<string, PendingCommit>();
  private readonly messages: ChatMessage[] = [];

  applyRouterLine(raw: string): void {
    this.applyLine(ROUTER_ID, raw);
  }

  applySubagentLine(agentId: string, raw: string): void {
    this.applyLine(agentId, raw);
  }

  setSubagentMeta(agentId: string, meta: SubagentMeta): void {
    this.subagentMeta.set(agentId, meta);
    this.agent(agentId);
  }

  snapshot(context: SnapshotContext): SessionDetail {
    const { summary } = context;
    const waiting = context.waitingAgentIds ?? new Set<string>();
    const agents: AgentView[] = [this.view(ROUTER_ID, this.router, summary, waiting)];
    for (const [agentId, acc] of this.subagents) {
      agents.push(this.view(agentId, acc, summary, waiting));
    }
    const tokens = agents.reduce((sum, agent) => addTokens(sum, agent.tokens), emptyTokens());
    const earlierMessageCount = Math.max(0, this.messages.length - RECENT_MESSAGE_LIMIT);
    return {
      ...summary,
      cwd: this.cwd ?? summary.cwd,
      title: this.title ?? summary.title,
      startedAt: this.startedAt ?? summary.startedAt,
      updatedAt: this.updatedAt ?? summary.updatedAt,
      agents,
      handoffs: [...this.handoffs.values()],
      commits: [...this.commits],
      tokens,
      messages: this.messages.slice(earlierMessageCount),
      earlierMessageCount,
      unknownEventTypes: Object.fromEntries(this.unknownEventTypes),
      malformedLines: this.malformedLines,
    };
  }

  /** Up to `limit` messages that come before `beforeIndex`, oldest first. */
  messagesBefore(beforeIndex: number, limit: number): ChatMessage[] {
    const end = Math.max(0, Math.min(beforeIndex, this.messages.length));
    return this.messages.slice(Math.max(0, end - limit), end);
  }

  private agent(agentId: string): AgentAccumulator {
    if (agentId === ROUTER_ID) return this.router;
    let acc = this.subagents.get(agentId);
    if (!acc) {
      acc = new AgentAccumulator();
      this.subagents.set(agentId, acc);
    }
    return acc;
  }

  private applyLine(agentId: string, raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      this.malformedLines++;
      return;
    }
    const base = baseLineSchema.safeParse(json);
    if (!base.success) {
      this.malformedLines++;
      return;
    }
    const line = base.data;
    if (!KNOWN_EVENT_TYPES.has(line.type)) {
      this.unknownEventTypes.set(line.type, (this.unknownEventTypes.get(line.type) ?? 0) + 1);
      return;
    }
    if (line.cwd && agentId === ROUTER_ID && !this.cwd) this.cwd = line.cwd;
    if (line.timestamp) {
      this.startedAt ??= line.timestamp;
      if (!this.updatedAt || line.timestamp > this.updatedAt) this.updatedAt = line.timestamp;
    }

    switch (line.type) {
      case "assistant": {
        const parsed = assistantLineSchema.safeParse(json);
        if (parsed.success) this.applyAssistant(agentId, parsed.data);
        else this.malformedLines++;
        return;
      }
      case "user": {
        const parsed = userLineSchema.safeParse(json);
        if (parsed.success) this.applyUser(agentId, parsed.data);
        else this.malformedLines++;
        return;
      }
      case "custom-title":
      case "ai-title": {
        if (agentId !== ROUTER_ID) return;
        const parsed = titleLineSchema.safeParse(json);
        if (!parsed.success) return;
        // A title the user set wins over one Claude generated.
        if (parsed.data.type === "custom-title") {
          this.title = maskSecrets(parsed.data.customTitle);
          this.hasCustomTitle = true;
        } else if (!this.hasCustomTitle) {
          this.title = maskSecrets(parsed.data.aiTitle);
        }
        return;
      }
      case "relocated": {
        const parsed = relocatedLineSchema.safeParse(json);
        if (parsed.success && agentId === ROUTER_ID) this.cwd = parsed.data.relocatedCwd;
        return;
      }
      default:
        return;
    }
  }

  private applyAssistant(agentId: string, line: AssistantLine): void {
    const acc = this.agent(agentId);
    if (line.message.model && !line.message.model.startsWith("<")) acc.model = line.message.model;
    acc.countUsage(line.message.id, line.message.usage);
    acc.lastActivityAt = line.timestamp ?? acc.lastActivityAt;

    for (const block of line.message.content) {
      const toolUse = toolUseBlockSchema.safeParse(block);
      if (toolUse.success) {
        const { id, name, input } = toolUse.data;
        acc.pendingTools.set(id, name);
        acc.lastKind = "tool-use";
        if (HANDOFF_TOOLS.has(name)) this.recordHandoff(id, input, line.timestamp);
        if (SHELL_TOOLS.has(name) && typeof input.command === "string") {
          if (isGitCommitCommand(input.command)) {
            this.pendingCommits.set(id, { agentId, command: input.command });
          }
        }
        continue;
      }
      const text = textBlockSchema.safeParse(block);
      if (text.success) {
        acc.lastKind = "text";
        if (agentId === ROUTER_ID) this.addMessage("router", text.data.text, line.timestamp);
      }
    }
  }

  private addMessage(author: ChatMessage["author"], text: string, at?: string): void {
    const trimmed = text.trim();
    // Harness-injected text (reminders, slash-command echoes) starts with a tag, not prose.
    if (!trimmed || trimmed.startsWith("<")) return;
    this.messages.push({
      index: this.messages.length,
      author,
      text: maskSecrets(trimmed),
      at: at ?? null,
    });
  }

  private applyUser(agentId: string, line: UserLine): void {
    const acc = this.agent(agentId);
    acc.lastActivityAt = line.timestamp ?? acc.lastActivityAt;
    const content = line.message.content;
    if (typeof content === "string") {
      if (!line.isMeta) {
        acc.lastKind = "prompt";
        acc.lastErrored = false;
        if (agentId === ROUTER_ID) this.addMessage("user", content, line.timestamp);
      }
      return;
    }
    let sawToolResult = false;
    for (const block of content) {
      const text = textBlockSchema.safeParse(block);
      if (text.success && !line.isMeta && agentId === ROUTER_ID) {
        this.addMessage("user", text.data.text, line.timestamp);
      }
      const result = toolResultBlockSchema.safeParse(block);
      if (!result.success) continue;
      sawToolResult = true;
      const { tool_use_id: toolUseId, is_error: isError } = result.data;
      acc.pendingTools.delete(toolUseId);
      acc.lastErrored = isError === true;
      const handoff = this.handoffs.get(toolUseId);
      if (handoff) handoff.finished = true;
      const commit = this.pendingCommits.get(toolUseId);
      if (commit) {
        this.pendingCommits.delete(toolUseId);
        if (!isError) this.recordCommit(commit, result.data.content, line.timestamp);
      }
    }
    if (sawToolResult) acc.lastKind = "tool-result";
    else if (!line.isMeta) {
      acc.lastKind = "prompt";
      acc.lastErrored = false;
    }
  }

  private recordHandoff(toolUseId: string, input: Record<string, unknown>, at?: string): void {
    const role = typeof input.subagent_type === "string" ? input.subagent_type : "general-purpose";
    const description = typeof input.description === "string" ? maskSecrets(input.description) : "";
    this.handoffs.set(toolUseId, {
      toolUseId,
      role,
      description,
      startedAt: at ?? this.updatedAt ?? "",
      finished: false,
    });
  }

  private recordCommit(commit: PendingCommit, content: unknown, at?: string): void {
    const parsed = parseCommit(commit.command, toolResultText(content));
    if (!parsed) return;
    this.commits.push({
      hash: parsed.hash,
      message: maskSecrets(parsed.message),
      agentId: commit.agentId,
      at: at ?? "",
    });
  }

  private view(
    agentId: string,
    acc: AgentAccumulator,
    summary: SessionSummary,
    waiting: ReadonlySet<string>,
  ): AgentView {
    const meta = this.subagentMeta.get(agentId);
    const handoff = meta?.toolUseId ? this.handoffs.get(meta.toolUseId) : undefined;
    const isRouter = agentId === ROUTER_ID;
    const finished = !isRouter && (meta?.finished === true || handoff?.finished === true);
    const currentTool = acc.pendingTools.size > 0 ? [...acc.pendingTools.values()].at(-1) : null;
    return {
      id: agentId,
      role: isRouter ? ROUTER_ID : (meta?.agentType ?? handoff?.role ?? "agent"),
      model: acc.model,
      state: deriveAgentState({
        live: summary.live,
        liveStatus: summary.liveStatus,
        isRouter,
        finished,
        waiting: waiting.has(agentId),
        hasPendingTool: acc.pendingTools.size > 0,
        lastKind: acc.lastKind,
        lastErrored: acc.lastErrored,
      }),
      currentTool: currentTool ?? null,
      task: isRouter ? null : maskOrNull(meta?.description ?? handoff?.description ?? null),
      lastActivityAt: acc.lastActivityAt,
      tokens: acc.tokens,
    };
  }
}

export interface AgentStateInput {
  live: boolean;
  liveStatus: string | null;
  isRouter: boolean;
  finished: boolean;
  waiting: boolean;
  hasPendingTool: boolean;
  lastKind: LastKind | null;
  lastErrored: boolean;
}

export function deriveAgentState(input: AgentStateInput): AgentState {
  if (input.finished) return "done";
  if (!input.live) return "idle";
  if (input.waiting) return "waiting";
  if (input.isRouter && input.liveStatus === "idle") return "idle";
  if (input.hasPendingTool) return "typing";
  if (input.lastErrored) return "error";
  if (input.lastKind === "text" && !input.isRouter) return "thinking";
  if (input.lastKind === "text") return input.liveStatus === "busy" ? "thinking" : "idle";
  return "thinking";
}

function maskOrNull(text: string | null): string | null {
  return text === null ? null : maskSecrets(text);
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) => {
      const text = textBlockSchema.safeParse(block);
      return text.success ? text.data.text : "";
    })
    .join("\n");
}
