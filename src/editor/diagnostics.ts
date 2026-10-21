import {
  EditorSelection,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Spelling and grammar diagnostics on the writing surface (DESIGN.md §11): a wavy
 * underline in `diagnostic-spelling` and a dotted one in `diagnostic-grammar`, with
 * `aria-invalid` for assistive technology. They are hidden while the caret is in the
 * word being typed, and nothing pops up unasked.
 *
 * Results arrive from Rust per block (linter.ts). A diagnostic is mapped through later
 * edits only while its own text is untouched; an edit touching it removes it until the
 * block is checked again, so a result is never stretched over text it didn't see.
 */

export type DiagnosticKind = "spelling" | "grammar";

export class Diagnostic extends RangeValue {
  constructor(
    readonly kind: DiagnosticKind,
    readonly lang: "en" | "ar",
    /** Harper's explanation (grammar); empty for spelling. */
    readonly message: string,
    /** Corrections known up front; spelling's are found when the writer asks. */
    readonly suggestions: readonly string[],
    readonly ruleId: string,
    /** The flagged text, as it was checked. */
    readonly text: string,
  ) {
    super();
  }

  /** What *Ignore* remembers: the word for spelling, the rule and text for grammar. */
  get ignoreKey(): string {
    return this.kind === "spelling" ? `spelling:${this.text}` : `${this.ruleId}:${this.text}`;
  }
}

/** A diagnostic with its place in the document. */
export interface Placed {
  from: number;
  to: number;
  diagnostic: Diagnostic;
}

export interface DiagnosticDisplay {
  spelling: boolean;
  grammar: boolean;
}

/** New results for one block: everything inside `from`–`to` is replaced. */
export const setBlockDiagnostics = StateEffect.define<{
  from: number;
  to: number;
  found: Placed[];
}>();
/** Which kinds are shown (Settings › Language & checking). */
export const setDisplay = StateEffect.define<DiagnosticDisplay>();
/** Words and suggestions the writer chose to ignore in this document. */
export const setIgnored = StateEffect.define<ReadonlySet<string>>();
/** Forget every result (the personal dictionary or the settings changed). */
export const clearDiagnostics = StateEffect.define<null>();
/** A word went into the personal dictionary: its spelling marks go at once. */
export const forgetWord = StateEffect.define<string>();

interface DiagnosticState {
  all: RangeSet<Diagnostic>;
  /** Where the writer is typing: the diagnostic around it stays hidden. */
  typingAt: number | null;
  display: DiagnosticDisplay;
  ignored: ReadonlySet<string>;
  decorations: DecorationSet;
}

/** One mark per kind and language: an Arabic word's underline sits lower, below its
 * dots and descenders, so the element drawing it says so itself. */
const mark = (kind: DiagnosticKind, lang: "en" | "ar") =>
  Decoration.mark({
    class: `cm-diag cm-diag-${kind}${lang === "ar" ? " cm-diag-ar" : ""}`,
    attributes: { "aria-invalid": kind },
  });
const marks = {
  "spelling-en": mark("spelling", "en"),
  "spelling-ar": mark("spelling", "ar"),
  "grammar-en": mark("grammar", "en"),
  "grammar-ar": mark("grammar", "ar"),
} as const;

function visible(s: DiagnosticState, d: Diagnostic): boolean {
  return s.display[d.kind] && !s.ignored.has(d.ignoreKey);
}

function decorate(s: Omit<DiagnosticState, "decorations">): DecorationSet {
  const ranges = [];
  for (let it = s.all.iter(); it.value; it.next()) {
    const d = it.value;
    if (!visible(s as DiagnosticState, d)) continue;
    if (s.typingAt !== null && it.from <= s.typingAt && s.typingAt <= it.to) continue;
    ranges.push(marks[`${d.kind}-${d.lang}`].range(it.from, it.to));
  }
  return Decoration.set(ranges, true);
}

/** Maps diagnostics through an edit, dropping every one the edit touched. */
function mapThrough(all: RangeSet<Diagnostic>, tr: Transaction): RangeSet<Diagnostic> {
  const changed: [number, number][] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => changed.push([fromB, toB]));
  return all.map(tr.changes).update({
    filter: (from, to) => from < to && !changed.some(([a, b]) => from <= b && to >= a),
  });
}

const typing = (tr: Transaction) =>
  tr.docChanged && (tr.isUserEvent("input.type") || tr.isUserEvent("delete"));

export const diagnosticField = StateField.define<DiagnosticState>({
  create() {
    const base = {
      all: RangeSet.empty as RangeSet<Diagnostic>,
      typingAt: null,
      display: { spelling: true, grammar: true },
      ignored: new Set<string>(),
    };
    return { ...base, decorations: Decoration.none };
  },
  update(s, tr) {
    let { all, typingAt, display, ignored } = s;
    let dirty = false;
    if (tr.docChanged) {
      all = mapThrough(all, tr);
      dirty = true;
    }
    for (const e of tr.effects) {
      if (e.is(setBlockDiagnostics)) {
        const { from, to, found } = e.value;
        all = all.update({
          filterFrom: from,
          filterTo: to,
          filter: (a, b) => a < from || b > to,
          add: found.map((p) => p.diagnostic.range(p.from, p.to)),
          sort: true,
        });
        dirty = true;
      } else if (e.is(setDisplay)) {
        display = e.value;
        dirty = true;
      } else if (e.is(setIgnored)) {
        ignored = e.value;
        dirty = true;
      } else if (e.is(clearDiagnostics)) {
        all = RangeSet.of<Diagnostic>([]);
        dirty = true;
      } else if (e.is(forgetWord)) {
        const word = e.value;
        all = all.update({ filter: (_a, _b, d) => !(d.kind === "spelling" && d.text === word) });
        dirty = true;
      }
    }
    const next = typing(tr)
      ? tr.state.selection.main.head
      : tr.selection
        ? null
        : typingAt === null
          ? null
          : tr.changes.mapPos(typingAt);
    if (next !== typingAt) dirty = true;
    typingAt = next;
    if (!dirty) return s;
    const state = { all, typingAt, display, ignored };
    return { ...state, decorations: decorate(state) };
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.decorations),
});

/** The diagnostics the writer can see (shown kinds, not ignored), in document order. */
export function visibleDiagnostics(state: EditorState): Placed[] {
  const s = state.field(diagnosticField, false);
  if (!s) return [];
  const out: Placed[] = [];
  for (let it = s.all.iter(); it.value; it.next()) {
    if (visible(s, it.value)) out.push({ from: it.from, to: it.to, diagnostic: it.value });
  }
  return out;
}

/** The diagnostic at `pos`: the narrowest one around it, spelling first. */
export function diagnosticAt(state: EditorState, pos: number): Placed | null {
  const around = visibleDiagnostics(state).filter((p) => p.from <= pos && pos <= p.to);
  around.sort(
    (a, b) =>
      Number(a.diagnostic.kind === "grammar") - Number(b.diagnostic.kind === "grammar") ||
      a.to - a.from - (b.to - b.from),
  );
  return around[0] ?? null;
}

/** The next (or previous) diagnostic after the selection, wrapping around the document. */
export function nextDiagnostic(state: EditorState, direction: 1 | -1): Placed | null {
  const all = visibleDiagnostics(state);
  if (!all.length) return null;
  const { from } = state.selection.main;
  if (direction === 1) return all.find((p) => p.from > from) ?? all[0] ?? null;
  return all.findLast((p) => p.from < from) ?? all.at(-1) ?? null;
}

/** Whether `placed` still describes the document: its text is unchanged where it was. */
export function stillValid(state: EditorState, placed: Placed): boolean {
  return (
    placed.to <= state.doc.length &&
    state.doc.sliceString(placed.from, placed.to) === placed.diagnostic.text
  );
}

/** Replaces the flagged text with a correction: one undoable edit, the caret after it. */
export function applySuggestion(view: EditorView, placed: Placed, replacement: string): boolean {
  if (view.state.readOnly || !stillValid(view.state, placed)) return false;
  view.dispatch({
    changes: { from: placed.from, to: placed.to, insert: replacement },
    selection: EditorSelection.cursor(placed.from + replacement.length),
    userEvent: "input.complete",
    scrollIntoView: true,
  });
  return true;
}

export function diagnostics(): Extension {
  return diagnosticField;
}
