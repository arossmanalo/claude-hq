import type { TokenTotals } from "../../shared/model";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Nov". */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "No activity yet";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "Unknown time";
  const diff = now - time;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return "yesterday";
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** 950 -> "950", 12_340 -> "12.3k", 4_500_000 -> "4.5M". */
export function compactNumber(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** New tokens the model read or wrote; cache reads are cheap and shown separately. */
export function workTokens(tokens: TokenTotals): number {
  return tokens.input + tokens.output + tokens.cacheWrite;
}
