import { fold, score } from "../core/fuzzy.ts";

/** In the order the sheet shows them. Versions lists the open text's own, when it has some. */
export const SECTIONS = ["Texts", "Versions", "Commands", "Settings"] as const;
export type Section = (typeof SECTIONS)[number];

/** What the sheet lists, whatever the row does. */
export interface Row {
  id: string;
  section: Section;
  /** What searching compares, and what the row says. */
  label: string;
  run(): void | Promise<void>;
}

/**
 * The rows that match, best first within a section, with sections in a fixed order so
 * they never trade places while typing. With no query, each section keeps its own order:
 * newest text first, settings as listed.
 */
export function matching(rows: readonly Row[], query: string): Row[] {
  const words = fold(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [...rows];
  const ranked: { row: Row; total: number }[] = [];
  for (const row of rows) {
    const label = fold(row.label);
    let total = 0;
    for (const word of words) {
      const found = score(word, label);
      if (found === null) {
        total = -Infinity;
        break;
      }
      total += found;
    }
    if (total !== -Infinity) ranked.push({ row, total });
  }
  ranked.sort((a, b) => b.total - a.total);
  return SECTIONS.flatMap((section) =>
    ranked.filter(({ row }) => row.section === section).map(({ row }) => row),
  );
}

/** The next value along, wrapping: a setting's row changes it with one tap. */
export function next<T>(values: readonly T[], value: T): T {
  return values[(values.indexOf(value) + 1) % values.length] as T;
}

/** A path's last part and the folder before it. A name that ends in "/" stays whole. */
export function pathParts(path: string): { folder: string; file: string } {
  const at = path.lastIndexOf("/");
  if (at <= 0 || at === path.length - 1) return { folder: "", file: path };
  return { folder: path.slice(0, at), file: path.slice(at + 1) };
}

const moment = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** When a version arrived: two prints in one day have to be told apart. */
export function arrivedAt(ms: number | null): string {
  return ms === null || ms <= 0 ? "Date unknown" : moment.format(ms);
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The date a text arrived, or nothing when its note is lost: never a made-up one. */
export function arrived(ms: number | null): string {
  return ms === null || ms <= 0 ? "" : day.format(ms);
}
