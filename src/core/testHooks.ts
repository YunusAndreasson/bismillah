import { forceParsing } from "@codemirror/language";
import { Compartment, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { setProfile, setTheme, type Profile, type Theme } from "./appearance.ts";
import type { Editor } from "../editor/setup.ts";
import { caretBlink } from "../editor/caretBlink.ts";
import { remeasure } from "../editor/typography.ts";
import { visibleDiagnostics } from "../editor/diagnostics.ts";
import { lintIdle } from "../editor/linter.ts";
import { transliterationOn } from "../editor/typingAids.ts";
import { geometry, type Geometry } from "./testGeometry.ts";
import { commandLog, runCommand, type CommandId } from "./commands.ts";
import {
  appInfo,
  menuState,
  testDialog,
  testFault,
  testLibrary,
  testOpen,
  type MenuState,
} from "./ipc.ts";
import type { Panel } from "./panels.ts";
import type { SettingsTarget } from "./settingEntries.ts";
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
  /** Exercise normal caret blinking instead of the harness's steady caret. */
  blinkCaret(on: boolean): void;
  /** Count actual word-count computations; optionally pause/resume for an A/B probe. */
  wordCounter(paused?: boolean): { runs: number; paused: boolean };
  /** The open document's word count (behind the status line's reading time). */
  words(): number;
  commandLog: typeof commandLog;
  menuState(): Promise<MenuState>;
  menuItemEnabled(id: CommandId): Promise<boolean | null>;
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
  /** The open panel: its kind, query, rows (as read), the highlighted row, the row
   * opened in place, and each tab's count while searching. */
  panel(): PanelProbe | null;
  /** Opens a panel afresh, with `query` typed if given. */
  openPanel(kind: Panel, query?: string): Promise<void>;
  /** The open name prompt; `ready` once its field has focus. `problem`, not `error`:
   * WebDriver reads a result with an `error` key as a failure of its own. */
  prompt(): { title: string; value: string; problem: string | null; ready: boolean } | null;
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
  /** The status line's passing message. */
  note(): string;
  suggestions(): {
    kind: string;
    explanation: string;
    items: string[];
    focused: string | null;
  } | null;
  /** Opens the Settings panel, at a row (and opened in place) if given. */
  openSettings(at?: SettingsTarget | null): void;
  /** Visual fixtures only: labels never change Rust's actual storage locations. */
  setFolderLabels(folders: { config: string; data: string }): void;
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
  active: string | null;
  /** Every file and folder path in the listing, in tree order. */
  paths: string[];
}

export interface PanelProbe {
  kind: Panel;
  query: string;
  /** Each row's text, with its value ("file:notes.md", "setting:measure"). */
  rows: { value: string; text: string }[];
  selected: string | null;
  opened: string | null;
  /** The element with keyboard focus: "field", "opened" (a control in the opened
   * row) or "other". */
  focus: "field" | "opened" | "other";
  counts: Record<Panel, number> | null;
  keys: string;
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
  const blinking = new Compartment();
  let blinkingInstalled = false;
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
    wordCounter: (paused) => workspace.wordCounterForTest(paused),
    words: () => workspace.words,
    blinkCaret(on) {
      const extension = on ? caretBlink() : [];
      view.dispatch({
        effects: blinkingInstalled
          ? blinking.reconfigure(extension)
          : StateEffect.appendConfig.of(blinking.of(extension)),
      });
      blinkingInstalled = true;
    },
    geometry: geometry(view),
    commandLog,
    menuState,
    menuItemEnabled: (id) => workspace.menuItemEnabledForTest(id),
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
    setTransliteration(on) {
      if (view.state.field(transliterationOn) !== on) workspace.context.toggleTransliteration();
    },
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
    // The document's status, without the panels' items at its start.
    status() {
      const status = document.querySelector(".status")?.cloneNode(true);
      if (!(status instanceof HTMLElement)) return "";
      status.querySelector(".start")?.remove();
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
      const paths: string[] = [];
      const walk = (nodes: typeof lib.nodes) => {
        for (const node of nodes) {
          paths.push(node.path);
          walk(node.children);
        }
      };
      walk(lib.nodes);
      return { kind: lib.view.kind, name: lib.name, active: lib.active, paths };
    },
    panel() {
      const kind = workspace.panel;
      const box = document.querySelector(".panel");
      if (!kind || !box) return null;
      const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const rows = [...box.querySelectorAll<HTMLElement>(".panel-row")];
      const value = (el: Element) => el.getAttribute("data-value") ?? "";
      const current = box.querySelector(".panel-row.current");
      const opened = box.querySelector(".panel-opened");
      const active = document.activeElement;
      const counts = [...box.querySelectorAll(".panel-tab .count")].map((el) =>
        Number(text(el).replace(/\D/g, "")),
      );
      return {
        kind,
        query: workspace.panelQuery,
        rows: rows.map((el) => ({ value: value(el), text: text(el) })),
        selected: current ? value(current) : null,
        opened: opened ? value(opened) : null,
        focus: active?.classList.contains("panel-input")
          ? "field"
          : opened?.contains(active)
            ? "opened"
            : "other",
        counts:
          counts.length === 3
            ? { files: counts[0] ?? 0, commands: counts[1] ?? 0, settings: counts[2] ?? 0 }
            : null,
        keys: text(box.querySelector(".panel-keys .now")),
      };
    },
    async openPanel(kind, query) {
      workspace.panel = null;
      await settle();
      workspace.openPanel(kind, query === undefined ? {} : { query });
      await settle();
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
    openSettings: (at = null) => workspace.openSettings(at),
    setFolderLabels: (folders) => {
      workspace.info.folders = folders;
    },
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
  // Ready once the native menu is built and the other fonts loaded, which the app does
  // after the text is editable.
  void workspace.ready.then(() => {
    document.documentElement.dataset.ready = "true";
  });
}
