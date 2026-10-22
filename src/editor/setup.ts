import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basmallah } from "./basmallah.ts";
import { caretBlink } from "./caretBlink.ts";
import { bidi } from "./bidi.ts";
import { forgetWord, setDisplay, setIgnored } from "./diagnostics.ts";
import { focusKeepsScroll } from "./focusScroll.ts";
import { linter, recheck, type LintSource } from "./linter.ts";
import { paragraphs } from "./paragraphs.ts";
import { rest } from "./rest.ts";
import { documentSearch } from "./search.ts";
import { frontmatterEnd, markdownDialect } from "./dialect.ts";
import { hangingMarks } from "./hangingMarks.ts";
import { links } from "./links.ts";
import { livePreview } from "./livePreview.ts";
import { imageAddress, previewBlocks, type ImageAddress } from "./previewBlocks.ts";
import { previewTables } from "./previewTables.ts";
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
  /** Rendered text outside the caret's block (ADR-0012); off: Always show Markdown. */
  livePreview: boolean;
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
  livePreview: true,
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
  /** Where live preview loads a local image from (Rust checks it against the library). */
  imageAddress?: ImageAddress;
  /** A Ctrl+click on a link, with its address as written (Rust decides if it opens). */
  onOpenLink?: (address: string) => void;
  /** The writing surface's accessible name: the document's file name. */
  label?: string;
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
  /** The name a screen reader gives the writing surface (the open file's name). */
  setLabel(label: string): void;
  /** Words and suggestions the writer ignored in this document. */
  setIgnored(keys: ReadonlySet<string>): void;
  /** Checks the whole document again (the dictionary or the dialect changed). */
  recheck(): void;
  /** A word went into the personal dictionary: unmarked now, then checked again. */
  wordAdded(word: string): void;
}

/**
 * Where the caret starts in a newly opened document with live preview: the first line
 * of text after any frontmatter, so the frontmatter opens folded (ADR-0012).
 */
export function startOfText(text: string): number {
  const end = frontmatterEnd(text);
  if (end === null) return 0;
  const rest = /^(?:[ \t]*\n)*/.exec(text.slice(end + 1))?.[0].length ?? 0;
  return Math.min(text.length, end + 1 + rest);
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
    livePreview: new Compartment(),
    readOnly: new Compartment(),
    label: new Compartment(),
  };
  let label = options.label ?? "";
  const configured = {
    basmallah: () => (config.basmallah ? basmallah() : []),
    typewriter: () => (config.typewriter ? typewriter() : []),
    zuhd: () => (config.zuhd ? [zuhd(), focusGranularity.of(config.focusGranularity)] : []),
    smartPunctuation: () => typingAidsConfig.of({ smartPunctuation: config.smartPunctuation }),
    livePreview: () =>
      config.livePreview ? [livePreview(), previewBlocks(), previewTables()] : [],
    readOnly: (on: boolean) => [EditorState.readOnly.of(on), EditorView.editable.of(!on)],
    label: () => EditorView.contentAttributes.of({ "aria-label": label }),
  };

  const extensions = (readOnly: boolean): Extension[] => [
    cspNonce(),
    baseTheme,
    history(),
    caretBlink(options.steadyCaret),
    options.keys ?? [],
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    focusKeepsScroll(),
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
    paragraphs(),
    rest(),
    documentSearch(),
    options.lint ? linter(options.lint) : [],
    options.imageAddress ? imageAddress.of(options.imageAddress) : [],
    options.onOpenLink ? links(options.onOpenLink) : [],
    slots.smartPunctuation.of(configured.smartPunctuation()),
    slots.livePreview.of(configured.livePreview()),
    slots.basmallah.of(configured.basmallah()),
    slots.typewriter.of(configured.typewriter()),
    slots.zuhd.of(configured.zuhd()),
    slots.readOnly.of(configured.readOnly(readOnly)),
    slots.label.of(configured.label()),
  ];

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      selection: EditorSelection.cursor(config.livePreview ? startOfText(options.doc) : 0),
      extensions: extensions(!!options.readOnly),
    }),
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
      const previewChanged = changed("livePreview");
      Object.assign(config, patch);
      const effects = [];
      if (basmallahChanged) effects.push(slots.basmallah.reconfigure(configured.basmallah()));
      if (typewriterChanged) effects.push(slots.typewriter.reconfigure(configured.typewriter()));
      if (zuhdChanged) effects.push(slots.zuhd.reconfigure(configured.zuhd()));
      if (smartChanged)
        effects.push(slots.smartPunctuation.reconfigure(configured.smartPunctuation()));
      if (previewChanged) effects.push(slots.livePreview.reconfigure(configured.livePreview()));
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
      view.setState(
        EditorState.create({
          doc: text,
          selection: EditorSelection.cursor(config.livePreview ? startOfText(text) : 0),
          extensions: extensions(readOnly),
        }),
      );
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
    setLabel(next) {
      if (next === label) return;
      label = next;
      view.dispatch({ effects: slots.label.reconfigure(configured.label()) });
    },
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
