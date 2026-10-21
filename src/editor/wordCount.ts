/**
 * Word count and reading time for the status line (DESIGN.md §12). Information, not a
 * target. Frontmatter and URLs are not prose, so they don't count; the Basmallah opening
 * is not in the text at all (ADR-0008).
 */

import { frontmatterEnd } from "./dialect.ts";

/** Link targets, autolinks and bare URLs. */
const URLS =
  /\]\([^)\s]*(?:\s+"[^"]*")?\)|<[a-z][a-z0-9+.-]*:[^>\s]*>|\b(?:https?:\/\/|www\.)\S+/giu;

const words = new Intl.Segmenter(undefined, { granularity: "word" });

function proseOf(text: string): string {
  const end = frontmatterEnd(text);
  return (end === null ? text : text.slice(end)).replace(URLS, " ");
}

function segmentedCount(prose: string): number {
  let count = 0;
  for (const segment of words.segment(prose)) if (segment.isWordLike) count++;
  return count;
}

export function countWords(text: string): number {
  return segmentedCount(proseOf(text));
}

/** Reuse unchanged lines' segmentation after a typing pause. Newlines are word
 * boundaries, including for Arabic and dictionary-segmented scripts. Strip metadata
 * and URLs before splitting: a link title or frontmatter can span multiple lines.
 * Keep only the current document's lines, so deleted text and old files aren't held.
 */
export class WordCounter {
  #lines = new Map<string, number>();

  count(text: string): number {
    const next = new Map<string, number>();
    let total = 0;
    for (const line of proseOf(text).split("\n")) {
      let count = next.get(line) ?? this.#lines.get(line);
      if (count === undefined) count = segmentedCount(line);
      next.set(line, count);
      total += count;
    }
    this.#lines = next;
    return total;
  }
}

/** Minutes at an unhurried 230 words a minute; at least one for any text. */
export function readingMinutes(wordCount: number): number {
  return wordCount === 0 ? 0 : Math.max(1, Math.round(wordCount / 230));
}
