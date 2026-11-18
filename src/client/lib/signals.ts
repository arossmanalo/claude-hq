import type { PermissionRequest, RouterStatus } from "../../shared/protocol";

/** What the office needs from you right now, and how many tasks have finished so far. */
export interface SignalSnapshot {
  permissionIds: ReadonlySet<string>;
  /** Attention text per router folder (null when the router needs nothing). */
  attention: ReadonlyMap<string, string | null>;
  taskDoneCount: number;
}

export interface Signals {
  /** Something new needs the user: a permission card, a question, or the handoff cap. */
  needsInput: boolean;
  /** A router finished a request with nothing pending. */
  done: boolean;
  /** Items waiting on the user, for the tab title. */
  waitingCount: number;
}

export function snapshotOf(
  permissions: PermissionRequest[],
  routers: RouterStatus[],
  taskDoneCount: number,
): SignalSnapshot {
  return {
    permissionIds: new Set(permissions.map((request) => request.requestId)),
    attention: new Map(routers.map((router) => [router.cwd, router.attention])),
    taskDoneCount,
  };
}

/**
 * Compares two snapshots. Several changes arriving together still produce one "needs input" and
 * one "done", so a burst of events never stacks sounds.
 */
export function compareSignals(previous: SignalSnapshot, next: SignalSnapshot): Signals {
  const newPermission = [...next.permissionIds].some((id) => !previous.permissionIds.has(id));
  const newAttention = [...next.attention].some(
    ([cwd, text]) => text !== null && previous.attention.get(cwd) !== text,
  );
  const attentionCount = [...next.attention.values()].filter((text) => text !== null).length;
  return {
    needsInput: newPermission || newAttention,
    done: next.taskDoneCount > previous.taskDoneCount,
    waitingCount: next.permissionIds.size + attentionCount,
  };
}
