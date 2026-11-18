import { Container, Graphics, Text } from "pixi.js";
import type { ProjectSummary } from "../../shared/model";
import { PALETTE, px } from "./pixels";
import { SIGN_FONT, fitLabel, type Scene } from "./scene";

export interface BuildingData {
  projects: ProjectSummary[];
  /** Project keys whose office needs the user (an approval, a question, the handoff cap). */
  attention: ReadonlySet<string>;
  /** Project keys whose router is working right now. */
  working: ReadonlySet<string>;
}

export interface BuildingHandlers {
  onOpenProject: (projectKey: string) => void;
}

const FLOOR_CELLS = 18;
const ROOF_CELLS = 16;
const LOBBY_CELLS = 24;
const GROUND_CELLS = 6;
const PLAQUE_CELLS = 46;
const WINDOW_W = 6;
const WINDOW_H = 9;
const WINDOW_GAP = 4;
const MARGIN_PX = 16;

type Lighting = "working" | "live" | "dark";

interface FloorDrawing {
  project: ProjectSummary;
  lighting: Lighting;
  attention: boolean;
  windows: Graphics;
  marker: Text | null;
  top: number;
}

export class BuildingScene implements Scene<BuildingData> {
  readonly root = new Container();
  private data: BuildingData = { projects: [], attention: new Set(), working: new Set() };
  private width = 0;
  private unit = 4;
  private floors: FloorDrawing[] = [];
  private hoveredKey: string | null = null;
  private lastFlicker = -1;

  constructor(private readonly handlers: BuildingHandlers) {}

  layout(width: number): number {
    this.width = width;
    this.unit = width >= 520 ? 4 : 3;
    this.rebuild();
    return this.height();
  }

  update(data: BuildingData): void {
    this.data = data;
    this.rebuild();
  }

  tick(elapsedMs: number): void {
    // Lit windows flicker a little, like a real office at night: two steps a second.
    const step = Math.floor(elapsedMs / 500);
    if (step === this.lastFlicker) return;
    this.lastFlicker = step;
    for (const [index, floor] of this.floors.entries()) {
      this.drawWindows(floor, step + index);
      if (floor.marker) floor.marker.visible = step % 2 === 0;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  private height(): number {
    const cells = ROOF_CELLS + this.data.projects.length * FLOOR_CELLS + LOBBY_CELLS + GROUND_CELLS;
    return cells * this.unit;
  }

  private towerCells(): number {
    return Math.min(Math.floor((this.width - MARGIN_PX * 2) / this.unit), 150);
  }

  private rebuild(): void {
    if (this.width === 0) return;
    for (const child of this.root.removeChildren()) child.destroy({ children: true });
    this.floors = [];
    const u = this.unit;
    const tower = this.towerCells();
    const left = MARGIN_PX / u;
    const totalCells = this.height() / u;

    const backdrop = new Graphics();
    px(backdrop, u, 0, 0, this.width / u, totalCells, PALETTE.sky);
    px(backdrop, u, 0, totalCells - GROUND_CELLS, this.width / u, GROUND_CELLS, PALETTE.ground);
    px(backdrop, u, 0, totalCells - GROUND_CELLS, this.width / u, 1, PALETTE.street);
    this.root.addChild(backdrop);

    this.drawRoof(left, tower);
    this.data.projects.forEach((project, index) => {
      this.drawFloor(project, left, tower, ROOF_CELLS + index * FLOOR_CELLS);
    });
    this.drawLobby(left, tower, ROOF_CELLS + this.data.projects.length * FLOOR_CELLS);
    this.lastFlicker = -1;
  }

  private drawRoof(left: number, tower: number): void {
    const u = this.unit;
    const g = new Graphics();
    // Antenna, roof slab and parapet.
    px(g, u, left + 10, 0, 1, 8, PALETTE.trim);
    px(g, u, left + 9, 0, 3, 1, PALETTE.lamp);
    px(g, u, left + 4, 8, tower - 8, 4, PALETTE.concreteDark);
    px(g, u, left, 12, tower, 4, PALETTE.trim);
    this.root.addChild(g);

    const sign = new Text({
      text: "CLAUDE OFFICE",
      style: { fontFamily: SIGN_FONT, fontSize: u * 4, fill: PALETTE.lamp, fontWeight: "600" },
    });
    sign.position.set((left + 16) * u, 7 * u);
    sign.anchor.set(0, 0.5);
    this.root.addChild(sign);
  }

  private drawFloor(project: ProjectSummary, left: number, tower: number, top: number): void {
    const u = this.unit;
    const lighting: Lighting = this.data.working.has(project.key)
      ? "working"
      : project.live
        ? "live"
        : "dark";
    const attention = this.data.attention.has(project.key);
    const plaqueW = Math.min(PLAQUE_CELLS, Math.floor(tower * 0.45));

    const slab = new Graphics();
    const drawSlab = (hovered: boolean) => {
      slab.clear();
      px(slab, u, left, top, tower, FLOOR_CELLS, hovered ? PALETTE.concreteLight : PALETTE.concrete);
      px(slab, u, left, top, tower, 1, PALETTE.concreteDark);
      // Name plaque: lamplight border when the office needs you.
      px(slab, u, left + 2, top + 3, plaqueW, FLOOR_CELLS - 6, attention ? PALETTE.lamp : PALETTE.trim);
      px(slab, u, left + 3, top + 4, plaqueW - 2, FLOOR_CELLS - 8, PALETTE.wall);
    };
    drawSlab(this.hoveredKey === project.key);
    slab.eventMode = "static";
    slab.cursor = "pointer";
    slab.on("pointertap", () => this.handlers.onOpenProject(project.key));
    slab.on("pointerover", () => {
      this.hoveredKey = project.key;
      drawSlab(true);
    });
    slab.on("pointerout", () => {
      if (this.hoveredKey === project.key) this.hoveredKey = null;
      drawSlab(false);
    });
    this.root.addChild(slab);

    const fontSize = u * 3.5;
    const maxChars = Math.floor(((plaqueW - 6) * u) / (fontSize * 0.55));
    const name = new Text({
      text: fitLabel(project.name, maxChars),
      style: {
        fontFamily: SIGN_FONT,
        fontSize,
        fill: lighting === "dark" ? PALETTE.textDim : PALETTE.text,
      },
    });
    name.anchor.set(0, 0.5);
    name.position.set((left + 5) * u, (top + FLOOR_CELLS / 2) * u);
    name.eventMode = "none";
    this.root.addChild(name);

    let marker: Text | null = null;
    if (attention) {
      marker = new Text({
        text: "!",
        style: { fontFamily: SIGN_FONT, fontSize: u * 5, fill: PALETTE.lamp, fontWeight: "600" },
      });
      marker.anchor.set(0.5, 0.5);
      marker.position.set((left + plaqueW - 2) * u, (top + FLOOR_CELLS / 2) * u);
      marker.eventMode = "none";
      this.root.addChild(marker);
    }

    const windows = new Graphics();
    windows.eventMode = "none";
    this.root.addChild(windows);
    const floor: FloorDrawing = { project, lighting, attention, windows, marker, top };
    this.floors.push(floor);
    this.drawWindows(floor, 0);
  }

  private drawWindows(floor: FloorDrawing, step: number): void {
    const u = this.unit;
    const tower = this.towerCells();
    const left = MARGIN_PX / u;
    const plaqueW = Math.min(PLAQUE_CELLS, Math.floor(tower * 0.45));
    const startX = left + plaqueW + 6;
    const count = Math.max(0, Math.floor((tower - plaqueW - 8) / (WINDOW_W + WINDOW_GAP)));
    const g = floor.windows;
    g.clear();
    for (let i = 0; i < count; i++) {
      const x = startX + i * (WINDOW_W + WINDOW_GAP);
      const y = floor.top + (FLOOR_CELLS - WINDOW_H) / 2;
      px(g, u, x - 1, y - 1, WINDOW_W + 2, WINDOW_H + 2, PALETTE.concreteDark);
      px(g, u, x, y, WINDOW_W, WINDOW_H, this.windowColor(floor.lighting, i, step));
      px(g, u, x, y + WINDOW_H / 2, WINDOW_W, 1, PALETTE.concreteDark);
    }
  }

  private windowColor(lighting: Lighting, index: number, step: number): number {
    if (lighting === "dark") return PALETTE.windowDark;
    if (lighting === "live") return index < 2 ? PALETTE.lampSoft : PALETTE.windowDim;
    // Working: every window lit, one at a time dimming as people move about.
    return (index + step) % 7 === 0 ? PALETTE.lampSoft : PALETTE.lamp;
  }

  private drawLobby(left: number, tower: number, top: number): void {
    const u = this.unit;
    const g = new Graphics();
    px(g, u, left, top, tower, LOBBY_CELLS, PALETTE.concreteDark);
    px(g, u, left, top, tower, 2, PALETTE.trim);
    const doorX = left + Math.floor(tower / 2) - 8;
    px(g, u, doorX, top + 6, 16, LOBBY_CELLS - 6, PALETTE.trim);
    px(g, u, doorX + 1, top + 7, 6, LOBBY_CELLS - 7, PALETTE.windowDim);
    px(g, u, doorX + 9, top + 7, 6, LOBBY_CELLS - 7, PALETTE.windowDim);
    px(g, u, doorX + 6, top + 14, 1, 3, PALETTE.lamp);
    px(g, u, doorX + 9, top + 14, 1, 3, PALETTE.lamp);
    this.root.addChild(g);

    if (this.data.projects.length === 0) {
      const empty = new Text({
        text: "No offices yet",
        style: { fontFamily: SIGN_FONT, fontSize: u * 3.5, fill: PALETTE.textDim },
      });
      empty.position.set((left + 4) * u, (top + 8) * u);
      this.root.addChild(empty);
    }
  }
}
