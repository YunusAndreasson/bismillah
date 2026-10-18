import { forceParsing } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { setProfile, setTheme, type Profile, type Theme } from "./appearance.ts";
import type { Editor } from "../editor/setup.ts";
import { remeasure } from "../editor/typography.ts";
import { geometry, type Geometry } from "./testGeometry.ts";
import { commandLog } from "./commands.ts";
import { menuState, type MenuState } from "./ipc.ts";

/**
 * Hooks the WebDriver tests and `pnpm app:shot` drive through `executeScript`. Installed
 * only when Rust reports test mode (`BISMILLAH_TEST=1`).
 */
export interface TestHooks {
  view: EditorView;
  geometry: Geometry;
  setTheme(theme: Theme): void;
  setProfile(profile: Profile): Promise<void>;
  setScale(scale: number): Promise<void>;
  setBasmallah(on: boolean): void;
  setTypewriter(on: boolean): void;
  commandLog: typeof commandLog;
  menuState(): Promise<MenuState>;
  /** Replaces the whole document (spike tests load their own fixtures). */
  setDoc(text: string): Promise<void>;
  /** Resolves after layout settles (two frames plus a CodeMirror measure). */
  settle(): Promise<void>;
}

declare global {
  interface Window {
    __bismillah?: TestHooks;
    __cspViolations?: string[];
  }
}

function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) =>
      left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(n);
  });
}

export function installTestHooks(editor: Editor): void {
  const { view } = editor;
  const settle = async () => {
    await document.fonts.ready;
    // Screenshots and probes may jump anywhere in the document; parse all of it first.
    forceParsing(view, view.state.doc.length, 2000);
    await frames(2);
    view.requestMeasure();
    await frames(2);
  };
  window.__bismillah = {
    view,
    geometry: geometry(view),
    commandLog,
    menuState,
    setTheme,
    async setProfile(profile) {
      setProfile(profile);
      await document.fonts.ready;
      remeasure(view);
      await settle();
    },
    async setScale(scale) {
      document.documentElement.style.setProperty("--doc-scale", String(scale));
      remeasure(view);
      await settle();
    },
    setBasmallah: (on) => editor.setBasmallah(on),
    setTypewriter: (on) => editor.setTypewriter(on),
    async setDoc(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      await settle();
    },
    settle,
  };
  document.documentElement.dataset.ready = "true";
}
