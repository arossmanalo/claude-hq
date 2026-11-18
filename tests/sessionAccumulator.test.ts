import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SessionAccumulator, deriveAgentState } from "../src/server/logs/sessionAccumulator";
import type { SessionSummary } from "../src/shared/model";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const projectDir = path.join(__dirname, "fixtures/claude/projects/D--demo-shop");
const mainLog = readFileSync(path.join(projectDir, `${SESSION_ID}.jsonl`), "utf8");
const coderLog = readFileSync(
  path.join(projectDir, SESSION_ID, "subagents/agent-acoder01.jsonl"),
  "utf8",
);

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: SESSION_ID,
    cwd: "",
    title: null,
    startedAt: null,
    updatedAt: null,
    live: true,
    liveStatus: "busy",
    ownedByOffice: false,
    sizeBytes: 0,
    ...overrides,
  };
}

/** Feeds complete lines only, like JsonlTail does: the half-written last line is held back. */
function completeLines(text: string): string[] {
  const parts = text.split("\n");
  parts.pop();
  return parts;
}

function buildFixtureSession(): SessionAccumulator {
  const acc = new SessionAccumulator();
  for (const line of completeLines(mainLog)) acc.applyRouterLine(line);
  acc.setSubagentMeta("acoder01", {
    agentType: "coder",
    description: "Add cart badge",
    toolUseId: "toolu_handoff1",
    finished: false,
  });
  for (const line of completeLines(coderLog)) acc.applySubagentLine("acoder01", line);
  return acc;
}

describe("SessionAccumulator", () => {
  it("reads cwd, the user's custom title over the AI title, and the time range", () => {
    const detail = buildFixtureSession().snapshot({ summary: summary() });
    expect(detail.cwd).toBe("D:\\demo\\shop");
    expect(detail.title).toBe("Cart badge");
    expect(detail.startedAt).toBe("2026-11-01T10:00:00.000Z");
    expect(detail.updatedAt).toBe("2026-11-01T10:05:01.000Z");
  });

  it("counts tokens once per API message even when its blocks are split across lines", () => {
    const detail = buildFixtureSession().snapshot({ summary: summary() });
    const router = detail.agents.find((agent) => agent.id === "router");
    expect(router?.tokens).toEqual({ input: 110, output: 25, cacheRead: 1000, cacheWrite: 50 });
    expect(detail.tokens.input).toBe(110 + 250);
  });

  it("records the handoff to the coder and marks it finished when the result returns", () => {
    const detail = buildFixtureSession().snapshot({ summary: summary() });
    expect(detail.handoffs).toEqual([
      {
        toolUseId: "toolu_handoff1",
        role: "coder",
        description: "Add cart badge",
        startedAt: "2026-11-01T10:00:03.000Z",
        finished: true,
      },
    ]);
  });

  it("stamps the commit on the agent that made it", () => {
    const detail = buildFixtureSession().snapshot({ summary: summary() });
    expect(detail.commits).toEqual([
      {
        hash: "3f9c2ab",
        message: "feat(cart): add item count badge",
        agentId: "acoder01",
        at: "2026-11-01T10:01:02.000Z",
      },
    ]);
  });

  it("gives the subagent its role, model, and task, and shows it done once its handoff returned", () => {
    const detail = buildFixtureSession().snapshot({ summary: summary() });
    const coder = detail.agents.find((agent) => agent.id === "acoder01");
    expect(coder).toMatchObject({
      role: "coder",
      model: "claude-sonnet-5-5",
      task: "Add cart badge",
      state: "done",
    });
  });

  it("counts unknown event types instead of failing, and ignores the half-written last line", () => {
    const detail = buildFixtureSession().snapshot({ summary: summary() });
    expect(detail.unknownEventTypes).toEqual({ "future-event-kind": 1 });
    expect(detail.malformedLines).toBe(0);
  });

  it("counts a corrupt line in the middle of a file as malformed", () => {
    const acc = new SessionAccumulator();
    acc.applyRouterLine('{"type":"user", oops');
    acc.applyRouterLine('{"no":"type"}');
    expect(acc.snapshot({ summary: summary() }).malformedLines).toBe(2);
  });

  it("shows the agent waiting while a permission request for it is open", () => {
    const acc = buildFixtureSession();
    const detail = acc.snapshot({ summary: summary(), waitingAgentIds: new Set(["router"]) });
    expect(detail.agents[0]?.state).toBe("waiting");
  });

  it("keeps the router conversation as chat messages, without subagent or harness text", () => {
    const acc = buildFixtureSession();
    acc.applyRouterLine(
      JSON.stringify({ type: "user", message: { content: "<system-reminder>x</system-reminder>" } }),
    );
    const detail = acc.snapshot({ summary: summary() });
    expect(detail.messages.map((message) => [message.author, message.text])).toEqual([
      ["user", "Add a cart badge and test it"],
      ["router", "Handing this to the coder."],
      ["router", "Done."],
    ]);
    expect(detail.earlierMessageCount).toBe(0);
  });

  it("sends only the latest 500 messages and pages back through older ones", () => {
    const acc = new SessionAccumulator();
    for (let i = 0; i < 520; i++) {
      acc.applyRouterLine(JSON.stringify({ type: "user", message: { content: `prompt ${i}` } }));
    }
    const detail = acc.snapshot({ summary: summary() });
    expect(detail.messages).toHaveLength(500);
    expect(detail.messages[0]?.text).toBe("prompt 20");
    expect(detail.earlierMessageCount).toBe(20);
    expect(acc.messagesBefore(20, 5).map((message) => message.text)).toEqual([
      "prompt 15",
      "prompt 16",
      "prompt 17",
      "prompt 18",
      "prompt 19",
    ]);
  });

  it("masks secrets in chat text", () => {
    const acc = new SessionAccumulator();
    acc.applyRouterLine(
      JSON.stringify({ type: "user", message: { content: "use API_KEY=abcd1234 please" } }),
    );
    expect(acc.snapshot({ summary: summary() }).messages[0]?.text).toBe(
      "use API_KEY=•••••• please",
    );
  });

  it("takes the new folder when a session was relocated", () => {
    const acc = new SessionAccumulator();
    acc.applyRouterLine(
      '{"type":"user","message":{"role":"user","content":"hi"},"cwd":"D:\\\\old","timestamp":"2026-11-01T00:00:00Z"}',
    );
    acc.applyRouterLine('{"type":"relocated","relocatedCwd":"D:\\\\new"}');
    expect(acc.snapshot({ summary: summary() }).cwd).toBe("D:\\new");
  });
});

describe("deriveAgentState", () => {
  const base = {
    live: true,
    liveStatus: "busy",
    isRouter: true,
    finished: false,
    waiting: false,
    hasPendingTool: false,
    lastKind: null,
    lastErrored: false,
  } as const;

  it("is idle when the session is not running, whatever the log says", () => {
    expect(deriveAgentState({ ...base, live: false, hasPendingTool: true })).toBe("idle");
  });

  it("is typing while a tool call has no result yet", () => {
    expect(deriveAgentState({ ...base, hasPendingTool: true })).toBe("typing");
  });

  it("is waiting before anything else while a permission request is open", () => {
    expect(deriveAgentState({ ...base, hasPendingTool: true, waiting: true })).toBe("waiting");
  });

  it("is an error when the last tool result failed", () => {
    expect(deriveAgentState({ ...base, lastKind: "tool-result", lastErrored: true })).toBe("error");
  });

  it("is idle when the router's process reports idle", () => {
    expect(deriveAgentState({ ...base, liveStatus: "idle", lastKind: "text" })).toBe("idle");
  });

  it("is done for a finished subagent even after the session ends", () => {
    expect(deriveAgentState({ ...base, isRouter: false, finished: true, live: false })).toBe("done");
  });
});
