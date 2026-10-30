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

// Library nodes are immutable snapshots. A weak cache reuses folded search keys
// between keystrokes and releases them with the old listing. Check source fields
// too, so callers that update a candidate in place cannot get stale matches.
const foldedFiles = new WeakMap<
  FileCandidate,
  { sourceName: string; sourcePath: string; name: string; path: string }
>();

function foldedFile(file: FileCandidate): { name: string; path: string } {
  let cached = foldedFiles.get(file);
  if (!cached || cached.sourceName !== file.name || cached.sourcePath !== file.path) {
    cached = {
      sourceName: file.name,
      sourcePath: file.path,
      name: fold(file.name),
      path: fold(file.path),
    };
    foldedFiles.set(file, cached);
  }
  return cached;
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
    const recentFiles: T[] = [];
    const others: T[] = [];
    for (const file of files) {
      if (recency.has(file.path)) recentFiles.push(file);
      else if (others.length < limit) others.push(file);
    }
    // Stable sort preserves library order for equal recency.
    recentFiles.sort((a, b) => rank(a) - rank(b));
    return recentFiles.concat(others).slice(0, limit);
  }
  if (limit <= 0) return [];
  type Scored = { file: T; score: number; index: number };
  const compare = (a: Scored, b: Scored) =>
    b.score - a.score ||
    rank(a.file) - rank(b.file) ||
    a.file.path.length - b.file.path.length ||
    a.file.path.localeCompare(b.file.path) ||
    a.index - b.index;
  const scored: Scored[] = [];
  let index = 0;
  for (const file of files) {
    const order = index++;
    const { name, path } = foldedFile(file);
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
    if (total === -Infinity) continue;
    const candidate = { file, score: total, index: order };
    // Retain only the visible best matches, rather than sorting and retaining the
    // whole library. Binary insertion preserves all existing ranking tie-breaks.
    const worst = scored.at(-1);
    if (scored.length >= limit && worst && compare(candidate, worst) >= 0) continue;
    let lo = 0;
    let hi = scored.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const at = scored[mid];
      if (at && compare(candidate, at) < 0) hi = mid;
      else lo = mid + 1;
    }
    scored.splice(lo, 0, candidate);
    if (scored.length > limit) scored.pop();
  }
  return scored.map((s) => s.file);
}

/** How one folded word matches folded text: 3 at its start, 2 at a word's start, 1 inside
 * it, 0 by scattered letters, or null not at all. */
function wordTier(word: string, text: string): number | null {
  let at = text.indexOf(word);
  if (at === 0) return 3;
  if (at > 0) {
    for (; at > 0; at = text.indexOf(word, at + 1)) if (BOUNDARY.test(text[at - 1] ?? "")) return 2;
    return 1;
  }
  return score(word, text) === null ? null : 0;
}

/** The worst word's tier, each word taking the best of `texts`; 3 with no words. */
function tierOf(words: readonly string[], texts: readonly string[]): number | null {
  let worst = 3;
  for (const word of words) {
    let best: number | null = null;
    for (const text of texts) {
      const t = wordTier(word, text);
      if (t !== null && (best === null || t > best)) best = t;
    }
    if (best === null) return null;
    worst = Math.min(worst, best);
  }
  return worst;
}

/**
 * Tiers compare matches of different kinds, whose scores don't: Search lists files,
 * commands and settings together and drops scattered-letter matches (tier 0) when any
 * row matches as a run of letters (DESIGN.md §6).
 */
export function fileTier(query: string, file: FileCandidate): number | null {
  const { name, path } = foldedFile(file);
  return tierOf(tokens(query), [name, path]);
}

export function commandTier(query: string, command: CommandCandidate): number | null {
  return tierOf(tokens(query), [command.label, ...(command.aliases ?? [])].map(fold));
}

/** How many files match `query` at `least` tier or better. */
export function countFiles(query: string, files: readonly FileCandidate[], least = 0): number {
  const words = tokens(query);
  let n = 0;
  for (const file of files) {
    const { name, path } = foldedFile(file);
    const t = tierOf(words, [name, path]);
    if (t !== null && t >= least) n += 1;
  }
  return n;
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
