/**
 * Word count and reading time for the status line (DESIGN.md §12). Information, not a
 * target. Frontmatter and URLs are not prose, so they don't count; the Basmallah opening
 * is not in the text at all (ADR-0008).
 */

const FRONTMATTER = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;
/** Link targets, autolinks and bare URLs. */
const URLS =
  /\]\([^)\s]*(?:\s+"[^"]*")?\)|<[a-z][a-z0-9+.-]*:[^>\s]*>|\b(?:https?:\/\/|www\.)\S+/giu;

const words = new Intl.Segmenter(undefined, { granularity: "word" });

export function countWords(text: string): number {
  const prose = text.replace(FRONTMATTER, "").replace(URLS, " ");
  let count = 0;
  for (const segment of words.segment(prose)) if (segment.isWordLike) count++;
  return count;
}

/** Minutes at an unhurried 230 words a minute; at least one for any text. */
export function readingMinutes(wordCount: number): number {
  return wordCount === 0 ? 0 : Math.max(1, Math.round(wordCount / 230));
}
