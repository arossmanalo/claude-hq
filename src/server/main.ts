import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtClientDir, createApp } from "./app";
import type { ClientHub, HubHandlers } from "./clientHub";
import { LogStore } from "./logs/logStore";
import { openBrowser } from "./openBrowser";
import { claudeHome, liveSessionsDir, officeHome, projectsDir } from "./paths";
import { findFreePort, HOST } from "./port";
import { findClaudeExecutable } from "./router/claudeBinary";
import { RouterManager } from "./router/routerManager";
import type { ChildLike } from "./router/routerProcess";
import { SettingsFile } from "./settings";

const DEFAULT_PORT = 4317;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const isDev = process.argv.includes("--dev");

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** The router agent can live in the user's agents folder or be overridden by the project. */
async function routerAgentExists(cwd: string): Promise<boolean> {
  return (
    (await fileExists(path.join(cwd, ".claude", "agents", "router.md"))) ||
    (await fileExists(path.join(claudeHome(), "agents", "router.md")))
  );
}

async function main(): Promise<void> {
  const port = await findFreePort(Number(process.env.OFFICE_PORT ?? DEFAULT_PORT));
  const settings = new SettingsFile(path.join(officeHome(), "settings.json"));
  const settingsProblem = await settings.load();
  if (settingsProblem) console.warn(settingsProblem);

  let manager: RouterManager | null = null;
  const store = new LogStore({
    projectsDir: projectsDir(),
    liveDir: liveSessionsDir(),
    ownedSessionIds: () => manager?.ownedSessionIds() ?? new Set(),
    waitingAgentIds: (sessionId) => manager?.waitingAgentIds(sessionId) ?? new Set(),
    ownedLiveStatus: (sessionId) => manager?.liveStatus(sessionId) ?? null,
  });

  let claudeBin: string | null = null;
  const routers = new RouterManager({
    settings,
    statePath: path.join(officeHome(), "routers.json"),
    spawn: (args, cwd): ChildLike => {
      claudeBin ??= findClaudeExecutable();
      return spawn(claudeBin, args, { cwd, stdio: "pipe", windowsHide: true });
    },
    sessionInfo: (sessionId) => store.sessionSummary(sessionId),
    routerAgentExists,
  });
  manager = routers;
  await routers.load();
  await store.start();

  const hubHandlers = (): HubHandlers => ({
    onConnect: async (send) => {
      send({ type: "projects", projects: store.projects() });
      send({ type: "routers", routers: routers.statuses() });
      send({ type: "permissions", requests: routers.permissions() });
      send({ type: "settings", sound: settings.value.sound });
      if (settingsProblem) send({ type: "notice", level: "error", message: settingsProblem });
    },
    onSubscribe: async (sessionIds, send) => {
      for (const sessionId of sessionIds) {
        const detail = await store.detail(sessionId);
        if (detail) send({ type: "session", detail });
      }
    },
    onCommand: async (message) => {
      switch (message.type) {
        case "chat.send":
          await routers.send({
            cwd: message.cwd,
            sessionId: message.sessionId,
            text: message.text,
            model: message.model,
          });
          return;
        case "chat.stop":
          routers.stop(message.cwd);
          return;
        case "chat.clearQueue":
          routers.clearQueue(message.cwd);
          return;
        case "permission.answer":
          routers.answer(message.requestId, message.allow);
          return;
        case "settings.sound": {
          const next = await settings.update((current) => ({
            ...current,
            sound: { muted: message.muted, volume: message.volume },
          }));
          hubRef?.broadcast({ type: "settings", sound: next.sound });
          return;
        }
      }
    },
  });

  let hubRef: ClientHub | null = null;
  const { app, hub } = await createApp({
    port,
    store,
    hubHandlers,
    clientDir: isDev ? undefined : builtClientDir(repoRoot),
    logLevel: process.env.OFFICE_LOG_LEVEL,
  });

  hubRef = hub;
  routers.on("changed", () => hub.broadcast({ type: "routers", routers: routers.statuses() }));
  routers.on("permissions", () =>
    hub.broadcast({ type: "permissions", requests: routers.permissions() }),
  );
  routers.on("taskDone", (cwd) => hub.broadcast({ type: "taskDone", cwd }));
  routers.on("session", (sessionId) => store.notify(sessionId));

  if (isDev) {
    const { createServer } = await import("vite");
    const middie = (await import("@fastify/middie")).default;
    const vite = await createServer({
      configFile: path.join(repoRoot, "vite.config.ts"),
      server: { middlewareMode: true, hmr: { server: app.server } },
      appType: "spa",
    });
    await app.register(middie);
    app.use(vite.middlewares);
  }

  await app.listen({ port, host: HOST });
  const url = `http://${HOST}:${port}`;
  console.log(`Claude Office is running at ${url}`);
  if (process.env.OFFICE_NO_OPEN !== "1" && !process.argv.includes("--no-open")) openBrowser(url);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await routers.shutdown();
    await store.stop();
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
