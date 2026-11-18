import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROUTER_MODELS, type RouterModel } from "../../shared/protocol";
import type { RouterAgent } from "./routerManager";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** The `model:` in an agent file's frontmatter, if it's one the office can pass to the CLI. */
export function modelFromAgentFile(text: string): RouterModel | null {
  const frontmatter = FRONTMATTER.exec(text)?.[1];
  const value = frontmatter ? /^model:\s*([^\s#]+)/m.exec(frontmatter)?.[1] : undefined;
  return ROUTER_MODELS.find((model) => model === value) ?? null;
}

/**
 * Finds the router agent: a project's own `.claude/agents/router.md` wins over the user's
 * `~/.claude/agents/router.md`, the same order Claude Code uses.
 */
export async function findRouterAgent(cwd: string, claudeHome: string): Promise<RouterAgent | null> {
  const candidates = [
    path.join(cwd, ".claude", "agents", "router.md"),
    path.join(claudeHome, "agents", "router.md"),
  ];
  for (const candidate of candidates) {
    try {
      return { model: modelFromAgentFile(await readFile(candidate, "utf8")) };
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return null;
}
