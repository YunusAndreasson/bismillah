import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownDialect } from "./dialect.ts";
import { revealedLines } from "./livePreview.ts";
import { isResting, rest, setResting } from "./rest.ts";

const DOC = "# Title\n\nA *first* paragraph.\n\nA second one.";

function state(selection = EditorSelection.cursor(12)): EditorState {
  const created = EditorState.create({
    doc: DOC,
    selection,
    extensions: [markdownDialect(), rest()],
  });
  ensureSyntaxTree(created, created.doc.length, 5000);
  return created.update({}).state;
}

const putDown = (s: EditorState) => s.update({ effects: setResting.of(true) }).state;

describe("putting the pen down", () => {
  it("reveals no block while resting, and the caret's block again after", () => {
    const writing = state();
    expect(revealedLines(writing)).toEqual({ from: 9, to: 29 });
    const resting = putDown(writing);
    expect(isResting(resting)).toBe(true);
    expect(revealedLines(resting)).toEqual({ from: -1, to: -1 });
    expect(resting.doc.toString()).toBe(DOC);
  });

  it("is picked up by typing, a caret move or a click", () => {
    const resting = putDown(state());
    const typed = resting.update({
      changes: { from: 12, insert: "x" },
      selection: { anchor: 13 },
      userEvent: "input.type",
    }).state;
    expect(isResting(typed)).toBe(false);
    const moved = resting.update({ selection: { anchor: 13 }, userEvent: "select" }).state;
    expect(isResting(moved)).toBe(false);
    const clicked = resting.update({ selection: { anchor: 12 }, userEvent: "select.pointer" });
    expect(isResting(clicked.state)).toBe(false);
  });

  it("stays down when CodeMirror re-reads the same selection", () => {
    const resting = putDown(state());
    expect(isResting(resting.update({ selection: { anchor: 12 } }).state)).toBe(true);
    expect(isResting(resting.update({}).state)).toBe(true);
  });
});
