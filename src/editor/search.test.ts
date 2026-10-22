import { history, undo } from "@codemirror/commands";
import {
  findNext,
  openSearchPanel,
  replaceAll,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { isResting, rest } from "./rest.ts";
import { documentSearch, openReplace } from "./search.ts";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view?.dom.remove();
});

function editor(doc: string, readOnly = false): EditorView {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [history(), rest(), documentSearch(), EditorState.readOnly.of(readOnly)],
    }),
  });
  return view;
}

describe("document search", () => {
  it("preserves Arabic marks and original UTF-16 ranges beside supplementary characters", () => {
    const doc = "😀 بسم بِسْمِ بِسْمِ";
    const v = editor(doc);
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "بِسْمِ" })) });
    findNext(v);
    expect(v.state.selection.main.from).toBe(doc.indexOf("بِسْمِ"));
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe("بِسْمِ");
    expect(v.state.doc.toString()).toBe(doc);
  });

  it("compares Unicode forms without rewriting them and restores all bytes with one undo", () => {
    const original = "é e\u0301 بِسْمِ";
    const v = editor(original);
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "é", replace: "E" })) });
    findNext(v);
    expect(v.state.doc.toString()).toBe(original);
    replaceAll(v);
    expect(v.state.doc.toString()).toBe("E E بِسْمِ");
    expect(undo(v)).toBe(true);
    expect(v.state.doc.toString()).toBe(original);
  });

  it("never replaces part of a compatibility character's expansion", () => {
    const v = editor("ﬀ ff");
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "f", replace: "X" })) });
    replaceAll(v);
    expect(v.state.doc.toString()).toBe("ﬀ XX");
  });

  it("focuses what to find until there is something to find", () => {
    const v = editor("Text");
    expect(openReplace(v)).toBe(true);
    expect(document.activeElement?.getAttribute("name")).toBe("search");
  });

  it("focuses replacement and closes search before Escape puts the pen down", () => {
    const v = editor("Text");
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "Text" })) });
    expect(openReplace(v)).toBe(true);
    expect(document.activeElement?.getAttribute("name")).toBe("replace");
    expect(
      runScopeHandlers(
        v,
        new KeyboardEvent("keydown", { key: "Escape", keyCode: 27 }),
        "search-panel",
      ),
    ).toBe(true);
    expect(v.dom.querySelector(".cm-search")).toBeNull();
    expect(isResting(v.state)).toBe(false);
  });

  it("allows finding but refuses replacing a read-only document", () => {
    const v = editor("بِسْمِ", true);
    expect(openReplace(v)).toBe(false);
    openSearchPanel(v);
    expect(v.dom.querySelector('input[name="replace"]')).toBeNull();
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "بِسْمِ", replace: "x" })) });
    replaceAll(v);
    expect(v.state.doc.toString()).toBe("بِسْمِ");
  });

  it("explains invalid patterns and empty results, and clears stale feedback after edits", () => {
    const v = editor("بِسْمِ scatter");
    openSearchPanel(v);
    const field = v.dom.querySelector<HTMLInputElement>('input[name="search"]');
    const status = () => v.dom.querySelector(".cm-search-feedback");
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "[", regexp: true })) });
    expect(field?.getAttribute("aria-invalid")).toBe("true");
    expect(field?.getAttribute("aria-describedby")).toBe(status()?.id);
    expect(status()?.textContent).toContain("Invalid regular expression");
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "cat", wholeWord: true })) });
    expect(field?.getAttribute("aria-invalid")).toBe("false");
    expect(status()?.textContent).toContain("No matches");
    v.dispatch({ changes: { from: v.state.doc.length, insert: " cat" } });
    expect(status()?.textContent).toContain("Match found");
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
    expect(status()?.textContent).toBe("Type text to find in this document.");
    expect(v.state.doc.toString()).toBe("بِسْمِ scatter cat");
  });
});
