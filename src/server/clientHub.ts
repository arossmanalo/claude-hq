import type { WebSocket } from "ws";
import { clientMessageSchema, type ClientMessage, type ServerMessage } from "../shared/protocol";

const MAX_MESSAGE_BYTES = 256 * 1024;

interface Client {
  subscriptions: Set<string>;
}

export interface HubHandlers {
  /** Sends what a newly connected page needs to draw. */
  onConnect: (send: (message: ServerMessage) => void) => Promise<void>;
  /** Sends the current detail of each newly subscribed session. */
  onSubscribe: (sessionIds: string[], send: (message: ServerMessage) => void) => Promise<void>;
  /** Everything except subscribe. Throwing sends the error text back to that page. */
  onCommand: (message: Exclude<ClientMessage, { type: "subscribe" }>) => Promise<void>;
}

/** Tracks connected pages and which sessions each one is looking at. */
export class ClientHub {
  private readonly clients = new Map<WebSocket, Client>();

  constructor(private readonly handlers: HubHandlers) {}

  add(socket: WebSocket): void {
    const client: Client = { subscriptions: new Set() };
    this.clients.set(socket, client);
    const send = (message: ServerMessage) => sendTo(socket, message);
    socket.on("close", () => this.clients.delete(socket));
    socket.on("message", (data, isBinary) => {
      void this.receive(socket, client, data, isBinary, send);
    });
    this.handlers.onConnect(send).catch((error: unknown) => {
      send({ type: "notice", level: "error", message: errorText(error) });
    });
  }

  broadcast(message: ServerMessage): void {
    for (const socket of this.clients.keys()) sendTo(socket, message);
  }

  /** Session ids at least one page is watching. */
  subscribedSessionIds(): Set<string> {
    const ids = new Set<string>();
    for (const client of this.clients.values()) {
      for (const id of client.subscriptions) ids.add(id);
    }
    return ids;
  }

  sendToSubscribers(sessionId: string, message: ServerMessage): void {
    for (const [socket, client] of this.clients) {
      if (client.subscriptions.has(sessionId)) sendTo(socket, message);
    }
  }

  private async receive(
    socket: WebSocket,
    client: Client,
    data: unknown,
    isBinary: boolean,
    send: (message: ServerMessage) => void,
  ): Promise<void> {
    if (isBinary || !Buffer.isBuffer(data) || data.length > MAX_MESSAGE_BYTES) {
      send({ type: "notice", level: "error", message: "Message too large or not text." });
      return;
    }
    let parsed: ClientMessage;
    try {
      const result = clientMessageSchema.safeParse(JSON.parse(data.toString("utf8")));
      if (!result.success) throw new Error("The office didn't understand that message.");
      parsed = result.data;
    } catch (error: unknown) {
      send({ type: "notice", level: "error", message: errorText(error) });
      return;
    }
    try {
      if (parsed.type === "subscribe") {
        const added = parsed.sessionIds.filter((id) => !client.subscriptions.has(id));
        client.subscriptions = new Set(parsed.sessionIds);
        await this.handlers.onSubscribe(added, send);
        return;
      }
      await this.handlers.onCommand(parsed);
    } catch (error: unknown) {
      if (socket.readyState === socket.OPEN) {
        send({ type: "notice", level: "error", message: errorText(error) });
      }
    }
  }
}

function sendTo(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function errorText(error: unknown): string {
  if (error instanceof SyntaxError) return "The office received a message that isn't valid JSON.";
  return error instanceof Error ? error.message : String(error);
}
