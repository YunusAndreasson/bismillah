import { forceParsing } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { setProfile, setTheme, type Profile, type Theme } from "./appearance.ts";
import type { Editor } from "../editor/setup.ts";
import { remeasure } from "../editor/typography.ts";
import { visibleDiagnostics } from "../editor/diagnostics.ts";
import { lintIdle } from "../editor/linter.ts";
import { setTransliteration } from "../editor/typingAids.ts";
import { geometry, type Geometry } from "./testGeometry.ts";
import { commandLog, runCommand, type CommandId } from "./commands.ts";
import {
  appInfo,
  menuState,
  testClipboard,
  testDialog,
  testFault,
  testLibrary,
  testOpen,
  type MenuState,
} from "./ipc.ts";
import type { SaveState } from "./session.svelte.ts";
import { copy } from "./copy.ts";
import { shortcuts } from "./keybindings.svelte.ts";
import { settings, type Settings } from "./settings.svelte.ts";
import { colourThemes } from "./themes.svelte.ts";
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
  /** Makes `path` the library, standing in for the folder dialog. */
  setLibrary(path: string): Promise<void>;
  /** The next native file dialog answers `path` (null: cancelled) without showing. */
  nextDialog(path: string | null): Promise<void>;
  library(): LibraryProbe;
  /** The open quick open or palette: its kind and the text of each item. */
  picker(): { kind: string; items: string[]; selected: string | null } | null;
  /** The open name prompt; `ready` once its field has focus. `problem`, not `error`:
   * WebDriver reads a result with an `error` key as a failure of its own. */
  prompt(): { title: string; value: string; problem: string | null; ready: boolean } | null;
  /** Lays the library out again for the current window (tests resize the window). */
  measure(): Promise<void>;
  /** Resolves once checking has caught up with the document (or after `timeoutMs`). */
  lintSettled(timeoutMs?: number): Promise<boolean>;
  /** The diagnostics the writer can see, and which of them are drawn now. */
  diagnostics(): { text: string; kind: string; lang: string; drawn: boolean }[];
  /** Puts the caret at the first occurrence of `text` (plus `offset`). */
  caretAt(text: string, offset?: number): void;
  /** The open suggestions menu, as drawn: its kind, explanation, items and the focused
   * item. */
  /** Whether the suggestions menu is open in the app's state (drawn or not). */
  menuOpen(): boolean;
  /** The system clipboard under an X target ("text/html", "UTF8_STRING"). */
  clipboard(target: string): Promise<string | null>;
  /** The status line's passing message. */
  note(): string;
  suggestions(): {
    kind: string;
    explanation: string;
    items: string[];
    focused: string | null;
  } | null;
  /** Opens Settings, at a section if given. */
  openSettings(section?: "files" | "appearance" | null): void;
  /** Each command's shortcut now, and why lines of keybindings.toml weren't used. */
  shortcuts(): { keys: Record<string, string>; problems: string[]; changed: number };
  /** The colour themes Settings lists, with their problems as Settings words them. */
  colourThemes(): { id: string; name: string; usable: boolean; problems: string[] }[];
  /** A token's value on the root element now ("surface-editor" → "#f4ecdd"). */
  token(name: string): string;
}

export interface LibraryProbe {
  kind: string;
  name: string | null;
  visible: boolean;
  mode: "docked" | "overlay";
  offset: number;
  focused: string | null;
  active: string | null;
  /** The element with keyboard focus is a row of the tree: its path. */
  focusedRow: string | null;
  rows: { path: string; level: number; expanded: boolean | null; selected: boolean }[];
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
    // The document's status, without the library toggle at its start.
    status() {
      const status = document.querySelector(".status")?.cloneNode(true);
      if (!(status instanceof HTMLElement)) return "";
      status.querySelector(".library-toggle")?.remove();
      return status.textContent?.replace(/\s+/g, " ").trim() ?? "";
    },
    async fault(kind) {
      await testFault(kind);
    },
    pid: async () => (await appInfo()).pid,
    welcome: () => workspace.welcomeForTest(),
    async regainFocus() {
      await workspace.checkOnFocus();
      await settle();
    },
    async setLibrary(path) {
      workspace.library.apply(await testLibrary(path));
      await settle();
    },
    async nextDialog(path) {
      await testDialog(path);
    },
    library() {
      const lib = workspace.library;
      const active = document.activeElement;
      const row =
        active instanceof HTMLElement ? active.closest<HTMLElement>('[role="treeitem"]') : null;
      return {
        kind: lib.view.kind,
        name: lib.name,
        visible: lib.visible,
        mode: lib.layout.mode,
        offset: lib.layout.offset,
        focused: lib.focused,
        active: lib.active,
        focusedRow: row?.dataset.path ?? null,
        rows: [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((el) => ({
          path: el.dataset.path ?? "",
          level: Number(el.getAttribute("aria-level")),
          expanded: el.hasAttribute("aria-expanded")
            ? el.getAttribute("aria-expanded") === "true"
            : null,
          selected: el.getAttribute("aria-selected") === "true",
        })),
      };
    },
    picker() {
      const kind = workspace.picker;
      if (!kind) return null;
      const text = (el: Element) => el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const items = [...document.querySelectorAll(".picker-item")];
      const selected = document.querySelector(".picker-item[data-selected]");
      return { kind, items: items.map(text), selected: selected ? text(selected) : null };
    },
    prompt() {
      const dialog = document.querySelector(".prompt");
      if (!dialog) return null;
      const input = dialog.querySelector("input");
      return {
        title: dialog.querySelector(".prompt-title")?.textContent?.trim() ?? "",
        value: input?.value ?? "",
        problem: dialog.querySelector(".error")?.textContent?.trim() ?? null,
        ready: input !== null && document.activeElement === input,
      };
    },
    async measure() {
      workspace.measureLayout();
      await settle();
    },
    async lintSettled(timeoutMs = 15_000) {
      const end = Date.now() + timeoutMs;
      // Idle twice in a row, a frame apart: a response may schedule the next request.
      for (let calm = 0; Date.now() < end;) {
        calm = lintIdle(view) ? calm + 1 : 0;
        if (calm >= 2) return true;
        await frames(2);
      }
      return false;
    },
    diagnostics() {
      const state = view.state;
      const drawn = new Set(
        [...view.contentDOM.querySelectorAll(".cm-diag")].map((el) => el.textContent ?? ""),
      );
      return visibleDiagnostics(state).map(({ from, to, diagnostic: d }) => {
        const text = state.sliceDoc(from, to);
        return { text, kind: d.kind, lang: d.lang, drawn: drawn.has(text) };
      });
    },
    caretAt(text, offset = 0) {
      const at = view.state.doc.toString().indexOf(text);
      if (at < 0) throw new Error(`"${text}" isn't in the document`);
      view.dispatch({ selection: { anchor: at + offset } });
      view.focus();
    },
    menuOpen: () => workspace.checking.menu !== null,
    clipboard: (target) => testClipboard(target),
    note: () => document.querySelector(".status .note")?.textContent?.trim() ?? "",
    suggestions() {
      const menu = document.querySelector(".suggestions");
      if (!menu) return null;
      const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const focused = document.activeElement?.closest('[role="menuitem"]') ?? null;
      return {
        kind: text(menu.querySelector(".kind")),
        explanation: text(menu.querySelector(".why")),
        items: [...menu.querySelectorAll('[role="menuitem"]')].map(text),
        focused: focused ? text(focused) : null,
      };
    },
    openSettings: (section = null) => workspace.openSettings(section),
    shortcuts: () => ({
      keys: Object.fromEntries(shortcuts.keys),
      problems: shortcuts.problems.map((p) => copy.shortcuts.problem(p)),
      changed: shortcuts.changed,
    }),
    colourThemes: () =>
      colourThemes.list.map((t) => ({
        id: t.id,
        name: t.name,
        usable: t.usable,
        problems: copy.themes.problems(t.problems),
      })),
    token(name) {
      // Resolved through a probe, so var() aliases come back as the colour they draw.
      const probe = document.createElement("span");
      probe.style.setProperty("color", `var(--${name})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    },
  };
  document.documentElement.dataset.ready = "true";
}
