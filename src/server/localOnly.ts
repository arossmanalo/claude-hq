import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * The office can start Claude with your permissions, so only pages it serves itself may talk to
 * it. Checking Host stops DNS-rebinding pages (an attacker's domain pointed at 127.0.0.1) and
 * checking Origin stops any other site from opening the WebSocket from your browser.
 */
export function createLocalOnlyGuard(getPort: () => number) {
  const allowedHosts = () => {
    const port = getPort();
    return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  };

  return async function localOnly(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const host = request.headers.host ?? "";
    if (!allowedHosts().has(host)) {
      await reply.code(403).send({ error: "Claude Office only answers on 127.0.0.1." });
      return;
    }
    const origin = request.headers.origin;
    if (origin === undefined) {
      // Browsers always send Origin on WebSocket upgrades, so a missing one is not a browser page.
      if (request.url.startsWith("/ws")) {
        await reply.code(403).send({ error: "WebSocket connections must come from the office page." });
      }
      return;
    }
    const originHost = safeHost(origin);
    if (!originHost || !allowedHosts().has(originHost)) {
      await reply.code(403).send({ error: "Requests from other sites are not allowed." });
    }
  };
}

function safeHost(origin: string): string | null {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" ? url.host : null;
  } catch {
    return null;
  }
}
