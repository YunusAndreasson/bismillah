import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  Prec,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  WidgetType,
  type Command,
  type DecorationSet,
  type MouseSelectionStyle,
  type Rect,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { highlightTree } from "@lezer/highlight";
import { lineDirection, type Dir } from "./bidi.ts";
import { inlineEdit, references, renderedDecorations, revealed, type Span } from "./livePreview.ts";
import { inlineStyle } from "./markdownStyling.ts";
import { arabicRuns } from "./scriptRuns.ts";

/**
 * Live preview's tables (ADR-0012, DESIGN.md §11). Outside the caret's block a GFM table
 * is drawn as a grid: no pipes, no delimiter row, its columns aligned, its cells rendered
 * as the text around them is. The grid stands in for the table's lines (a block widget)
 * and keeps their rhythm: each row is one line high and the rule under the header takes
 * the delimiter row's line, so a table whose cells don't wrap reveals without moving.
 *
 * Every drawn piece of text knows the source offset it came from. A click in the grid
 * puts the caret on the clicked character (and draws it there while the press holds
 * the reveal), and the arrow keys step into a table instead of over it.
 */

export type Align = "left" | "center" | "right" | null;

/** A cell's content, trimmed of the spaces around it. */
export type Cell = Span;

export interface TableShape {
  /** The table's lines, from the start of the first to the end of the last. */
  from: number;
  to: number;
  dir: Dir;
  align: Align[];
  /** Exactly one cell per column in every row: short rows are padded with empty
   * cells at their end, and cells beyond the header's are left out, as GFM does. */
  head: Cell[];
  rows: Cell[][];
}

function trim(state: EditorState, from: number, to: number): Cell {
  const text = state.sliceDoc(from, to);
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  return start >= end
    ? { from: from + start, to: from + start }
    : { from: from + start, to: from + end };
}

/** A row's cells, split at its unescaped pipes. A leading pipe opens the row and a
 * trailing one closes it; neither bounds a cell. */
function rowCells(state: EditorState, row: SyntaxNode): Cell[] {
  const pipes = row.getChildren("TableDelimiter");
  const cells: Cell[] = [];
  let start = row.from;
  for (const pipe of pipes) {
    cells.push(trim(state, start, pipe.from));
    start = pipe.to;
  }
  cells.push(trim(state, start, row.to));
  const empty = (cell: Cell | undefined) => cell !== undefined && cell.from === cell.to;
  if (pipes.length && empty(cells[0])) cells.shift();
  if (pipes.length && empty(cells.at(-1))) cells.pop();
  return cells;
}

/** Column alignment from the delimiter row: `:--` left, `:-:` centre, `--:` right. */
export function alignments(delimiter: string): Align[] {
  const cells = delimiter.trim().split("|");
  if (cells[0]?.trim() === "") cells.shift();
  if (cells.length > 1 && cells.at(-1)?.trim() === "") cells.pop();
  return cells.map((cell) => {
    const c = cell.trim();
    const left = c.startsWith(":");
    const right = c.endsWith(":") && c.length > 1;
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
}

/** The grid of a table node, or null when it can't be drawn as one: a table inside a
 * quote or list item keeps its Markdown, since its lines carry other marks. */
export function tableShape(state: EditorState, node: SyntaxNode): TableShape | null {
  const { doc } = state;
  const header = node.getChild("TableHeader");
  const delimiter = node.getChild("TableDelimiter");
  if (!header || !delimiter || node.parent?.name !== "Document") return null;
  const first = doc.lineAt(node.from);
  const last = doc.lineAt(node.to);
  if (state.sliceDoc(first.from, node.from).trim() !== "") return null;
  for (let n = first.number; n <= last.number; n++) {
    if (!/^ {0,3}\S/.test(doc.line(n).text)) return null;
  }
  const head = rowCells(state, header);
  const columns = head.length;
  const fit = (cells: Cell[], end: number): Cell[] =>
    Array.from({ length: columns }, (_, i) => cells[i] ?? { from: end, to: end });
  const align = alignments(state.sliceDoc(delimiter.from, delimiter.to));
  let dir: Dir | null = null;
  for (let n = first.number; n <= last.number && !dir; n++) {
    dir = lineDirection(state, doc.line(n));
  }
  return {
    from: first.from,
    to: last.to,
    dir: dir ?? "ltr",
    align: Array.from({ length: columns }, (_, i) => align[i] ?? null),
    head: fit(head, header.to),
    rows: node.getChildren("TableRow").map((row) => fit(rowCells(state, row), row.to)),
  };
}

// ---------------------------------------------------------------------------------------
// A cell's text, drawn as live preview draws the text around it.

/** A run of drawn source text: [from, to) with the classes and attributes on it. */
export interface Piece {
  from: number;
  to: number;
  cls: string;
  attrs: Record<string, string>;
}

const NO_SCRIPT_RUNS = new Set(["InlineCode", "URL", "Autolink"]);
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;

/**
 * The drawn pieces of [from, to): live preview's decorations (hidden marks left out,
 * links, code and footnotes marked), the Markdown highlighting (emphasis, strong,
 * strike) and Arabic runs, as the editor draws them on a line.
 */
export function drawnPieces(state: EditorState, cell: Cell): Piece[] {
  const { from, to } = cell;
  if (from >= to) return [];
  const hidden: Span[] = [];
  const marks: { from: number; to: number; cls: string; attrs: Record<string, string> }[] = [];
  const clip = (a: number, b: number) => [Math.max(a, from), Math.min(b, to)] as const;
  renderedDecorations(state, [cell], () => null).between(from, to, (a, b, deco) => {
    const [x, y] = clip(a, b);
    if (x >= y) return;
    const spec = deco.spec as { class?: string; attributes?: Record<string, string> };
    if (deco.point) hidden.push({ from: x, to: y });
    else marks.push({ from: x, to: y, cls: spec.class ?? "", attrs: spec.attributes ?? {} });
  });
  const tree = syntaxTree(state);
  highlightTree(
    tree,
    inlineStyle,
    (a, b, cls) => {
      const [x, y] = clip(a, b);
      if (x < y) marks.push({ from: x, to: y, cls, attrs: {} });
    },
    from,
    to,
  );
  for (const run of arabicRuns(state.sliceDoc(from, to))) {
    let skip = false;
    for (
      let node: SyntaxNode | null = tree.resolveInner(from + run.from, 1);
      node;
      node = node.parent
    ) {
      if (NO_SCRIPT_RUNS.has(node.name)) skip = true;
    }
    if (skip) continue;
    const cls = run.quranic ? "cm-ar cm-quran" : run.vocalised ? "cm-ar cm-ar-voc" : "cm-ar";
    marks.push({ from: from + run.from, to: from + run.to, cls, attrs: { lang: "ar" } });
  }
  const cuts = new Set([from, to]);
  for (const r of [...hidden, ...marks]) cuts.add(r.from).add(r.to);
  const points = [...cuts].sort((a, b) => a - b);
  const pieces: Piece[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] ?? 0;
    const b = points[i + 1] ?? 0;
    if (hidden.some((h) => h.from <= a && b <= h.to)) continue;
    const on = marks.filter((m) => m.from <= a && b <= m.to);
    const cls = [...new Set(on.flatMap((m) => m.cls.split(" ")).filter(Boolean))].join(" ");
    const attrs = Object.assign({}, ...on.map((m) => m.attrs)) as Record<string, string>;
    const prev = pieces.at(-1);
    if (
      prev &&
      prev.to === a &&
      prev.cls === cls &&
      JSON.stringify(prev.attrs) === JSON.stringify(attrs)
    ) {
      prev.to = b;
    } else {
      pieces.push({ from: a, to: b, cls, attrs });
    }
  }
  return pieces;
}

// ---------------------------------------------------------------------------------------
// The grid.

/** Each drawn text node and the source offset of its first character, relative to the
 * table's start; each cell element and its content, likewise. */
const drawnFrom = new WeakMap<Node, number>();
const cellOf = new WeakMap<Element, Cell>();

interface DrawnCell {
  /** Content range, relative to the table's start. */
  cell: Cell;
  align: Align;
  pieces: { from: number; text: string; cls: string; attrs: Record<string, string> }[];
}

class TableWidget extends WidgetType {
  /** Everything the DOM is drawn from, offsets relative to the table's start, so an
   * equal grid elsewhere in the document reuses its DOM. */
  readonly key: string;

  constructor(
    readonly dir: Dir,
    readonly head: DrawnCell[],
    readonly rows: DrawnCell[][],
  ) {
    super();
    this.key = JSON.stringify([dir, head, rows]);
  }

  override eq(other: WidgetType): boolean {
    return other instanceof TableWidget && other.key === this.key;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-table";
    wrap.dir = this.dir;
    const table = document.createElement("table");
    const row = (cells: DrawnCell[], tag: "th" | "td") => {
      const tr = document.createElement("tr");
      for (const { cell, align, pieces } of cells) {
        const el = document.createElement(tag);
        if (align) el.className = `cm-table-${align}`;
        cellOf.set(el, cell);
        // The cell's text keeps its own direction inside the table's.
        const content = document.createElement("span");
        content.dir = "auto";
        for (const piece of pieces) {
          const text = document.createTextNode(piece.text);
          drawnFrom.set(text, piece.from);
          if (!piece.cls && !Object.keys(piece.attrs).length) {
            content.append(text);
            continue;
          }
          const span = document.createElement("span");
          if (piece.cls) span.className = piece.cls;
          for (const [name, value] of Object.entries(piece.attrs)) span.setAttribute(name, value);
          span.append(text);
          content.append(span);
        }
        el.append(content);
        tr.append(el);
      }
      return tr;
    };
    const thead = document.createElement("thead");
    thead.append(row(this.head, "th"));
    const tbody = document.createElement("tbody");
    for (const cells of this.rows) tbody.append(row(cells, "td"));
    table.append(thead, tbody);
    wrap.append(table);
    return wrap;
  }

  /** Where the caret at `pos` (relative to the table's start) is drawn in the grid. */
  override coordsAt(dom: HTMLElement, pos: number, side: number): Rect | null {
    const texts: Text[] = [];
    const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Text && drawnFrom.has(node)) texts.push(node);
    }
    const start = (t: Text) => drawnFrom.get(t) ?? 0;
    let found = texts.find((t) => start(t) <= pos && pos <= start(t) + t.length);
    let offset = found ? pos - start(found) : 0;
    if (!found) {
      // In a hidden mark or between cells: the nearest drawn text on the caret's side.
      found =
        side < 0
          ? texts.findLast((t) => start(t) + t.length <= pos)
          : texts.find((t) => start(t) >= pos);
      found ??= texts[0];
      if (!found) return null;
      offset = start(found) >= pos ? 0 : found.length;
    }
    // Measured as CodeMirror measures text: the character beside the caret, flattened
    // to the caret's edge of it, so the row keeps its height when the table reveals.
    const after = side >= 0 ? offset < found.length : offset === 0;
    const from = after ? offset : Math.max(0, offset - 1);
    const range = document.createRange();
    range.setStart(found, from);
    range.setEnd(found, Math.min(found.length, from + 1));
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    const rtl = RTL_CHAR.test(found.data.slice(from, from + 1));
    const x = after === rtl ? rect.right : rect.left;
    return { left: x, right: x, top: rect.top, bottom: rect.bottom };
  }

  /** CodeMirror handles the press: a click puts the caret in the source (tableMouse). */
  override ignoreEvent(): boolean {
    return false;
  }

  override get estimatedHeight(): number {
    return -1;
  }
}

function drawn(state: EditorState, base: number, cells: Cell[], align: Align[]): DrawnCell[] {
  return cells.map((cell, i) => ({
    cell: { from: cell.from - base, to: cell.to - base },
    align: align[i] ?? null,
    pieces: drawnPieces(state, cell).map((p) => ({
      from: p.from - base,
      text: state.sliceDoc(p.from, p.to),
      cls: p.cls,
      attrs: p.attrs,
    })),
  }));
}

/**
 * Grids by their table's text. A grid is drawn relative to its table's first line, and
 * depends only on that text (a drawn table is a top-level block, parsed the same
 * wherever it stands) and the document's link and footnote definitions, which decide
 * what its brackets are. So an edit elsewhere, even in a 1 MB document, draws no table
 * again, and neither does moving the caret from block to block (ARCHITECTURE.md §14).
 */
const grids = { definitions: "", byText: new Map<string, TableWidget | null>() };
/** Enough for any book; past it the cache starts again rather than grow. */
const GRID_LIMIT = 4096;

const definitionKeys = new WeakMap<object, string>();

/** The document's link and footnote definitions, as one comparable key. */
function definitionsKey(state: EditorState): string {
  const refs = references(state);
  let key = definitionKeys.get(refs);
  if (key === undefined) {
    key = JSON.stringify([[...refs.links], [...refs.footnotes]]);
    definitionKeys.set(refs, key);
  }
  return key;
}

/** The grid for a table and the lines it replaces, or null if it isn't drawn. */
function gridAt(
  state: EditorState,
  table: { from: number; to: number; node: SyntaxNode },
  definitions: string,
): { from: number; to: number; widget: TableWidget } | null {
  const first = state.doc.lineAt(table.from);
  const last = state.doc.lineAt(table.to);
  if (definitions !== grids.definitions) {
    grids.definitions = definitions;
    grids.byText.clear();
  }
  const text = state.sliceDoc(first.from, last.to);
  let widget = grids.byText.get(text);
  if (widget === undefined) {
    const shape = tableShape(state, table.node);
    widget =
      shape &&
      new TableWidget(
        shape.dir,
        drawn(state, shape.from, shape.head, shape.align),
        shape.rows.map((row) => drawn(state, shape.from, row, shape.align)),
      );
    if (grids.byText.size >= GRID_LIMIT) grids.byText.clear();
    grids.byText.set(text, widget);
  }
  return widget ? { from: first.from, to: last.to, widget } : null;
}

/** Grids for the document's tables, except the one that holds the caret. */
export function renderedTables(state: EditorState): DecorationSet {
  const open = state.field(revealed).lines;
  const definitions = definitionsKey(state);
  const out: Range<Decoration>[] = [];
  // A cursor over the top-level blocks: no node object for each of a book's blocks.
  const cursor = syntaxTree(state).cursor();
  if (!cursor.firstChild()) return Decoration.none;
  do {
    if (cursor.name !== "Table") continue;
    const cursorNode = cursor;
    const table = {
      from: cursor.from,
      to: cursor.to,
      get node() {
        return cursorNode.node;
      },
    };
    const grid = gridAt(state, table, definitions);
    if (!grid) continue;
    if (open.from <= grid.to && open.to >= grid.from) continue;
    out.push(Decoration.replace({ widget: grid.widget, block: true }).range(grid.from, grid.to));
  } while (cursor.nextSibling());
  return Decoration.set(out);
}

const tables = StateField.define<DecorationSet>({
  create: renderedTables,
  update(value, tr) {
    const before = tr.startState.field(revealed, false);
    const after = tr.state.field(revealed);
    const reveal = before !== after;
    // The same revealed block grows/shrinks while typing. Compare its mapped
    // boundaries rather than object identity, but still rebuild when a transaction
    // also moves the selection to another block (including a rendered table).
    const sameBlock =
      before &&
      tr.changes.mapPos(before.lines.from, -1) === after.lines.from &&
      tr.changes.mapPos(before.lines.to, 1) === after.lines.to;
    // Typing in the revealed block moves the drawn tables and changes none of them.
    if (tr.docChanged && sameBlock && inlineEdit(tr)) return value.map(tr.changes);
    if (tr.docChanged || reveal || syntaxTree(tr.state) !== syntaxTree(tr.startState))
      return renderedTables(tr.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ---------------------------------------------------------------------------------------
// The mouse and the arrow keys.

interface Caret {
  node: Node;
  offset: number;
}

function caretAt(x: number, y: number): Caret | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => globalThis.Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const at = doc.caretPositionFromPoint(x, y);
    return at && { node: at.offsetNode, offset: at.offset };
  }
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** The source position under a point in a drawn table, or null outside every table. */
function tablePosAt(view: EditorView, x: number, y: number): { pos: number; assoc: -1 | 1 } | null {
  const target = document.elementFromPoint(x, y);
  const wrap = target?.closest(".cm-table");
  if (!wrap || !view.contentDOM.contains(wrap)) return null;
  const base = view.posAtDOM(wrap);
  const caret = caretAt(x, y);
  const from = caret && wrap.contains(caret.node) ? drawnFrom.get(caret.node) : undefined;
  if (caret && from !== undefined) {
    // The clicked character is the one after the caret when the point is on it, else
    // the one before; a double-click takes its word from that side.
    const { node, offset } = caret;
    let assoc: -1 | 1 = offset > 0 ? -1 : 1;
    if (node instanceof Text && offset < node.length) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const box = range.getBoundingClientRect();
      if (x >= box.left && x <= box.right) assoc = 1;
    }
    return { pos: base + from + offset, assoc };
  }
  // Beside a cell's text: its start or its end, whichever side was clicked.
  const el = target?.closest("th, td");
  const cell = el && cellOf.get(el);
  if (!el || !cell) return { pos: base, assoc: 1 };
  const box = el.firstElementChild?.getBoundingClientRect();
  const rtl = getComputedStyle(el.firstElementChild ?? el).direction === "rtl";
  const before = box ? (rtl ? x > box.right : x < box.left) : false;
  return before ? { pos: base + cell.from, assoc: 1 } : { pos: base + cell.to, assoc: -1 };
}

/** A press in a drawn table selects in its source, as a press in text does. */
const tableMouse = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.button !== 0) return null;
  const start = tablePosAt(view, event.clientX, event.clientY);
  if (!start) return null;
  let anchor = start.pos;
  const style: MouseSelectionStyle = {
    update(update) {
      if (update.docChanged) anchor = update.changes.mapPos(anchor);
      return false;
    },
    get(current, extend, multiple) {
      const at =
        tablePosAt(view, current.clientX, current.clientY) ??
        view.posAndSideAtCoords({ x: current.clientX, y: current.clientY }, false);
      const { selection } = view.state;
      if (extend) return selection.replaceRange(selection.main.extend(at.pos));
      const range =
        at.pos === anchor
          ? EditorSelection.cursor(anchor, start.assoc)
          : EditorSelection.range(anchor, at.pos);
      return multiple ? selection.addRange(range) : EditorSelection.create([range]);
    },
  };
  return style;
});

/**
 * CodeMirror's vertical motion skips block widgets. Moving down onto a drawn table puts
 * the caret at the start of its first row, moving up at the start of its last; the
 * table then reveals its Markdown.
 */
function stepInto(forward: boolean, extend: boolean): Command {
  return (view) => {
    const { state } = view;
    if (state.selection.ranges.length > 1) return false;
    const main = state.selection.main;
    const next = view.moveVertically(main, forward);
    // The tables the motion passed over; the caret stops at the nearest.
    const skipped: Span[] = [];
    state
      .field(tables)
      .between(Math.min(main.head, next.head), Math.max(main.head, next.head), (from, to) => {
        const over = forward
          ? main.head < from && next.head >= to
          : main.head > to && next.head <= from;
        if (over) skipped.push({ from, to });
      });
    const table = forward ? skipped[0] : skipped.at(-1);
    if (!table) return false;
    const target = forward ? table.from : state.doc.lineAt(table.to).from;
    view.dispatch({
      selection: extend
        ? state.selection.replaceRange(main.extend(target))
        : EditorSelection.cursor(target),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  };
}

/** Tables drawn as grids outside the caret's block (ADR-0012). */
export function previewTables(): Extension {
  return [
    tables,
    tableMouse,
    Prec.high(
      keymap.of([
        { key: "ArrowDown", run: stepInto(true, false), shift: stepInto(true, true) },
        { key: "ArrowUp", run: stepInto(false, false), shift: stepInto(false, true) },
      ]),
    ),
  ];
}
