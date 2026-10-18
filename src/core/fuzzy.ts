/**
 * Matching for quick open and the command palette (DESIGN.md §6). Both sides are folded
 * first, on copies only (nothing the writer typed or named is ever changed): case,
 * Latin diacritics and Arabic vocalisation are ignored, and so are the IJMES letters ʿ
 * and ʾ, so "hadith" finds "ḥadīth.md", "ilm" finds "ʿilm.md" and "سلام" finds "سَلَام.md".
 */

const cp = (...codes: number[]) => codes.map((c) => String.fromCodePoint(c)).join("");

/** Marks typed as letters that searching should look past: ʿ ʾ ʻ ‘ ’ ' and tatweel. */
const SKIPPED = new RegExp(`[${cp(0x2bf, 0x2be, 0x2bb, 0x2018, 0x2019, 0x27, 0x640)}]`, "gu");
const ALEF_WASLA = cp(0x671);
const ALEF = cp(0x627);

/** The text as searching compares it. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(SKIPPED, "")
    .replaceAll(ALEF_WASLA, ALEF)
    .toLowerCase();
}

const BOUNDARY = /[\s\-_/.()[\]]/u;

/**
 * How well `query` matches `text` (both folded), or null if it doesn't: higher is
 * better. A substring beats scattered letters; the start of the text or of a word
 * beats the middle; shorter texts win ties.
 */
export function score(query: string, text: string): number | null {
  if (!query) return 0;
  const at = text.indexOf(query);
  if (at >= 0) {
    const start = at === 0 ? 40 : BOUNDARY.test(text[at - 1] ?? "") ? 20 : 0;
    return 100 + query.length * 4 + start - Math.min(at, 30) * 0.5 - text.length * 0.05;
  }
  let from = 0;
  let run = 0;
  let total = 0;
  for (const ch of query) {
    const j = text.indexOf(ch, from);
    if (j < 0) return null;
    if (j === from && from > 0) {
      run += 1;
      total += 2 + run;
    } else {
      run = 0;
      total += j === 0 || BOUNDARY.test(text[j - 1] ?? "") ? 3 : 1;
    }
    from = j + ch.length;
  }
  return total - text.length * 0.05;
}

function tokens(query: string): string[] {
  return fold(query).split(/\s+/u).filter(Boolean);
}

export interface FileCandidate {
  path: string;
  name: string;
}

/**
 * Files for quick open, best first. Every word of the query must match the name or the
 * path; name matches count double. Ties go to recent files, then shallower paths. With
 * no query, recently opened files come first, then the rest in library order.
 */
export function rankFiles<T extends FileCandidate>(
  query: string,
  files: readonly T[],
  recent: readonly string[],
  limit = 50,
): T[] {
  const recency = new Map(recent.map((path, i) => [path, i]));
  const rank = (f: T) => recency.get(f.path) ?? Infinity;
  const words = tokens(query);
  if (words.length === 0) {
    const order = new Map(files.map((f, i) => [f.path, i]));
    return [...files]
      .sort((a, b) => rank(a) - rank(b) || (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0))
      .slice(0, limit);
  }
  const scored: { file: T; score: number }[] = [];
  for (const file of files) {
    const name = fold(file.name);
    const path = fold(file.path);
    let total = 0;
    for (const word of words) {
      const inName = score(word, name);
      const inPath = score(word, path);
      if (inName === null && inPath === null) {
        total = -Infinity;
        break;
      }
      total += Math.max((inName ?? -Infinity) * 2, inPath ?? -Infinity);
    }
    if (total > -Infinity) scored.push({ file, score: total });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        rank(a.file) - rank(b.file) ||
        a.file.path.length - b.file.path.length ||
        a.file.path.localeCompare(b.file.path),
    )
    .slice(0, limit)
    .map((s) => s.file);
}

export interface CommandCandidate {
  label: string;
  aliases?: readonly string[];
}

/** Commands for the palette, best first; registry order without a query. Aliases count
 * as well as the label, so "focus" or "زهد" finds Zuhd mode. */
export function rankCommands<T extends CommandCandidate>(
  query: string,
  commands: readonly T[],
): T[] {
  const words = tokens(query);
  if (words.length === 0) return [...commands];
  const scored: { command: T; score: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const texts = [command.label, ...(command.aliases ?? [])].map(fold);
    let total = 0;
    for (const word of words) {
      const best = Math.max(
        ...texts.map((t, i) => (score(word, t) ?? -Infinity) * (i === 0 ? 1.2 : 1)),
      );
      if (best === -Infinity) return;
      total += best;
    }
    scored.push({ command, score: total, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.command);
}
