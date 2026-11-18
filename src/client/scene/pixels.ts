import type { Graphics } from "pixi.js";
import type { RoomState } from "./rooms";

/** Scene colours. Mirrors the CSS tokens so canvas and panels read as one place. */
export const PALETTE = {
  sky: 0x1e1c18,
  ground: 0x2d2a24,
  street: 0x25221d,
  concrete: 0x5a544a,
  concreteDark: 0x48433b,
  concreteLight: 0x6f685b,
  trim: 0x3d3931,
  windowDark: 0x24272b,
  windowDim: 0x3b4a55,
  lamp: 0xf0b44c,
  lampSoft: 0xc98f3a,
  floor: 0x3d3931,
  floorLight: 0x4a453c,
  wall: 0x2d2a24,
  wallTop: 0x36322b,
  desk: 0x7a5a3a,
  deskDark: 0x5e4630,
  monitorOff: 0x1b1d20,
  screen: 0x8fb3c9,
  screenBright: 0xcfe3ee,
  screenError: 0xe0675b,
  paper: 0xebe5d8,
  ink: 0x171512,
  thinking: 0x8fb3c9,
  done: 0x86b36f,
  error: 0xe0675b,
  text: 0xebe5d8,
  textDim: 0xa69e8f,
  cabinet: 0x6f685b,
  cabinetDark: 0x4a453c,
  skin: [0xe8c4a0, 0xc69472, 0x8d5f43, 0xf1d3b6],
  hair: [0x2b2118, 0x5a3b22, 0x1a1a1a, 0x9b6b3d],
  pants: 0x2f3440,
} as const;

/** Shirt colour per role, so each agent is recognisable across rooms and bubbles. */
export const ROLE_COLORS: Record<string, number> = {
  router: 0xf0b44c,
  designer: 0xd98aa0,
  coder: 0x6fa3c7,
  tester: 0x86b36f,
  reviewer: 0xc9b27a,
};

export function roleColor(role: string): number {
  return ROLE_COLORS[role] ?? 0x9a9488;
}

export const STATE_COLORS: Record<RoomState, number> = {
  waiting: PALETTE.lamp,
  typing: PALETTE.screenBright,
  thinking: PALETTE.thinking,
  error: PALETTE.error,
  done: PALETTE.done,
  idle: PALETTE.textDim,
  empty: PALETTE.concreteDark,
};

/** Fills one block of pixels on a `unit`-sized grid. */
export function px(
  g: Graphics,
  unit: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  g.rect(Math.round(x * unit), Math.round(y * unit), Math.round(w * unit), Math.round(h * unit)).fill(
    color,
  );
}

/**
 * A seated worker, 8 x 11 pixels. h = hair, s = skin, e = eye, c = shirt, a = arm (shirt),
 * p = trousers. Arms are drawn separately so they can move.
 */
const WORKER = [
  "..hhhh..",
  ".hhhhhh.",
  ".hssssh.",
  ".sesses.",
  "..ssss..",
  ".cccccc.",
  "cccccccc",
  "cccccccc",
  ".cccccc.",
  ".pppppp.",
  ".pp..pp.",
];

export interface WorkerLook {
  shirt: number;
  skin: number;
  hair: number;
}

/** Stable look per role, so the coder always looks like the coder. */
export function lookFor(role: string): WorkerLook {
  let hash = 0;
  for (const char of role) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return {
    shirt: roleColor(role),
    skin: PALETTE.skin[hash % PALETTE.skin.length] ?? PALETTE.skin[0],
    hair: PALETTE.hair[(hash >> 3) % PALETTE.hair.length] ?? PALETTE.hair[0],
  };
}

export function drawWorker(
  g: Graphics,
  unit: number,
  originX: number,
  originY: number,
  look: WorkerLook,
  options: { blink?: boolean; slump?: number } = {},
): void {
  const slump = options.slump ?? 0;
  WORKER.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      let color: number | null = null;
      if (cell === "h") color = look.hair;
      else if (cell === "s") color = look.skin;
      else if (cell === "e") color = options.blink ? look.skin : PALETTE.ink;
      else if (cell === "c") color = look.shirt;
      else if (cell === "p") color = PALETTE.pants;
      // The head sinks a pixel when slumped (idle).
      const dy = y < 5 ? slump : 0;
      if (color !== null) px(g, unit, originX + x, originY + y + dy, 1, 1, color);
    }
  });
}
