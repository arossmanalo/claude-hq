import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { LogStore } from "../src/server/logs/logStore";

const PORT = 4317;
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const LOCAL = { host: `127.0.0.1:${PORT}` };

describe("HTTP API", () => {
  let root: string;
  let store: LogStore;
  let app: FastifyInstance;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "office-app-"));
    await cp(path.join(__dirname, "fixtures/claude"), root, { recursive: true });
    store = new LogStore({ projectsDir: path.join(root, "projects"), liveDir: path.join(root, "sessions") });
    await store.start();
    ({ app } = await createApp({
      port: PORT,
      store,
      hubHandlers: () => ({
        onConnect: async () => {},
        onSubscribe: async () => {},
        onCommand: async () => {},
      }),
    }));
  });

  afterEach(async () => {
    await app.close();
    await store.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("lists projects for the office's own page", async () => {
    const response = await app.inject({ url: "/api/projects", headers: LOCAL });
    expect(response.statusCode).toBe(200);
    expect(response.json()[0].name).toBe("shop");
  });

  it("returns one session's detail, and 404 for an unknown id", async () => {
    const found = await app.inject({ url: `/api/sessions/${SESSION_ID}`, headers: LOCAL });
    expect(found.json().agents).toHaveLength(2);
    const missing = await app.inject({ url: "/api/sessions/nope", headers: LOCAL });
    expect(missing.statusCode).toBe(404);
  });

  it("pages back through messages and rejects a bad query", async () => {
    const page = await app.inject({
      url: `/api/sessions/${SESSION_ID}/messages?before=2&limit=1`,
      headers: LOCAL,
    });
    expect(page.json()).toEqual([expect.objectContaining({ index: 1 })]);
    const bad = await app.inject({ url: `/api/sessions/${SESSION_ID}/messages`, headers: LOCAL });
    expect(bad.statusCode).toBe(400);
  });

  it("refuses requests addressed to another host name (DNS rebinding)", async () => {
    const response = await app.inject({ url: "/api/projects", headers: { host: "evil.test:4317" } });
    expect(response.statusCode).toBe(403);
  });

  it("refuses requests sent from another site's page", async () => {
    const response = await app.inject({
      url: "/api/projects",
      headers: { ...LOCAL, origin: "http://evil.test" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("refuses WebSocket connections without the office's origin", async () => {
    const noOrigin = await app.inject({ url: "/ws", headers: LOCAL });
    expect(noOrigin.statusCode).toBe(403);
    const foreign = await app.inject({
      url: "/ws",
      headers: { ...LOCAL, origin: "http://localhost:9999" },
    });
    expect(foreign.statusCode).toBe(403);
  });
});
