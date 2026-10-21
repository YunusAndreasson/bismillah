import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { markdownDialect } from "./dialect.ts";
import { paragraphBreak, paragraphs, undoBreak } from "./paragraphs.ts";

/** A parsed state with the caret at `|` (removed from the text). */
function at(marked: string): EditorState {
  const caret = marked.indexOf("|");
  const doc = marked.replace("|", "");
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [markdownDialect(), paragraphs()],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

/** The document after Enter, with the caret marked, or null where Enter keeps its meaning. */
function enter(marked: string): string | null {
  const state = at(marked);
  const spec = paragraphBreak(state);
  if (!spec) return null;
  const next = state.update(spec).state;
  const head = next.selection.main.head;
  return `${next.sliceDoc(0, head)}|${next.sliceDoc(head)}`;
}

describe("Enter as a paragraph break", () => {
  it.each([
    ["the end of a paragraph", "One.|", "One.\n\n|"],
    ["the end of a paragraph before the next", "One.|\n\nTwo.", "One.\n\n|\n\nTwo."],
    ["the middle of a line", "One.| Two.", "One.\n\n| Two."],
    ["a heading", "# Title|", "# Title\n\n|"],
    ["Arabic", "بسم الله.|", "بسم الله.\n\n|"],
    ["a line whose paragraph runs on below", "One|\ntwo.", "One\n\n|\n\ntwo."],
    ["spaces before the caret, kept as typed", "One.  |", "One.  \n\n|"],
  ])("breaks the paragraph at %s", (_name, before, after) => {
    expect(enter(before)).toBe(after);
  });

  it.each([
    ["a list item (lang-markdown continues the list)", "- one|"],
    ["a quote (lang-markdown continues the quote)", "> one|"],
    ["fenced code", "```\ncode|\n```"],
    ["a blank line", "One.\n\n|"],
    ["the start of a line", "|One."],
    ["frontmatter", "---\ntitle: x|\n---\n\nText."],
    ["a table", "| a | b |\n|---|---|\n| 1 | 2 ||"],
    ["a setext heading", "Title|\n====="],
  ])("keeps the usual Enter in %s", (_name, before) => {
    expect(enter(before)).toBeNull();
  });

  it("replaces a selection within the line", () => {
    const state = EditorState.create({
      doc: "One two.",
      selection: EditorSelection.range(3, 7),
      extensions: [markdownDialect(), paragraphs()],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const parsed = state.update({}).state;
    const spec = paragraphBreak(parsed);
    expect(spec).not.toBeNull();
    if (spec) expect(parsed.update(spec).state.doc.toString()).toBe("One\n\n.");
  });
});

describe("Backspace after a paragraph break", () => {
  it("takes the whole break back, and only straight after", () => {
    for (const before of ["One.|", "One|\ntwo."]) {
      const state = at(before);
      const spec = paragraphBreak(state);
      expect(spec).not.toBeNull();
      if (!spec) continue;
      const broken = state.update(spec).state;
      const back = undoBreak(broken);
      expect(back).not.toBeNull();
      if (back) {
        const restored = broken.update(back).state;
        expect(restored.doc.toString()).toBe(before.replace("|", ""));
        expect(restored.selection.main.head).toBe(before.indexOf("|"));
      }
      // Typing after the break ends it: Backspace is an ordinary Backspace again.
      const typed = broken.update({
        changes: { from: broken.selection.main.head, insert: "x" },
        selection: { anchor: broken.selection.main.head + 1 },
        userEvent: "input.type",
      }).state;
      expect(undoBreak(typed)).toBeNull();
    }
  });

  it("does nothing after an ordinary newline", () => {
    const state = at("One.|");
    const typed = state.update({
      changes: { from: 4, insert: "\n" },
      selection: { anchor: 5 },
      userEvent: "input",
    }).state;
    expect(undoBreak(typed)).toBeNull();
  });
});
