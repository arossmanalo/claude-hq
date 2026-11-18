import { EventEmitter } from "node:events";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type {
  ChatMessage,
  ProjectSummary,
  SessionDetail,
  SessionSummary,
} from "../../shared/model";
import { canonicalFolder, projectKey } from "../paths";
import { JsonlTail } from "./jsonlTail";
import { readLiveSessions, type LiveSession } from "./liveRegistry";
import { subagentMetaSchema } from "./logSchema";
import { SessionAccumulator } from "./sessionAccumulator";
import { SessionIndex, type SessionFileInfo } from "./sessionIndex";

/** Archived sessions kept fully parsed after you last opened them. Live ones are always kept. */
const MAX_IDLE_TRACKERS = 8;
const FLUSH_DELAY_MS = 200;
const SUBAGENT_FILE = /^agent-(.+)\.jsonl$/;

export interface LogStoreOptions {
  projectsDir: string;
  liveDir: string;
  livePollMs?: number;
  /** Session ids whose router process the office itself is running. */
  ownedSessionIds?: () => ReadonlySet<string>;
  /** Agent ids with an open permission request, per session. */
  waitingAgentIds?: (sessionId: string) => ReadonlySet<string>;
  /**
   * "busy" or "idle" for sessions the office runs. The office knows its own router's state
   * sooner than Claude Code's registry does.
   */
  ownedLiveStatus?: (sessionId: string) => string | null;
}

interface Tracker {
  info: SessionFileInfo;
  acc: SessionAccumulator;
  main: JsonlTail;
  subagents: Map<string, JsonlTail>;
  metaMtimes: Map<string, number>;
  /** Serialises refreshes so two reads never run on the same tail at once. */
  queue: Promise<void>;
  lastOpenedAt: number;
}

type StoreEvents = {
  projects: [];
  session: [sessionId: string];
  error: [error: Error];
};

export class LogStore extends EventEmitter<StoreEvents> {
  private readonly index: SessionIndex;
  private files = new Map<string, SessionFileInfo>();
  private live = new Map<string, LiveSession>();
  private readonly trackers = new Map<string, Tracker>();
  private readonly dirty = new Set<string>();
  private projectsDirty = false;
  private watcher: FSWatcher | null = null;
  private liveTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private lastProjectsJson = "";

  constructor(private readonly options: LogStoreOptions) {
    super();
    this.index = new SessionIndex(options.projectsDir);
  }

  async start(): Promise<void> {
    await this.rescan();
    this.live = await readLiveSessions(this.options.liveDir);
    this.lastProjectsJson = JSON.stringify(this.projects());
    this.watcher = watch(this.options.projectsDir, {
      ignoreInitial: true,
      depth: 3,
      ignored: (filePath, stats) => !!stats?.isFile() && !/\.(jsonl|json)$/.test(filePath),
    });
    this.watcher.on("all", (_event, filePath) => this.onFileEvent(filePath));
    this.watcher.on("error", (error) => {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    });
    this.liveTimer = setInterval(() => void this.pollLive(), this.options.livePollMs ?? 1500);
  }

  async stop(): Promise<void> {
    if (this.liveTimer) clearInterval(this.liveTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.watcher?.close();
  }

  projects(): ProjectSummary[] {
    const byKey = new Map<string, ProjectSummary>();
    const add = (summary: SessionSummary) => {
      const cwd = canonicalFolder(summary.cwd);
      const key = projectKey(cwd);
      let project = byKey.get(key);
      if (!project) {
        project = { key, name: path.basename(cwd), cwd, sessions: [], live: false };
        byKey.set(key, project);
      }
      project.sessions.push(summary);
      if (summary.live) project.live = true;
    };
    for (const info of this.files.values()) {
      const summary = this.summaryFor(info.sessionId);
      if (summary) add(summary);
    }
    // A session that just started may be running before its log file exists.
    for (const live of this.live.values()) {
      if (!this.files.has(live.sessionId) && live.cwd) {
        add({
          sessionId: live.sessionId,
          cwd: live.cwd,
          title: live.name,
          startedAt: null,
          updatedAt: null,
          live: true,
          liveStatus: live.status,
          ownedByOffice: this.owned().has(live.sessionId),
          sizeBytes: 0,
        });
      }
    }
    const projects = [...byKey.values()];
    for (const project of projects) project.sessions.sort(byMostRecent);
    return projects.sort(
      (a, b) =>
        Number(b.live) - Number(a.live) ||
        (b.sessions[0]?.updatedAt ?? "").localeCompare(a.sessions[0]?.updatedAt ?? ""),
    );
  }

  /** Full state of one session. Parses its whole log the first time, then only what's new. */
  async detail(sessionId: string): Promise<SessionDetail | null> {
    const summary = this.summaryFor(sessionId);
    if (!summary) return null;
    const tracker = await this.ensureTracker(sessionId);
    if (!tracker) return null;
    tracker.lastOpenedAt = Date.now();
    return tracker.acc.snapshot({
      summary,
      waitingAgentIds: this.options.waitingAgentIds?.(sessionId),
    });
  }

  async messagesBefore(sessionId: string, before: number, limit: number): Promise<ChatMessage[]> {
    const tracker = await this.ensureTracker(sessionId);
    return tracker ? tracker.acc.messagesBefore(before, limit) : [];
  }

  /** Call when office-owned state (waiting approvals, ownership) changes for a session. */
  notify(sessionId: string): void {
    this.projectsDirty = true;
    if (this.trackers.has(sessionId)) this.dirty.add(sessionId);
    this.scheduleFlush();
  }

  private owned(): ReadonlySet<string> {
    return this.options.ownedSessionIds?.() ?? new Set();
  }

  /** Live and ownership facts for one session, or null if the office has never seen it. */
  sessionSummary(sessionId: string): SessionSummary | null {
    return this.summaryFor(sessionId);
  }

  private summaryFor(sessionId: string): SessionSummary | null {
    const info = this.files.get(sessionId);
    const live = this.live.get(sessionId);
    const cwd = info?.cwd ?? live?.cwd;
    if (!cwd) return null;
    const owned = this.owned().has(sessionId);
    return {
      sessionId,
      cwd,
      title: info?.title ?? live?.name ?? null,
      startedAt: info?.startedAt ?? null,
      updatedAt: info?.updatedAt ?? null,
      live: live !== undefined || owned,
      liveStatus: (owned ? this.options.ownedLiveStatus?.(sessionId) : null) ?? live?.status ?? null,
      ownedByOffice: owned,
      sizeBytes: info?.sizeBytes ?? 0,
    };
  }

  private async rescan(): Promise<void> {
    const files = await this.index.scan();
    this.files = new Map(files.map((info) => [info.sessionId, info]));
  }

  private onFileEvent(filePath: string): void {
    const relative = path.relative(this.options.projectsDir, filePath);
    const parts = relative.split(path.sep);
    const sessionPart = parts[1];
    if (!sessionPart) return;
    const sessionId = sessionPart.replace(/\.jsonl$/, "");
    this.projectsDirty = true;
    if (this.trackers.has(sessionId)) this.dirty.add(sessionId);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((error: unknown) => {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      });
    }, FLUSH_DELAY_MS);
  }

  private async flush(): Promise<void> {
    if (this.projectsDirty) {
      this.projectsDirty = false;
      await this.rescan();
      this.emitProjectsIfChanged();
    }
    const sessions = [...this.dirty];
    this.dirty.clear();
    for (const sessionId of sessions) {
      const tracker = this.trackers.get(sessionId);
      if (!tracker) continue;
      await this.refresh(tracker);
      this.emit("session", sessionId);
    }
  }

  private async pollLive(): Promise<void> {
    let next: Map<string, LiveSession>;
    try {
      next = await readLiveSessions(this.options.liveDir);
    } catch (error: unknown) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const changed = new Set<string>();
    for (const [id, session] of next) {
      if (this.live.get(id)?.status !== session.status) changed.add(id);
    }
    for (const id of this.live.keys()) if (!next.has(id)) changed.add(id);
    this.live = next;
    if (changed.size === 0) return;
    this.emitProjectsIfChanged();
    for (const id of changed) {
      if (this.trackers.has(id)) this.emit("session", id);
    }
  }

  private emitProjectsIfChanged(): void {
    const json = JSON.stringify(this.projects());
    if (json === this.lastProjectsJson) return;
    this.lastProjectsJson = json;
    this.emit("projects");
  }

  private async ensureTracker(sessionId: string): Promise<Tracker | null> {
    const existing = this.trackers.get(sessionId);
    if (existing) {
      await existing.queue;
      return existing;
    }
    const info = this.files.get(sessionId);
    if (!info) return null;
    const tracker: Tracker = {
      info,
      acc: new SessionAccumulator(),
      main: new JsonlTail(info.filePath),
      subagents: new Map(),
      metaMtimes: new Map(),
      queue: Promise.resolve(),
      lastOpenedAt: Date.now(),
    };
    this.trackers.set(sessionId, tracker);
    await this.refresh(tracker);
    this.evictIdleTrackers();
    return tracker;
  }

  private refresh(tracker: Tracker): Promise<void> {
    tracker.queue = tracker.queue.then(() => this.readTracker(tracker));
    return tracker.queue;
  }

  private async readTracker(tracker: Tracker): Promise<void> {
    try {
      const mainResult = await tracker.main.readNew((line) => tracker.acc.applyRouterLine(line));
      if (mainResult === "reset") {
        // The log was rewritten: rebuild from scratch, including subagents.
        tracker.acc = new SessionAccumulator();
        tracker.main = new JsonlTail(tracker.info.filePath);
        tracker.subagents.clear();
        tracker.metaMtimes.clear();
        await tracker.main.readNew((line) => tracker.acc.applyRouterLine(line));
      }
      await this.readSubagents(tracker);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.trackers.delete(tracker.info.sessionId);
        return;
      }
      throw error;
    }
  }

  private async readSubagents(tracker: Tracker): Promise<void> {
    const dir = path.join(path.dirname(tracker.info.filePath), tracker.info.sessionId, "subagents");
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const match = SUBAGENT_FILE.exec(entry);
      if (!match?.[1]) continue;
      const agentId = match[1];
      await this.readSubagentMeta(tracker, dir, agentId);
      let tail = tracker.subagents.get(agentId);
      if (!tail) {
        tail = new JsonlTail(path.join(dir, entry));
        tracker.subagents.set(agentId, tail);
      }
      await tail.readNew((line) => tracker.acc.applySubagentLine(agentId, line));
    }
  }

  private async readSubagentMeta(tracker: Tracker, dir: string, agentId: string): Promise<void> {
    const metaPath = path.join(dir, `agent-${agentId}.meta.json`);
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(metaPath)).mtimeMs;
    } catch {
      // Claude Code writes the meta file just after the log; it shows up on a later refresh.
      return;
    }
    if (tracker.metaMtimes.get(agentId) === mtimeMs) return;
    try {
      const parsed = subagentMetaSchema.safeParse(JSON.parse(await readFile(metaPath, "utf8")));
      if (parsed.success) tracker.acc.setSubagentMeta(agentId, parsed.data);
      tracker.metaMtimes.set(agentId, mtimeMs);
    } catch {
      // Half-written meta file; retry on the next change.
    }
  }

  private evictIdleTrackers(): void {
    const idle = [...this.trackers.entries()]
      .filter(([sessionId]) => !this.live.has(sessionId) && !this.owned().has(sessionId))
      .sort(([, a], [, b]) => b.lastOpenedAt - a.lastOpenedAt);
    for (const [sessionId] of idle.slice(MAX_IDLE_TRACKERS)) this.trackers.delete(sessionId);
  }
}

function byMostRecent(a: SessionSummary, b: SessionSummary): number {
  return Number(b.live) - Number(a.live) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
}
