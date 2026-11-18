import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { z } from "zod";
import { ClientHub, type HubHandlers } from "./clientHub";
import { createLocalOnlyGuard } from "./localOnly";
import type { LogStore } from "./logs/logStore";

export interface AppOptions {
  port: number;
  store: LogStore;
  hubHandlers: (store: LogStore) => HubHandlers;
  /** Serve the built client from this folder; omit in dev, where Vite serves it. */
  clientDir?: string;
  logLevel?: string;
}

const messagesQuerySchema = z.object({
  before: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function createApp(options: AppOptions): Promise<{
  app: FastifyInstance;
  hub: ClientHub;
}> {
  const app = Fastify({ logger: { level: options.logLevel ?? "warn" } });
  const { store } = options;
  const hub = new ClientHub(options.hubHandlers(store));

  app.addHook("onRequest", createLocalOnlyGuard(() => options.port));
  await app.register(fastifyWebsocket, { options: { maxPayload: 256 * 1024 } });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/projects", async () => store.projects());

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId", async (request, reply) => {
    const detail = await store.detail(request.params.sessionId);
    if (!detail) return reply.code(404).send({ error: "No session with that id." });
    return detail;
  });

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/messages",
    async (request, reply) => {
      const query = messagesQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "Pass ?before=<index>&limit=<1-200>." });
      }
      return store.messagesBefore(request.params.sessionId, query.data.before, query.data.limit);
    },
  );

  app.get("/ws", { websocket: true }, (socket) => hub.add(socket));

  if (options.clientDir) {
    await app.register(fastifyStatic, {
      root: options.clientDir,
      // Asset names carry a content hash; the page itself must be rechecked after each build.
      setHeaders: (response, filePath) => {
        if (filePath.endsWith("index.html")) response.header("Cache-Control", "no-cache");
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  store.on("projects", () => {
    hub.broadcast({ type: "projects", projects: store.projects() });
    // A page may have subscribed to a session before its log file existed (a router that just
    // started). Now that the store may know it, send what it has.
    for (const sessionId of hub.subscribedSessionIds()) {
      void store.detail(sessionId).then((detail) => {
        if (detail) hub.sendToSubscribers(sessionId, { type: "session", detail });
      });
    }
  });
  store.on("session", (sessionId) => {
    if (!hub.subscribedSessionIds().has(sessionId)) return;
    void store.detail(sessionId).then((detail) => {
      if (detail) hub.sendToSubscribers(sessionId, { type: "session", detail });
    });
  });
  store.on("error", (error) => app.log.error(error));

  return { app, hub };
}

export function builtClientDir(repoRoot: string): string {
  return path.join(repoRoot, "dist", "client");
}
