import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { LintBlock } from "../core/ipc.ts";

/**
 * What the checker reads (ARCHITECTURE.md §7.1). The editor's own syntax tree decides
 * what is prose, so the checker and the editor agree on the dialect: paragraphs,
 * headings, task items and table cells are sent, each as its exact text with the
 * ranges the checker must not read as prose. Code blocks, frontmatter, HTML blocks and
 * link definitions are never sent, and the Basmallah is not in the document at all.
 */

/** A block to check, in document positions. */
export interface LintUnit extends LintBlock {
  from: number;
  to: number;
}

const UNITS = new Set([
  "Paragraph",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "Task",
  "TableCell",
]);

/** Blocks whose text is never prose. */
const NEVER = new Set([
  "FencedCode",
  "CodeBlock",
  "Frontmatter",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "LinkReference",
]);

/** Inline text that stands for words but isn't prose: never read, and grammar beside it
 * is unreliable. */
const SKIP = new Set([
  "InlineCode",
  "URL",
  "Autolink",
  "HTMLTag",
  "Comment",
  "ProcessingInstruction",
  "Entity",
  "LinkLabel",
  "LinkTitle",
]);

/** Markdown punctuation: never read, but words on either side stay words. */
const MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "LinkMark",
  "QuoteMark",
  "ListMark",
  "TaskMarker",
  "TableDelimiter",
  "HardBreak",
]);

/** A footnote reference or the start of its definition: `[^1]`, `[^note]:`. */
const FOOTNOTE = /\[\^[^\]\s]+\]:?/g;

/** The blocks that overlap `from`–`to`, in document order. Only parsed text counts:
 * blocks past the end of the parsed tree are found once the parser gets there. Stops
 * after the block that brings the text past `budget` UTF-16 units. */
export function lintUnits(
  state: EditorState,
  from: number,
  to: number,
  budget = Infinity,
): LintUnit[] {
  const units: LintUnit[] = [];
  let size = 0;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (size >= budget || NEVER.has(node.name)) return false;
      if (UNITS.has(node.name)) {
        const unit = unitOf(state, node.node);
        units.push(unit);
        size += unit.text.length;
        return false;
      }
      return undefined;
    },
  });
  return units;
}

function unitOf(state: EditorState, node: SyntaxNode): LintUnit {
  const { from, to } = node;
  const text = state.doc.sliceString(from, to);
  const skip: [number, number][] = [];
  const marks: [number, number][] = [];
  const rel = (a: number, b: number): [number, number] => [a - from, b - from];
  node.toTree().iterate({
    enter(inner) {
      const a = inner.from + from;
      const b = inner.to + from;
      if (SKIP.has(inner.name)) {
        skip.push(rel(a, b));
        return false;
      }
      if (inner.name === "Link" && state.doc.sliceString(a, a + 2) === "[^") {
        skip.push(rel(a, b));
        return false;
      }
      if (inner.name === "Escape") {
        marks.push(rel(a, a + 1));
        return false;
      }
      if (MARKS.has(inner.name)) marks.push(rel(a, b));
      return undefined;
    },
  });
  for (const m of text.matchAll(FOOTNOTE)) {
    const range: [number, number] = [m.index, m.index + m[0].length];
    if (skip.some(([a, b]) => a <= range[0] && range[1] <= b)) continue;
    // `[^1]:` replaces the `[^1]` the parser saw as a link.
    const inside = skip.findIndex(([a, b]) => range[0] <= a && b <= range[1]);
    if (inside >= 0) skip.splice(inside, 1);
    skip.push(range);
  }
  return { from, to, text, skip, marks };
}

const LANG = /^lang:[ \t]*["']?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,8})*)["']?[ \t]*$/m;

/** The document's frontmatter `lang:` (a BCP 47 tag), which routes the checking. */
export function frontmatterLang(state: EditorState): string | null {
  const first = syntaxTree(state).topNode.firstChild;
  if (first?.name !== "Frontmatter") return null;
  return LANG.exec(state.doc.sliceString(first.from, first.to))?.[1] ?? null;
}
