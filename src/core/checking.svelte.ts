import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  applySuggestion,
  diagnosticAt,
  nextDiagnostic,
  stillValid,
  type DiagnosticKind,
  type Placed,
} from "../editor/diagnostics.ts";
import { documentLang } from "../editor/linter.ts";
import type { Editor } from "../editor/setup.ts";
import { copy } from "./copy.ts";
import { IgnoredWords } from "./ignored.ts";
import * as ipc from "./ipc.ts";
import { isError, type AddWordError } from "./ipc.ts";

/**
 * Suggestions for a possible mistake (DESIGN.md §11, §14): the menu names the kind,
 * explains it in one sentence and offers explicit actions. It opens only when the writer
 * asks (Mod-., F7, a right-click on a marked word). Corrections for spelling are found
 * only then; *Ignore* lasts for this document and session; *Add to dictionary* writes
 * the word to the writer's own dictionary.
 */

/** Part of an explanation: quoted words are isolated, since they may be Arabic. */
export interface MessagePart {
  text: string;
  quoted: boolean;
}

/** Something the menu can be placed against without being an element. */
export interface Anchor {
  getBoundingClientRect(): DOMRect;
}

export interface SuggestionMenu {
  placed: Placed;
  kind: DiagnosticKind;
  lang: "en" | "ar";
  /** The flagged text. */
  text: string;
  /** Grammar: Harper's explanation; spelling: empty (the interface explains it). */
  message: MessagePart[];
  replacements: string[];
  /** The document can be changed (it isn't read-only). */
  canReplace: boolean;
  canAdd: boolean;
  anchor: Anchor;
}

/** Harper writes words in `backticks`; they become quoted parts, and the sentence ends
 * with a full stop. */
export function messageParts(message: string): MessagePart[] {
  const text = /[.?!…]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`;
  return text
    .split("`")
    .map((part, i) => ({ text: part, quoted: i % 2 === 1 }))
    .filter((p) => p.text !== "");
}

/** The flagged text's box on screen (its first line, if it wraps). */
function rectOf(view: EditorView, placed: Placed): DOMRect {
  const start = view.coordsAtPos(placed.from, 1);
  const end = view.coordsAtPos(placed.to, -1);
  const fallback = view.contentDOM.getBoundingClientRect();
  if (!start) return fallback;
  const sameLine = end !== null && Math.abs(end.top - start.top) < 2;
  const left = sameLine ? Math.min(start.left, end.left) : start.left;
  const right = sameLine ? Math.max(start.right, end.right) : start.left + 1;
  return new DOMRect(left, start.top, right - left, start.bottom - start.top);
}

/** What the suggestions need from the workspace. */
export interface CheckingHost {
  editor(): Editor | null;
  /** The open document, for remembering what was ignored in it. */
  documentKey(): string | null;
  /** Whether any checking is switched on. */
  checking(): boolean;
  /** Shows a notice that stays until dismissed (a failed *Add to dictionary*). */
  failed(message: string): void;
}

const NOTE_MS = 4000;

export class Checking {
  menu = $state<SuggestionMenu | null>(null);
  /** A short, passing message in the status line ("No spelling or grammar issues."). */
  note = $state<string | null>(null);

  #ignored = new IgnoredWords();
  #noteTimer: ReturnType<typeof setTimeout> | undefined;
  /** Each opening, so suggestions that arrive after another one opened are dropped. */
  #opening = 0;

  constructor(private readonly host: CheckingHost) {}

  #document(): string {
    return this.host.documentKey() ?? "";
  }

  /** A document was shown: it keeps what was ignored in it earlier this session. */
  documentShown(): void {
    this.menu = null;
    this.host.editor()?.setIgnored(this.#ignored.of(this.#document()));
  }

  say(message: string): void {
    clearTimeout(this.#noteTimer);
    this.note = message;
    this.#noteTimer = setTimeout(() => (this.note = null), NOTE_MS);
  }

  /** Mod-.: the suggestions for the issue at the caret. */
  async atCaret(): Promise<void> {
    const view = this.host.editor()?.view;
    if (!view) return;
    if (!this.host.checking()) return this.say(copy.checking.off);
    const placed = diagnosticAt(view.state, view.state.selection.main.head);
    if (!placed) return this.say(copy.checking.noIssueHere);
    await this.open(placed);
  }

  /** F7 / Shift-F7: selects the next or previous issue and opens its suggestions. */
  async next(direction: 1 | -1): Promise<void> {
    const view = this.host.editor()?.view;
    if (!view) return;
    if (!this.host.checking()) return this.say(copy.checking.off);
    const placed = nextDiagnostic(view.state, direction);
    if (!placed) return this.say(copy.checking.noIssues);
    await this.select(placed);
  }

  /** A right-click on a marked word. True if there was an issue there. */
  contextMenu(pos: number): boolean {
    const view = this.host.editor()?.view;
    const placed = view ? diagnosticAt(view.state, pos) : null;
    if (!placed) return false;
    void this.select(placed);
    return true;
  }

  async select(placed: Placed): Promise<void> {
    const view = this.host.editor()?.view;
    if (!view) return;
    view.dispatch({
      selection: EditorSelection.range(placed.from, placed.to),
      scrollIntoView: true,
    });
    await this.open(placed);
  }

  /** Opens the menu for an issue, once its corrections are known. */
  async open(placed: Placed): Promise<void> {
    const view = this.host.editor()?.view;
    if (!view) return;
    const opening = ++this.#opening;
    const d = placed.diagnostic;
    const replacements = [...d.suggestions];
    if (d.kind === "spelling") {
      const found = await ipc.lintSuggest(d.text, d.lang, documentLang(view)).catch(() => []);
      for (const s of found) if (!replacements.includes(s)) replacements.push(s);
    }
    if (opening !== this.#opening || !stillValid(view.state, placed)) return;
    // A menu already open (F7 inside it) shows the next issue in place.
    this.menu = {
      placed,
      kind: d.kind,
      lang: d.lang,
      text: d.text,
      message: d.message ? messageParts(d.message) : [],
      replacements,
      canReplace: !view.state.readOnly,
      canAdd: d.kind === "spelling",
      anchor: { getBoundingClientRect: () => rectOf(view, placed) },
    };
  }

  /** Closes the menu; focus goes back to the text. */
  close(): void {
    this.menu = null;
    this.host.editor()?.view.focus();
  }

  replace(replacement: string): void {
    const menu = this.menu;
    const view = this.host.editor()?.view;
    if (menu && view) applySuggestion(view, menu.placed, replacement);
    this.close();
  }

  ignore(): void {
    const menu = this.menu;
    if (menu) {
      const keys = this.#ignored.add(this.#document(), menu.placed.diagnostic.ignoreKey);
      this.host.editor()?.setIgnored(keys);
    }
    this.close();
  }

  async addToDictionary(): Promise<void> {
    const menu = this.menu;
    this.close();
    if (!menu) return;
    try {
      await ipc.lintAddWord(menu.text);
      this.host.editor()?.wordAdded(menu.text);
    } catch (error) {
      if (isError<AddWordError>(error)) this.host.failed(copy.checking.addFailed(menu.text, error));
    }
  }
}
