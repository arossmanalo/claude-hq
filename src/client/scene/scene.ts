import type { Container } from "pixi.js";

/** A drawable view. SceneCanvas owns the Pixi app and drives these calls. */
export interface Scene<T> {
  readonly root: Container;
  /** Lays the scene out for a canvas this wide and returns the height it needs. */
  layout(width: number): number;
  update(data: T): void;
  /** Called every frame with total elapsed time, for animation. */
  tick(elapsedMs: number): void;
  destroy(): void;
}

export const SIGN_FONT = "Pixelify Sans";

/** Cuts a label to fit `maxChars`, ending with an ellipsis. */
export function fitLabel(text: string, maxChars: number): string {
  if (maxChars <= 1) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
