import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAgents } from "../src/server/installAgents";

const source = path.join(__dirname, "..", "agents");

describe("installAgents", () => {
  let target: string;

  beforeEach(async () => {
    target = await mkdtemp(path.join(os.tmpdir(), "office-agents-"));
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  it("installs the whole team into an empty folder", async () => {
    const results = await installAgents(source, target, false);
    expect(results.map((result) => result.file)).toEqual([
      "coder.md",
      "designer.md",
      "reviewer.md",
      "router.md",
      "tester.md",
    ]);
    expect(results.every((result) => result.outcome === "installed")).toBe(true);
  });

  it("keeps a copy the user edited unless forced", async () => {
    await writeFile(path.join(target, "coder.md"), "my own coder");
    const kept = await installAgents(source, target, false);
    expect(kept.find((result) => result.file === "coder.md")?.outcome).toBe("kept-yours");
    expect(await readFile(path.join(target, "coder.md"), "utf8")).toBe("my own coder");

    const forced = await installAgents(source, target, true);
    expect(forced.find((result) => result.file === "coder.md")?.outcome).toBe("replaced");
  });

  it("reports unchanged files on a second run", async () => {
    await installAgents(source, target, false);
    const again = await installAgents(source, target, false);
    expect(again.every((result) => result.outcome === "unchanged")).toBe(true);
  });

  it("gives each role the model the plan assigned", async () => {
    const models: Record<string, string> = {};
    for (const role of ["router", "designer", "coder", "tester", "reviewer"]) {
      const text = await readFile(path.join(source, `${role}.md`), "utf8");
      models[role] = /^model:\s*(\S+)/m.exec(text)?.[1] ?? "";
    }
    expect(models).toEqual({
      router: "opus",
      designer: "opus",
      coder: "sonnet",
      tester: "sonnet",
      reviewer: "opus",
    });
  });
});
