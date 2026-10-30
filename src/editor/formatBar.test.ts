// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdownDialect } from "./dialect.ts";
import { FORMAT_EVENT } from "./format.ts";
import { focusFormatBar, formatBar, isBarShown, KEYBOARD_PAUSE_MS } from "./formatBar.ts";

describe("the bar over a selection", () => {
  let view: EditorView;
  const mounted = { count: 0, destroyed: 0 };

  function open(doc: string, readOnly = false) {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [
          markdownDialect(),
          EditorState.readOnly.of(readOnly),
          formatBar((_view, dom) => {
            mounted.count += 1;
            dom.className = "format-bar";
            return {
              update: () => undefined,
              destroy: () => {
                mounted.destroyed += 1;
              },
            };
          }),
        ],
      }),
    });
  }

  const selectByKeys = (from: number, to: number) => {
    view.dispatch({ selection: EditorSelection.range(from, to), userEvent: "select" });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mounted.count = 0;
    mounted.destroyed = 0;
  });
  afterEach(() => {
    view.destroy();
    vi.useRealTimers();
  });

  it("waits for a pause after a keyboard selection", () => {
    open("A word here");
    selectByKeys(2, 6);
    expect(isBarShown(view.state)).toBe(false);
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS);
    expect(isBarShown(view.state)).toBe(true);
  });

  it("restarts the pause with each key", () => {
    open("A word here");
    selectByKeys(2, 3);
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS - 1);
    selectByKeys(2, 4);
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS - 1);
    expect(isBarShown(view.state)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isBarShown(view.state)).toBe(true);
  });

  it("waits for the mouse's release", () => {
    open("A word here");
    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    view.dispatch({ selection: EditorSelection.range(2, 6), userEvent: "select.pointer" });
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS * 2);
    expect(isBarShown(view.state)).toBe(false);
    window.dispatchEvent(new MouseEvent("mouseup"));
    vi.advanceTimersByTime(0);
    expect(isBarShown(view.state)).toBe(true);
  });

  it("recovers from a release it never saw", () => {
    open("A word here");
    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    window.dispatchEvent(new Event("blur"));
    selectByKeys(2, 6);
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS);
    expect(isBarShown(view.state)).toBe(true);
  });

  it("goes when the writer types, and doesn't come back by itself", () => {
    open("A word here");
    selectByKeys(2, 6);
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS);
    view.dispatch({
      changes: { from: 2, to: 6, insert: "x" },
      selection: EditorSelection.cursor(3),
      userEvent: "input.type",
    });
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS * 2);
    expect(isBarShown(view.state)).toBe(false);
  });

  it("goes when the selection collapses", () => {
    open("A word here");
    selectByKeys(2, 6);
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS);
    selectByKeys(4, 4);
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS);
    expect(isBarShown(view.state)).toBe(false);
  });

  it("stays, the same bar, through a format action", () => {
    open("A word here");
    selectByKeys(2, 6);
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS);
    expect(mounted.count).toBe(1);
    view.dispatch({
      changes: [
        { from: 2, insert: "**" },
        { from: 6, insert: "**" },
      ],
      selection: EditorSelection.range(4, 8),
      userEvent: FORMAT_EVENT,
    });
    expect(isBarShown(view.state)).toBe(true);
    expect(mounted.count).toBe(1);
    expect(mounted.destroyed).toBe(0);
  });

  it("brings nothing for a match from Find", () => {
    open("A word here");
    view.dispatch({ selection: EditorSelection.range(2, 6), userEvent: "select.search" });
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS * 2);
    expect(isBarShown(view.state)).toBe(false);
  });

  it("stays away from read-only text and code", () => {
    open("A word here", true);
    selectByKeys(2, 6);
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS);
    expect(isBarShown(view.state)).toBe(false);
    view.destroy();
    open("```\ncode\n```");
    selectByKeys(4, 8);
    vi.advanceTimersByTime(KEYBOARD_PAUSE_MS);
    expect(isBarShown(view.state)).toBe(false);
  });

  it("comes at once when asked for from the keyboard", () => {
    open("A word here");
    expect(focusFormatBar(view)).toBe(false);
    view.dispatch({ selection: EditorSelection.range(2, 6) });
    expect(focusFormatBar(view)).toBe(true);
    expect(isBarShown(view.state)).toBe(true);
  });
});
