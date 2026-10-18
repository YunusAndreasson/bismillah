import { forceParsing } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { setProfile, setTheme, type Profile, type Theme } from "./appearance.ts";
import type { Editor } from "../editor/setup.ts";
import { remeasure } from "../editor/typography.ts";
import { setTransliteration } from "../editor/typingAids.ts";
import { geometry, type Geometry } from "./testGeometry.ts";
import { commandLog, runCommand, type CommandId } from "./commands.ts";
import { appInfo, menuState, testFault, testOpen, type MenuState } from "./ipc.ts";
import type { SaveState } from "./session.svelte.ts";
import { settings, type Settings } from "./settings.svelte.ts";
import type { Workspace } from "./workspace.svelte.ts";

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
  setTransliteration(on: boolean): void;
  setSmartPunctuation(on: boolean): void;
  commandLog: typeof commandLog;
  menuState(): Promise<MenuState>;
  /** Replaces the whole document (spike tests load their own fixtures). */
  setDoc(text: string): Promise<void>;
  /** Resolves after layout settles (two frames plus a CodeMirror measure). */
  settle(): Promise<void>;
  /** Opens a file by path, standing in for the native Open dialog. */
  open(path: string): Promise<void>;
  /** Runs a command as the menu would. */
  run(id: CommandId): void;
  /** The open document's save state and revisions. */
  saveState(): { state: SaveState; revision: number; savedRevision: number } | null;
  /** Saves now and resolves true once every edit is on disk. */
  flush(): Promise<boolean>;
  /** Visible notices: their messages and action labels. */
  notices(): { message: string; actions: string[] }[];
  /** Presses a notice's action by its label. */
  act(label: string): Promise<void>;
  changeSettings(patch: Partial<Settings>): Promise<void>;
  status(): string;
  /** Makes every save fail at one step (in Rust) until cleared with null. */
  fault(kind: "disk_full" | "rename_fails" | null): Promise<void>;
  /** The app's process id, so the recovery test can kill exactly this process. */
  pid(): Promise<number>;
  /** Runs what regaining window focus runs (no window manager under Xvfb). */
  regainFocus(): Promise<void>;
  /** Shows the first screen, as when nothing is open. */
  welcome(): void;
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

export function installTestHooks(editor: Editor, workspace: Workspace): void {
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
    // Appearance and editor switches go through the settings, like the real controls,
    // so a later settings change can't silently undo them; each also applies at once.
    setTheme(theme) {
      setTheme(theme);
      void settings.set({ theme });
    },
    async setProfile(profile) {
      setProfile(profile);
      await settings.set({ writing_profile: profile });
      await document.fonts.ready;
      remeasure(view);
      await settle();
    },
    async setScale(scale) {
      document.documentElement.style.setProperty("--doc-scale", String(scale));
      await settings.set({ text_scale: scale });
      remeasure(view);
      await settle();
    },
    setBasmallah(on) {
      editor.setBasmallah(on);
      void settings.set({ basmallah_opening: on });
    },
    setTypewriter(on) {
      editor.setTypewriter(on);
      void settings.set({ typewriter_scrolling: on });
    },
    setTransliteration: (on) => view.dispatch({ effects: setTransliteration.of(on) }),
    setSmartPunctuation(on) {
      editor.setSmartPunctuation(on);
      void settings.set({ smart_punctuation: on });
    },
    async setDoc(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      await settle();
    },
    settle,
    async open(path) {
      await workspace.session?.flush();
      const opened = await testOpen(path);
      workspace.showForTest(opened);
      await settle();
    },
    run: (id) => void runCommand(id, "ui", workspace.context),
    saveState() {
      const s = workspace.session;
      return s ? { state: s.state, revision: s.revision, savedRevision: s.savedRevision } : null;
    },
    flush: () => workspace.session?.flush() ?? Promise.resolve(true),
    notices: () =>
      workspace.notices.map((n) => ({
        message: n.message,
        actions: n.actions.map((a) => a.label),
      })),
    async act(label) {
      for (const notice of workspace.notices) {
        const action = notice.actions.find((a) => a.label === label);
        if (action) {
          await action.run();
          return;
        }
      }
      throw new Error(`no notice action "${label}"`);
    },
    async changeSettings(patch) {
      await settings.set(patch);
      await settle();
    },
    status: () => document.querySelector(".status")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    async fault(kind) {
      await testFault(kind);
    },
    pid: async () => (await appInfo()).pid,
    welcome: () => workspace.welcomeForTest(),
    async regainFocus() {
      await workspace.checkOnFocus();
      await settle();
    },
  };
  document.documentElement.dataset.ready = "true";
}
