import { language, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  findClusterBreak,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/**
 * Formatting a selection (ADR-0019): explicit, undoable commands that only insert or
 * remove Markdown marks around the writer's words and never touch the words themselves
 * (AGENTS.md, "The writer's trust" rule 3). Everything written is plain Markdown, and a
 * mark the parser wouldn't read as that mark isn't written at all. Pure functions over
 * the state, so each rule is tested here; the bar and the commands only dispatch what
 * they return.
 */

export type Mark = "bold" | "italic" | "strike" | "code";
export type Block = "text" | "h1" | "h2" | "h3" | "quote" | "bullet" | "numbered";

/** The user event of every edit here: one undoable step that keeps the bar in place. */
export const FORMAT_EVENT = "input.format";

interface Span {
  from: number;
  to: number;
}

const NODE: Record<Mark, string> = {
  bold: "StrongEmphasis",
  italic: "Emphasis",
  strike: "Strikethrough",
  code: "InlineCode",
};

const MARK_NODE: Record<Mark, string> = {
  bold: "EmphasisMark",
  italic: "EmphasisMark",
  strike: "StrikethroughMark",
  code: "CodeMark",
};

/** Text blocks a mark can go in. Code, tables, frontmatter and raw HTML aren't among them. */
const TEXT_BLOCK = /^(?:Paragraph|ATXHeading[1-6]|SetextHeading[12])$/;
/** Inline nodes a mark may not cut through, so a span grows to take them whole. */
const INLINE =
  /^(?:Emphasis|StrongEmphasis|Strikethrough|InlineCode|Link|Image|Autolink|Escape|Entity)$/;
/** Where the text isn't prose, so nothing can be wrapped inside it. */
const LITERAL = /^(?:InlineCode|URL|LinkTitle|LinkLabel|Autolink)$/;
/** Blocks whose lines "Turn into" leaves alone. */
const FIXED_BLOCK =
  /^(?:Frontmatter|FencedCode|CodeBlock|Table|HTMLBlock|LinkReference|HorizontalRule|CommentBlock|ProcessingInstructionBlock)$/;

const WORD = /[\p{L}\p{N}\p{M}]/u;

function enclosing(state: EditorState, span: Span, name: RegExp | string): SyntaxNode | null {
  const test = (n: string) => (typeof name === "string" ? n === name : name.test(n));
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(span.from, 1);
    node;
    node = node.parent
  ) {
    if (test(node.name) && node.from <= span.from && node.to >= span.to) return node;
  }
  return null;
}

/** A position never falls between a letter and its vowel marks: a mark there would
 * detach them from the letter. */
function onCluster(state: EditorState, pos: number, forward: boolean): number {
  const line = state.doc.lineAt(pos);
  const at = pos - line.from;
  if (at === 0 || at === line.length) return pos;
  const next = findClusterBreak(line.text, at, true);
  const back = findClusterBreak(line.text, next, false);
  if (back === at) return pos;
  return line.from + (forward ? next : back);
}

/** Grows a span until it cuts no inline node in two. */
function whole(state: EditorState, start: Span, block: SyntaxNode): Span {
  const span = { ...start };
  for (let changed = true; changed;) {
    changed = false;
    syntaxTree(state).iterate({
      from: Math.max(block.from, span.from - 1),
      to: Math.min(block.to, span.to + 1),
      enter(node) {
        if (!INLINE.test(node.name)) return;
        if (node.from < span.from && node.to > span.from && node.to < span.to) {
          span.from = node.from;
          changed = true;
        }
        if (node.to > span.to && node.from < span.to && node.from > span.from) {
          span.to = node.to;
          changed = true;
        }
      },
    });
  }
  return span;
}

/** The selection's part of each text block, without the spaces around it and without
 * block marks: a span can't cross a blank line, and `** word **` isn't emphasis. */
function spans(state: EditorState): Span[] {
  const { from, to } = state.selection.main;
  const found: Span[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (!TEXT_BLOCK.test(node.name)) return;
      const block = node.node;
      let start = Math.max(from, block.from);
      let end = Math.min(to, block.to);
      for (const mark of block.getChildren("HeaderMark")) {
        if (mark.from === block.from) {
          start = Math.max(start, mark.to);
        } else if (mark.from > block.from) {
          end = Math.min(end, mark.from);
        }
      }
      const text = state.sliceDoc(start, end);
      const lead = text.length - text.trimStart().length;
      const trail = text.length - text.trimEnd().length;
      if (lead === text.length) return false;
      start = onCluster(state, start + lead, false);
      end = onCluster(state, end - trail, true);
      found.push(whole(state, { from: start, to: end }, block));
      return false;
    },
  });
  return found;
}

function blockIsFixed(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (FIXED_BLOCK.test(node.name)) return true;
  }
  return false;
}

function isActive(state: EditorState, span: Span, mark: Mark): boolean {
  return enclosing(state, span, NODE[mark]) !== null;
}

/** Whether a mark can be added here: not inside code or an address, and code can't hold
 * other marks, which would then read as literal asterisks. */
function canWrap(state: EditorState, span: Span, mark: Mark): boolean {
  if (enclosing(state, span, LITERAL)) return false;
  if (mark === "code") {
    if (state.sliceDoc(span.from, span.to).includes("`")) return false;
    let inline = false;
    syntaxTree(state).iterate({
      from: span.from,
      to: span.to,
      enter(node) {
        if (INLINE.test(node.name) && node.from < span.to && node.to > span.from) inline = true;
      },
    });
    if (inline) return false;
  }
  return readsAsMark(state, span, mark);
}

/**
 * Whether the parser would read the wrapped words as this mark, with the letters on
 * either side: `**"word"**x` is only asterisks, because a closing mark can't sit between
 * punctuation and a letter. Lines are joined so a quote's marks don't end the paragraph.
 */
function readsAsMark(state: EditorState, span: Span, mark: Mark): boolean {
  const parser = state.facet(language)?.parser;
  if (!parser) return false;
  const text = markFor(state, span, mark);
  const words = state.sliceDoc(span.from, span.to).replace(/\s*\n[\s>]*/g, " ");
  const before = Array.from(state.sliceDoc(Math.max(0, span.from - 2), span.from)).at(-1) ?? "";
  const after = Array.from(state.sliceDoc(span.to, span.to + 2))[0] ?? "";
  const start = before.length + text.length;
  const end = start + words.length;
  let reads = false;
  parser.parse(`${before}${text}${words}${text}${after}`).iterate({
    enter(node) {
      if (
        node.name === NODE[mark] &&
        node.from === before.length &&
        node.to === end + text.length
      ) {
        reads = start < end;
      }
    },
  });
  return reads;
}

/** `_` can't open or close inside a word; `*` can, so a word's part takes `*`. */
function markFor(state: EditorState, span: Span, mark: Mark): string {
  if (mark === "bold") return "**";
  if (mark === "strike") return "~~";
  if (mark === "code") return "`";
  const before = state.sliceDoc(Math.max(0, span.from - 1), span.from);
  const after = state.sliceDoc(span.to, Math.min(state.doc.length, span.to + 1));
  return WORD.test(before) || WORD.test(after) ? "*" : "_";
}

/** The edit's selection: the same words, on the inside of any mark added at its edges. */
function keepSelection(state: EditorState, spec: TransactionSpec): TransactionSpec {
  const changes = state.changes(spec.changes);
  const { anchor, head, from, to } = state.selection.main;
  const mappedFrom = changes.mapPos(from, 1);
  const mappedTo = Math.max(mappedFrom, changes.mapPos(to, -1));
  return {
    changes,
    selection:
      anchor <= head
        ? EditorSelection.range(mappedFrom, mappedTo)
        : EditorSelection.range(mappedTo, mappedFrom),
    userEvent: FORMAT_EVENT,
    scrollIntoView: false,
  };
}

function removeMarks(node: SyntaxNode, mark: Mark): { from: number; to: number }[] {
  const marks = node.getChildren(MARK_NODE[mark]);
  const first = marks[0];
  const last = marks.at(-1);
  if (!first || !last || first === last) return [];
  return [
    { from: first.from, to: first.to },
    { from: last.from, to: last.to },
  ];
}

/** Adds the mark to the selection, or takes it off if all of the selection has it. */
export function toggleMark(state: EditorState, mark: Mark): TransactionSpec | null {
  const { main } = state.selection;
  if (main.empty) return toggleAtCaret(state, mark);
  const found = spans(state);
  if (!found.length) return null;
  if (found.every((span) => isActive(state, span, mark))) {
    const seen = new Set<number>();
    const changes = found.flatMap((span) => {
      const node = enclosing(state, span, NODE[mark]);
      if (!node || seen.has(node.from)) return [];
      seen.add(node.from);
      return removeMarks(node, mark);
    });
    return changes.length ? keepSelection(state, { changes }) : null;
  }
  const wrap = found.filter((span) => !isActive(state, span, mark));
  if (!wrap.every((span) => canWrap(state, span, mark))) return null;
  const changes = wrap.flatMap((span) => {
    const text = markFor(state, span, mark);
    return [
      { from: span.from, insert: text },
      { from: span.to, insert: text },
    ];
  });
  return keepSelection(state, { changes });
}

/** A caret takes the mark on the word it's in. An empty pair isn't Markdown (`****` is a
 * rule, `~~~~` a code fence), so away from a word nothing happens. */
function toggleAtCaret(state: EditorState, mark: Mark): TransactionSpec | null {
  const pos = state.selection.main.head;
  const node = enclosing(state, { from: pos, to: pos }, NODE[mark]);
  if (node) {
    const changes = removeMarks(node, mark);
    if (!changes.length) return null;
    const set = state.changes(changes);
    return {
      changes: set,
      selection: EditorSelection.cursor(set.mapPos(pos, 1)),
      userEvent: FORMAT_EVENT,
    };
  }
  const word = state.wordAt(pos);
  if (!word || !enclosing(state, word, TEXT_BLOCK)) return null;
  const span = {
    from: onCluster(state, word.from, false),
    to: onCluster(state, word.to, true),
  };
  if (!canWrap(state, span, mark)) return null;
  const text = markFor(state, span, mark);
  const set = state.changes([
    { from: span.from, insert: text },
    { from: span.to, insert: text },
  ]);
  return {
    changes: set,
    selection: EditorSelection.cursor(set.mapPos(pos, pos === span.to ? -1 : 1)),
    userEvent: FORMAT_EVENT,
  };
}

/** A line's own block mark, after any indent: `# `, `> `, `- ` or `1. `. */
const BLOCK_MARK = /^([ \t]*)(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+)?/;

function blockOfMark(mark: string | undefined): Block {
  if (!mark) return "text";
  if (mark.startsWith("#")) {
    const level = mark.trimEnd().length;
    return level === 1 ? "h1" : level === 2 ? "h2" : level === 3 ? "h3" : "text";
  }
  if (mark.startsWith(">")) return "quote";
  return /\d/.test(mark.charAt(0)) ? "numbered" : "bullet";
}

function markOfBlock(block: Block, number: number): string {
  switch (block) {
    case "text":
      return "";
    case "h1":
      return "# ";
    case "h2":
      return "## ";
    case "h3":
      return "### ";
    case "quote":
      return "> ";
    case "bullet":
      return "- ";
    case "numbered":
      return `${String(number)}. `;
  }
}

/** The lines "Turn into" may change: blank ones are skipped unless alone, and null means
 * the selection touches an underlined heading, whose second line a mark would break. */
function blockLines(state: EditorState): { from: number; text: string }[] | null {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  // A selection ending at the very start of a line doesn't touch that line.
  const endLine = state.doc.lineAt(to);
  const last = to > from && to === endLine.from ? endLine.number - 1 : endLine.number;
  const lines: { from: number; text: string }[] = [];
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    if (enclosing(state, { from: line.from, to: line.from }, /^SetextHeading[12]$/)) return null;
    if (blockIsFixed(state, line.from)) continue;
    if (!line.text.trim() && first !== last) continue;
    lines.push({ from: line.from, text: line.text });
  }
  return lines;
}

/** Changes each line's block mark and nothing else, keeping its indent. */
export function setBlock(state: EditorState, block: Block): TransactionSpec | null {
  const lines = blockLines(state);
  if (!lines?.length) return null;
  let number = 0;
  const changes = lines.flatMap((line) => {
    number += 1;
    const match = BLOCK_MARK.exec(line.text);
    const indent = match?.[1] ?? "";
    const mark = match?.[2];
    // A fourth-level heading reads as text here, but still has a mark to take off.
    if (blockOfMark(mark) === block && (block !== "text" || !mark)) return [];
    const from = line.from + indent.length;
    return [{ from, to: from + (mark?.length ?? 0), insert: markOfBlock(block, number) }];
  });
  return changes.length ? keepSelection(state, { changes }) : null;
}

/** What the bar shows: which marks the selection has, which it can take, and its block. */
export interface FormatState {
  active: Record<Mark, boolean>;
  enabled: Record<Mark, boolean>;
  /** The first line's block; null when "Turn into" can't act here. */
  block: Block | null;
}

const MARKS: readonly Mark[] = ["bold", "italic", "strike", "code"];

export function formatState(state: EditorState): FormatState {
  const found = spans(state);
  const active = {} as Record<Mark, boolean>;
  const enabled = {} as Record<Mark, boolean>;
  for (const mark of MARKS) {
    active[mark] = found.length > 0 && found.every((span) => isActive(state, span, mark));
    enabled[mark] =
      found.length > 0 &&
      (active[mark] ||
        found.every((span) => isActive(state, span, mark) || canWrap(state, span, mark)));
  }
  const lines = blockLines(state);
  const first = lines?.[0];
  return {
    active,
    enabled,
    block: first ? blockOfMark(BLOCK_MARK.exec(first.text)?.[2]) : null,
  };
}

/** Whether there's anything in the selection to format; the bar stays away if not. */
export function canFormat(state: EditorState): boolean {
  if (state.readOnly || state.selection.main.empty) return false;
  const format = formatState(state);
  return format.block !== null || MARKS.some((mark) => format.enabled[mark]);
}
