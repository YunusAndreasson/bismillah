import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownDialect } from "./dialect.ts";
import { inlineEdit, livePreview, references } from "./livePreview.ts";
import { previewBlocks } from "./previewBlocks.ts";
import { previewTables, renderedTables } from "./previewTables.ts";

const DOC = [
  "A plain paragraph of prose‸ to type in.",
  "",
  "| Name | Value |",
  "|---|---|",
  "| a | [the link][ref] |",
  "",
  "![a figure](figures/arch.png)",
  "",
  "A line with `code` in it.",
  "",
  "[ref]: https://example.org/first",
].join("\n");

/** A state with all of live preview and the caret at the `‸`. */
function stateAt(doc: string): EditorState {
  const caret = doc.indexOf("‸");
  const text = doc.replace("‸", "");
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(caret),
    extensions: [markdownDialect(), livePreview(), previewBlocks(), previewTables()],
  });
  ensureSyntaxTree(state, text.length, 5000);
  return state.update({}).state;
}

const at = (state: EditorState, text: string) => state.doc.toString().indexOf(text);

/** Where the state's own fields replace lines with a grid, as [from, to] pairs. */
function drawnGrids(state: EditorState): [number, number][] {
  const out: [number, number][] = [];
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === "function") continue;
    source.between(0, state.doc.length, (from, to, deco) => {
      if (deco.spec.block && to > from) out.push([from, to]);
    });
  }
  return out;
}

const ranges = (set: ReturnType<typeof renderedTables>, length: number) => {
  const out: [number, number][] = [];
  set.between(0, length, (from, to) => {
    out.push([from, to]);
  });
  return out;
};
const edit = (state: EditorState, spec: TransactionSpec) => inlineEdit(state.update(spec));

describe("edits that leave the rest of the document as it was", () => {
  const state = stateAt(DOC);
  const caret = state.selection.main.head;

  it("are typing and deleting inside the revealed line", () => {
    expect(edit(state, { changes: { from: caret, insert: "s" } })).toBe(true);
    expect(edit(state, { changes: { from: caret, insert: "a few words" } })).toBe(true);
    expect(edit(state, { changes: { from: caret - 5, to: caret } })).toBe(true);
    expect(edit(state, { selection: { anchor: 0 } })).toBe(true);
  });

  it("aren't line breaks, line starts or structure", () => {
    expect(edit(state, { changes: { from: caret, insert: "\n" } })).toBe(false);
    expect(edit(state, { changes: { from: 0, insert: "#" } })).toBe(false);
    expect(edit(state, { changes: { from: 2, insert: " " } })).toBe(false);
    for (const mark of ["|", "`", "~", "<", ">", "[", "]", "!"])
      expect(edit(state, { changes: { from: caret, insert: mark } }), mark).toBe(false);
    // Joining the line with the next one deletes a line break.
    const end = state.doc.lineAt(caret).to;
    expect(edit(state, { changes: { from: end - 1, to: end + 1 } })).toBe(false);
  });

  it("aren't edits outside the revealed block, or on a line with structure", () => {
    expect(edit(state, { changes: { from: at(state, "Value"), insert: "s" } })).toBe(false);
    const code = stateAt(DOC.replace("‸", "").replace("in it.", "in it‸."));
    expect(edit(code, { changes: { from: code.selection.main.head, insert: "s" } })).toBe(false);
  });
});

describe("live preview's document-wide parts across edits", () => {
  it("keep the definitions, tables and images through typing", () => {
    let state = stateAt(DOC);
    const refs = references(state);
    const tables = renderedTables(state).size;
    expect(tables).toBe(1);
    for (const key of "and more") {
      const head = state.selection.main.head;
      state = state.update({
        changes: { from: head, insert: key },
        selection: { anchor: head + 1 },
      }).state;
    }
    expect(references(state)).toBe(refs);
    expect(references(state).links.get("ref")).toBe("https://example.org/first");
    // The kept grids stand where drawing them afresh would put them.
    expect(drawnGrids(state)).toEqual(ranges(renderedTables(state), state.doc.length));
    expect(drawnGrids(state).length).toBe(tables);
  });

  it("follow a definition that changes, and a fence that turns the rest into code", () => {
    let state = stateAt(DOC.replace("‸", "").replace("/first", "/fir‸st"));
    state = state.update({ changes: { from: state.selection.main.head, insert: "-ever" } }).state;
    expect(references(state).links.get("ref")).toBe("https://example.org/fir-everst");
    // A fence opened above the table makes everything after it code: no table is drawn.
    state = stateAt(DOC);
    state = state.update({ changes: { from: 0, insert: "```\n" } }).state;
    ensureSyntaxTree(state, state.doc.length, 5000);
    state = state.update({}).state;
    expect(renderedTables(state).size).toBe(0);
    expect(references(state).links.size).toBe(0);
  });
});
