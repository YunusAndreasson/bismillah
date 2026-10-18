import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySuggestion,
  Diagnostic,
  diagnosticAt,
  diagnosticField,
  diagnostics,
  nextDiagnostic,
  setBlockDiagnostics,
  setDisplay,
  setIgnored,
  stillValid,
  visibleDiagnostics,
  type DiagnosticKind,
  type Placed,
} from "./diagnostics.ts";

const DOC = "I will recieve the letter tomorow. This is a apple.";

function placed(state: EditorState, word: string, kind: DiagnosticKind = "spelling"): Placed {
  const from = state.doc.toString().indexOf(word);
  const to = from + word.length;
  return { from, to, diagnostic: new Diagnostic(kind, "en", "", [], kind, word) };
}

function withDiagnostics(doc = DOC): EditorState {
  let state = EditorState.create({ doc, extensions: [diagnostics(), history()] });
  const found = [
    placed(state, "recieve"),
    placed(state, "tomorow"),
    placed(state, "a apple", "grammar"),
  ];
  state = state.update({
    effects: setBlockDiagnostics.of({ from: 0, to: doc.length, found }),
  }).state;
  return state;
}

/** The decorated text and its classes. */
function decorated(state: EditorState): string[] {
  const out: string[] = [];
  const set = state.field(diagnosticField).decorations;
  for (let it = set.iter(); it.value; it.next()) {
    out.push(`${state.sliceDoc(it.from, it.to)}:${it.value.spec.class as string}`);
  }
  return out;
}

const apply = (state: EditorState, spec: TransactionSpec) => state.update(spec).state;

describe("diagnostics", () => {
  it("draws spelling and grammar with their own classes and aria-invalid", () => {
    const state = withDiagnostics();
    expect(decorated(state)).toEqual([
      "recieve:cm-diag cm-diag-spelling",
      "tomorow:cm-diag cm-diag-spelling",
      "a apple:cm-diag cm-diag-grammar",
    ]);
    const set = state.field(diagnosticField).decorations;
    expect(set.iter().value?.spec.attributes).toEqual({ "aria-invalid": "spelling" });
  });

  it("replaces a block's results when new ones arrive", () => {
    let state = withDiagnostics();
    state = apply(state, {
      effects: setBlockDiagnostics.of({ from: 0, to: 34, found: [placed(state, "letter")] }),
    });
    expect(decorated(state).map((d) => d.split(":")[0])).toEqual(["letter", "a apple"]);
  });

  it("drops a diagnostic whose text is edited and moves the others", () => {
    let state = withDiagnostics();
    // Fix the first word: "recieve" → "receive" (delete the i, insert after the e).
    state = apply(state, { changes: { from: 9, to: 10, insert: "e" }, userEvent: "input.type" });
    state = apply(state, { selection: EditorSelection.cursor(0) });
    expect(decorated(state).map((d) => d.split(":")[0])).toEqual(["tomorow", "a apple"]);
    // An edit before them moves them with the text.
    state = apply(state, { changes: { from: 0, insert: "Well, " } });
    expect(decorated(state).map((d) => d.split(":")[0])).toEqual(["tomorow", "a apple"]);
  });

  it("drops a diagnostic when text is typed right against it", () => {
    let state = withDiagnostics();
    state = apply(state, { changes: { from: 33, insert: "s" }, userEvent: "input.type" });
    expect(decorated(state).map((d) => d.split(":")[0])).not.toContain("tomorow");
  });

  it("hides the diagnostic around the caret while the writer types, until the caret leaves", () => {
    let state = withDiagnostics("Spelling: recieve here and tomorow.");
    const found = [placed(state, "recieve"), placed(state, "tomorow")];
    // Typing at the end of the sentence, then a result arrives for the word being typed.
    state = apply(state, {
      changes: { from: 34, insert: "x" },
      selection: EditorSelection.cursor(35),
      userEvent: "input.type",
    });
    state = apply(state, {
      effects: setBlockDiagnostics.of({
        from: 0,
        to: state.doc.length,
        found: [found[0] as Placed, { ...placed(state, "tomorow"), to: 35 }],
      }),
    });
    expect(decorated(state).map((d) => d.split(":")[0])).toEqual(["recieve"]);
    state = apply(state, { selection: EditorSelection.cursor(0) });
    expect(decorated(state).map((d) => d.split(":")[0])).toEqual(["recieve", "tomorowx"]);
  });

  it("hides switched-off kinds and ignored words", () => {
    let state = withDiagnostics();
    state = apply(state, { effects: setDisplay.of({ spelling: false, grammar: true }) });
    expect(decorated(state).map((d) => d.split(":")[0])).toEqual(["a apple"]);
    state = apply(state, {
      effects: [
        setDisplay.of({ spelling: true, grammar: true }),
        setIgnored.of(new Set(["spelling:tomorow"])),
      ],
    });
    expect(decorated(state).map((d) => d.split(":")[0])).toEqual(["recieve", "a apple"]);
    expect(visibleDiagnostics(state).map((p) => p.diagnostic.text)).toEqual(["recieve", "a apple"]);
  });
});

describe("finding diagnostics", () => {
  it("goes to the next and previous one, wrapping around", () => {
    let state = withDiagnostics();
    const next = () => nextDiagnostic(state, 1)?.diagnostic.text;
    const previous = () => nextDiagnostic(state, -1)?.diagnostic.text;
    expect(next()).toBe("recieve");
    state = apply(state, { selection: EditorSelection.range(7, 14) });
    expect(next()).toBe("tomorow");
    expect(previous()).toBe("a apple");
    state = apply(state, { selection: EditorSelection.cursor(DOC.length) });
    expect(next()).toBe("recieve");
    expect(previous()).toBe("a apple");
  });

  it("finds the one at the caret, spelling before grammar", () => {
    let state = EditorState.create({ doc: "Their is", extensions: [diagnostics()] });
    state = apply(state, {
      effects: setBlockDiagnostics.of({
        from: 0,
        to: 8,
        found: [placed(state, "Their is", "grammar"), placed(state, "Their")],
      }),
    });
    expect(diagnosticAt(state, 2)?.diagnostic.kind).toBe("spelling");
    expect(diagnosticAt(state, 7)?.diagnostic.kind).toBe("grammar");
    expect(diagnosticAt(state, 8)?.diagnostic.kind).toBe("grammar");
  });
});

describe("applying a suggestion", () => {
  let view: EditorView | null = null;
  afterEach(() => view?.destroy());

  it("replaces the word as one undoable edit, the caret after it", () => {
    view = new EditorView({ state: withDiagnostics() });
    const target = placed(view.state, "recieve");
    expect(applySuggestion(view, target, "receive")).toBe(true);
    expect(view.state.doc.toString()).toBe("I will receive the letter tomorow. This is a apple.");
    expect(view.state.selection.main.head).toBe(14);
    undo(view);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("refuses when the text changed since it was flagged", () => {
    view = new EditorView({ state: withDiagnostics() });
    const target = placed(view.state, "recieve");
    view.dispatch({ changes: { from: 7, to: 8, insert: "R" } });
    expect(stillValid(view.state, target)).toBe(false);
    expect(applySuggestion(view, target, "receive")).toBe(false);
    expect(view.state.doc.toString()).toContain("Recieve");
  });
});
