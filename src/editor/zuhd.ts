import { syntaxTree } from "@codemirror/language";
import { Facet, RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Zuhd mode (زهد), the focus mode (DESIGN.md §11.1): text outside the current paragraph
 * or sentence is drawn in `text-secondary`, never faded with opacity, so its contrast
 * stays measurable. It only decorates; the text and layout never change.
 */

export type FocusGranularity = "paragraph" | "sentence";

export const focusGranularity = Facet.define<FocusGranularity, FocusGranularity>({
  combine: (values) => values.at(-1) ?? "paragraph",
});

/** Blocks that are focused as a whole. Containers (lists, quotes) are not: their
 * paragraphs are. */
const TEXT_BLOCKS = new Set([
  "Paragraph",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "FencedCode",
  "CodeBlock",
  "Table",
  "HTMLBlock",
  "Frontmatter",
  "LinkReference",
]);

export interface Range {
  from: number;
  to: number;
}

/** The text block around `pos`, or null on a blank line. */
function blockAt(state: EditorState, pos: number): Range | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (
      let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      if (TEXT_BLOCKS.has(node.name)) return { from: node.from, to: node.to };
    }
  }
  return null;
}

const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });

/**
 * The range Zuhd mode keeps in full colour: the block around the caret, or the sentence
 * within it. Trailing spaces belong to no sentence. Null when the caret is on a blank line.
 */
export function focusedRange(state: EditorState, granularity: FocusGranularity): Range | null {
  const head = state.selection.main.head;
  const block = blockAt(state, head);
  if (!block || granularity === "paragraph") return block;
  const text = state.sliceDoc(block.from, block.to);
  const offset = head - block.from;
  let last: Range | null = null;
  for (const { segment, index } of sentences.segment(text)) {
    const end = index + segment.trimEnd().length;
    last = { from: block.from + index, to: block.from + end };
    // A caret right after a sentence's last character still belongs to it.
    if (offset <= end || offset < index + segment.length) return last;
  }
  return last;
}

function dimmed(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const focus = focusedRange(view.state, view.state.facet(focusGranularity));
  const mark = Decoration.mark({ class: "cm-zuhd-dim" });
  for (const { from, to } of view.visibleRanges) {
    if (!focus) {
      builder.add(from, to, mark);
      continue;
    }
    if (from < focus.from) builder.add(from, Math.min(to, focus.from), mark);
    if (to > focus.to) builder.add(Math.max(from, focus.to), to, mark);
  }
  return builder.finish();
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = dimmed(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState) ||
        update.state.facet(focusGranularity) !== update.startState.facet(focusGranularity)
      )
        this.decorations = dimmed(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export function zuhd(): Extension {
  return [plugin, EditorView.editorAttributes.of({ class: "cm-zuhd" })];
}
