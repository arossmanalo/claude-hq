import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtClientDir, createApp } from "./app";
import { LogStore } from "./logs/logStore";
import { openBrowser } from "./openBrowser";
import { liveSessionsDir, projectsDir } from "./paths";
import { findFreePort, HOST } from "./port";
import type { HubHandlers } from "./clientHub";

const DEFAULT_PORT = 4317;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const isDev = process.argv.includes("--dev");

function hubHandlers(store: LogStore): HubHandlers {
  return {
    onConnect: async (send) => {
      send({ type: "projects", projects: store.projects() });
    },
    onSubscribe: async (sessionIds, send) => {
      for (const sessionId of sessionIds) {
        const detail = await store.detail(sessionId);
        if (detail) send({ type: "session", detail });
      }
    },
    onCommand: async () => {
      throw new Error("Chatting with the router isn't available in this build yet.");
    },
  };
}

async function main(): Promise<void> {
  const port = await findFreePort(Number(process.env.OFFICE_PORT ?? DEFAULT_PORT));
  const store = new LogStore({ projectsDir: projectsDir(), liveDir: liveSessionsDir() });
  await store.start();

  const { app } = await createApp({
    port,
    store,
    hubHandlers,
    clientDir: isDev ? undefined : builtClientDir(repoRoot),
    logLevel: process.env.OFFICE_LOG_LEVEL,
  });

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

  const shutdown = async (): Promise<void> => {
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
