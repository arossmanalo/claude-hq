import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { maskSecrets } from "../../shared/maskSecrets";
import {
  baseLineSchema,
  lastPromptLineSchema,
  relocatedLineSchema,
  titleLineSchema,
} from "./logSchema";

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 512 * 1024;
const PROMPT_TITLE_LENGTH = 80;

export interface SessionFileInfo {
  sessionId: string;
  filePath: string;
  cwd: string | null;
  title: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  sizeBytes: number;
  mtimeMs: number;
}

/**
 * Builds a session summary from the first 64 KB and last 512 KB of its log, so the building can
 * list hundreds of sessions (some over 100 MB) without parsing whole files.
 */
export async function summariseSessionFile(filePath: string): Promise<SessionFileInfo> {
  const info = await stat(filePath);
  const handle = await open(filePath, "r");
  try {
    const headLength = Math.min(HEAD_BYTES, info.size);
    const head = Buffer.alloc(headLength);
    await handle.read(head, 0, headLength, 0);
    const tailStart = Math.max(0, info.size - TAIL_BYTES);
    const tailLength = info.size - tailStart;
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, tailStart);

    const headLines = completeLines(head, false, info.size > headLength);
    const tailLines = completeLines(tail, tailStart > 0, false);
    return {
      sessionId: path.basename(filePath, ".jsonl"),
      filePath,
      ...readSummaryFields(headLines, tailLines),
      sizeBytes: info.size,
      mtimeMs: info.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}

/** Splits a byte window into whole lines, dropping a cut-off first or last line. */
function completeLines(bytes: Buffer, dropFirst: boolean, dropLast: boolean): string[] {
  const lines = bytes.toString("utf8").split("\n");
  if (dropFirst) lines.shift();
  if (dropLast || !bytes.toString("utf8").endsWith("\n")) lines.pop();
  return lines.filter((line) => line.trim().length > 0);
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function readSummaryFields(headLines: string[], tailLines: string[]) {
  let cwd: string | null = null;
  let relocatedCwd: string | null = null;
  let startedAt: string | null = null;
  let updatedAt: string | null = null;
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let lastPrompt: string | null = null;

  const visit = (json: unknown) => {
    const base = baseLineSchema.safeParse(json);
    if (!base.success) return;
    const line = base.data;
    if (line.cwd && !cwd) cwd = line.cwd;
    if (line.timestamp) {
      if (!startedAt || line.timestamp < startedAt) startedAt = line.timestamp;
      if (!updatedAt || line.timestamp > updatedAt) updatedAt = line.timestamp;
    }
    const title = titleLineSchema.safeParse(json);
    if (title.success) {
      if (title.data.type === "custom-title") customTitle = title.data.customTitle;
      else aiTitle = title.data.aiTitle;
    }
    const relocated = relocatedLineSchema.safeParse(json);
    if (relocated.success) relocatedCwd = relocated.data.relocatedCwd;
    const prompt = lastPromptLineSchema.safeParse(json);
    if (prompt.success) lastPrompt = prompt.data.lastPrompt;
  };

  for (const line of headLines) visit(parseJson(line));
  for (const line of tailLines) visit(parseJson(line));

  const promptTitle: string | null = lastPrompt;
  return {
    cwd: relocatedCwd ?? cwd,
    title: maskTitle(customTitle ?? aiTitle ?? (promptTitle ? truncate(promptTitle) : null)),
    startedAt,
    updatedAt,
  };
}

/** Titles often come from the user's last prompt, which can contain a pasted key. */
function maskTitle(title: string | null): string | null {
  return title === null ? null : maskSecrets(title);
}

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > PROMPT_TITLE_LENGTH
    ? `${oneLine.slice(0, PROMPT_TITLE_LENGTH - 1)}…`
    : oneLine;
}

/** Caches summaries by file size and modification time so rescans only reread changed files. */
export class SessionIndex {
  private readonly cache = new Map<string, SessionFileInfo>();

  constructor(private readonly projectsRoot: string) {}

  async scan(): Promise<SessionFileInfo[]> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.projectsRoot);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const results: SessionFileInfo[] = [];
    const seen = new Set<string>();
    for (const dir of projectDirs) {
      const dirPath = path.join(this.projectsRoot, dir);
      let files: string[];
      try {
        files = await readdir(dirPath);
      } catch {
        // Not a directory, or removed during the scan.
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(dirPath, file);
        seen.add(filePath);
        const summary = await this.summary(filePath);
        if (summary) results.push(summary);
      }
    }
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key);
    return results;
  }

  private async summary(filePath: string): Promise<SessionFileInfo | null> {
    try {
      const info = await stat(filePath);
      const cached = this.cache.get(filePath);
      if (cached && cached.sizeBytes === info.size && cached.mtimeMs === info.mtimeMs) {
        return cached;
      }
      const fresh = await summariseSessionFile(filePath);
      this.cache.set(filePath, fresh);
      return fresh;
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }
}
