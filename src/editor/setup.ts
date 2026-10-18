import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { basmallah } from "./basmallah.ts";
import { bidi } from "./bidi.ts";
import { forgetWord, setDisplay, setIgnored } from "./diagnostics.ts";
import { linter, recheck, type LintSource } from "./linter.ts";
import { markdownDialect } from "./dialect.ts";
import { hangingMarks } from "./hangingMarks.ts";
import { markdownStyling } from "./markdownStyling.ts";
import { scriptRuns } from "./scriptRuns.ts";
import { typewriter } from "./typewriter.ts";
import { typingAids, typingAidsConfig } from "./typingAids.ts";
import { focusGranularity, zuhd, type FocusGranularity } from "./zuhd.ts";

/** The writer's switches that change how the editor behaves. */
export interface EditorConfig {
  basmallah: boolean;
  typewriter: boolean;
  zuhd: boolean;
  focusGranularity: FocusGranularity;
  /** Smart punctuation (DESIGN.md §11.3). */
  smartPunctuation: boolean;
  /** Which diagnostics are shown (DESIGN.md §11); Rust also stops looking. */
  spelling: boolean;
  grammar: boolean;
}

export const DEFAULT_CONFIG: EditorConfig = {
  basmallah: true,
  typewriter: true,
  zuhd: false,
  focusGranularity: "paragraph",
  smartPunctuation: true,
  spelling: true,
  grammar: true,
};

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  readOnly?: boolean;
  config?: Partial<EditorConfig>;
  /** Steady caret for deterministic screenshots. */
  steadyCaret?: boolean;
  /** App-level key bindings from the command registry. */
  keys?: Extension;
  /** Called after every change to the text (each one is a new revision). */
  onChange?: () => void;
  /** Where spelling and grammar are checked; without one, nothing is. */
  lint?: LintSource;
  /** A right-click at `pos`; true if it was handled (the suggestions opened). */
  onContextMenu?: (pos: number) => boolean;
}

export interface Editor {
  view: EditorView;
  readonly config: EditorConfig;
  configure(patch: Partial<EditorConfig>): void;
  /** Replaces the document with a newly opened file: fresh history, caret at the top. */
  load(text: string, readOnly: boolean): void;
  /** Replaces the text after an external change, keeping the caret and scroll near. */
  reloadQuietly(text: string): void;
  /** Replaces the whole text as one undoable edit (restoring recovered text). */
  replaceAll(text: string): void;
  text(): string;
  /** Kept for the test hooks and screenshots. */
  readonly typewriter: boolean;
  setBasmallah(on: boolean): void;
  setTypewriter(on: boolean): void;
  setSmartPunctuation(on: boolean): void;
  /** Words and suggestions the writer ignored in this document. */
  setIgnored(keys: ReadonlySet<string>): void;
  /** Checks the whole document again (the dictionary or the dialect changed). */
  recheck(): void;
  /** A word went into the personal dictionary: unmarked now, then checked again. */
  wordAdded(word: string): void;
}

/**
 * Layout-neutral base styles. CodeMirror's defaults set a monospace font and line
 * height on the scroller; the writing profile owns both (DESIGN.md §8.3).
 */
const baseTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
  "&.cm-focused": { outline: "none" },
});

/**
 * The nonce Tauri put on index.html's inline style element. CodeMirror injects its
 * base styles with a <style> element, which `style-src 'self'` blocks without it
 * (ARCHITECTURE.md §10).
 */
function cspNonce(): Extension {
  const carrier = document.getElementById("csp-nonce");
  const nonce = carrier instanceof HTMLStyleElement ? carrier.nonce : "";
  return nonce ? EditorView.cspNonce.of(nonce) : [];
}

export function createEditor(options: EditorOptions): Editor {
  const config: EditorConfig = { ...DEFAULT_CONFIG, ...options.config };
  const slots = {
    basmallah: new Compartment(),
    typewriter: new Compartment(),
    zuhd: new Compartment(),
    smartPunctuation: new Compartment(),
    readOnly: new Compartment(),
  };
  const configured = {
    basmallah: () => (config.basmallah ? basmallah() : []),
    typewriter: () => (config.typewriter ? typewriter() : []),
    zuhd: () => (config.zuhd ? [zuhd(), focusGranularity.of(config.focusGranularity)] : []),
    smartPunctuation: () => typingAidsConfig.of({ smartPunctuation: config.smartPunctuation }),
    readOnly: (on: boolean) => [EditorState.readOnly.of(on), EditorView.editable.of(!on)],
  };

  const extensions = (readOnly: boolean): Extension[] => [
    cspNonce(),
    baseTheme,
    history(),
    drawSelection({ cursorBlinkRate: options.steadyCaret ? 0 : 1200 }),
    options.keys ?? [],
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off" }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange?.();
    }),
    EditorView.domEventHandlers({
      contextmenu(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null || !options.onContextMenu?.(pos)) return false;
        event.preventDefault();
        return true;
      },
    }),
    markdownDialect(),
    markdownStyling(),
    bidi(),
    scriptRuns(),
    hangingMarks(),
    typingAids(),
    options.lint ? linter(options.lint) : [],
    slots.smartPunctuation.of(configured.smartPunctuation()),
    slots.basmallah.of(configured.basmallah()),
    slots.typewriter.of(configured.typewriter()),
    slots.zuhd.of(configured.zuhd()),
    slots.readOnly.of(configured.readOnly(readOnly)),
  ];

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({ doc: options.doc, extensions: extensions(!!options.readOnly) }),
  });
  let ignored: ReadonlySet<string> = new Set();
  /** A new state starts with the writer's checking switches and ignored words. */
  const checkingEffects = () => [
    setDisplay.of({ spelling: config.spelling, grammar: config.grammar }),
    setIgnored.of(ignored),
  ];
  if (options.lint) view.dispatch({ effects: checkingEffects() });

  /** The switches the diagnostics were last shown with. */
  const shown = { spelling: config.spelling, grammar: config.grammar };
  const editor: Editor = {
    view,
    config,
    get typewriter() {
      return config.typewriter;
    },
    configure(patch) {
      // Only what changed is reconfigured: rebuilding the Basmallah, say, on every
      // settings change would drop a selection in it.
      const changed = (key: keyof EditorConfig) => key in patch && patch[key] !== config[key];
      const basmallahChanged = changed("basmallah");
      const typewriterChanged = changed("typewriter");
      const zuhdChanged = changed("zuhd") || changed("focusGranularity");
      const smartChanged = changed("smartPunctuation");
      Object.assign(config, patch);
      const effects = [];
      if (basmallahChanged) effects.push(slots.basmallah.reconfigure(configured.basmallah()));
      if (typewriterChanged) effects.push(slots.typewriter.reconfigure(configured.typewriter()));
      if (zuhdChanged) effects.push(slots.zuhd.reconfigure(configured.zuhd()));
      if (smartChanged)
        effects.push(slots.smartPunctuation.reconfigure(configured.smartPunctuation()));
      if (
        options.lint &&
        (config.spelling !== shown.spelling || config.grammar !== shown.grammar)
      ) {
        shown.spelling = config.spelling;
        shown.grammar = config.grammar;
        effects.push(setDisplay.of({ ...shown }), recheck.of(null));
      }
      if (effects.length) view.dispatch({ effects });
    },
    load(text, readOnly) {
      view.setState(EditorState.create({ doc: text, extensions: extensions(readOnly) }));
      if (options.lint) view.dispatch({ effects: checkingEffects() });
      view.scrollDOM.scrollTop = 0;
    },
    reloadQuietly(text) {
      const { head } = view.state.selection.main;
      const top = view.scrollDOM.scrollTop;
      const readOnly = view.state.readOnly;
      view.setState(
        EditorState.create({
          doc: text,
          selection: EditorSelection.cursor(Math.min(head, text.length)),
          extensions: extensions(readOnly),
        }),
      );
      if (options.lint) view.dispatch({ effects: checkingEffects() });
      view.scrollDOM.scrollTop = top;
    },
    replaceAll(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        userEvent: "input.restore",
      });
    },
    text: () => view.state.doc.toString(),
    setBasmallah: (on) => editor.configure({ basmallah: on }),
    setTypewriter: (on) => editor.configure({ typewriter: on }),
    setSmartPunctuation: (on) => editor.configure({ smartPunctuation: on }),
    setIgnored(keys) {
      ignored = keys;
      if (options.lint) view.dispatch({ effects: setIgnored.of(keys) });
    },
    recheck() {
      if (options.lint) view.dispatch({ effects: recheck.of(null) });
    },
    wordAdded(word) {
      if (options.lint) view.dispatch({ effects: [forgetWord.of(word), recheck.of(null)] });
    },
  };
  return editor;
}
