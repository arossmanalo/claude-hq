import {
  addTokens,
  emptyTokens,
  type AgentState,
  type SessionDetail,
  type TokenTotals,
} from "../../shared/model";

/** Rooms every office has, in floor-plan order. */
export const CORE_ROLES = ["router", "designer", "coder", "tester", "reviewer"] as const;
const MAX_EXTRA_ROOMS = 3;
const CONTRACTOR_ROLE = "contractors";

export type RoomState = AgentState | "empty";

export interface RoomModel {
  role: string;
  label: string;
  model: string | null;
  state: RoomState;
  currentTool: string | null;
  task: string | null;
  tokens: TokenTotals;
  commits: number;
  /** How many agents of this role worked in the session. */
  agentCount: number;
}

/** Which state wins when several agents share a room. */
const STATE_PRIORITY: Record<RoomState, number> = {
  waiting: 6,
  typing: 5,
  thinking: 4,
  error: 3,
  done: 2,
  idle: 1,
  empty: 0,
};

const ROLE_LABELS: Record<string, string> = {
  router: "Router",
  designer: "Designer",
  coder: "Coder",
  tester: "Tester",
  reviewer: "Reviewer",
  [CONTRACTOR_ROLE]: "Contractors",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** "claude-opus-5-5" -> "Opus 5.5"; unknown names pass through. */
export function modelLabel(model: string | null): string | null {
  if (!model) return null;
  const match = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  if (!match?.[1] || !match[2]) return model;
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  return match[3] ? `${family} ${match[2]}.${match[3]}` : `${family} ${match[2]}`;
}

export function stateLabel(room: Pick<RoomModel, "state" | "currentTool">): string {
  switch (room.state) {
    case "typing":
      return room.currentTool ? `Using ${room.currentTool}` : "Working";
    case "thinking":
      return "Thinking";
    case "waiting":
      return "Needs your OK";
    case "error":
      return "Hit an error";
    case "done":
      return "Done";
    case "idle":
      return "Idle";
    case "empty":
      return "Free desk";
  }
}

function emptyRoom(role: string): RoomModel {
  return {
    role,
    label: roleLabel(role),
    model: null,
    state: "empty",
    currentTool: null,
    task: null,
    tokens: emptyTokens(),
    commits: 0,
    agentCount: 0,
  };
}

/**
 * One room per core role, plus rooms for other roles the router used. More than three extra
 * roles share a "Contractors" room so the floor plan stays readable.
 */
export function buildRooms(detail: SessionDetail | null): RoomModel[] {
  const rooms = new Map<string, RoomModel>(CORE_ROLES.map((role) => [role, emptyRoom(role)]));
  if (!detail) return [...rooms.values()];

  const extraRoles = [...new Set(detail.agents.map((agent) => agent.role))].filter(
    (role) => !rooms.has(role),
  );
  const ownRoomRoles = new Set(
    extraRoles.length > MAX_EXTRA_ROOMS ? extraRoles.slice(0, MAX_EXTRA_ROOMS - 1) : extraRoles,
  );
  const roomFor = (role: string) =>
    rooms.has(role) || ownRoomRoles.has(role) ? role : CONTRACTOR_ROLE;

  for (const agent of detail.agents) {
    const role = roomFor(agent.role);
    const room = rooms.get(role) ?? emptyRoom(role);
    rooms.set(role, room);
    room.agentCount++;
    room.tokens = addTokens(room.tokens, agent.tokens);
    room.commits += detail.commits.filter((commit) => commit.agentId === agent.id).length;
    if (STATE_PRIORITY[agent.state] >= STATE_PRIORITY[room.state]) {
      room.state = agent.state;
      room.model = agent.model ?? room.model;
      room.currentTool = agent.currentTool;
      room.task = agent.task ?? room.task;
    }
  }
  return [...rooms.values()];
}
