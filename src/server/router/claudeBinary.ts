import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Finds the real Claude Code executable. On Windows the npm install puts a `claude.cmd` shim on
 * PATH; Node can't spawn that without a shell, and a shell would mangle the JSON arguments, so
 * resolve the `claude.exe` it points to instead.
 */
export function findClaudeExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OFFICE_CLAUDE_BIN;
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`OFFICE_CLAUDE_BIN points to ${override}, which doesn't exist.`);
  }
  const pathDirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const isWindows = process.platform === "win32";
  for (const dir of pathDirs) {
    if (isWindows) {
      const exe = path.join(dir, "claude.exe");
      if (existsSync(exe)) return exe;
      if (existsSync(path.join(dir, "claude.cmd"))) {
        const bundled = path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
        if (existsSync(bundled)) return bundled;
      }
    } else {
      const bin = path.join(dir, "claude");
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error(
    "Couldn't find Claude Code. Install it (npm install -g @anthropic-ai/claude-code) or set OFFICE_CLAUDE_BIN to the claude executable.",
  );
}
