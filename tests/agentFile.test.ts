import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRouterAgent, modelFromAgentFile } from "../src/server/router/agentFile";

describe("modelFromAgentFile", () => {
  it("reads the model from the frontmatter", () => {
    expect(modelFromAgentFile("---\nname: router\nmodel: opus\n---\nBody")).toBe("opus");
  });

  it("ignores model lines in the body and values the CLI picker doesn't know", () => {
    expect(modelFromAgentFile("---\nname: router\n---\nmodel: haiku")).toBeNull();
    expect(modelFromAgentFile("---\nmodel: inherit\n---\n")).toBeNull();
  });

  it("handles Windows line endings", () => {
    expect(modelFromAgentFile("---\r\nmodel: sonnet\r\n---\r\n")).toBe("sonnet");
  });
});

describe("findRouterAgent", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "office-agent-"));
    await mkdir(path.join(root, "home", "agents"), { recursive: true });
    await mkdir(path.join(root, "project", ".claude", "agents"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns null when no router is installed", async () => {
    expect(await findRouterAgent(path.join(root, "project"), path.join(root, "home"))).toBeNull();
  });

  it("prefers the project's own router over the user's", async () => {
    await writeFile(path.join(root, "home", "agents", "router.md"), "---\nmodel: opus\n---\n");
    expect(await findRouterAgent(path.join(root, "project"), path.join(root, "home"))).toEqual({
      model: "opus",
    });
    await writeFile(
      path.join(root, "project", ".claude", "agents", "router.md"),
      "---\nmodel: haiku\n---\n",
    );
    expect(await findRouterAgent(path.join(root, "project"), path.join(root, "home"))).toEqual({
      model: "haiku",
    });
  });
});
