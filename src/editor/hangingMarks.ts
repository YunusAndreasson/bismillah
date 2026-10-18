import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type EditorState, type Extension, type Line } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { remeasureTypography } from "./typography.ts";

/**
 * How one line hangs its Markdown marks in the gutter (DESIGN.md §11, ADR-0002).
 *
 * - `prefix` is the leading source text that is pulled into the gutter with a negative
 *   `text-indent`, so the prose after it starts on the reading edge.
 * - `shift` lists the markers whose widths indent the line: those of the enclosing list
 *   items, outermost excluded (its marker hangs). A nested item's marker therefore sits
 *   under its parent's text and its text under its own, in proportional fonts too,
 *   whatever the source indentation is.
 * - `level` is the heading level (0 for none), which decides the font size to measure in.
 *
 * Only CSS on the line element changes. The text, the caret model and the DOM order are
 * untouched, so caret motion, selection and mouse placement keep working (spike result,
 * docs/spikes/hanging-marks-and-bidi.md).
 */
export interface Hang {
  prefix: string;
  shift: string[];
  level: number;
}

const HANGING = new Set(["HeaderMark", "QuoteMark", "ListMark"]);
const NO_HANG = new Set(["FencedCode", "CodeBlock", "Frontmatter", "HTMLBlock", "Table"]);
const HEADING_LEVEL = /^ATXHeading([1-6])$/;

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t";
}

function markStartingAt(tree: Tree, pos: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (node.from !== pos) break;
    if (HANGING.has(node.name)) return node;
  }
  return null;
}

/** The marker that opens `item` with the spaces after it, e.g. "- " or "10. ". */
function markerText(state: EditorState, item: SyntaxNode): string {
  const mark = item.getChild("ListMark");
  if (!mark) return "";
  const line = state.doc.lineAt(mark.from);
  let end = mark.to - line.from;
  while (isSpace(line.text[end])) end++;
  return line.text.slice(mark.from - line.from, end);
}

/** Markers of the list items around `item`, inner ones only (the outermost hangs). */
function indentMarkers(state: EditorState, item: SyntaxNode): string[] {
  const chain: SyntaxNode[] = [];
  for (let node: SyntaxNode | null = item; node?.name === "ListItem";) {
    chain.unshift(node);
    const list: SyntaxNode | null = node.parent;
    node = list?.parent ?? null;
  }
  return chain.slice(1).map((n) => markerText(state, n));
}

export function lineHang(state: EditorState, line: Line): Hang | null {
  const tree = syntaxTree(state);
  const text = line.text;
  let firstText = 0;
  while (isSpace(text[firstText])) firstText++;
  for (let node: SyntaxNode | null = tree.resolveInner(line.from + firstText, 1); node;) {
    if (NO_HANG.has(node.name)) return null;
    node = node.parent;
  }

  let offset = 0;
  let level = 0;
  let sawMark = false;
  let shift: string[] = [];
  for (;;) {
    let p = offset;
    while (isSpace(text[p])) p++;
    const mark = p < text.length ? markStartingAt(tree, line.from + p) : null;
    if (!mark) {
      offset = sawMark ? p : offset;
      break;
    }
    if (mark.name === "HeaderMark") {
      const heading = mark.parent ? HEADING_LEVEL.exec(mark.parent.name) : null;
      // Only an ATX heading's opening marks hang; setext underlines stay put.
      if (!heading || !mark.parent || mark.parent.from !== mark.from) return null;
      level = Number(heading[1]);
    }
    if (mark.name === "ListMark" && mark.parent) shift = indentMarkers(state, mark.parent);
    sawMark = true;
    offset = mark.to - line.from;
    while (isSpace(text[offset])) offset++;
  }

  if (!sawMark) {
    // A continuation line of a list item: hang its indentation so the text lines up
    // with the item's text.
    if (firstText === 0) return null;
    let item: SyntaxNode | null = tree.resolveInner(line.from + firstText, 1);
    while (item && item.name !== "ListItem") item = item.parent;
    if (!item) return null;
    return { prefix: text.slice(0, firstText), shift: indentMarkers(state, item), level: 0 };
  }
  return { prefix: text.slice(0, offset), shift, level };
}

/** Reads rendered widths of prefixes in the editor's own font, cached per typography. */
class PrefixMeasurer {
  private readonly cache = new Map<string, number>();
  private readonly root: HTMLElement;

  constructor(view: EditorView) {
    this.root = document.createElement("div");
    this.root.className = "cm-hang-measure";
    this.root.setAttribute("aria-hidden", "true");
    view.dom.appendChild(this.root);
  }

  width(level: number, text: string): number {
    if (text === "") return 0;
    const key = `${level}|${text}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const line = document.createElement("div");
    line.className = level ? `cm-line cm-h${level}` : "cm-line";
    const span = line.appendChild(document.createElement("span"));
    span.textContent = text;
    this.root.appendChild(line);
    const width = span.getBoundingClientRect().width;
    line.remove();
    this.cache.set(key, width);
    return width;
  }

  clear(): void {
    this.cache.clear();
  }

  destroy(): void {
    this.root.remove();
  }
}

const hangingPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    gutter: number;
    private readonly measurer: PrefixMeasurer;

    constructor(view: EditorView) {
      this.measurer = new PrefixMeasurer(view);
      this.gutter = this.measureGutter();
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      const remeasure = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(remeasureTypography)),
      );
      if (remeasure) {
        this.measurer.clear();
        this.gutter = this.measureGutter();
      }
      if (
        remeasure ||
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      )
        this.decorations = this.build(update.view);
    }

    /** Room for the widest standard mark: an h6, a nested quote or a two-digit item. */
    measureGutter(): number {
      const widths = [
        this.measurer.width(6, "###### "),
        this.measurer.width(0, "> > "),
        this.measurer.width(0, "10. "),
      ];
      return Math.ceil(Math.max(...widths));
    }

    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const { doc } = view.state;
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to;) {
          const line = doc.lineAt(pos);
          const hang = lineHang(view.state, line);
          if (hang) {
            const hangPx = this.measurer.width(hang.level, hang.prefix);
            const shiftPx = hang.shift.reduce((sum, m) => sum + this.measurer.width(0, m), 0);
            builder.add(
              line.from,
              line.from,
              Decoration.line({
                class: "cm-hang",
                attributes: { style: `--hang:${hangPx}px;--shift:${shiftPx}px` },
              }),
            );
          }
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }

    width(text: string): number {
      return this.measurer.width(0, text);
    }

    destroy() {
      this.measurer.destroy();
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * The rendered width of a line's leading `text` in body type, from the same measurer the
 * hanging uses; null before the plugin exists. Live preview draws quote bars with it.
 */
export function prefixWidth(view: EditorView, text: string): number | null {
  return view.plugin(hangingPlugin)?.width(text) ?? null;
}

/** Hanging heading, quote and list marks, mirrored on RTL lines. */
export function hangingMarks(): Extension {
  return [
    hangingPlugin,
    EditorView.editorAttributes.of((view) => {
      const plugin = view.plugin(hangingPlugin);
      return plugin ? { style: `--hang-gutter:${plugin.gutter}px` } : null;
    }),
  ];
}
