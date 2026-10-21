import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
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
      if ((deco.spec as { block?: boolean }).block && to > from) out.push([from, to]);
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

  it("aren't edits outside the revealed block", () => {
    expect(edit(state, { changes: { from: at(state, "Value"), insert: "s" } })).toBe(false);
  });

  it("can type prose on a line with unchanged inline code", () => {
    const code = stateAt(DOC.replace("‸", "").replace("in it.", "in it‸."));
    expect(edit(code, { changes: { from: code.selection.main.head, insert: "s" } })).toBe(true);
    const end = stateAt(DOC.replace("‸", "").replace("in it.", "in it.‸"));
    expect(edit(end, { changes: { from: end.selection.main.head, insert: "s" } })).toBe(true);
  });

  it("rejects code delimiter, escape, adjacency and fence changes", () => {
    for (const [doc, inserted, removed] of [
      ["Prose with `co‸de` here.", "`", 0],
      ["Prose with `co‸de` here.", "\\", 0],
      ["Prose with `a`‸ `b` here.", "", 1],
      ["Prose with `a‸` here.", "", 1],
      ["Prose with `‸a` here.", "x", 0],
      ["Prose with \\x‸`code` here.", "y", 0],
      ["```code‸\ncontents\n```", "x", 0],
      ["A `code` and [link](url) here‸.", "x", 0],
    ] as const) {
      const code = stateAt(doc);
      const from = code.selection.main.head;
      expect(edit(code, { changes: { from, to: from + removed, insert: inserted } }), doc).toBe(
        false,
      );
    }
  });

  it("maps existing table widgets through prose edits beside inline code", () => {
    let code = stateAt(DOC.replace("‸", "").replace("in it.", "in it‸."));
    const refs = references(code);
    const before = drawnGrids(code);
    for (const key of " and more") {
      const head = code.selection.main.head;
      code = code.update({
        changes: { from: head, insert: key },
        selection: { anchor: head + 1 },
      }).state;
      expect(references(code)).toBe(refs);
      expect(drawnGrids(code)).toEqual(ranges(renderedTables(code), code.doc.length));
    }
    expect(drawnGrids(code)).toEqual(before);
  });

  it("aren't edits in frontmatter, including after spaced delimiters", () => {
    for (const doc of [
      "--- ‸\ntitle: Hidden\n---\n\nProse.",
      "---\ntitle: Hidden\n--- ‸\n\nProse.",
      "---\ntitle: Hidden‸\n---\n\nProse.",
    ]) {
      const metadata = stateAt(doc);
      expect(edit(metadata, { changes: { from: metadata.selection.main.head, insert: "x" } })).toBe(
        false,
      );
    }
    const invalid = stateAt("--- x‸\ntitle: Hidden\n---\n\nProse.");
    expect(edit(invalid, { changes: { from: 4, to: 5 } })).toBe(false);
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

  it("reveal a table when an inline edit also moves the caret into it", () => {
    const state = stateAt(DOC);
    const head = state.selection.main.head;
    const table = at(state, "Value");
    const next = state.update({
      changes: { from: head, insert: "longer" },
      selection: { anchor: table + 6 },
    }).state;
    expect(drawnGrids(next)).toEqual([]);
    expect(renderedTables(next).size).toBe(0);
  });

  it("map tables after deletions and keep them correct through undo-shaped edits", () => {
    let state = stateAt(DOC);
    const head = state.selection.main.head;
    for (const changes of [
      { from: head - 4, to: head },
      { from: head - 4, insert: "rose" },
    ]) {
      state = state.update({ changes }).state;
      expect(drawnGrids(state)).toEqual(ranges(renderedTables(state), state.doc.length));
      expect(drawnGrids(state)).toHaveLength(1);
    }
  });

  it("includes newly parsed previews when a background parse lands with an inline edit", () => {
    const doc = `Intro prose to type in.\n\n${"A paragraph.\n\n".repeat(12_000)}| A | B |\n|---|---|\n| 1 | 2 |\n\n![Figure](a.png)\n\n[late]: https://example.org`;
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(12),
      extensions: [markdownDialect(), livePreview(), previewBlocks(), previewTables()],
    });
    expect(syntaxTree(state).length).toBeLessThan(doc.length);
    ensureSyntaxTree(state, doc.length, 5000);
    const next = state.update({
      changes: { from: 12, insert: "s" },
      selection: { anchor: 13 },
    }).state;
    expect(drawnGrids(next)).toEqual(ranges(renderedTables(next), next.doc.length));
    expect(drawnGrids(next)).toHaveLength(1);
    expect(references(next).links.get("late")).toBe("https://example.org");
    let images = 0;
    for (const source of next.facet(EditorView.decorations)) {
      if (typeof source === "function") continue;
      source.between(0, next.doc.length, (_from, _to, deco) => {
        if ((deco.spec as { widget?: { src?: string } }).widget?.src === "a.png") images++;
      });
    }
    expect(images).toBe(1);
  });
});
