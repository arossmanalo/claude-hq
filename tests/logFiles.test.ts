import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlTail } from "../src/server/logs/jsonlTail";
import { readLiveSessions } from "../src/server/logs/liveRegistry";
import { SessionIndex, summariseSessionFile } from "../src/server/logs/sessionIndex";

const fixtures = path.join(__dirname, "fixtures/claude");
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("JsonlTail", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "office-tail-"));
    file = path.join(dir, "log.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function read(tail: JsonlTail): Promise<{ lines: string[]; result: string }> {
    const lines: string[] = [];
    const result = await tail.readNew((line) => lines.push(line));
    return { lines, result };
  }

  it("delivers only complete lines and holds back a line still being written", async () => {
    await writeFile(file, '{"a":1}\n{"b":');
    const tail = new JsonlTail(file);
    expect((await read(tail)).lines).toEqual(['{"a":1}']);
    await appendFile(file, '2}\n{"c":3}\n');
    expect((await read(tail)).lines).toEqual(['{"b":2}', '{"c":3}']);
    expect((await read(tail)).lines).toEqual([]);
  });

  it("keeps a multi-byte character intact when it arrives in two writes", async () => {
    const bytes = Buffer.from('{"t":"café ☕"}\n', "utf8");
    const split = bytes.indexOf(0xe2) + 1;
    await writeFile(file, bytes.subarray(0, split));
    const tail = new JsonlTail(file);
    expect((await read(tail)).lines).toEqual([]);
    await appendFile(file, bytes.subarray(split));
    expect((await read(tail)).lines).toEqual(['{"t":"café ☕"}']);
  });

  it("starts over and says so when the file is rewritten shorter", async () => {
    await writeFile(file, '{"a":1}\n{"b":2}\n');
    const tail = new JsonlTail(file);
    await read(tail);
    await writeFile(file, '{"z":9}\n');
    expect(await read(tail)).toEqual({ lines: ['{"z":9}'], result: "reset" });
  });
});

describe("summariseSessionFile", () => {
  it("reads folder, title, and time range from the ends of the file", async () => {
    const summary = await summariseSessionFile(
      path.join(fixtures, "projects/D--demo-shop", `${SESSION_ID}.jsonl`),
    );
    expect(summary).toMatchObject({
      sessionId: SESSION_ID,
      cwd: "D:\\demo\\shop",
      title: "Cart badge",
      startedAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:05:01.000Z",
    });
  });

  it("falls back to the last prompt as the title, trimmed to one short line", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "office-index-"));
    try {
      const file = path.join(dir, "s.jsonl");
      const prompt = `Please   build\n${"x".repeat(200)}`;
      await writeFile(
        file,
        `${JSON.stringify({ type: "last-prompt", lastPrompt: prompt })}\n` +
          `${JSON.stringify({ type: "user", cwd: "D:\\p", message: { content: "hi" } })}\n`,
      );
      const summary = await summariseSessionFile(file);
      expect(summary.title?.startsWith("Please build x")).toBe(true);
      expect(summary.title?.length).toBe(80);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SessionIndex", () => {
  it("lists every session log in every project folder", async () => {
    const sessions = await new SessionIndex(path.join(fixtures, "projects")).scan();
    expect(sessions.map((session) => session.sessionId)).toEqual([SESSION_ID]);
  });

  it("returns nothing when Claude Code has never run", async () => {
    expect(await new SessionIndex(path.join(fixtures, "missing")).scan()).toEqual([]);
  });
});

describe("readLiveSessions", () => {
  it("keeps sessions whose process is running and skips stale or broken files", async () => {
    const live = await readLiveSessions(path.join(fixtures, "sessions"), (pid) => pid === 4242);
    expect([...live.keys()]).toEqual([SESSION_ID]);
    expect(live.get(SESSION_ID)).toMatchObject({ pid: 4242, status: "busy" });
  });
});
