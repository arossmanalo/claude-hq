import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { findFreePort, HOST } from "./port";
import { openBrowser } from "./openBrowser";

const DEFAULT_PORT = 4317;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const isDev = process.argv.includes("--dev");

async function main(): Promise<void> {
  const app = Fastify({ logger: { level: process.env.OFFICE_LOG_LEVEL ?? "warn" } });

  app.get("/api/health", async () => ({ ok: true }));

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
  } else {
    const clientDir = path.join(repoRoot, "dist", "client");
    await app.register(fastifyStatic, { root: clientDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  const preferred = Number(process.env.OFFICE_PORT ?? DEFAULT_PORT);
  const port = await findFreePort(preferred);
  await app.listen({ port, host: HOST });

  const url = `http://${HOST}:${port}`;
  console.log(`Claude Office is running at ${url}`);
  if (process.env.OFFICE_NO_OPEN !== "1") openBrowser(url);

  const shutdown = async (): Promise<void> => {
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
