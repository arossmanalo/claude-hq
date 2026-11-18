import { appendFile, cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LogStore } from "../src/server/logs/logStore";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("LogStore", () => {
  let root: string;
  let store: LogStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "office-store-"));
    await cp(path.join(__dirname, "fixtures/claude"), root, { recursive: true });
    store = new LogStore({
      projectsDir: path.join(root, "projects"),
      liveDir: path.join(root, "sessions"),
      livePollMs: 50,
    });
    await store.start();
  });

  afterEach(async () => {
    await store.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("groups sessions into projects by folder", () => {
    const projects = store.projects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ name: "shop", cwd: "D:\\demo\\shop", live: false });
    expect(projects[0]?.sessions[0]).toMatchObject({ sessionId: SESSION_ID, title: "Cart badge" });
  });

  it("parses a session's main log and subagent logs on first open", async () => {
    const detail = await store.detail(SESSION_ID);
    expect(detail?.agents.map((agent) => agent.role)).toEqual(["router", "coder"]);
    expect(detail?.commits).toHaveLength(1);
  });

  it("returns null for a session it has never seen", async () => {
    expect(await store.detail("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("picks up lines appended to an open session and announces the change", async () => {
    await store.detail(SESSION_ID);
    const changed = new Promise<string>((resolve) => store.once("session", resolve));
    const logPath = path.join(root, "projects/D--demo-shop", `${SESSION_ID}.jsonl`);
    // Finish the half-written line from the fixture, then add a new prompt.
    await appendFile(
      logPath,
      'tent":"hi"}}\n' +
        `${JSON.stringify({ type: "user", message: { content: "Now add tests" }, timestamp: "2026-11-01T11:00:00.000Z" })}\n`,
    );
    await expect(changed).resolves.toBe(SESSION_ID);
    const detail = await store.detail(SESSION_ID);
    // The completed line parses cleanly: holding it back earlier lost nothing.
    expect(detail?.messages.slice(-2).map((message) => message.text)).toEqual([
      "hi",
      "Now add tests",
    ]);
    expect(detail?.malformedLines).toBe(0);
  }, 10_000);
});
