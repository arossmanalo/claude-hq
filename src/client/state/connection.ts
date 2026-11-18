import { isServerMessage, type ClientMessage } from "../../shared/protocol";
import { useOfficeStore } from "./officeStore";

const MAX_BACKOFF_MS = 10_000;

/**
 * One WebSocket to the office server. Reconnects with backoff when the server restarts, and
 * re-sends the current subscriptions so the page catches up without a reload.
 */
class Connection {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private subscriptions: string[] = [];
  private reconnectTimer: number | null = null;

  start(): void {
    if (this.socket) return;
    this.open();
  }

  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      useOfficeStore
        .getState()
        .addNotice("error", "Not connected to the office server. Is `npm start` still running?");
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  subscribe(sessionIds: string[]): void {
    const same =
      sessionIds.length === this.subscriptions.length &&
      sessionIds.every((id, i) => id === this.subscriptions[i]);
    if (same) return;
    this.subscriptions = sessionIds;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "subscribe", sessionIds } satisfies ClientMessage));
    }
  }

  private open(): void {
    const store = useOfficeStore.getState();
    store.setConnection("connecting");
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.attempt = 0;
      useOfficeStore.getState().setConnection("open");
      if (this.subscriptions.length > 0) {
        socket.send(
          JSON.stringify({ type: "subscribe", sessionIds: this.subscriptions } satisfies ClientMessage),
        );
      }
    });
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        useOfficeStore.getState().addNotice("error", "The server sent a message that isn't JSON.");
        return;
      }
      if (isServerMessage(message)) useOfficeStore.getState().receive(message);
    });
    socket.addEventListener("close", () => {
      this.socket = null;
      useOfficeStore.getState().setConnection("closed");
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt);
    this.attempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}

export const connection = new Connection();
