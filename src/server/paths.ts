import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Claude Code's config folder. Honors CLAUDE_CONFIG_DIR the same way Claude Code does. */
export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

export function projectsDir(): string {
  return path.join(claudeHome(), "projects");
}

export function liveSessionsDir(): string {
  return path.join(claudeHome(), "sessions");
}

/** Folder for the office's own settings, outside any repo. */
export function officeHome(): string {
  return process.env.OFFICE_HOME ?? path.join(os.homedir(), ".claude-office");
}

/** Stable key for a project folder: case-insensitive on Windows, no trailing separator. */
export function projectKey(cwd: string): string {
  const normalised = path.normalize(canonicalFolder(cwd)).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalised.toLowerCase() : normalised;
}

const canonicalCache = new Map<string, string>();

/**
 * Expands Windows 8.3 short names (C:\Users\ABCDEF~1) to the long path, so one folder recorded
 * both ways is still one project. A folder that no longer exists keeps the path as recorded.
 */
export function canonicalFolder(folder: string): string {
  const cached = canonicalCache.get(folder);
  if (cached !== undefined) return cached;
  let resolved = folder;
  if (folder.includes("~")) {
    try {
      resolved = realpathSync.native(folder);
    } catch {
      // Deleted folder or no access: the recorded path is the best we have.
      resolved = folder;
    }
  }
  canonicalCache.set(folder, resolved);
  return resolved;
}
