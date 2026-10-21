import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { caretBlink } from "./caretBlink.ts";

let view: EditorView;
let focused: boolean;
let hidden: boolean;
let reduced: boolean;
let motion: EventTarget;
const editable = new Compartment();

function open(steady = false): void {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: "العَرَبِيَّةُ أَمَانَةٌ. English prose.",
      extensions: [caretBlink(steady), editable.of(EditorView.editable.of(true))],
    }),
  });
}

const off = () => view.dom.hasAttribute("data-caret-hidden");

beforeEach(() => {
  vi.useFakeTimers();
  focused = true;
  hidden = false;
  reduced = false;
  motion = new EventTarget();
  Object.defineProperty(motion, "matches", { get: () => reduced });
  vi.spyOn(EditorView.prototype, "hasFocus", "get").mockImplementation(() => focused);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("matchMedia", () => motion);
});

afterEach(() => {
  view.destroy();
  view.dom.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("discrete caret blinking", () => {
  it("rests visibly after about ten idle seconds and resumes after interaction", () => {
    open();
    vi.advanceTimersByTime(10_000);
    expect(off()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    view.dispatch({ selection: { anchor: 2 } });
    vi.advanceTimersByTime(600);
    expect(off()).toBe(true);
  });
  it("changes only caret visibility, twice per cycle, without transactions", () => {
    open();
    const state = view.state;
    vi.advanceTimersByTime(599);
    expect(off()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(off()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(off()).toBe(false);
    expect(view.state).toBe(state);
  });

  it("shows the caret immediately after typing and moving it", () => {
    open();
    vi.advanceTimersByTime(600);
    view.dispatch({ changes: { from: 0, insert: "A" } });
    expect(off()).toBe(false);
    vi.advanceTimersByTime(600);
    expect(off()).toBe(true);
    view.dispatch({ selection: { anchor: 2 } });
    expect(off()).toBe(false);
    vi.advanceTimersByTime(599);
    expect(off()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(off()).toBe(true);
  });

  it("stops while hidden and resumes with a visible caret", () => {
    open();
    vi.advanceTimersByTime(600);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(off()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(off()).toBe(false);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(600);
    expect(off()).toBe(true);
  });

  it("stops when focus is lost", () => {
    open();
    focused = false;
    vi.advanceTimersByTime(600);
    expect(off()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(off()).toBe(false);
  });

  it("honours reduced motion and changes to that preference", () => {
    open();
    vi.advanceTimersByTime(600);
    reduced = true;
    motion.dispatchEvent(new Event("change"));
    vi.advanceTimersByTime(5000);
    expect(off()).toBe(false);
    reduced = false;
    motion.dispatchEvent(new Event("change"));
    vi.advanceTimersByTime(600);
    expect(off()).toBe(true);
  });

  it("keeps a steady caret for screenshots and read-only documents", () => {
    open(true);
    vi.advanceTimersByTime(5000);
    expect(off()).toBe(false);
    view.destroy();
    view.dom.remove();
    open();
    view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(false)) });
    vi.advanceTimersByTime(5000);
    expect(off()).toBe(false);
  });

  it("cancels its timer and listeners when the editor is destroyed", () => {
    open();
    view.destroy();
    document.dispatchEvent(new Event("visibilitychange"));
    motion.dispatchEvent(new Event("change"));
    vi.advanceTimersByTime(5000);
    expect(off()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
