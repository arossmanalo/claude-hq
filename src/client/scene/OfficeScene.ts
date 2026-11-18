import { Container, Graphics, Text } from "pixi.js";
import { PALETTE, STATE_COLORS, drawWorker, lookFor, px } from "./pixels";
import { modelLabel, stateLabel, type RoomModel } from "./rooms";
import { SIGN_FONT, fitLabel, type Scene } from "./scene";

export interface OfficeData {
  rooms: RoomModel[];
  /** The router's latest handoff, shown as a speech bubble in its room. */
  handoff: { role: string; description: string; finished: boolean } | null;
  archiveCount: number;
  selectedRole: string | null;
}

export interface OfficeHandlers {
  onSelectRoom: (role: string) => void;
  onOpenArchive: () => void;
}

const MARGIN_PX = 16;
const GAP_PX = 12;
/** Animation runs at 8 frames a second, the cadence of classic pixel art. */
const FRAME_MS = 125;

interface RoomDrawing {
  room: RoomModel;
  cellsW: number;
  cellsH: number;
  dynamic: Graphics;
  frame: Graphics;
}

export class OfficeScene implements Scene<OfficeData> {
  readonly root = new Container();
  private data: OfficeData = { rooms: [], handoff: null, archiveCount: 0, selectedRole: null };
  private width = 0;
  private unit = 4;
  private columns = 2;
  private roomW = 0;
  private roomH = 0;
  private drawings: RoomDrawing[] = [];
  private lastFrame = -1;

  constructor(private readonly handlers: OfficeHandlers) {}

  layout(width: number): number {
    this.width = width;
    this.columns = width >= 900 ? 3 : 2;
    this.roomW = Math.floor((width - MARGIN_PX * 2 - GAP_PX * (this.columns - 1)) / this.columns);
    this.unit = this.roomW >= 230 ? 4 : this.roomW >= 150 ? 3 : 2;
    this.roomH = Math.round(Math.min(220, Math.max(132, this.roomW * 0.66)));
    this.rebuild();
    return this.height();
  }

  update(data: OfficeData): void {
    this.data = data;
    this.rebuild();
  }

  tick(elapsedMs: number): void {
    const frame = Math.floor(elapsedMs / FRAME_MS);
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    for (const drawing of this.drawings) this.drawDynamic(drawing, frame);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  private tileCount(): number {
    return this.data.rooms.length + 1;
  }

  private height(): number {
    const rows = Math.ceil(this.tileCount() / this.columns);
    return MARGIN_PX * 2 + rows * this.roomH + (rows - 1) * GAP_PX;
  }

  private tilePosition(index: number): { x: number; y: number } {
    const column = index % this.columns;
    const row = Math.floor(index / this.columns);
    return {
      x: MARGIN_PX + column * (this.roomW + GAP_PX),
      y: MARGIN_PX + row * (this.roomH + GAP_PX),
    };
  }

  private rebuild(): void {
    if (this.width === 0) return;
    for (const child of this.root.removeChildren()) child.destroy({ children: true });
    this.drawings = [];
    const backdrop = new Graphics();
    backdrop.rect(0, 0, this.width, this.height()).fill(PALETTE.sky);
    this.root.addChild(backdrop);

    this.data.rooms.forEach((room, index) => this.drawRoom(room, this.tilePosition(index)));
    this.drawArchive(this.tilePosition(this.data.rooms.length));
    this.lastFrame = -1;
  }

  private drawRoom(room: RoomModel, position: { x: number; y: number }): void {
    const u = this.unit;
    const container = new Container();
    container.position.set(position.x, position.y);
    this.root.addChild(container);

    const cellsW = Math.floor(this.roomW / u);
    const cellsH = Math.floor(this.roomH / u);
    const wallCells = Math.floor(cellsH * 0.42);
    const statics = new Graphics();
    px(statics, u, 0, 0, cellsW, cellsH, room.state === "empty" ? PALETTE.street : PALETTE.floor);
    px(statics, u, 0, 0, cellsW, wallCells, PALETTE.wall);
    px(statics, u, 0, wallCells - 1, cellsW, 1, PALETTE.wallTop);
    // Floorboards.
    for (let y = wallCells + 4; y < cellsH; y += 5) {
      px(statics, u, 0, y, cellsW, 1, PALETTE.floorLight);
    }
    this.drawCommitStamps(statics, room, cellsW);
    statics.eventMode = "static";
    statics.cursor = "pointer";
    statics.on("pointertap", () => this.handlers.onSelectRoom(room.role));
    container.addChild(statics);

    const fontSize = Math.max(12, u * 3.5);
    const charWidth = fontSize * 0.55;
    const title = new Text({
      text: room.label,
      style: {
        fontFamily: SIGN_FONT,
        fontSize,
        fontWeight: "600",
        fill: room.state === "empty" ? PALETTE.textDim : PALETTE.text,
      },
    });
    title.position.set(3 * u, 2 * u);
    title.eventMode = "none";
    container.addChild(title);

    const details = [modelLabel(room.model), room.state === "empty" ? "Free desk" : stateLabel(room)]
      .filter(Boolean)
      .join(" · ");
    const subtitle = new Text({
      text: fitLabel(details, Math.floor((cellsW * u - 6 * u) / (charWidth * 0.8))),
      style: { fontFamily: SIGN_FONT, fontSize: fontSize * 0.8, fill: PALETTE.textDim },
    });
    subtitle.position.set(3 * u, 2 * u + fontSize * 1.25);
    subtitle.eventMode = "none";
    container.addChild(subtitle);

    if (room.role === "router" && this.data.handoff) {
      this.drawHandoffBubble(container, cellsW, wallCells, fontSize);
    }

    const dynamic = new Graphics();
    dynamic.eventMode = "none";
    container.addChild(dynamic);
    const frame = new Graphics();
    frame.eventMode = "none";
    container.addChild(frame);
    const drawing: RoomDrawing = { room, cellsW, cellsH, dynamic, frame };
    this.drawings.push(drawing);
    this.drawDynamic(drawing, 0);
  }

  private drawCommitStamps(g: Graphics, room: RoomModel, cellsW: number): void {
    const u = this.unit;
    const shown = Math.min(room.commits, 5);
    for (let i = 0; i < shown; i++) {
      const x = cellsW - 6 - i * 5;
      px(g, u, x, 3, 4, 5, PALETTE.paper);
      px(g, u, x + 1, 5, 2, 2, PALETTE.done);
    }
  }

  private drawHandoffBubble(
    container: Container,
    cellsW: number,
    wallCells: number,
    fontSize: number,
  ): void {
    const handoff = this.data.handoff;
    if (!handoff) return;
    const u = this.unit;
    const bubbleW = Math.floor(cellsW * 0.5);
    const x = cellsW - bubbleW - 2;
    const y = wallCells + 2;
    const bubble = new Graphics();
    px(bubble, u, x, y, bubbleW, 8, PALETTE.paper);
    px(bubble, u, x + 2, y + 8, 2, 2, PALETTE.paper);
    bubble.eventMode = "none";
    container.addChild(bubble);
    const verb = handoff.finished ? "Done:" : "→";
    const label = `${verb} ${capitalise(handoff.role)}`;
    const text = new Text({
      text: fitLabel(`${label} ${handoff.description}`, Math.floor((bubbleW * u) / (fontSize * 0.42))),
      style: { fontFamily: SIGN_FONT, fontSize: fontSize * 0.75, fill: PALETTE.ink },
    });
    text.position.set((x + 1) * u, (y + 1.5) * u);
    text.eventMode = "none";
    container.addChild(text);
  }

  private drawDynamic(drawing: RoomDrawing, frame: number): void {
    const u = this.unit;
    const { room, cellsW, cellsH, dynamic: g } = drawing;
    g.clear();
    const deskW = Math.min(30, cellsW - 8);
    const deskX = Math.floor((cellsW - deskW) / 2);
    const deskY = cellsH - 12;
    const workerX = deskX + Math.floor(deskW / 2) - 4;
    const workerY = deskY - 9;

    if (room.state === "empty") {
      // Empty chair behind the desk.
      px(g, u, workerX + 1, workerY + 3, 6, 6, PALETTE.trim);
    } else {
      const slump = room.state === "idle" ? 1 : 0;
      const blink = frame % 24 === 0;
      drawWorker(g, u, workerX, workerY, lookFor(room.role), { blink, slump });
    }

    // Desk with monitor.
    px(g, u, deskX, deskY, deskW, 4, PALETTE.desk);
    px(g, u, deskX, deskY + 4, deskW, 1, PALETTE.deskDark);
    px(g, u, deskX + 1, deskY + 5, 2, 6, PALETTE.deskDark);
    px(g, u, deskX + deskW - 3, deskY + 5, 2, 6, PALETTE.deskDark);
    const monitorX = deskX + deskW - 12;
    px(g, u, monitorX, deskY - 8, 10, 7, PALETTE.trim);
    px(g, u, monitorX + 1, deskY - 7, 8, 5, this.screenColor(room, frame));
    px(g, u, monitorX + 4, deskY - 1, 2, 1, PALETTE.trim);
    if (room.state === "typing") {
      for (let line = 0; line < 3; line++) {
        const width = 2 + ((frame + line * 3) % 5);
        px(g, u, monitorX + 2, deskY - 6 + line * 1.5, Math.min(width, 6), 0.5, PALETTE.ink);
      }
      // Hands on the keyboard, alternating.
      const lift = frame % 2;
      px(g, u, workerX + 1, deskY - 1 + (lift ? 0 : 0.5), 2, 1, lookFor(room.role).skin);
      px(g, u, workerX + 5, deskY - 1 + (lift ? 0.5 : 0), 2, 1, lookFor(room.role).skin);
    }
    if (room.state === "waiting") {
      // Raised hand.
      const skin = lookFor(room.role).skin;
      px(g, u, workerX + 8, workerY - 3 + (frame % 4 < 2 ? 0 : 1), 1, 5, skin);
    }
    this.drawStateBubble(g, room, workerX + 9, workerY - 7, frame);
    this.drawFrame(drawing, frame);
  }

  private screenColor(room: RoomModel, frame: number): number {
    switch (room.state) {
      case "typing":
        return PALETTE.screenBright;
      case "thinking":
        return frame % 8 < 4 ? PALETTE.screen : PALETTE.screenBright;
      case "error":
        return PALETTE.screenError;
      case "waiting":
        return PALETTE.lamp;
      case "done":
        return PALETTE.done;
      default:
        return PALETTE.monitorOff;
    }
  }

  private drawStateBubble(g: Graphics, room: RoomModel, x: number, y: number, frame: number): void {
    const u = this.unit;
    if (room.state === "empty" || room.state === "typing") return;
    const color = STATE_COLORS[room.state];
    px(g, u, x, y, 7, 5, PALETTE.paper);
    px(g, u, x, y + 5, 1, 1, PALETTE.paper);
    switch (room.state) {
      case "thinking": {
        const dots = (frame >> 1) % 4;
        for (let i = 0; i < Math.max(1, dots); i++) px(g, u, x + 1 + i * 2, y + 2, 1, 1, color);
        return;
      }
      case "waiting":
        if (frame % 4 < 3) {
          px(g, u, x + 3, y + 1, 1, 2, color);
          px(g, u, x + 3, y + 4 - 0.5, 1, 0.5, color);
        }
        return;
      case "error":
        px(g, u, x + 2, y + 1, 1, 1, color);
        px(g, u, x + 4, y + 1, 1, 1, color);
        px(g, u, x + 3, y + 2, 1, 1, color);
        px(g, u, x + 2, y + 3, 1, 1, color);
        px(g, u, x + 4, y + 3, 1, 1, color);
        return;
      case "done":
        px(g, u, x + 1, y + 2, 1, 1, color);
        px(g, u, x + 2, y + 3, 1, 1, color);
        px(g, u, x + 3, y + 2, 1, 1, color);
        px(g, u, x + 4, y + 1, 1, 1, color);
        px(g, u, x + 5, y + 0.5, 1, 1, color);
        return;
      case "idle":
        px(g, u, x + 2, y + 1, 3, 1, color);
        px(g, u, x + 3, y + 2, 1, 1, color);
        px(g, u, x + 2, y + 3, 3, 1, color);
        return;
    }
  }

  private drawFrame(drawing: RoomDrawing, frame: number): void {
    const g = drawing.frame;
    g.clear();
    const selected = this.data.selectedRole === drawing.room.role;
    const waiting = drawing.room.state === "waiting";
    if (!selected && !(waiting && frame % 8 < 5)) return;
    const width = drawing.cellsW * this.unit;
    const height = drawing.cellsH * this.unit;
    g.rect(1, 1, width - 2, height - 2).stroke({
      color: waiting ? PALETTE.lamp : PALETTE.text,
      width: 2,
      alignment: 1,
    });
  }

  private drawArchive(position: { x: number; y: number }): void {
    const u = this.unit;
    const container = new Container();
    container.position.set(position.x, position.y);
    this.root.addChild(container);
    const cellsW = Math.floor(this.roomW / u);
    const cellsH = Math.floor(this.roomH / u);
    const g = new Graphics();
    px(g, u, 0, 0, cellsW, cellsH, PALETTE.street);
    px(g, u, 0, 0, cellsW, Math.floor(cellsH * 0.42), PALETTE.wall);
    const cabinetX = Math.floor(cellsW / 2) - 7;
    const cabinetY = cellsH - 26;
    px(g, u, cabinetX, cabinetY, 14, 24, PALETTE.cabinet);
    for (let drawer = 0; drawer < 3; drawer++) {
      const y = cabinetY + 1 + drawer * 8;
      px(g, u, cabinetX + 1, y, 12, 7, PALETTE.cabinetDark);
      px(g, u, cabinetX + 5, y + 3, 4, 1, PALETTE.paper);
    }
    g.eventMode = "static";
    g.cursor = "pointer";
    g.on("pointertap", () => this.handlers.onOpenArchive());
    container.addChild(g);

    const fontSize = Math.max(12, u * 3.5);
    const title = new Text({
      text: "Filing cabinet",
      style: { fontFamily: SIGN_FONT, fontSize, fontWeight: "600", fill: PALETTE.text },
    });
    title.position.set(3 * u, 2 * u);
    title.eventMode = "none";
    container.addChild(title);
    const count = this.data.archiveCount;
    const subtitle = new Text({
      text: count === 1 ? "1 session" : `${count} sessions`,
      style: { fontFamily: SIGN_FONT, fontSize: fontSize * 0.8, fill: PALETTE.textDim },
    });
    subtitle.position.set(3 * u, 2 * u + fontSize * 1.25);
    subtitle.eventMode = "none";
    container.addChild(subtitle);
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
