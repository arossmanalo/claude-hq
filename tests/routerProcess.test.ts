import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import type { Decision } from "../src/server/router/permissionPolicy";
import { RouterProcess, type ChildLike } from "../src/server/router/routerProcess";

class FakeChild extends EventEmitter implements ChildLike {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  written: Record<string, unknown>[] = [];
  killed = false;

  constructor() {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      for (const line of chunk.split("\n").filter(Boolean)) this.written.push(JSON.parse(line));
    });
  }

  kill(): boolean {
    this.killed = true;
    this.emit("exit", null);
    return true;
  }

  /** Simulates the CLI printing one stream-json message. */
  print(message: object): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setUp(decide: (role: string, tool: string) => Decision = () => ({ kind: "ask", reason: "Runs a shell command" })) {
  const child = new FakeChild();
  let spawnedArgs: string[] = [];
  const router = new RouterProcess({
    cwd: "D:\\demo\\shop",
    resumeSessionId: null,
    model: "sonnet",
    handoffCap: 2,
    spawn: (args) => {
      spawnedArgs = args;
      return child;
    },
    decide: ({ role, toolName }) => decide(role, toolName),
  });
  router.start();
  return { child, router, args: () => spawnedArgs };
}

function routerSays(child: FakeChild, ...content: object[]) {
  child.print({ type: "assistant", parent_tool_use_id: null, message: { content } });
}

describe("RouterProcess", () => {
  let events: string[];

  beforeEach(() => {
    events = [];
  });

  it("starts the CLI as the router agent with host-answered permissions", () => {
    const { args } = setUp();
    expect(args()).toEqual(expect.arrayContaining(["--agent", "router", "--model", "sonnet"]));
    expect(args().join(" ")).toContain("--permission-prompt-tool stdio");
  });

  it("queues messages sent while busy and sends them when the turn ends", async () => {
    const { child, router } = setUp();
    router.on("taskDone", () => events.push("done"));
    router.send("first");
    router.send("second");
    await flush();
    expect(router.status().queued).toEqual(["second"]);
    child.print({ type: "result", subtype: "success", session_id: "s1" });
    await flush();
    const userMessages = child.written.filter((message) => message.type === "user");
    expect(userMessages).toHaveLength(2);
    expect(events).toEqual([]);
    child.print({ type: "result", subtype: "success", session_id: "s1" });
    await flush();
    expect(events).toEqual(["done"]);
    expect(router.status()).toMatchObject({ phase: "idle", sessionId: "s1", queued: [] });
  });

  it("raises a card for requests the policy asks about and answers when the user decides", async () => {
    const { child, router } = setUp();
    child.print({ type: "system", subtype: "task_started", task_id: "a1", subagent_type: "coder" });
    child.print({
      type: "control_request",
      request_id: "req-1",
      request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "npm install" }, agent_id: "a1" },
    });
    await flush();
    expect(router.permissionRequests()).toEqual([
      expect.objectContaining({ requestId: "req-1", role: "coder", agentId: "a1", summary: "Bash: npm install" }),
    ]);
    expect(router.waitingAgentIds()).toEqual(new Set(["a1"]));
    expect(router.answer("req-1", true)).toBe(true);
    await flush();
    expect(child.written.at(-1)).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "req-1",
        response: { behavior: "allow", updatedInput: { command: "npm install" } },
      },
    });
    expect(router.permissionRequests()).toEqual([]);
  });

  it("answers allowed and denied requests itself without a card", async () => {
    const { child, router } = setUp((role) =>
      role === "reviewer" ? { kind: "deny", message: "Reviewers only read." } : { kind: "allow" },
    );
    child.print({ type: "system", subtype: "task_started", task_id: "r1", subagent_type: "reviewer" });
    child.print({
      type: "control_request",
      request_id: "req-2",
      request: { subtype: "can_use_tool", tool_name: "Edit", input: {}, agent_id: "r1" },
    });
    await flush();
    expect(router.permissionRequests()).toEqual([]);
    expect(child.written.at(-1)).toMatchObject({
      response: { request_id: "req-2", response: { behavior: "deny", message: "Reviewers only read." } },
    });
  });

  it("pauses the router when it passes the handoff cap", async () => {
    const { child, router } = setUp();
    router.send("build it");
    router.send("queued");
    for (let i = 0; i < 3; i++) routerSays(child, { type: "tool_use", id: `t${i}`, name: "Agent", input: {} });
    await flush();
    expect(child.written.some((m) => JSON.stringify(m).includes('"subtype":"interrupt"'))).toBe(true);
    expect(router.status().attention).toContain("2 handoffs");
    expect(router.status().queued).toEqual([]);
    child.print({ type: "result", subtype: "error_during_execution", is_error: true });
    await flush();
    expect(router.status().phase).toBe("idle");
  });

  it("flags a turn that ends with a question for the user", async () => {
    const { child, router } = setUp();
    router.on("taskDone", () => events.push("done"));
    router.send("make a logo");
    routerSays(child, { type: "text", text: "Which colours should it use?" });
    child.print({ type: "result", subtype: "success" });
    await flush();
    expect(router.status().attention).toBe("The router asked you a question.");
    expect(events).toEqual([]);
  });

  it("stops: interrupts the turn, cancels the queue, and declines open requests", async () => {
    const { child, router } = setUp();
    router.send("one");
    router.send("two");
    child.print({
      type: "control_request",
      request_id: "req-3",
      request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "x" } },
    });
    await flush();
    router.stop();
    await flush();
    expect(router.status().queued).toEqual([]);
    expect(router.permissionRequests()).toEqual([]);
    const types = child.written.map((m) => JSON.stringify(m));
    expect(types.some((m) => m.includes('"behavior":"deny"'))).toBe(true);
    expect(types.some((m) => m.includes('"subtype":"interrupt"'))).toBe(true);

    // The CLI ends an interrupted turn with an error result; that's expected, not a failure.
    router.on("taskDone", () => events.push("done"));
    child.print({ type: "result", subtype: "error_during_execution", is_error: true });
    await flush();
    expect(router.status()).toMatchObject({ phase: "idle", error: null });
    expect(events).toEqual([]);
  });

  it("reports an unexpected exit with the end of stderr", async () => {
    const { child, router } = setUp();
    child.stderr.write("Error: not logged in\n");
    await flush();
    child.emit("exit", 1);
    expect(router.status().phase).toBe("error");
    expect(router.status().error).toContain("not logged in");
  });

  it("marks a busy router as interrupted when the office shuts it down", () => {
    const { router } = setUp();
    router.send("long task");
    router.kill();
    expect(router.status().phase).toBe("interrupted");
  });
});
