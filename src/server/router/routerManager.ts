import { EventEmitter } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import type { PermissionRequest, RouterModel, RouterStatus } from "../../shared/protocol";
import { ROUTER_MODELS } from "../../shared/protocol";
import { canonicalFolder, projectKey } from "../paths";
import { writeJsonAtomically, type SettingsFile } from "../settings";
import { decide } from "./permissionPolicy";
import { RouterProcess, type SpawnRouter } from "./routerProcess";

const PERSIST_DELAY_MS = 300;

const savedRouterSchema = z.array(
  z.object({
    cwd: z.string(),
    sessionId: z.string().nullable(),
    model: z.enum(ROUTER_MODELS).nullable(),
    phase: z.string(),
  }),
);

export interface SessionInfo {
  live: boolean;
  ownedByOffice: boolean;
}

export interface RouterManagerOptions {
  settings: SettingsFile;
  spawn: SpawnRouter;
  /** Where router state is kept so an interrupted task can be resumed after a restart. */
  statePath: string;
  sessionInfo: (sessionId: string) => SessionInfo | null;
  /** The router agent definition for this folder, or null when it isn't installed. */
  routerAgent: (cwd: string) => Promise<RouterAgent | null>;
}

export interface RouterAgent {
  /** The `model:` from the agent file, when it names one the picker knows. */
  model: RouterModel | null;
}

export interface SendRequest {
  cwd: string;
  sessionId: string | null;
  text: string;
  model: RouterModel | null;
}

type ManagerEvents = {
  changed: [];
  permissions: [];
  taskDone: [cwd: string];
  /** Ownership or waiting agents changed for this session. */
  session: [sessionId: string];
};

/** Runs at most one router process per project folder. */
export class RouterManager extends EventEmitter<ManagerEvents> {
  private readonly routers = new Map<string, RouterProcess>();
  /** Routers that ended (stopped, interrupted, or failed), kept so the office can offer Resume. */
  private readonly ended = new Map<string, RouterStatus>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: RouterManagerOptions) {
    super();
  }

  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.options.statePath, "utf8");
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    let saved: z.infer<typeof savedRouterSchema>;
    try {
      const parsed = savedRouterSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return;
      saved = parsed.data;
    } catch {
      // A corrupt state file only loses the Resume buttons; the session logs are untouched.
      return;
    }
    for (const record of saved) {
      // A router that was working when the server last stopped (or crashed) was cut off.
      const cutOff = ["working", "starting", "interrupted"].includes(record.phase);
      this.ended.set(projectKey(record.cwd), {
        cwd: record.cwd,
        sessionId: record.sessionId,
        phase: cutOff ? "interrupted" : "stopped",
        model: record.model,
        queued: [],
        handoffsThisRequest: 0,
        handoffCap: this.options.settings.value.handoffCap,
        attention: null,
        error: null,
      });
    }
  }

  statuses(): RouterStatus[] {
    const live = [...this.routers.values()].map((router) => router.status());
    return [...live, ...this.ended.values()];
  }

  permissions(): PermissionRequest[] {
    return [...this.routers.values()].flatMap((router) => router.permissionRequests());
  }

  ownedSessionIds(): Set<string> {
    const ids = new Set<string>();
    for (const router of this.routers.values()) if (router.sessionId) ids.add(router.sessionId);
    return ids;
  }

  /** "busy" while the office's router for this session is mid-request, else "idle". */
  liveStatus(sessionId: string): string | null {
    for (const router of this.routers.values()) {
      if (router.sessionId === sessionId) return router.isBusy ? "busy" : "idle";
    }
    return null;
  }

  waitingAgentIds(sessionId: string): Set<string> {
    for (const router of this.routers.values()) {
      if (router.sessionId === sessionId) return router.waitingAgentIds();
    }
    return new Set();
  }

  async send(request: SendRequest): Promise<void> {
    const cwd = canonicalFolder(request.cwd);
    await this.assertFolder(cwd);
    const key = projectKey(cwd);
    const existing = this.routers.get(key);

    if (existing?.alive) {
      const otherSession =
        request.sessionId !== null && existing.sessionId !== null && request.sessionId !== existing.sessionId;
      const otherModel = request.model !== null && request.model !== existing.model;
      if (!otherSession && !otherModel) {
        existing.send(request.text);
        return;
      }
      if (existing.isBusy) {
        throw new Error(
          otherSession
            ? "This project's router is busy with another session. Stop it first, then continue this one."
            : "The router is in the middle of a request. Change the model when it finishes, or stop it first.",
        );
      }
      const resumeId = request.sessionId ?? existing.sessionId;
      // The office is replacing its own router: wait for it to exit so two processes never write
      // the same session, and skip the "running elsewhere" check, which would see that process.
      this.routers.delete(key);
      await existing.killAndWait();
      await this.startRouter(cwd, { ...request, sessionId: resumeId }, { replacingOwnRouter: true });
      return;
    }

    await this.startRouter(cwd, request, { replacingOwnRouter: false });
  }

  stop(cwd: string): void {
    this.routerFor(cwd)?.stop();
  }

  clearQueue(cwd: string): void {
    this.routerFor(cwd)?.clearQueue();
  }

  answer(requestId: string, allow: boolean): void {
    for (const router of this.routers.values()) {
      if (router.answer(requestId, allow)) return;
    }
    throw new Error("That approval is no longer waiting. The router may have stopped or moved on.");
  }

  /** Called on server shutdown: remember which routers were mid-task, then end them. */
  async shutdown(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    const records = this.stateRecords().map((record) =>
      // Anything still running is about to be cut off.
      record.phase === "working" || record.phase === "starting"
        ? { ...record, phase: "interrupted" }
        : record,
    );
    await writeJsonAtomically(this.options.statePath, records);
    for (const router of this.routers.values()) router.kill();
  }

  private routerFor(cwd: string): RouterProcess | undefined {
    return this.routers.get(projectKey(canonicalFolder(cwd)));
  }

  private async assertFolder(cwd: string): Promise<void> {
    try {
      if ((await stat(cwd)).isDirectory()) return;
    } catch {
      // Reported below.
    }
    throw new Error(`The folder ${cwd} doesn't exist or isn't a folder.`);
  }

  private async startRouter(
    cwd: string,
    request: SendRequest,
    { replacingOwnRouter }: { replacingOwnRouter: boolean },
  ): Promise<void> {
    if (request.sessionId && !replacingOwnRouter) {
      const info = this.options.sessionInfo(request.sessionId);
      if (info?.live && !info.ownedByOffice) {
        throw new Error(
          "This session is still running in Claude Code. Continue it there, or wait until it ends.",
        );
      }
    }
    const agent = await this.options.routerAgent(cwd);
    if (!agent) {
      throw new Error(
        "The router agent isn't installed. Run `npm run agents:install` in the Claude Office folder, then send again.",
      );
    }

    const key = projectKey(cwd);
    const router = new RouterProcess({
      cwd,
      resumeSessionId: request.sessionId,
      // Pass the agent file's model explicitly: the user's global "model" setting would win otherwise.
      model: request.model ?? agent.model,
      handoffCap: this.options.settings.value.handoffCap,
      spawn: this.options.spawn,
      decide: ({ role, toolName, input }) =>
        decide({ role, toolName, input, cwd, safeCommands: this.options.settings.value.safeCommands }),
    });
    let knownSessionId = router.sessionId;
    router.on("changed", () => {
      if (router.sessionId !== knownSessionId) {
        if (knownSessionId) this.emit("session", knownSessionId);
        knownSessionId = router.sessionId;
      }
      if (router.sessionId) this.emit("session", router.sessionId);
      this.changed();
    });
    router.on("permissions", () => {
      this.emit("permissions");
      if (router.sessionId) this.emit("session", router.sessionId);
    });
    router.on("taskDone", () => this.emit("taskDone", cwd));
    router.on("exit", () => {
      if (this.routers.get(key) === router) {
        this.routers.delete(key);
        this.ended.set(key, router.status());
      }
      if (router.sessionId) this.emit("session", router.sessionId);
      this.changed();
    });

    this.ended.delete(key);
    this.routers.set(key, router);
    router.start();
    router.send(request.text);
    this.changed();
  }

  private changed(): void {
    this.emit("changed");
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      writeJsonAtomically(this.options.statePath, this.stateRecords()).catch(() => {
        // Losing this file only loses Resume buttons after a restart; the next change retries.
      });
    }, PERSIST_DELAY_MS);
  }

  private stateRecords(): z.infer<typeof savedRouterSchema> {
    return this.statuses().map((status) => ({
      cwd: status.cwd,
      sessionId: status.sessionId,
      model: status.model,
      phase: status.phase,
    }));
  }
}
