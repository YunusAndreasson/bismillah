import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownDialect } from "./dialect.ts";
import { holdReveal, revealed } from "./livePreview.ts";
import {
  alignments,
  drawnPieces,
  renderedTables,
  tableShape,
  type Cell,
  type TableShape,
} from "./previewTables.ts";

/** A parsed state with the caret at the `‸` in `doc` (at the end without one). */
function stateWith(doc: string): EditorState {
  const caret = doc.indexOf("‸");
  const text = doc.replace("‸", "");
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(caret < 0 ? text.length : caret),
    extensions: [markdownDialect(), revealed],
  });
  ensureSyntaxTree(state, text.length, 5000);
  return state.update({}).state;
}

function shapeOf(doc: string): { state: EditorState; shape: TableShape | null } {
  const state = stateWith(doc);
  let shape: TableShape | null = null;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Table" && !shape) shape = tableShape(state, node.node);
    },
  });
  return { state, shape };
}

const texts = (state: EditorState, cells: Cell[]) => cells.map((c) => state.sliceDoc(c.from, c.to));

/** A cell drawn as text, each piece with its classes: "text" or "text{classes}". */
function drawnText(state: EditorState, cell: Cell): string {
  return drawnPieces(state, cell)
    .map((p) => {
      const text = state.sliceDoc(p.from, p.to);
      return p.cls ? `${text}{${p.cls}}` : text;
    })
    .join("");
}

describe("a table's grid", () => {
  it("has one cell per column in every row, trimmed, as GFM reads them", () => {
    const { state, shape } = shapeOf(
      "| A | *b* |  |\n|:--|--:|:-:|\n| x \\| y | `c` |\n|  | z |\n| 1 | 2 | 3 | 4 |\nno pipe\n\n‸",
    );
    if (!shape) throw new Error("no table");
    expect(texts(state, shape.head)).toEqual(["A", "*b*", ""]);
    expect(shape.align).toEqual(["left", "right", "center"]);
    expect(shape.rows.map((row) => texts(state, row))).toEqual([
      ["x \\| y", "`c`", ""],
      ["", "z", ""],
      ["1", "2", "3"],
      ["no pipe", "", ""],
    ]);
    expect(shape.from).toBe(0);
    expect(state.sliceDoc(shape.to - 7, shape.to)).toBe("no pipe");
  });

  it("reads alignment from the delimiter row", () => {
    expect(alignments("|---|:--|--:|:-:|")).toEqual([null, "left", "right", "center"]);
    expect(alignments(" :--- | ---: ")).toEqual(["left", "right"]);
  });

  it("takes its direction from its first strong letter", () => {
    expect(shapeOf("| الاسم | Size |\n|---|---|\n| أ | 1 |\n\n‸").shape?.dir).toBe("rtl");
    expect(shapeOf("| # | Name |\n|---|---|\n| 1 | علي |\n\n‸").shape?.dir).toBe("ltr");
    expect(shapeOf("| # | ١ |\n|---|---|\n| 1 | علي |\n\n‸").shape?.dir).toBe("rtl");
  });

  it("is not drawn inside a quote or a list item", () => {
    expect(shapeOf("> | A | B |\n> |---|---|\n> | 1 | 2 |\n\n‸").shape).toBeNull();
    expect(shapeOf("- item\n\n  | A | B |\n  |---|---|\n  | 1 | 2 |\n\n‸").shape).toBeNull();
  });
});

describe("a cell's text", () => {
  it("is drawn as the text around it: marks hidden, emphasis, code and links marked", () => {
    const { state, shape } = shapeOf(
      "| *em* **strong** `code` | [link](https://e.com) [sic] x \\| y |\n|---|---|\n\n‸",
    );
    if (!shape) throw new Error("no table");
    const [first, second] = shape.head;
    if (!first || !second) throw new Error("no cells");
    expect(drawnText(state, first)).toBe("em{cm-em} strong{cm-strong} code{cm-md-code cm-code}");
    expect(drawnText(state, second)).toBe(
      // An undefined `[sic]` keeps its brackets, in syntax-marker as in a paragraph.
      "link{cm-md-link} [{cm-mark}sic]{cm-mark} x | y",
    );
  });

  it("marks Arabic runs for the Arabic font, never inside code", () => {
    const { state, shape } = shapeOf("| كتاب `كود` |\n|---|\n\n‸");
    const cell = shape?.head[0];
    if (!cell) throw new Error("no cell");
    const pieces = drawnPieces(state, cell);
    expect(pieces.map((p) => [state.sliceDoc(p.from, p.to), p.cls, p.attrs])).toEqual([
      ["كتاب", "cm-ar", { lang: "ar" }],
      [" ", "", {}],
      ["كود", "cm-md-code cm-code", {}],
    ]);
  });
});

describe("drawn tables", () => {
  const doc = "Text\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nMore";

  const drawnRanges = (state: EditorState) => {
    const ranges: string[] = [];
    renderedTables(state).between(0, state.doc.length, (from, to) => {
      ranges.push(state.sliceDoc(from, to));
    });
    return ranges;
  };

  it("stand in for the table's lines outside the caret's block", () => {
    expect(drawnRanges(stateWith(`${doc}‸`))).toEqual(["| A | B |\n|---|---|\n| 1 | 2 |"]);
  });

  it("show the Markdown of the table that holds the caret", () => {
    expect(drawnRanges(stateWith(doc.replace("| 1 |", "| 1‸ |")))).toEqual([]);
  });

  it("wait for the mouse button's release", () => {
    const inside = doc.indexOf("| 1 |") + 2;
    const pressed = stateWith(`${doc}‸`).update({ effects: holdReveal.of(true) }).state;
    const clicked = pressed.update({
      selection: EditorSelection.cursor(inside),
      userEvent: "select.pointer",
    }).state;
    expect(drawnRanges(clicked)).toHaveLength(1);
    expect(drawnRanges(clicked.update({ effects: holdReveal.of(false) }).state)).toEqual([]);
  });
});
