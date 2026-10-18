import { syntaxTree } from "@codemirror/language";
import { Facet, StateEffect, type ChangeSet, type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { LintRequest, LintResponse } from "../core/ipc.ts";
import { Diagnostic, diagnostics, setBlockDiagnostics, type Placed } from "./diagnostics.ts";
import { frontmatterLang, lintUnits, type LintUnit } from "./lintBlocks.ts";

/**
 * When and what to check (ARCHITECTURE.md §7.1). Blocks that changed are sent about
 * 300 ms after typing pauses; a newly opened document is checked from the visible
 * blocks outwards, a few thousand characters per request, so a long document never
 * holds up the first results. At most one request is in flight: what changes
 * meanwhile simply waits for the next one, so nothing superseded is ever queued.
 *
 * Each request carries the editor's revision. When the answer arrives, a block that was
 * edited in the meantime is dropped (it is checked again), and an untouched block's
 * results are moved to wherever the block now is. A result is never put on text it
 * didn't see.
 */

/** Where the checking happens: the Rust checker in the app, a stand-in in tests. */
export interface LintSource {
  check(request: LintRequest): Promise<LintResponse>;
}

export const lintSource = Facet.define<LintSource, LintSource | null>({
  combine: (values) => values[0] ?? null,
});

/** Check the whole document again (the dictionary or the settings changed). */
export const recheck = StateEffect.define<null>();

/** With the checker's usual 50–150 ms, results land within 500 ms of a typing pause
 * (ARCHITECTURE.md §14). */
export const DEBOUNCE_MS = 300;
/** About this many UTF-16 units of text per request. */
export const BATCH_UNITS = 6000;
/** A pause between background requests, so the editor stays responsive. */
const BACKGROUND_MS = 30;

type Range = [number, number];

/** Joins ranges that overlap or touch, in order. */
function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Ranges in the parts inside `from`–`to` first, then the rest, each in order. */
function prioritise(ranges: Range[], from: number, to: number): Range[] {
  const inside: Range[] = [];
  const outside: Range[] = [];
  for (const [a, b] of ranges) {
    const start = Math.max(a, from);
    const end = Math.min(b, to);
    if (start < end) {
      inside.push([start, end]);
      if (a < start) outside.push([a, start]);
      if (end < b) outside.push([end, b]);
    } else outside.push([a, b]);
  }
  return [...inside, ...outside];
}

/** A change to fences, HTML or frontmatter can turn the text after it into prose or
 * code, so everything after it is checked again (unchanged blocks come from Rust's
 * cache). */
const STRUCTURE = /^[ \t]*(?:```|~~~|<|---|\.\.\.)/m;
const REMOVED_STRUCTURE = /```|~~~|<|---|\.\.\./;

interface InFlight {
  revision: number;
  units: LintUnit[];
  /** Edits made while the request was out. */
  changes: ChangeSet | null;
}

class Scheduler {
  dirty: Range[];
  revision = 0;
  lang: string | null;
  inFlight: InFlight | null = null;
  timer: ReturnType<typeof setTimeout> | undefined;
  destroyed = false;

  constructor(readonly view: EditorView) {
    this.dirty = [[0, view.state.doc.length]];
    this.lang = frontmatterLang(view.state);
    this.schedule(0);
  }

  update(update: ViewUpdate): void {
    let urgent = false;
    if (update.docChanged) {
      this.revision += 1;
      const changes = update.changes;
      const length = update.state.doc.length;
      const touched: Range[] = [];
      changes.iterChanges((fromA, toA, fromB, toB) => {
        touched.push([Math.max(0, fromB - 1), Math.min(length, toB + 1)]);
        const doc = update.state.doc;
        const lines = doc.sliceString(doc.lineAt(fromB).from, doc.lineAt(toB).to);
        const removed = update.startState.doc.sliceString(fromA, toA);
        if (STRUCTURE.test(lines) || REMOVED_STRUCTURE.test(removed)) touched.push([fromB, length]);
      });
      this.dirty = merge([
        ...this.dirty.map(([a, b]): Range => [changes.mapPos(a, -1), changes.mapPos(b, 1)]),
        ...touched,
      ]);
      if (this.inFlight)
        this.inFlight.changes = this.inFlight.changes
          ? this.inFlight.changes.compose(changes)
          : changes;
      const lang = frontmatterLang(update.state);
      if (lang !== this.lang) {
        this.lang = lang;
        this.dirty = [[0, length]];
      }
    }
    for (const tr of update.transactions)
      if (tr.effects.some((e) => e.is(recheck))) {
        this.dirty = [[0, update.state.doc.length]];
        urgent = true;
      }
    if (update.docChanged) this.schedule(DEBOUNCE_MS, true);
    else if (urgent) this.schedule(0, true);
    else if (
      this.dirty.length &&
      (update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState))
    )
      this.schedule(BACKGROUND_MS);
  }

  /** Sends after `delay`; a later edit restarts a pending wait (`restart`). */
  schedule(delay: number, restart = false): void {
    if (this.timer !== undefined) {
      if (!restart) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.send();
    }, delay);
  }

  /** The next blocks to check, visible ones first, and the ranges they leave dirty. */
  take(): { units: LintUnit[]; gaps: Range[] } {
    const state = this.view.state;
    const parsed = syntaxTree(state).length;
    const { from: vf, to: vt } = this.view.viewport;
    const units: LintUnit[] = [];
    const gaps: Range[] = [];
    const remaining: Range[] = [];
    let size = 0;
    for (const [a, b] of prioritise(this.dirty, vf, vt)) {
      const end = Math.min(b, parsed);
      if (size >= BATCH_UNITS || a > end || (a === end && a < b)) {
        remaining.push([a, b]);
        continue;
      }
      const found = lintUnits(state, a, end, BATCH_UNITS - size).filter(
        (u) => !units.some((t) => t.from === u.from),
      );
      units.push(...found);
      size += found.reduce((n, u) => n + u.text.length, 0);
      // Covered: up to the end of the last block taken, or all of it if nothing was cut.
      const last = found.at(-1);
      const covered = size >= BATCH_UNITS && last ? Math.max(a, Math.min(last.to, end)) : end;
      if (covered < b) remaining.push([covered, b]);
      // Text in the covered part outside every block is no longer prose (it may have
      // become code): its old results go.
      let at = a;
      for (const u of found.filter((u) => u.to > a && u.from < covered)) {
        if (u.from > at) gaps.push([at, u.from]);
        at = Math.max(at, u.to);
      }
      if (at < covered) gaps.push([at, covered]);
    }
    this.dirty = merge(remaining);
    return { units, gaps };
  }

  async send(): Promise<void> {
    const source = this.view.state.facet(lintSource);
    if (this.inFlight || this.destroyed || !source) return;
    const { units, gaps } = this.take();
    if (gaps.length)
      this.view.dispatch({
        effects: gaps.map(([from, to]) => setBlockDiagnostics.of({ from, to, found: [] })),
      });
    if (!units.length) return;
    const flight: InFlight = { revision: this.revision, units, changes: null };
    this.inFlight = flight;
    let response: LintResponse | null = null;
    try {
      response = await source.check({
        revision: flight.revision,
        lang: this.lang,
        blocks: units.map(({ text, skip, marks }) => ({ text, skip, marks })),
      });
    } catch (error) {
      // The checker isn't available; the text stays unmarked rather than wrong.
      console.error("bismillah: checking failed", error);
    }
    this.inFlight = null;
    if (this.destroyed) return;
    if (response && response.revision === flight.revision) this.apply(flight, response);
    if (this.dirty.length) this.schedule(BACKGROUND_MS);
  }

  apply(flight: InFlight, response: LintResponse): void {
    const { changes } = flight;
    const effects = [];
    for (const [i, unit] of flight.units.entries()) {
      // Edited while it was being checked: stale. The edit made it dirty again.
      if (changes?.touchesRange(unit.from, unit.to)) continue;
      const from = changes ? changes.mapPos(unit.from) : unit.from;
      const to = changes ? changes.mapPos(unit.to) : unit.to;
      const found: Placed[] = (response.blocks[i] ?? [])
        .filter((d) => d.from_utf16 < d.to_utf16 && d.to_utf16 <= unit.text.length)
        .map((d) => ({
          from: from + d.from_utf16,
          to: from + d.to_utf16,
          diagnostic: new Diagnostic(
            d.kind,
            d.lang,
            d.message,
            d.suggestions,
            d.rule_id,
            unit.text.slice(d.from_utf16, d.to_utf16),
          ),
        }));
      effects.push(setBlockDiagnostics.of({ from, to, found }));
    }
    if (effects.length) this.view.dispatch({ effects });
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
  }
}

const scheduler = ViewPlugin.fromClass(Scheduler);

/** Spelling and grammar checking: the diagnostics and the scheduler that fills them. */
export function linter(source: LintSource): Extension {
  return [diagnostics(), lintSource.of(source), scheduler];
}

/** The document's language for checking, as its frontmatter declares it. */
export function documentLang(view: EditorView): string | null {
  return view.plugin(scheduler)?.lang ?? null;
}

/** Test hook: whether checking has caught up with the document. */
export function lintIdle(view: EditorView): boolean {
  const s = view.plugin(scheduler);
  return !s || (!s.inFlight && !s.dirty.length && s.timer === undefined);
}
