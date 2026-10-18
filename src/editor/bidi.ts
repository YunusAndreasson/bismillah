import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type EditorState, type Extension, type Line } from "@codemirror/state";
import {
  Decoration,
  Direction,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * Per-line direction and bidi isolation (DESIGN.md §8.6, ARCHITECTURE.md §2).
 *
 * Each line gets an explicit `dir` from the first strong character of its Markdown
 * block, skipping syntax (marks, URLs, inline code), so `- عنصر` is right-to-left and
 * `[الصفحة](https://…) inside English text` is left-to-right. Lines of one paragraph
 * share its direction. Code, frontmatter and URLs are always left-to-right, and inline
 * code and URLs are isolated so they don't reorder the Arabic around them. The isolates
 * are registered with CodeMirror so caret motion follows the visible order.
 */

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
const STRONG_CHAR = /\p{L}/u;

/** Syntax that never decides a block's direction. */
const SKIP = new Set([
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "TaskMarker",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "InlineCode",
  "LinkMark",
  "URL",
  "Autolink",
  "LinkTitle",
  "LinkLabel",
  "Escape",
]);
const ALWAYS_LTR = new Set(["FencedCode", "CodeBlock", "Frontmatter", "HTMLBlock", "CommentBlock"]);
const BLOCKS = new Set([
  "Paragraph",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "TableHeader",
  "TableRow",
  "LinkReference",
]);
const ISOLATE = new Set(["InlineCode", "URL", "Autolink"]);

export type Dir = "ltr" | "rtl";

/** Direction of the first strong character in [from, to), ignoring Markdown syntax. */
export function firstStrongDirection(state: EditorState, from: number, to: number): Dir | null {
  const skipped: [number, number][] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (SKIP.has(node.name)) {
        skipped.push([node.from, node.to]);
        return false;
      }
    },
  });
  const text = state.sliceDoc(from, to);
  let s = 0;
  let offset = 0;
  for (const ch of text) {
    const pos = from + offset;
    offset += ch.length;
    while (s < skipped.length && (skipped[s]?.[1] ?? 0) <= pos) s++;
    const range = skipped[s];
    if (range && range[0] <= pos && pos < range[1]) continue;
    if (RTL_CHAR.test(ch) && STRONG_CHAR.test(ch)) return "rtl";
    if (STRONG_CHAR.test(ch)) return "ltr";
  }
  return null;
}

/** The direction-deciding block for a line: its leaf block, or "ltr" for code. */
function blockFor(state: EditorState, line: Line): SyntaxNode | "ltr" | null {
  let pos = line.from;
  while (pos < line.to && /\s/.test(state.doc.sliceString(pos, pos + 1))) pos++;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node;) {
    if (ALWAYS_LTR.has(node.name)) return "ltr";
    if (BLOCKS.has(node.name)) return node;
    node = node.parent;
  }
  return null;
}

export function lineDirection(state: EditorState, line: Line): Dir | null {
  const block = blockFor(state, line);
  if (block === "ltr") return "ltr";
  if (block) return firstStrongDirection(state, block.from, block.to);
  return firstStrongDirection(state, line.from, line.to);
}

const dirDeco = {
  ltr: Decoration.line({ attributes: { dir: "ltr" } }),
  rtl: Decoration.line({ attributes: { dir: "rtl" } }),
};
const isolateDeco = Decoration.mark({
  class: "cm-isolate",
  attributes: { dir: "ltr" },
  bidiIsolate: Direction.LTR,
});

function previousDirection(state: EditorState, line: Line): Dir {
  for (let n = line.number - 1; n >= 1 && n > line.number - 200; n--) {
    const prev = state.doc.line(n);
    if (prev.text.trim() === "") continue;
    return lineDirection(state, prev) ?? "ltr";
  }
  return "ltr";
}

function build(view: EditorView): { lines: DecorationSet; isolates: DecorationSet } {
  const lines = new RangeSetBuilder<Decoration>();
  const isolates = new RangeSetBuilder<Decoration>();
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    let last: Dir | null = null;
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      // Lines without strong text (blank lines, rules, numbers) follow the text above.
      const dir: Dir = lineDirection(state, line) ?? last ?? previousDirection(state, line);
      lines.add(line.from, line.from, dirDeco[dir]);
      if (line.text.trim() !== "") last = dir;
      pos = line.to + 1;
    }
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (ALWAYS_LTR.has(node.name)) return false;
        if (ISOLATE.has(node.name)) {
          if (node.to > node.from) isolates.add(node.from, node.to, isolateDeco);
          return false;
        }
      },
    });
  }
  return { lines: lines.finish(), isolates: isolates.finish() };
}

const bidiPlugin = ViewPlugin.fromClass(
  class {
    lines: DecorationSet;
    isolates: DecorationSet;
    constructor(view: EditorView) {
      ({ lines: this.lines, isolates: this.isolates } = build(view));
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      )
        ({ lines: this.lines, isolates: this.isolates } = build(update.view));
    }
  },
  {
    provide: (plugin) => [
      EditorView.decorations.of((view) => view.plugin(plugin)?.lines ?? Decoration.none),
      EditorView.decorations.of((view) => view.plugin(plugin)?.isolates ?? Decoration.none),
      EditorView.bidiIsolatedRanges.of((view) => view.plugin(plugin)?.isolates ?? Decoration.none),
    ],
  },
);

export function bidi(): Extension {
  return [EditorView.perLineTextDirection.of(true), bidiPlugin];
}
