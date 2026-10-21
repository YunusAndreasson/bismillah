import type { Battery } from "../core/ipc.ts";

/**
 * The stick's clock and battery (os/PLAN.md, OS-3). The battery warns at LOW; at
 * CRITICAL the app saves and powers off, which narrows the window for losing unsaved
 * edits without closing it (batteries misreport, and can die suddenly).
 */
export const LOW = 10;
export const CRITICAL = 3;

export type BatteryLevel = "fine" | "low" | "critical";

export function batteryLevel(battery: Battery | null): BatteryLevel {
  if (!battery || battery.charging) return "fine";
  if (battery.percent <= CRITICAL) return "critical";
  if (battery.percent <= LOW) return "low";
  return "fine";
}

/** Minutes `timeZone` is ahead of UTC at `at` (ms). */
export function zoneOffset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || undefined,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return Math.round((wall - Math.floor(at / 60_000) * 60_000) / 60_000);
}

/**
 * The real time, given the system's. A computer whose hardware clock keeps local time
 * (as Windows sets it) starts Linux that many hours off, read as if it were UTC; the
 * stick never writes the hardware clock, so the correction is made here.
 */
export function correctedNow(now: number, timeZone: string, clockKeepsLocalTime: boolean): number {
  return clockKeepsLocalTime ? now - zoneOffset(now, timeZone) * 60_000 : now;
}

/** The status line's clock: 24-hour, in the writer's time zone. */
export function clockText(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || undefined,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}
