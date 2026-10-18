import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  Annotation,
  EditorState,
  Facet,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * Typing aids (DESIGN.md §11.3, ADR-0010): smart punctuation and IJMES transliteration
 * mode. Ported from the Phase 0 spike (spikes/transliteration/converter.ts), whose table
 * was chosen on 1.8M words of prose (docs/spikes/transliteration.md).
 *
 * The aids act only on keys the writer has just typed at the caret. The typed key goes in
 * as ordinary input first; the conversion follows as its own undo step, so `Mod-Z` returns
 * to the typed keys and an immediate Backspace restores them literally. Keys restored that
 * way never convert again. Nothing here runs on open, paste, drop or save, so the file
 * keeps exactly what the writer typed (AGENTS.md, "The writer's trust" rule 3).
 *
 * The keys typed since the caret last arrived are tracked as *units*: what one plain key
 * or one conversion inserted, with the keys that produced it. Rules match the raw keys of
 * the most recent units, aligned to unit boundaries, so "…" (typed "...") never supplies a
 * "." to a later rule, while "’" (typed "'") still counts as a typed "'" for "''" → ʾ.
 */

export interface TypingAidsConfig {
  smartPunctuation: boolean;
}

/** Settings for the aids; smart punctuation is on by default (`smart_punctuation`). */
export const typingAidsConfig = Facet.define<Partial<TypingAidsConfig>, TypingAidsConfig>({
  combine(values) {
    let smartPunctuation = true;
    for (const value of values) smartPunctuation = value.smartPunctuation ?? smartPunctuation;
    return { smartPunctuation };
  },
});

export const setTransliteration = StateEffect.define<boolean>();

/** Transliteration mode (`Mod-Shift-T`), off by default. */
export const transliterationOn = StateField.define<boolean>({
  create: () => false,
  update(on, tr) {
    for (const effect of tr.effects) if (effect.is(setTransliteration)) on = effect.value;
    return on;
  },
});

export function toggleTransliteration(view: EditorView): boolean {
  view.dispatch({ effects: setTransliteration.of(!view.state.field(transliterationOn)) });
  return true;
}

// ---------------------------------------------------------------------------------------
// The transliteration table (IJMES, DESIGN.md §11.3): the spike's FINAL table.

const AYN = "ʿ"; // U+02BF MODIFIER LETTER LEFT HALF RING
const HAMZA = "ʾ"; // U+02BE MODIFIER LETTER RIGHT HALF RING

interface Unit {
  /** The keys that produced this unit. */
  readonly raw: string;
  /** What it inserted. */
  readonly out: string;
  /** Restored and escaped units never take part in a later conversion. */
  readonly sticky: boolean;
}

interface GuardContext {
  /** Text of the current line before the characters the rule would replace. */
  readonly before: string;
  /** Units the rule would replace, oldest first (the key just typed is not included). */
  readonly replaced: readonly Unit[];
}

interface Rule {
  /** Keys typed, e.g. ".h". The last character is the key that completes the sequence. */
  readonly pattern: string;
  readonly output: string;
  /** Escapes turn a just-made ʿ back into backticks and stay literal afterwards. */
  readonly escape?: boolean;
  /** Returns false to leave the keys as typed. */
  readonly guard?: (ctx: GuardContext) => boolean;
}

const lastOf = (s: string): string => [...s].at(-1) ?? "";
const LETTER = /\p{L}/u;

const MACRONS: Rule[] = [
  ["a", "ā"],
  ["i", "ī"],
  ["u", "ū"],
  ["A", "Ā"],
  ["I", "Ī"],
  ["U", "Ū"],
].map(([vowel, output]) => ({ pattern: `${vowel}=`, output: output ?? "" }));

/**
 * Dots below come before the letter, so sentence ends ("Allāh.") never convert. An
 * upper-case dot sequence straight after a letter stays as typed, so A.H., U.S. and
 * Ph.D. survive; lower case is unguarded, so "A.hmad" still gives Aḥmad.
 */
const DOTS: Rule[] = [
  ["h", "ḥ"],
  ["s", "ṣ"],
  ["d", "ḍ"],
  ["t", "ṭ"],
  ["z", "ẓ"],
  ["H", "Ḥ"],
  ["S", "Ṣ"],
  ["D", "Ḍ"],
  ["T", "Ṭ"],
  ["Z", "Ẓ"],
].map(([letter = "", output = ""]) => ({
  pattern: `.${letter}`,
  output,
  ...(letter === letter.toUpperCase()
    ? { guard: ({ before }: GuardContext) => !LETTER.test(lastOf(before)) }
    : {}),
}));

/** The transliteration rules, longest pattern first. */
export const TRANSLITERATION: readonly Rule[] = (
  [
    ...MACRONS,
    ...DOTS,
    // A second backtick straight after a backtick-made ʿ turns both back into ``, so inline
    // code spans and fences still type.
    {
      pattern: "``",
      output: "``",
      escape: true,
      guard: ({ replaced }) => replaced.at(-1)?.out === AYN,
    },
    // A backtick right after a backtick stays a backtick.
    { pattern: "`", output: AYN, guard: ({ before }) => lastOf(before) !== "`" },
    { pattern: "''", output: HAMZA },
  ] satisfies Rule[]
).sort((a, b) => b.pattern.length - a.pattern.length);

const RULES_BY_KEY = new Map<string, Rule[]>();
for (const rule of TRANSLITERATION) {
  const key = lastOf(rule.pattern);
  RULES_BY_KEY.set(key, [...(RULES_BY_KEY.get(key) ?? []), rule]);
}

// ---------------------------------------------------------------------------------------
// The run of units typed at the caret.

interface Pending {
  /** The keys an immediate Backspace restores. */
  readonly raw: string;
  /** Length of the conversion's output, which ends at the caret. */
  readonly outLength: number;
}

interface Run {
  /** Document position where the run ends (the caret while typing), or -1. */
  readonly end: number;
  readonly units: readonly Unit[];
  /** The conversion an immediate Backspace would restore. */
  readonly pending: Pending | null;
}

const NO_RUN: Run = { end: -1, units: [], pending: null };
/** The longest pattern is three keys; a few more units are kept for safety. */
const RUN_LIMIT = 8;

interface AidChange {
  /** How many units at the end of the run the change replaces. */
  readonly replace: number;
  readonly units: readonly Unit[];
  readonly pending: Pending | null;
}

/** Marks the transactions the aids themselves dispatch. */
const aidChange = Annotation.define<AidChange>();

/** A plain key typed at a single caret: its position and text, or null. */
function typedKeys(tr: Transaction): { from: number; text: string } | null {
  if (!tr.isUserEvent("input.type") || tr.isUserEvent("input.type.compose")) return null;
  const changes: { from: number; to: number; text: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) =>
    changes.push({ from: fromA, to: toA, text: inserted.toString() }),
  );
  const [change] = changes;
  const { selection } = tr.state;
  if (changes.length !== 1 || !change || change.from !== change.to) return null;
  if (selection.ranges.length !== 1 || !selection.main.empty) return null;
  if (/[\r\n]/.test(change.text) || selection.main.head !== change.from + change.text.length)
    return null;
  return { from: change.from, text: change.text };
}

/** Several characters at once (an input method committing a word) never combine. */
const keyUnit = (text: string): Unit => ({ raw: text, out: text, sticky: [...text].length !== 1 });

const runField = StateField.define<Run>({
  create: () => NO_RUN,
  update(run, tr) {
    const aid = tr.annotation(aidChange);
    if (aid) {
      const kept = run.units.slice(0, Math.max(0, run.units.length - aid.replace));
      return {
        end: tr.state.selection.main.head,
        units: [...kept, ...aid.units].slice(-RUN_LIMIT),
        pending: aid.pending,
      };
    }
    if (tr.docChanged) {
      const typed = typedKeys(tr);
      if (!typed) return NO_RUN;
      const before = typed.from === run.end ? run.units : [];
      return {
        end: typed.from + typed.text.length,
        units: [...before, keyUnit(typed.text)].slice(-RUN_LIMIT),
        pending: null,
      };
    }
    if (tr.selection) {
      // A caret move, a click or a new selection ends the run. CodeMirror also re-reads
      // the DOM selection on its own; a selection that stays at the end of the run keeps it.
      const { selection } = tr.state;
      const user = tr.annotation(Transaction.userEvent) !== undefined;
      const unmoved =
        selection.ranges.length === 1 && selection.main.empty && selection.main.head === run.end;
      return !user && unmoved ? run : NO_RUN;
    }
    return run;
  },
});

// ---------------------------------------------------------------------------------------
// Deciding a conversion.

/** A conversion that typing a key causes. Positions are in the document before the key. */
export interface Conversion {
  /** Start of the characters replaced. */
  readonly from: number;
  /** The caret, where the key goes in after them. */
  readonly to: number;
  /** How many units before the key are replaced. */
  readonly units: number;
  /** The keys that make up the sequence, restored by an immediate Backspace. */
  readonly raw: string;
  readonly output: string;
  readonly sticky: boolean;
}

const WHITESPACE = /\s/u;
const ARABIC = /\p{Script=Arabic}/u;
const OPENING_CONTEXT = /[\s([{“‘«—–*_]/u;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
const URL_TOKEN = /^(?:https?:\/\/|www\.)|:\/\//i;
/** Block nodes whose text is never converted. */
const EXCLUDED_BLOCKS = new Set([
  "FencedCode",
  "CodeBlock",
  "Frontmatter",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
]);

/** Whether the node at `pos`, or one around it, is named in `names`. */
function inside(state: EditorState, pos: number, names: ReadonlySet<string>): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  for (; node; node = node.parent) if (names.has(node.name)) return true;
  return false;
}

/**
 * Whether typing at `pos` is in code, frontmatter, a URL or a link target. Block context
 * comes from the parser; inline context comes from scanning the line, because a code span
 * or link being typed isn't closed yet, so it isn't in the tree.
 */
export function isExcluded(state: EditorState, pos: number): boolean {
  if (inside(state, pos, EXCLUDED_BLOCKS)) return true;
  const line = state.doc.lineAt(pos);
  const text = state.sliceDoc(line.from, pos);
  if (FENCE_LINE.test(text)) return true;
  let code = false;
  let linkTarget = false;
  let token = "";
  let prev = "";
  for (const ch of text) {
    if (ch === "`") code = !code;
    if (!code) {
      if (ch === "(" && prev === "]") linkTarget = true;
      else if (linkTarget && (ch === ")" || WHITESPACE.test(ch))) linkTarget = false;
    }
    token = WHITESPACE.test(ch) ? "" : token + ch;
    prev = ch;
  }
  return code || linkTarget || URL_TOKEN.test(token.replace(/^[(<[]+/u, ""));
}

/** Whether the nearest letter before the caret on the line is Arabic. */
function lastStrongIsArabic(line: string): boolean {
  const chars = [...line];
  for (let i = chars.length - 1, seen = 0; i >= 0 && seen < 200; i--, seen++) {
    const ch = chars[i] ?? "";
    if (LETTER.test(ch)) return ARABIC.test(ch);
  }
  return false;
}

/**
 * How many recent units, together with `key`, spell exactly `pattern` (aligned to unit
 * boundaries), or -1. Sticky units never match.
 */
function align(units: readonly Unit[], pattern: string, key: string): number {
  if (!pattern.endsWith(key)) return -1;
  let rest = pattern.slice(0, pattern.length - key.length);
  let n = 0;
  for (let i = units.length - 1; rest.length > 0; i--) {
    const unit = units[i];
    if (!unit || unit.sticky || !rest.endsWith(unit.raw)) return -1;
    rest = rest.slice(0, rest.length - unit.raw.length);
    n++;
  }
  return n;
}

/**
 * What typing `key` at the caret converts, judged on the state before the key goes in,
 * or null when it stays as typed.
 */
export function planConversion(state: EditorState, key: string): Conversion | null {
  const { smartPunctuation } = state.facet(typingAidsConfig);
  const transliterating = state.field(transliterationOn, false) ?? false;
  if (!smartPunctuation && !transliterating) return null;
  const { selection } = state;
  if (selection.ranges.length !== 1 || !selection.main.empty) return null;
  if ([...key].length !== 1 || key === "\n") return null;
  const head = selection.main.head;
  if (isExcluded(state, head)) return null;

  const run = state.field(runField, false) ?? NO_RUN;
  const units = run.end === head ? run.units : [];
  const line = state.sliceDoc(state.doc.lineAt(head).from, head);
  const make = (n: number, raw: string, output: string, sticky = false): Conversion | null => {
    const replaced = units.slice(units.length - n);
    const length = replaced.reduce((sum, u) => sum + u.out.length, 0);
    // The units are what the writer typed just before the caret; check, never assume.
    if (state.sliceDoc(head - length, head) !== replaced.map((u) => u.out).join("")) return null;
    return { from: head - length, to: head, units: n, raw, output, sticky };
  };
  const before = (n: number): string => {
    const length = units.slice(units.length - n).reduce((sum, u) => sum + u.out.length, 0);
    return line.slice(0, line.length - length);
  };

  if (transliterating) {
    for (const rule of RULES_BY_KEY.get(key) ?? []) {
      const n = align(units, rule.pattern, key);
      if (n < 0) continue;
      if (rule.guard && !rule.guard({ before: before(n), replaced: units.slice(units.length - n) }))
        continue;
      return make(n, rule.pattern, rule.output, rule.escape);
    }
  }
  if (!smartPunctuation) return null;

  if (key === ".") {
    const n = align(units, "...", key);
    if (n >= 0) return make(n, "...", "…");
  } else if (key === "-") {
    for (const [pattern, output] of [
      ["---", "—"],
      ["--", "–"],
    ] as const) {
      const n = align(units, pattern, key);
      if (n < 0) continue;
      // A dash run alone on a line is a Markdown rule, frontmatter or a setext underline,
      // so dashes convert only after a non-space, non-dash character, and never in a table.
      const text = before(n);
      if (/[^\s-]/u.test(text) && !isTableRow(state, head, text)) return make(n, pattern, output);
    }
  } else if (key === '"' || key === "'") {
    const last = lastOf(line);
    const opening = last === "" || OPENING_CONTEXT.test(last);
    const arabic = lastStrongIsArabic(line);
    let output: string;
    if (key === '"') output = arabic ? (opening ? "«" : "»") : opening ? "“" : "”";
    else output = arabic || !opening ? "’" : "‘";
    return make(0, key, output);
  }
  return null;
}

const TABLE = new Set(["Table"]);

/** Table rows, including a delimiter row still being typed, keep their hyphens. */
function isTableRow(state: EditorState, pos: number, before: string): boolean {
  if (/^\s*\|/u.test(before) || /^[\s|:-]*\|[\s|:-]*$/u.test(before)) return true;
  return inside(state, pos, TABLE);
}

/**
 * The conversion as its own transaction, applied to `typed`, the transaction that put the
 * key in. Isolated in history, so `Mod-Z` returns to the typed keys.
 */
export function convert(typed: Transaction, conversion: Conversion): Transaction {
  // The end of the typed key: the caret before it, mapped past the insertion.
  const to = typed.changes.mapPos(conversion.to, 1);
  return typed.state.update({
    changes: { from: conversion.from, to, insert: conversion.output },
    selection: { anchor: conversion.from + conversion.output.length },
    scrollIntoView: true,
    userEvent: "input.type.aid",
    annotations: [
      isolateHistory.of("full"),
      aidChange.of({
        replace: conversion.units + 1,
        units: [{ raw: conversion.raw, out: conversion.output, sticky: conversion.sticky }],
        pending: { raw: conversion.raw, outLength: conversion.output.length },
      }),
    ],
  });
}

/**
 * Backspace straight after a conversion: the typed keys come back literally, and never
 * convert again. Null when the last action wasn't a conversion at the caret.
 */
export function restoreTyped(state: EditorState): TransactionSpec | null {
  const run = state.field(runField, false);
  const { selection } = state;
  if (!run?.pending || selection.ranges.length !== 1 || !selection.main.empty) return null;
  if (selection.main.head !== run.end) return null;
  const { raw, outLength } = run.pending;
  const from = run.end - outLength;
  return {
    changes: { from, to: run.end, insert: raw },
    selection: { anchor: from + raw.length },
    scrollIntoView: true,
    userEvent: "delete.backward",
    annotations: aidChange.of({
      replace: 1,
      units: [...raw].map((key) => ({ raw: key, out: key, sticky: true })),
      pending: null,
    }),
  };
}

const inputHandler = EditorView.inputHandler.of((view, from, to, text, insert) => {
  if (view.composing || from !== to || view.state.selection.main.head !== from) return false;
  const conversion = planConversion(view.state, text);
  if (!conversion) return false;
  const typed = insert();
  view.dispatch([typed, convert(typed, conversion)]);
  return true;
});

const backspace = Prec.highest(
  keymap.of([
    {
      key: "Backspace",
      run(view) {
        const spec = restoreTyped(view.state);
        if (!spec) return false;
        view.dispatch(spec);
        return true;
      },
    },
  ]),
);

/** Smart punctuation and transliteration mode, as typed. */
export function typingAids(): Extension {
  return [transliterationOn, runField, inputHandler, backspace];
}
