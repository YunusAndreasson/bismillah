import { syntaxTree } from "@codemirror/language";
import {
  Annotation,
  Prec,
  StateField,
  type EditorState,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Enter starts a new paragraph (DESIGN.md §11.4). In a paragraph or heading at the top
 * level it inserts the blank line Markdown needs between paragraphs, so one key does
 * what took two. Backspace straight after takes the whole break back. Shift-Enter still
 * inserts a single line break. Lists and quotes keep lang-markdown's Enter, which
 * continues them; code, tables, frontmatter, blank lines and a caret at the start of a
 * line keep the plain newline.
 */

const BLOCKS = /^(?:Paragraph|ATXHeading[1-6])$/;

/** The break just inserted: where it starts and how long it is. */
interface Break {
  readonly from: number;
  readonly length: number;
  /** The caret right after it, where an immediate Backspace takes it back. */
  readonly caret: number;
}

const inserted = Annotation.define<Break>();

const lastBreak = StateField.define<Break | null>({
  create: () => null,
  update(value, tr) {
    const made = tr.annotation(inserted);
    if (made) return made;
    // Typing, a click or a caret move ends it. CodeMirror also re-reads the DOM
    // selection on its own; a caret that stays put keeps it.
    if (tr.docChanged) return null;
    if (tr.selection && value) {
      const { main } = tr.state.selection;
      return main.empty && main.head === value.caret ? value : null;
    }
    return value;
  },
});

/** Enter as a paragraph break, or null where Enter keeps its usual meaning. */
export function paragraphBreak(state: EditorState): TransactionSpec | null {
  const { selection, doc } = state;
  if (selection.ranges.length !== 1) return null;
  const { from, to } = selection.main;
  const line = doc.lineAt(from);
  if (to > line.to || !line.text.slice(0, from - line.from).trim()) return null;
  let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(
    state,
  ).resolveInner(from, -1);
  while (node && !BLOCKS.test(node.name)) node = node.parent;
  if (node?.parent?.name !== "Document") return null;
  // At the end of a line whose paragraph runs on below, that rest becomes a paragraph
  // of its own: a blank line goes after the caret too.
  const runsOn =
    to === line.to && line.number < doc.lines && doc.line(line.number + 1).text.trim() !== "";
  const text = runsOn ? "\n\n\n" : "\n\n";
  const caret = from + 2;
  return {
    changes: { from, to, insert: text },
    selection: { anchor: caret },
    scrollIntoView: true,
    userEvent: "input",
    annotations: inserted.of({ from, length: text.length, caret }),
  };
}

/** Backspace straight after a paragraph break: the break goes, the caret returns. */
export function undoBreak(state: EditorState): TransactionSpec | null {
  const last = state.field(lastBreak, false);
  const { main } = state.selection;
  if (!last || state.selection.ranges.length !== 1 || !main.empty || main.head !== last.caret)
    return null;
  return {
    changes: { from: last.from, to: last.from + last.length },
    selection: { anchor: last.from },
    scrollIntoView: true,
    userEvent: "delete.backward",
  };
}

const run =
  (command: (state: EditorState) => TransactionSpec | null) =>
  (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const spec = command(view.state);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  };

export function paragraphs(): Extension {
  return [
    lastBreak,
    // Ahead of lang-markdown's Enter (Prec.high), which declines nothing.
    Prec.highest(
      keymap.of([
        { key: "Enter", run: run(paragraphBreak) },
        { key: "Backspace", run: run(undoBreak) },
      ]),
    ),
  ];
}
