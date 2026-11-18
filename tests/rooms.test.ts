import { describe, expect, it } from "vitest";
import { buildRooms, modelLabel } from "../src/client/scene/rooms";
import { emptyTokens, type AgentView, type SessionDetail } from "../src/shared/model";

function agent(overrides: Partial<AgentView>): AgentView {
  return {
    id: "router",
    role: "router",
    model: null,
    state: "idle",
    currentTool: null,
    task: null,
    lastActivityAt: null,
    tokens: emptyTokens(),
    ...overrides,
  };
}

function detail(agents: AgentView[], commitAgentIds: string[] = []): SessionDetail {
  return {
    sessionId: "s",
    cwd: "D:\\p",
    title: null,
    startedAt: null,
    updatedAt: null,
    live: true,
    liveStatus: "busy",
    ownedByOffice: false,
    sizeBytes: 0,
    agents,
    handoffs: [],
    commits: commitAgentIds.map((agentId) => ({ hash: null, message: "m", agentId, at: "" })),
    tokens: emptyTokens(),
    messages: [],
    earlierMessageCount: 0,
    unknownEventTypes: {},
    malformedLines: 0,
  };
}

describe("buildRooms", () => {
  it("always has the five core rooms, empty when unused", () => {
    const rooms = buildRooms(null);
    expect(rooms.map((room) => room.role)).toEqual([
      "router",
      "designer",
      "coder",
      "tester",
      "reviewer",
    ]);
    expect(rooms.every((room) => room.state === "empty")).toBe(true);
  });

  it("shows the most urgent state when two agents share a room", () => {
    const rooms = buildRooms(
      detail([
        agent({}),
        agent({ id: "a1", role: "coder", state: "done" }),
        agent({ id: "a2", role: "coder", state: "waiting", task: "Fix login" }),
      ]),
    );
    const coder = rooms.find((room) => room.role === "coder");
    expect(coder).toMatchObject({ state: "waiting", agentCount: 2, task: "Fix login" });
  });

  it("adds rooms for other roles and puts the overflow in a shared room", () => {
    const extras = ["Explore", "Plan", "docs", "security"].map((role, i) =>
      agent({ id: `x${i}`, role }),
    );
    const roles = buildRooms(detail([agent({}), ...extras])).map((room) => room.role);
    expect(roles.slice(5)).toEqual(["Explore", "Plan", "contractors"]);
  });

  it("counts each agent's commits in its room", () => {
    const rooms = buildRooms(
      detail([agent({}), agent({ id: "c1", role: "coder" })], ["c1", "c1", "router"]),
    );
    expect(rooms.find((room) => room.role === "coder")?.commits).toBe(2);
    expect(rooms.find((room) => room.role === "router")?.commits).toBe(1);
  });
});

describe("modelLabel", () => {
  it.each([
    ["claude-opus-5-5", "Opus 5.5"],
    ["claude-sonnet-5-5", "Sonnet 5.5"],
    ["claude-fable-5-2", "Fable 5.2"],
    ["some-other-model", "some-other-model"],
  ])("labels %s as %s", (model, label) => {
    expect(modelLabel(model)).toBe(label);
  });
});
