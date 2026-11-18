import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RouterManager, type SessionInfo } from "../src/server/router/routerManager";
import type { ChildLike } from "../src/server/router/routerProcess";
import { SettingsFile } from "../src/server/settings";

class FakeChild extends EventEmitter implements ChildLike {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(readonly args: string[]) {
    super();
  }
  kill(): boolean {
    this.emit("exit", null);
    return true;
  }
}

describe("RouterManager", () => {
  let dir: string;
  let children: FakeChild[];
  let sessions: Map<string, SessionInfo>;
  let agentInstalled: boolean;
  let manager: RouterManager;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "office-routers-"));
    children = [];
    sessions = new Map();
    agentInstalled = true;
    manager = new RouterManager({
      settings: new SettingsFile(path.join(dir, "settings.json")),
      statePath: path.join(dir, "routers.json"),
      spawn: (args) => {
        const child = new FakeChild(args);
        children.push(child);
        return child;
      },
      sessionInfo: (id) => sessions.get(id) ?? null,
      routerAgentExists: async () => agentInstalled,
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const send = (overrides: Partial<Parameters<RouterManager["send"]>[0]> = {}) =>
    manager.send({ cwd: dir, sessionId: null, text: "hello", model: null, ...overrides });

  it("starts one router per folder and reuses it for the next message", async () => {
    await send();
    await send({ text: "again" });
    expect(children).toHaveLength(1);
    expect(manager.statuses()[0]).toMatchObject({ phase: "working", queued: ["again"] });
  });

  it("refuses to take over a session that's running in Claude Code", async () => {
    sessions.set("s-term", { live: true, ownedByOffice: false });
    await expect(send({ sessionId: "s-term" })).rejects.toThrow(/still running in Claude Code/);
    expect(children).toHaveLength(0);
  });

  it("resumes an ended session with --resume", async () => {
    sessions.set("s-old", { live: false, ownedByOffice: false });
    await send({ sessionId: "s-old" });
    expect(children[0]?.args).toEqual(expect.arrayContaining(["--resume", "s-old"]));
  });

  it("explains how to install the agents when the router agent is missing", async () => {
    agentInstalled = false;
    await expect(send()).rejects.toThrow(/npm run agents:install/);
  });

  it("rejects a folder that doesn't exist", async () => {
    await expect(send({ cwd: path.join(dir, "nope") })).rejects.toThrow(/doesn't exist/);
  });

  it("won't switch sessions or models while the router is mid-request", async () => {
    await send();
    await expect(send({ model: "opus" })).rejects.toThrow(/middle of a request/);
  });

  it("restarts with the new model once the router is idle, keeping the session", async () => {
    await send();
    const first = children[0];
    first?.stdout.write(`${JSON.stringify({ type: "system", subtype: "init", session_id: "s1" })}\n`);
    first?.stdout.write(`${JSON.stringify({ type: "result", subtype: "success" })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    await send({ model: "opus" });
    expect(children).toHaveLength(2);
    expect(children[1]?.args).toEqual(expect.arrayContaining(["--model", "opus", "--resume", "s1"]));
  });

  it("remembers a busy router as interrupted across a restart", async () => {
    await send();
    await manager.shutdown();
    const saved = JSON.parse(await readFile(path.join(dir, "routers.json"), "utf8"));
    expect(saved[0]).toMatchObject({ phase: "interrupted" });

    const next = new RouterManager({
      settings: new SettingsFile(path.join(dir, "settings.json")),
      statePath: path.join(dir, "routers.json"),
      spawn: () => new FakeChild([]),
      sessionInfo: () => null,
      routerAgentExists: async () => true,
    });
    await next.load();
    expect(next.statuses()[0]).toMatchObject({ phase: "interrupted" });
  });

  it("ignores a corrupt state file", async () => {
    await writeFile(path.join(dir, "routers.json"), "{oops");
    await manager.load();
    expect(manager.statuses()).toEqual([]);
  });

  it("says so when an approval is no longer waiting", () => {
    expect(() => manager.answer("gone", true)).toThrow(/no longer waiting/);
  });
});
