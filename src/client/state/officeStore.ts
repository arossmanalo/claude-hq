import { create } from "zustand";
import type { ProjectSummary, SessionDetail } from "../../shared/model";
import type {
  PermissionRequest,
  RouterStatus,
  ServerMessage,
  SoundSettings,
} from "../../shared/protocol";

export type ConnectionState = "connecting" | "open" | "closed";

export type View =
  | { kind: "building" }
  /** `sessionId` is set when the user picked an older session from the filing cabinet. */
  | { kind: "office"; projectKey: string; sessionId: string | null }
  /** An office for a folder that has no Claude Code sessions yet. */
  | { kind: "new"; cwd: string };

export interface Notice {
  id: number;
  level: "info" | "error";
  message: string;
}

interface OfficeState {
  connection: ConnectionState;
  projects: ProjectSummary[];
  sessions: Record<string, SessionDetail>;
  routers: RouterStatus[];
  permissions: PermissionRequest[];
  notices: Notice[];
  view: View;
  /** Bumped on each finished task, so the sound hook can react to repeats. */
  taskDoneCount: number;
  sound: SoundSettings;
  /** The browser allows audio only after the first click or key press on the page. */
  soundUnlocked: boolean;
  setSoundUnlocked: () => void;
  setConnection: (state: ConnectionState) => void;
  receive: (message: ServerMessage) => void;
  setView: (view: View) => void;
  dismissNotice: (id: number) => void;
  addNotice: (level: Notice["level"], message: string) => void;
}

let nextNoticeId = 1;

export const useOfficeStore = create<OfficeState>()((set) => ({
  connection: "connecting",
  projects: [],
  sessions: {},
  routers: [],
  permissions: [],
  notices: [],
  view: { kind: "building" },
  taskDoneCount: 0,
  sound: { muted: false, volume: 0.6 },
  soundUnlocked: false,
  setSoundUnlocked: () => set({ soundUnlocked: true }),
  setConnection: (connection) => set({ connection }),
  receive: (message) => {
    switch (message.type) {
      case "projects":
        set({ projects: message.projects });
        return;
      case "session":
        set((state) => ({
          sessions: { ...state.sessions, [message.detail.sessionId]: message.detail },
        }));
        return;
      case "routers":
        set({ routers: message.routers });
        return;
      case "permissions":
        set({ permissions: message.requests });
        return;
      case "taskDone":
        set((state) => ({ taskDoneCount: state.taskDoneCount + 1 }));
        return;
      case "settings":
        set({ sound: message.sound });
        return;
      case "notice":
        set((state) => ({
          notices: [...state.notices, { id: nextNoticeId++, level: message.level, message: message.message }],
        }));
        return;
    }
  },
  setView: (view) => set({ view }),
  dismissNotice: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
  addNotice: (level, message) =>
    set((state) => ({ notices: [...state.notices, { id: nextNoticeId++, level, message }] })),
}));

/** Folder key comparison matching the server's: case-insensitive on Windows paths. */
export function sameFolder(a: string, b: string): boolean {
  const normalise = (value: string) => value.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
  return normalise(a) === normalise(b);
}

export function routerFor(routers: RouterStatus[], cwd: string): RouterStatus | undefined {
  return routers.find((router) => sameFolder(router.cwd, cwd));
}

/**
 * The session an office shows: the one picked from the filing cabinet, else the office's own
 * router session, else the newest live one, else the newest one.
 */
export function currentSessionId(
  project: ProjectSummary,
  routers: RouterStatus[],
  pickedSessionId: string | null,
): string | null {
  if (pickedSessionId) return pickedSessionId;
  const router = routerFor(routers, project.cwd);
  if (router?.sessionId) return router.sessionId;
  return project.sessions.find((session) => session.live)?.sessionId ?? project.sessions[0]?.sessionId ?? null;
}
