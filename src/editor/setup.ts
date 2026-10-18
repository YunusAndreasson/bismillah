import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { basmallah } from "./basmallah.ts";
import { bidi } from "./bidi.ts";
import { markdownDialect } from "./dialect.ts";
import { hangingMarks } from "./hangingMarks.ts";
import { markdownStyling } from "./markdownStyling.ts";
import { scriptRuns } from "./scriptRuns.ts";
import { typewriter } from "./typewriter.ts";

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  /** Steady caret for deterministic screenshots. */
  steadyCaret?: boolean;
  basmallah?: boolean;
  typewriter?: boolean;
  /** App-level key bindings from the command registry. */
  keys?: Extension;
}

export interface Editor {
  view: EditorView;
  typewriter: boolean;
  setBasmallah(on: boolean): void;
  setTypewriter(on: boolean): void;
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
  const basmallahSlot = new Compartment();
  const typewriterSlot = new Compartment();
  const extensions: Extension[] = [
    cspNonce(),
    baseTheme,
    history(),
    drawSelection({ cursorBlinkRate: options.steadyCaret ? 0 : 1200 }),
    options.keys ?? [],
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off" }),
    markdownDialect(),
    markdownStyling(),
    bidi(),
    scriptRuns(),
    hangingMarks(),
    basmallahSlot.of(options.basmallah === false ? [] : basmallah()),
    typewriterSlot.of(options.typewriter === false ? [] : typewriter()),
  ];
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({ doc: options.doc, extensions }),
  });
  const editor: Editor = {
    view,
    typewriter: options.typewriter !== false,
    setBasmallah(on) {
      view.dispatch({ effects: basmallahSlot.reconfigure(on ? basmallah() : []) });
    },
    setTypewriter(on) {
      editor.typewriter = on;
      view.dispatch({ effects: typewriterSlot.reconfigure(on ? typewriter() : []) });
    },
  };
  return editor;
}
