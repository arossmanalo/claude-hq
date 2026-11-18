import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const liveSessionSchema = z.looseObject({
  pid: z.number().int().positive(),
  sessionId: z.string(),
  cwd: z.string().optional(),
  status: z.string().optional(),
  name: z.string().optional(),
});

export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string | null;
  status: string | null;
  name: string | null;
}

export type PidCheck = (pid: number) => boolean;

export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means the process exists but belongs to someone else.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/**
 * Reads ~/.claude/sessions/<pid>.json and returns the sessions whose process is still running,
 * keyed by session id. Stale files from crashed processes are ignored, not deleted: they belong
 * to Claude Code.
 */
export async function readLiveSessions(
  dir: string,
  pidRunning: PidCheck = isPidRunning,
): Promise<Map<string, LiveSession>> {
  const live = new Map<string, LiveSession>();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return live;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    let parsed: z.infer<typeof liveSessionSchema>;
    try {
      const text = await readFile(path.join(dir, entry), "utf8");
      const result = liveSessionSchema.safeParse(JSON.parse(text));
      if (!result.success) continue;
      parsed = result.data;
    } catch {
      // The file can vanish or be half-written while Claude Code updates it; the next poll retries.
      continue;
    }
    if (!pidRunning(parsed.pid)) continue;
    live.set(parsed.sessionId, {
      pid: parsed.pid,
      sessionId: parsed.sessionId,
      cwd: parsed.cwd ?? null,
      status: parsed.status ?? null,
      name: parsed.name ?? null,
    });
  }
  return live;
}
