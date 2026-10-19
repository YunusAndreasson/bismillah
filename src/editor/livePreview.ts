import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  findClusterBreak,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type SelectionRange,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type MouseSelectionStyle,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { lineHang, prefixWidth } from "./hangingMarks.ts";
import { remeasureTypography } from "./typography.ts";

/**
 * Live preview (ADR-0012, DESIGN.md §11). Outside the block that holds the caret, the
 * document is drawn rendered: emphasis, strong, strike and code without their marks,
 * links as their text, bullets, quote bars and rules. The caret's block shows its
 * Markdown exactly as Phase 1 draws it, and "Always show Markdown" leaves this extension
 * out altogether.
 *
 * Marks are hidden in two ways:
 * - Marks inside the line (`**`, `_`, `` ` ``, `[…](url)`) are replaced, so the text
 *   closes up. Entering such a block reflows it once.
 * - Marks that hang in the gutter or fill their own line (`#`, `>`, list markers, task
 *   boxes, `---`, code fences) keep their place in the text and are only painted out;
 *   bullets, bars, boxes, rules and the ground of a code block are drawn by CSS where
 *   they stand. Revealing them moves nothing, and the caret model and DOM order never
 *   change.
 * Tables are drawn as a grid by previewTables.ts.
 *
 * Reveal follows the caret, never the pointer. While the mouse button is down the
 * reveal waits, so text never moves under a press or a drag; at the release the line
 * with the caret keeps its height on screen, and the second click of a double-click is
 * anchored to the character the first one chose.
 */

export interface Span {
  from: number;
  to: number;
}

/** Blocks that reveal as a whole when they hold the caret. Containers (lists, quotes)
 * don't: their paragraphs do, together with the marks on those lines. */
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
  "Table",
  "FencedCode",
  "CodeBlock",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "LinkReference",
  "HorizontalRule",
  "Frontmatter",
]);

/** Blocks whose contents are drawn as Phase 1 draws them, rendered or not. */
const SOURCE = new Set([
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "LinkReference",
  "Frontmatter",
]);

function unitAt(tree: Tree, pos: number, side: -1 | 1): SyntaxNode | null {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
    if (UNITS.has(node.name)) return node;
  }
  return null;
}

/**
 * The lines that show their Markdown: those of the block that holds the caret (the
 * selection's head), and always the caret's own line, so the caret never sits beside a
 * hidden mark. On a blank line it is just that line.
 */
export function revealedLines(state: EditorState): Span {
  const { doc } = state;
  const head = state.selection.main.head;
  const line = doc.lineAt(head);
  const tree = syntaxTree(state);
  // At the start of a list item the caret is on its marker, outside the paragraph; the
  // paragraph is found from the line's end.
  const unit =
    unitAt(tree, head, 1) ??
    unitAt(tree, head, -1) ??
    (line.length > 0 ? unitAt(tree, line.to, -1) : null);
  if (!unit) return { from: line.from, to: line.to };
  return {
    from: Math.min(line.from, doc.lineAt(unit.from).from),
    to: Math.max(line.to, doc.lineAt(unit.to).to),
  };
}

// ---------------------------------------------------------------------------------------
// Edits that leave the rest of the document as it was.

/** Characters that open or close a structure that reaches beyond its own line, or that
 * live preview draws from elsewhere: tables, code, HTML, links, definitions, images. */
const STRUCTURE = /[|`~<>[\]!]/;

/**
 * Whether a transaction only typed or deleted inside the revealed block's lines, without
 * changing anything that could reach beyond them: no line break added or removed, nothing
 * at a line's start (indentation, list, quote and heading marks, fences), and no
 * character that makes a table, code, HTML, a link, a definition or an image, on the
 * line before or after. Typing prose is almost always such an edit. The document's
 * tables, images and definitions then stand as they were, and their decorations only
 * move, so a key in a 1 MB document costs no more than in a short one (ARCHITECTURE.md
 * §14). Everything else rebuilds them.
 */
export function inlineEdit(tr: Transaction): boolean {
  if (!tr.docChanged) return true;
  const open = tr.startState.field(revealed, false)?.lines;
  if (!open) return false;
  let inline = true;
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (!inline) return;
    const before = tr.startState.doc.lineAt(fromA);
    const after = tr.state.doc.lineAt(fromB);
    const lead = /^[ \t]*/.exec(after.text)?.[0].length ?? 0;
    inline =
      inserted.lines === 1 &&
      toA <= before.to &&
      toB <= after.to &&
      fromA >= open.from &&
      toA <= open.to &&
      fromB - after.from > lead + 3 &&
      fromA - before.from > lead + 3 &&
      !STRUCTURE.test(before.text) &&
      !STRUCTURE.test(after.text);
  });
  return inline;
}

// ---------------------------------------------------------------------------------------
// Which block is revealed, and the mouse press that holds it.

/** A mouse button went down (true) or came up (false) in the editor. */
export const holdReveal = StateEffect.define<boolean>();

interface Reveal {
  lines: Span;
  /** A press is in progress: the reveal waits for its release. */
  held: boolean;
}

export const revealed = StateField.define<Reveal>({
  create: (state) => ({ lines: revealedLines(state), held: false }),
  update(value, tr) {
    let held = value.held;
    for (const effect of tr.effects) if (effect.is(holdReveal)) held = effect.value;
    // Typing or moving the caret by keyboard during a press reveals at once.
    if (held && (tr.docChanged || (tr.selection && !tr.isUserEvent("select.pointer")))) {
      held = false;
    }
    if (held) return value.held ? value : { lines: value.lines, held };
    const stale =
      value.held ||
      tr.docChanged ||
      tr.selection !== undefined ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState);
    if (!stale) return value;
    const lines = revealedLines(tr.state);
    if (!value.held && lines.from === value.lines.from && lines.to === value.lines.to) {
      return value;
    }
    return { lines, held: false };
  },
});

// ---------------------------------------------------------------------------------------
// Link and footnote definitions: `[sic]` is a link only if `[sic]: …` is defined, as
// CommonMark says, so bracketed text in scholarly prose keeps its brackets.

interface References {
  /** Defined link labels, normalised, with their addresses. */
  links: ReadonlyMap<string, string>;
  footnotes: ReadonlySet<string>;
}

const FOOTNOTE = /^\[\^([^\]\s]+)\]$/;
const referenceCache = new WeakMap<Tree, References>();

/** A link label as CommonMark matches it: case-folded, inner whitespace collapsed. */
export function normaliseLabel(label: string): string {
  return label.trim().replace(/\s+/gu, " ").toLowerCase();
}

/** The definitions, kept across edits that can't change them (`inlineEdit`). */
const definitions = StateField.define<References>({
  create: (state) => collectReferences(state),
  update(value, tr) {
    if (tr.docChanged && inlineEdit(tr)) return value;
    if (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return collectReferences(tr.state);
    }
    return value;
  },
});

/** The document's link and footnote definitions. */
export function references(state: EditorState): References {
  return state.field(definitions, false) ?? collectReferences(state);
}

function collectReferences(state: EditorState): References {
  const tree = syntaxTree(state);
  const cached = referenceCache.get(tree);
  if (cached) return cached;
  const links = new Map<string, string>();
  const footnotes = new Set<string>();
  tree.iterate({
    enter(node) {
      if (node.name === "LinkReference") {
        const label = node.node.getChild("LinkLabel");
        if (label) {
          const name = state.sliceDoc(label.from + 1, label.to - 1);
          const url = node.node.getChild("URL");
          const address = url ? state.sliceDoc(url.from, url.to) : "";
          if (name.startsWith("^")) footnotes.add(name.slice(1));
          // The first definition of a label wins, as in CommonMark.
          else if (!links.has(normaliseLabel(name))) links.set(normaliseLabel(name), address);
        }
        return false;
      }
      if (node.name === "Paragraph") {
        const first = node.node.firstChild;
        if (first?.name === "Link" && first.from === node.from) {
          const footnote = FOOTNOTE.exec(state.sliceDoc(first.from, first.to));
          if (footnote?.[1] && state.sliceDoc(first.to, first.to + 1) === ":") {
            footnotes.add(footnote[1]);
          }
        }
        return false;
      }
      if (UNITS.has(node.name)) return false;
    },
  });
  const found = { links, footnotes };
  referenceCache.set(tree, found);
  return found;
}

// ---------------------------------------------------------------------------------------
// The rendered look.

const hidden = Decoration.replace({});
const painted = (cls: string) =>
  Decoration.mark({ class: `cm-md-hidden ${cls}`.trim(), attributes: { "aria-hidden": "true" } });
const look = {
  hidden: painted(""),
  bullet: painted("cm-md-bullet"),
  task: painted("cm-md-task"),
  taskDone: painted("cm-md-task cm-md-done"),
  number: Decoration.mark({ class: "cm-md-number" }),
  link: Decoration.mark({ class: "cm-md-link" }),
  code: Decoration.mark({ class: "cm-md-code" }),
  alt: Decoration.mark({ class: "cm-md-alt" }),
  footnote: Decoration.mark({ class: "cm-md-footnote" }),
  codeInfo: Decoration.mark({ class: "cm-md-codeinfo" }),
  rule: Decoration.line({ class: "cm-md-rule" }),
  fence: Decoration.line({ class: "cm-md-fence" }),
};

/** Measures text at the start of a line in body type (the hanging marks' measurer). */
export type WidthOf = (text: string) => number | null;

/**
 * Quote bars sit on each `>` and run the full height of the line, wrapped rows too.
 * They are placed back from the reading edge, as if every `>` were followed by a space,
 * so an empty `>` line (which hangs only its `>`) keeps its bar in line with the rest.
 */
function quoteLine(
  state: EditorState,
  width: WidthOf,
  from: number,
  marks: number[],
): Range<Decoration> | null {
  const line = state.doc.lineAt(from);
  const mark = width(">");
  const hang = lineHang(state, line)?.prefix ?? "";
  const prefix = width(/[ \t]$/.test(hang) || hang === "" ? hang : `${hang} `);
  if (mark === null || prefix === null) return null;
  const bars = marks.map((offset) => (width(line.text.slice(0, offset)) ?? 0) + mark / 2 - prefix);
  const at = (x: number) =>
    `calc(var(--line-start) ${x < 0 ? "-" : "+"} ${Math.abs(x).toFixed(2)}px)`;
  const layer = (x: number, rtl: boolean) =>
    `linear-gradient(var(--quote-bar),var(--quote-bar)) ${rtl ? `right ${at(x)} top 0` : `${at(x)} 0`}/var(--quote-bar-width) 100% no-repeat`;
  const style =
    `--bars-ltr:${bars.map((x) => layer(x, false)).join(",")};` +
    `--bars-rtl:${bars.map((x) => layer(x, true)).join(",")}`;
  return Decoration.line({ class: "cm-md-quote", attributes: { style } }).range(from);
}

/**
 * The rendered look for `ranges` (the visible ones), outside the revealed lines.
 */
export function renderedDecorations(
  state: EditorState,
  ranges: readonly Span[],
  width: WidthOf,
): DecorationSet {
  const { lines: open } = state.field(revealed);
  const refs = references(state);
  const out: Range<Decoration>[] = [];
  const quotes = new Map<number, number[]>();

  /** Hides [from, to), never a line break (a plugin may not replace one). */
  const hide = (from: number, to: number) => {
    for (let pos = from; pos < to;) {
      const line = state.doc.lineAt(pos);
      const end = Math.min(to, line.to);
      if (end > pos) out.push(hidden.range(pos, end));
      pos = line.to + 1;
    }
  };
  const text = (node: { from: number; to: number }) => state.sliceDoc(node.from, node.to);
  const quoteMark = (node: SyntaxNode) => {
    out.push(look.hidden.range(node.from, node.to));
    const line = state.doc.lineAt(node.from);
    const marks = quotes.get(line.from) ?? [];
    marks.push(node.from - line.from);
    quotes.set(line.from, marks);
  };

  /** Links and images: `[text](url)`, `[text][label]`, `[label]`, `![alt](src)`. */
  const linkLike = (node: SyntaxNode, image: boolean) => {
    const marks = node.getChildren("LinkMark");
    const start = marks[0];
    const close = marks.find((m) => text(m) === "]");
    if (!start || !close) return;
    if (!image) {
      const footnote = FOOTNOTE.exec(text(node));
      if (footnote?.[1]) {
        const definition =
          node.parent?.name === "Paragraph" &&
          node.parent.from === node.from &&
          state.sliceDoc(node.to, node.to + 1) === ":";
        if (!definition && !refs.footnotes.has(footnote[1])) return;
        hide(node.from, node.from + 2);
        hide(node.to - 1, node.to + (definition ? 1 : 0));
        out.push(look.footnote.range(node.from + 2, node.to - 1));
        return;
      }
    }
    const inline = marks.some((m) => m.from === close.to && text(m) === "(");
    if (!inline) {
      const label = node.getChild("LinkLabel");
      const name =
        label && label.to - label.from > 2
          ? state.sliceDoc(label.from + 1, label.to - 1)
          : state.sliceDoc(start.to, close.from);
      if (!refs.links.has(normaliseLabel(name))) return;
    }
    // A link without text would vanish; it keeps its Markdown.
    if (!image && close.from === start.to) return;
    hide(start.from, start.to);
    hide(close.from, node.to);
    if (close.from > start.to) out.push((image ? look.alt : look.link).range(start.to, close.from));
  };

  /**
   * A code block on its ground, with its fences painted out and its info string kept as
   * a quiet label at the end of the first row. In a quote the bars carry the structure,
   * so there is no ground.
   */
  const codeBlock = (node: SyntaxNode, from: number, to: number) => {
    const { doc } = state;
    let quoted = false;
    for (let up = node.parent; up; up = up.parent) if (up.name === "Blockquote") quoted = true;
    const first = doc.lineAt(node.from).number;
    const last = doc.lineAt(node.to).number;
    const fenced = node.name === "FencedCode";
    for (const mark of node.getChildren("QuoteMark")) quoteMark(mark);
    if (!quoted) {
      const end = doc.lineAt(Math.min(node.to, to)).number;
      for (let n = doc.lineAt(Math.max(node.from, from)).number; n <= end; n++) {
        const cls = ["cm-md-codeblock"];
        if (n === first) cls.push("cm-md-codeblock-first");
        if (n === last) cls.push("cm-md-codeblock-last");
        out.push(Decoration.line({ class: cls.join(" ") }).range(doc.line(n).from));
      }
    }
    if (!fenced) return;
    const marks = node.getChildren("CodeMark");
    const open = marks[0];
    const close = marks.length > 1 ? marks.at(-1) : undefined;
    if (open?.from === node.from) {
      out.push(look.hidden.range(open.from, open.to));
      if (!quoted) out.push(look.fence.range(doc.lineAt(open.from).from));
    }
    const info = node.getChild("CodeInfo");
    if (info) out.push(look.codeInfo.range(info.from, info.to));
    if (close && doc.lineAt(close.from).number !== first) {
      out.push(look.hidden.range(close.from, close.to));
    }
  };

  const tree = syntaxTree(state);
  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(ref) {
        if (ref.name !== "Document" && ref.from >= open.from && ref.to <= open.to) return false;
        const node = ref.node;
        if (SOURCE.has(ref.name)) {
          // A block quoted line by line still has its quote marks.
          for (const mark of node.getChildren("QuoteMark")) quoteMark(mark);
          return false;
        }
        switch (ref.name) {
          case "HeaderMark": {
            const heading = node.parent;
            // A closing `##` sits inside the line; an opening one hangs in the gutter and
            // a setext underline has its own line.
            if (heading?.name.startsWith("ATXHeading") && node.from > heading.from) {
              hide(node.from, node.to);
            } else {
              out.push(look.hidden.range(node.from, node.to));
            }
            return;
          }
          case "QuoteMark":
            quoteMark(node);
            return;
          case "ListMark": {
            const item = node.parent;
            if (item?.getChild("Task")) out.push(look.hidden.range(node.from, node.to));
            else if (item?.parent?.name === "BulletList")
              out.push(look.bullet.range(node.from, node.to));
            else out.push(look.number.range(node.from, node.to));
            return;
          }
          case "TaskMarker":
            out.push((/x/i.test(text(node)) ? look.taskDone : look.task).range(node.from, node.to));
            return;
          case "HorizontalRule":
            out.push(look.hidden.range(node.from, node.to));
            out.push(look.rule.range(state.doc.lineAt(node.from).from));
            return false;
          case "FencedCode":
          case "CodeBlock":
            codeBlock(node, from, to);
            return false;
          case "EmphasisMark":
          case "StrikethroughMark":
            hide(node.from, node.to);
            return;
          case "InlineCode": {
            const marks = node.getChildren("CodeMark");
            const first = marks[0];
            const last = marks.at(-1);
            if (first && last && last !== first) {
              hide(first.from, first.to);
              hide(last.from, last.to);
              if (last.from > first.to) out.push(look.code.range(first.to, last.from));
            }
            return false;
          }
          case "Escape":
            hide(node.from, node.from + 1);
            return false;
          case "HardBreak":
            if (state.sliceDoc(node.from, node.from + 1) === "\\") hide(node.from, node.from + 1);
            return false;
          case "Link":
          case "Image":
            linkLike(node, ref.name === "Image");
            return;
          case "Autolink": {
            const marks = node.getChildren("LinkMark");
            const url = node.getChild("URL");
            if (marks.length === 2 && url) {
              for (const mark of marks) hide(mark.from, mark.to);
              out.push(look.link.range(url.from, url.to));
            }
            return false;
          }
          case "URL":
            // Bare URLs; those of links and images are handled with them.
            if (node.parent?.name !== "Link" && node.parent?.name !== "Image") {
              out.push(look.link.range(node.from, node.to));
            }
            return false;
        }
      },
    });
  }
  for (const [from, marks] of quotes) {
    const deco = quoteLine(state, width, from, marks);
    if (deco) out.push(deco);
  }
  return Decoration.set(out, true);
}

const build = (view: EditorView) =>
  renderedDecorations(view.state, view.visibleRanges, (text) => prefixWidth(view, text));

const rendering = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.state.field(revealed) !== update.startState.field(revealed, false) ||
        syntaxTree(update.state) !== syntaxTree(update.startState) ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(remeasureTypography)))
      )
        this.decorations = build(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------------------------------------------------------------------------------------
// The mouse: reveal at the release, keep the clicked line in place, anchor double-clicks.

/** How far apart (px) and how quickly (ms) clicks still count as one double-click. */
const MULTI_CLICK = { distance: 6, time: 600 };

interface Click {
  pos: number;
  assoc: -1 | 1;
  x: number;
  y: number;
  time: number;
}

/** The word, space run or punctuation run at `pos`, as CodeMirror's double-click takes. */
function groupAt(state: EditorState, pos: number, bias: -1 | 1): SelectionRange {
  const categorize = state.charCategorizer(pos);
  const line = state.doc.lineAt(pos);
  const at = pos - line.from;
  if (line.length === 0) return EditorSelection.cursor(pos);
  const side = at === 0 ? 1 : at === line.length ? -1 : bias;
  let from = at;
  let to = at;
  if (side < 0) from = findClusterBreak(line.text, at, false);
  else to = findClusterBreak(line.text, at);
  const kind = categorize(line.text.slice(from, to));
  while (from > 0) {
    const prev = findClusterBreak(line.text, from, false);
    if (categorize(line.text.slice(prev, from)) !== kind) break;
    from = prev;
  }
  while (to < line.length) {
    const next = findClusterBreak(line.text, to);
    if (categorize(line.text.slice(to, next)) !== kind) break;
    to = next;
  }
  return EditorSelection.range(line.from + from, line.from + to);
}

function rangeForClick(state: EditorState, pos: number, assoc: -1 | 1, clicks: number) {
  if (clicks === 2) return groupAt(state, pos, assoc);
  const line = state.doc.lineAt(pos);
  return EditorSelection.range(line.from, Math.min(state.doc.length, line.to + 1));
}

/**
 * A double- or triple-click whose first click revealed its block: the text moved after
 * the first click, so the word is taken at the position that click chose, not at the
 * pointer. Dragging on from there extends by words (or lines) as usual.
 */
function anchoredSelection(view: EditorView, start: MouseEvent, click: Click): MouseSelectionStyle {
  let pos = click.pos;
  const clicks = start.detail;
  return {
    update(update) {
      if (update.docChanged) pos = update.changes.mapPos(pos);
      return false;
    },
    get(event, extend) {
      let range = rangeForClick(view.state, pos, click.assoc, clicks);
      const moved = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
      if (moved > MULTI_CLICK.distance) {
        const at = view.posAndSideAtCoords({ x: event.clientX, y: event.clientY }, false);
        const other = rangeForClick(view.state, at.pos, at.assoc, clicks);
        const from = Math.min(range.from, other.from);
        const to = Math.max(range.to, other.to);
        range =
          other.from < range.from
            ? EditorSelection.range(to, from)
            : EditorSelection.range(from, to);
      }
      const { selection } = view.state;
      if (extend) return selection.replaceRange(selection.main.extend(range.from, range.to));
      return EditorSelection.create([range]);
    },
  };
}

const pointer = ViewPlugin.fromClass(
  class {
    /** The last release that revealed a block. */
    click: Click | null = null;
    private readonly release = (event: Event) => this.end(event);

    constructor(readonly view: EditorView) {
      // On the window, so it runs after CodeMirror's own release handler on the document.
      window.addEventListener("mouseup", this.release);
      window.addEventListener("dragend", this.release);
      window.addEventListener("blur", this.release);
    }

    end(event: Event) {
      const { view } = this;
      const reveal = view.state.field(revealed, false);
      if (!reveal?.held) return;
      const next = revealedLines(view.state);
      const effects: StateEffect<unknown>[] = [holdReveal.of(false)];
      if (next.from !== reveal.lines.from || next.to !== reveal.lines.to) {
        // Keep the caret's row where it is on screen while its block reveals.
        const { main } = view.state.selection;
        const assoc = main.assoc < 0 ? -1 : 1;
        const caret = view.coordsAtPos(main.head, assoc);
        if (caret) {
          const top = view.scrollDOM.getBoundingClientRect().top;
          effects.push(
            EditorView.scrollIntoView(EditorSelection.cursor(main.head, assoc), {
              y: "start",
              yMargin: caret.top - top,
            }),
          );
        }
        this.click =
          event instanceof MouseEvent && main.empty
            ? { pos: main.head, assoc, x: event.clientX, y: event.clientY, time: event.timeStamp }
            : null;
      }
      view.dispatch({ effects });
    }

    /** The anchored style for a double- or triple-click right after a revealing click. */
    anchored(event: MouseEvent): MouseSelectionStyle | null {
      const click = this.click;
      if (!click || event.detail < 2 || event.button !== 0) return null;
      const near =
        Math.hypot(event.clientX - click.x, event.clientY - click.y) <= MULTI_CLICK.distance &&
        event.timeStamp - click.time <= MULTI_CLICK.time;
      if (!near) return null;
      // The anchor serves the second and third click of this sequence only.
      if (event.detail >= 3) this.click = null;
      return anchoredSelection(this.view, event, click);
    }

    destroy() {
      window.removeEventListener("mouseup", this.release);
      window.removeEventListener("dragend", this.release);
      window.removeEventListener("blur", this.release);
    }
  },
);

/** Live preview: rendered text outside the caret's block (ADR-0012). */
export function livePreview(): Extension {
  return [
    revealed,
    definitions,
    rendering,
    pointer,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button === 0) view.dispatch({ effects: holdReveal.of(true) });
        return false;
      },
    }),
    EditorView.mouseSelectionStyle.of(
      (view, event) => view.plugin(pointer)?.anchored(event) ?? null,
    ),
    EditorView.editorAttributes.of({ class: "cm-live" }),
  ];
}
