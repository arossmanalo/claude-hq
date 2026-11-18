import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import type { PermissionRequest, RouterModel, RouterPhase, RouterStatus } from "../../shared/protocol";
import { cliInput, parseCliLine, type CliMessage } from "./cliStream";
import { summariseToolInput, type Decision } from "./permissionPolicy";

const STDERR_KEEP_CHARS = 4000;
const HANDOFF_TOOLS = new Set(["Agent", "Task"]);

/** The parts of a child process the router needs; tests pass a fake. */
export interface ChildLike {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(): boolean;
  on(event: "exit", listener: (code: number | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export type SpawnRouter = (args: string[], cwd: string) => ChildLike;

export interface RouterProcessOptions {
  cwd: string;
  resumeSessionId: string | null;
  model: RouterModel | null;
  handoffCap: number;
  spawn: SpawnRouter;
  decide: (request: { role: string; toolName: string; input: Record<string, unknown> }) => Decision;
}

interface PendingPermission {
  request: PermissionRequest;
  input: Record<string, unknown>;
}

type RouterEvents = {
  changed: [];
  permissions: [];
  /** A request finished with nothing queued behind it. */
  taskDone: [];
  exit: [];
};

/**
 * One headless `claude` process acting as a project's router. Owns the message queue, the
 * handoff cap, and the permission requests its agents raise.
 */
export class RouterProcess extends EventEmitter<RouterEvents> {
  readonly cwd: string;
  sessionId: string | null;
  phase: RouterPhase = "starting";
  attention: string | null = null;
  error: string | null = null;
  readonly model: RouterModel | null;

  private child: ChildLike | null = null;
  private readonly queue: string[] = [];
  private busy = false;
  private handoffs = 0;
  private lastRouterText = "";
  private stdoutBuffer = "";
  private stderrTail = "";
  private stopping = false;
  /** Set when the user pressed Stop; the turn's error result is then expected, not a failure. */
  private interruptRequested = false;
  private readonly agentRoles = new Map<string, string>();
  private readonly pending = new Map<string, PendingPermission>();

  constructor(private readonly options: RouterProcessOptions) {
    super();
    this.cwd = options.cwd;
    this.sessionId = options.resumeSessionId;
    this.model = options.model;
  }

  start(): void {
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-prompts",
      "host",
      "--permission-prompt-tool",
      "stdio",
      "--agent",
      "router",
    ];
    if (this.options.model) args.push("--model", this.options.model);
    if (this.options.resumeSessionId) args.push("--resume", this.options.resumeSessionId);

    const child = this.options.spawn(args, this.cwd);
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_KEEP_CHARS);
    });
    child.stdin.on("error", () => {
      // The process died mid-write; the exit handler reports it.
    });
    child.on("error", (error) => this.onExit(null, error.message));
    child.on("exit", (code) => this.onExit(code, null));
    this.write(cliInput.initialize(randomUUID()));
  }

  /** Sends a message now, or queues it until the current request finishes. */
  send(text: string): void {
    if (this.busy) {
      this.queue.push(text);
      this.emit("changed");
      return;
    }
    this.beginRequest(text);
  }

  /** Interrupts the current turn and cancels anything queued. */
  stop(): void {
    this.queue.length = 0;
    this.denyAllPending("Stopped from Claude Office.");
    if (this.busy) {
      this.interruptRequested = true;
      this.write(cliInput.interrupt(randomUUID()));
    }
    this.emit("changed");
  }

  clearQueue(): void {
    this.queue.length = 0;
    this.emit("changed");
  }

  /** Ends the process for good, as when the server shuts down or the user leaves the project. */
  kill(): void {
    this.stopping = true;
    this.denyAllPending("Claude Office closed.");
    this.child?.kill();
  }

  /** Kills the process and resolves once it has exited (or after `timeoutMs`). */
  killAndWait(timeoutMs = 5000): Promise<void> {
    if (!this.child) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.kill();
    });
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get alive(): boolean {
    return this.child !== null;
  }

  answer(requestId: string, allow: boolean): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    this.write(
      allow
        ? cliInput.allow(requestId, pending.input)
        : cliInput.deny(requestId, "The user declined this in Claude Office."),
    );
    this.emit("permissions");
    this.emit("changed");
    return true;
  }

  permissionRequests(): PermissionRequest[] {
    return [...this.pending.values()].map((pending) => pending.request);
  }

  waitingAgentIds(): Set<string> {
    return new Set([...this.pending.values()].map((pending) => pending.request.agentId));
  }

  status(): RouterStatus {
    return {
      cwd: this.cwd,
      sessionId: this.sessionId,
      phase: this.phase,
      model: this.model,
      queued: [...this.queue],
      handoffsThisRequest: this.handoffs,
      handoffCap: this.options.handoffCap,
      attention: this.attention,
      error: this.error,
    };
  }

  private beginRequest(text: string): void {
    this.busy = true;
    this.handoffs = 0;
    this.lastRouterText = "";
    this.attention = null;
    this.error = null;
    this.interruptRequested = false;
    this.phase = "working";
    this.write(cliInput.userMessage(text));
    this.emit("changed");
  }

  private write(message: object): void {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return;
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        const message = parseCliLine(line);
        if (message) this.onMessage(message);
      }
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private onMessage(message: CliMessage): void {
    switch (message.type) {
      case "system":
        if (message.subtype === "init" && message.session_id && message.session_id !== this.sessionId) {
          this.sessionId = message.session_id;
          if (this.phase === "starting") this.phase = this.busy ? "working" : "idle";
          this.emit("changed");
        }
        if (message.subtype === "task_started" && message.task_id && message.subagent_type) {
          this.agentRoles.set(message.task_id, message.subagent_type);
        }
        return;
      case "user":
        if (message.agent_id && message.subagent_type) {
          this.agentRoles.set(message.agent_id, message.subagent_type);
        }
        return;
      case "assistant":
        if (message.agent_id || message.parent_tool_use_id) return;
        for (const block of message.message.content) {
          if (block.type === "text" && block.text) this.lastRouterText = block.text;
          if (block.type === "tool_use" && block.name && HANDOFF_TOOLS.has(block.name)) {
            this.countHandoff();
          }
        }
        return;
      case "result":
        if (message.session_id) this.sessionId = message.session_id;
        this.onTurnEnd(message.is_error === true);
        return;
      case "control_request":
        this.onControlRequest(message);
        return;
      default:
        return;
    }
  }

  private countHandoff(): void {
    this.handoffs++;
    if (this.handoffs > this.options.handoffCap) {
      this.attention = `The router reached ${this.options.handoffCap} handoffs for this request and was paused. Reply to tell it how to continue.`;
      this.queue.length = 0;
      this.write(cliInput.interrupt(randomUUID()));
    }
    this.emit("changed");
  }

  private onTurnEnd(isError: boolean): void {
    this.busy = false;
    if (this.interruptRequested) {
      this.interruptRequested = false;
      this.phase = "idle";
      this.emit("changed");
      return;
    }
    if (isError && !this.attention) {
      this.error = "The router's last turn ended with an error. Its log in the conversation has details.";
    }
    const next = this.queue.shift();
    if (next !== undefined && !this.attention) {
      this.beginRequest(next);
      return;
    }
    if (next !== undefined) this.queue.unshift(next);
    this.phase = "idle";
    if (!this.attention && /\?\s*$/.test(this.lastRouterText.trim())) {
      this.attention = "The router asked you a question.";
    }
    this.emit("changed");
    if (!this.attention && !isError) this.emit("taskDone");
  }

  private onControlRequest(message: Extract<CliMessage, { type: "control_request" }>): void {
    const { request } = message;
    if (request.subtype !== "can_use_tool" || !request.tool_name) {
      // Requests the office doesn't implement get a clear error rather than hanging the CLI.
      this.write({
        type: "control_response",
        response: {
          subtype: "error",
          request_id: message.request_id,
          error: `Claude Office does not handle ${request.subtype}.`,
        },
      });
      return;
    }
    const agentId = request.agent_id ?? "router";
    const role = agentId === "router" ? "router" : (this.agentRoles.get(agentId) ?? "agent");
    const input = request.input ?? {};
    const decision = this.options.decide({ role, toolName: request.tool_name, input });
    if (decision.kind === "allow") {
      this.write(cliInput.allow(message.request_id, input));
      return;
    }
    if (decision.kind === "deny") {
      this.write(cliInput.deny(message.request_id, decision.message));
      return;
    }
    this.pending.set(message.request_id, {
      input,
      request: {
        requestId: message.request_id,
        cwd: this.cwd,
        sessionId: this.sessionId,
        agentId,
        role,
        toolName: request.tool_name,
        summary: summariseToolInput(request.tool_name, input),
        reason: decision.reason,
        createdAt: new Date().toISOString(),
      },
    });
    this.emit("permissions");
    this.emit("changed");
  }

  private denyAllPending(message: string): void {
    if (this.pending.size === 0) return;
    for (const requestId of this.pending.keys()) this.write(cliInput.deny(requestId, message));
    this.pending.clear();
    this.emit("permissions");
  }

  private onExit(code: number | null, spawnError: string | null): void {
    if (!this.child) return;
    this.child = null;
    const hadPending = this.pending.size > 0;
    this.pending.clear();
    if (hadPending) this.emit("permissions");
    const wasBusy = this.busy;
    this.busy = false;
    if (this.stopping) {
      this.phase = wasBusy ? "interrupted" : "stopped";
    } else if (spawnError || code !== 0) {
      this.phase = "error";
      const detail = spawnError ?? this.stderrTail.trim().split("\n").slice(-3).join(" ");
      this.error = `The router process ended unexpectedly${code !== null ? ` (exit code ${code})` : ""}. ${detail}`.trim();
    } else {
      this.phase = "stopped";
    }
    this.emit("changed");
    this.emit("exit");
  }
}
