import { tick } from "svelte";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { keymap } from "@codemirror/view";
import { Compartment, Prec } from "@codemirror/state";
import { createEditor, type Editor } from "../editor/setup.ts";
import { remeasure } from "../editor/typography.ts";
import { toggleTransliteration, transliterationOn } from "../editor/typingAids.ts";
import { WordCounter } from "../editor/wordCount.ts";
import { batteryLevel, clockText, correctedNow } from "../appliance/power.ts";
import { runCommand, useStickCommands, type CommandContext, type CommandId } from "./commands.ts";
import { copy, nameError, when } from "./copy.ts";
import * as ipc from "./ipc.ts";
import {
  isError,
  type DiskStatus,
  type LibraryError,
  type OpenedDocument,
  type OpenError,
  type SaveError,
} from "./ipc.ts";
import { shortcuts } from "./keybindings.svelte.ts";
import { DoubleShift } from "./doubleShift.ts";
import { keyOf, normalise } from "./keys.ts";
import type { Panel } from "./panels.ts";
import { applyColours, colourThemes, DEFAULT_THEME, onSystemScheme } from "./themes.svelte.ts";
import { Checking } from "./checking.svelte.ts";
import { GUIDE_NAME, GUIDE_WORDS } from "./guide.ts";
import { LibraryStore } from "./library.svelte.ts";
import type { NativeMenu } from "./menu.ts";
import { quietReload } from "./reload.ts";
import type { SettingsTarget } from "./settingEntries.ts";
import { DocumentSession } from "./session.svelte.ts";
import { findNode, folderFor } from "./tree.ts";
import {
  applyAppearance,
  clampScale,
  settings,
  TEXT_SCALE,
  type Settings,
} from "./settings.svelte.ts";
import { loadFonts, loadOtherFonts, setCustomFont, type Theme } from "./appearance.ts";

/**
 * The window's state and every action on it: which document is open, its save state,
 * the notices the writer must see, and the commands. Svelte components only render
 * this (src/App.svelte).
 */

export interface NoticeAction {
  label: string;
  run(): unknown;
  primary?: boolean;
}

export interface Notice {
  id: string;
  /** Errors stay until resolved; infos can be dismissed. */
  tone: "error" | "info";
  message: string;
  actions: NoticeAction[];
}

/** The small dialog that asks for a name: Rename…, New folder…. */
export interface NamePrompt {
  title: string;
  value: string;
  /** How much of `value` starts selected: a file's name without its ending. */
  select: number;
  hint: string | null;
  action: string;
  /** Where focus goes when it closes: the open panel's field, or the text. */
  returnTo: "panel" | "editor";
  /** Resolves with a sentence explaining why the name didn't work, or null when done. */
  submit(name: string): Promise<string | null>;
}

/** How long quitting waits for a save before leaving the text to recovery. */
const QUIT_TIMEOUT_MS = 4000;
/** How often the stick reads its battery and moves its clock. */
const BATTERY_MS = 30_000;
const CLOCK_MS = 5_000;
const WORD_COUNT_DELAY_MS = 300;

const THEMES: Theme[] = ["system", "light", "dark"];

export class Workspace {
  editor: Editor | null = null;
  session = $state<DocumentSession | null>(null);
  /** No document is open: show the first screen. */
  welcome = $state(false);
  words = $state(0);
  /** The writer is typing; quiet chrome may fade (DESIGN.md §12). */
  typing = $state(false);
  transliteration = $state(false);
  fullscreen = $state(false);
  aboutOpen = $state(false);
  /** Where bismillah keeps its files and its version (app_info), for Settings and About. */
  info = $state<{ version: string; folders: { config: string; data: string } }>({
    version: "",
    folders: { config: "", data: "" },
  });
  /** The writer's "Another font", and whether it is installed (null: unknown). */
  customFont = $state<{ name: string; installed: boolean | null }>({ name: "", installed: null });
  /** On the bismillah stick: what it was built from (About). Null on the desktop. */
  stick = $state<ipc.StickInfo | null>(null);
  /** The stick's lock view is up over everything (src/appliance/, os/PLAN.md OS-3). */
  locked = $state(false);
  /** The stick's battery, null without one; and its clock ("15:04"). */
  battery = $state<ipc.Battery | null>(null);
  clock = $state<string | null>(null);
  /** The keybindings.toml and colour-theme notices the writer has dismissed, by what
   * they said: a new problem shows again. */
  #dismissed = $state<string[]>([]);
  readonly library = new LibraryStore();
  /** Spelling and grammar suggestions (checking.svelte.ts). */
  readonly checking = new Checking({
    editor: () => this.editor,
    // A bundled document's key can't be taken for a file of the same name.
    documentKey: () =>
      this.session?.sample
        ? `bundled:${this.session.name}`
        : (this.library.active ?? this.session?.name ?? null),
    checking: () => settings.values.check_spelling || settings.values.check_grammar,
    failed: (message) => this.#notice("add-word-failed", "error", message, []),
  });
  /** The open panel: Files, Commands or Settings (DESIGN.md §6, ADR-0016). */
  panel = $state<Panel | null>(null);
  /** Its search field, kept as Tab moves to another panel. */
  panelQuery = $state("");
  /** A row for the open panel to highlight, and open in place (Show in Settings, a
   * renamed file); the panel takes it once it lists that row. */
  panelFocus = $state<{ value: string; open: boolean } | null>(null);
  /** The panel Shift Shift opens: the one used last. */
  lastPanel: Panel = "files";
  prompt = $state<NamePrompt | null>(null);
  recovery = $state<ipc.RecoveryEntry | null>(null);
  pending = $state<ipc.PendingRecovery[]>([]);
  infos = $state<Notice[]>([]);
  testMode = false;

  #host: HTMLElement | null = null;
  #menu = $state.raw<NativeMenu | null>(null);
  #wordTimer: ReturnType<typeof setTimeout> | undefined;
  #wordCounter = new WordCounter();
  #wordCountRuns = 0;
  #wordCountPaused = false;
  #onChange: (() => void) | null = null;
  /** The dialect the document was last checked in. */
  #dialect: Settings["english_dialect"] | null = null;

  /** Everything the writer must see now, most important first. */
  notices = $derived.by((): Notice[] => {
    const list: Notice[] = [];
    const session = this.session;
    if (session?.state.kind === "failed")
      list.push(this.#failureNotice(session, session.state.error));
    if (session && this.recovery) {
      const entry = this.recovery;
      list.push({
        id: "recovered",
        tone: "error",
        message: copy.recovered(session.name, when(entry.saved_at_ms)),
        actions: [
          { label: copy.actions.restore, run: () => this.restoreRecovered(), primary: true },
          { label: copy.actions.discard, run: () => this.discardRecovered() },
        ],
      });
    }
    for (const p of this.pending) {
      list.push({
        id: `pending-${p.token}`,
        tone: "info",
        message: copy.pendingRecovery(p.name, when(p.saved_at_ms)),
        actions: [
          {
            label: copy.actions.open(p.name),
            run: () => this.openRecovered(p.token),
            primary: true,
          },
          {
            label: copy.actions.notNow,
            run: () => (this.pending = this.pending.filter((x) => x !== p)),
          },
        ],
      });
    }
    if (settings.notSaved) {
      list.push({
        id: "settings-not-saved",
        tone: "error",
        message: copy.settingsNotSaved(settings.notSaved),
        actions: [{ label: copy.actions.dismiss, run: () => (settings.notSaved = null) }],
      });
    }
    list.push(...this.#configNotices());
    for (const n of settings.notices) {
      list.push({
        id: `settings-${n.kind}`,
        tone: "info",
        message: copy.settingsNotice(n),
        actions: [
          {
            label: copy.actions.dismiss,
            run: () => (settings.notices = settings.notices.filter((x) => x !== n)),
          },
        ],
      });
    }
    return [...list, ...this.infos];
  });

  #failureNotice(session: DocumentSession, error: SaveError): Notice {
    const name = session.name;
    if (error.kind === "conflict") {
      return {
        id: "conflict",
        tone: "error",
        message: copy.conflict(name, session.recoveryCurrent),
        actions: [
          { label: copy.actions.keepMine, run: () => session.save(true), primary: true },
          { label: copy.actions.loadTheirs, run: () => this.loadTheirs() },
          { label: copy.actions.saveMineAs, run: () => this.saveAs() },
        ],
      };
    }
    if (error.kind === "removed") {
      return {
        id: "removed",
        tone: "error",
        message: copy.removed(name, session.recoveryCurrent),
        actions: [
          { label: copy.actions.saveAgain, run: () => session.save(true), primary: true },
          { label: copy.actions.saveElsewhere, run: () => this.saveAs() },
        ],
      };
    }
    return {
      id: "failure",
      tone: "error",
      message: copy.failure(name, error, session.recoveryCurrent),
      actions: [
        { label: copy.actions.tryAgain, run: () => session.save(), primary: true },
        { label: copy.actions.saveElsewhere, run: () => this.saveAs() },
      ],
    };
  }

  /** keybindings.toml that couldn't be used, and a chosen colour theme that can't. */
  #configNotices(): Notice[] {
    const out: Notice[] = [];
    const notice = (id: string, message: string, row: "shortcuts" | "colours") => {
      if (this.#dismissed.includes(message)) return;
      out.push({
        id,
        tone: "info",
        message,
        actions: [
          {
            label: copy.actions.showInSettings,
            primary: true,
            run: () => this.openSettings({ row, open: true }),
          },
          { label: copy.actions.dismiss, run: () => this.#dismissed.push(message) },
        ],
      });
    };
    if (shortcuts.file.unreadable) {
      notice("keybindings", copy.shortcuts.unreadable(shortcuts.file.unreadable), "shortcuts");
    } else if (shortcuts.problems.length > 0) {
      notice("keybindings", copy.shortcuts.problemsNotice, "shortcuts");
    }
    const chosen = settings.values.colour_theme;
    if (colourThemes.loaded && chosen !== DEFAULT_THEME && !colourThemes.find(chosen)) {
      notice("colour-theme", copy.themes.unusableNotice(chosen), "colours");
    }
    return out;
  }

  /** Opens the Settings panel, at a row if given. */
  openSettings(at: SettingsTarget | null = null): void {
    this.openPanel("settings", {
      focus: at ? { value: `setting:${at.row}`, open: at.open ?? false } : null,
    });
  }

  /** Opens a panel afresh: an empty search (or `query`), on its first row (or `focus`). */
  openPanel(
    panel: Panel,
    at: { query?: string; focus?: { value: string; open: boolean } | null } = {},
  ): void {
    if (this.locked) return;
    if (this.panel === null) this.panelQuery = at.query ?? "";
    else if (at.query !== undefined) this.panelQuery = at.query;
    this.panelFocus = at.focus ?? null;
    this.panel = panel;
    this.lastPanel = panel;
  }

  /** A panel's own shortcut: opens it, switches to it, or closes it when it's open. */
  #togglePanel(panel: Panel): void {
    if (this.panel === panel) this.panel = null;
    else this.openPanel(panel);
  }

  #info(id: string, message: string): void {
    this.#notice(id, "info", message, []);
  }

  /** Shows a notice that replaces any with the same id; OK dismisses it. */
  #notice(id: string, tone: Notice["tone"], message: string, actions: NoticeAction[]): void {
    const notice: Notice = {
      id,
      tone,
      message,
      actions: [...actions, { label: copy.actions.dismiss, run: () => this.#dismiss(id) }],
    };
    this.infos = [...this.infos.filter((n) => n.id !== id), notice];
  }

  #dismiss(id: string): void {
    this.infos = this.infos.filter((n) => n.id !== id);
  }

  /** Starts the window: settings, the first document or screen, menus and events. */
  async start(
    host: HTMLElement,
    menu: (context: CommandContext) => Promise<NativeMenu>,
  ): Promise<void> {
    this.#host = host;
    performance.mark("bismillah:start");
    // First: on the stick the command registry changes before anything reads it.
    const info = await ipc.appInfo();
    if (info.stick) useStickCommands();
    this.stick = info.stick;
    await Promise.all([
      settings.load(),
      shortcuts.load().catch(() => false),
      colourThemes.load().catch(() => {}),
    ]);
    performance.mark("bismillah:configuration");
    this.testMode = info.test_mode;
    this.info = { version: info.version, folders: info.folders };
    applyAppearance(settings.values);
    applyColours(settings.values);
    // The fonts load while Rust opens the document.
    const fonts = loadFonts(settings.values.writing_profile);
    await this.#checkFont(settings.values.custom_font);
    onSystemScheme(() => applyColours(settings.values));
    // Before startup, which may change the library (a folder on the command line).
    await listen<ipc.LibraryView>("library-changed", ({ payload }) => this.library.apply(payload));
    const first = await ipc.startup();
    performance.mark("bismillah:document");
    const view = await ipc.libraryGet(false);
    performance.mark("bismillah:library");
    this.library.apply(view);
    await fonts;
    performance.mark("bismillah:fonts");
    if (first.kind === "document") {
      this.#show(first.document);
      // Other files' recovered text is mentioned at launch only, never on every open.
      this.pending = first.document.pending_recovery;
    } else {
      this.#showWelcome();
      if (first.kind === "welcome") this.pending = first.pending_recovery;
      else this.#info("open-failed", copy.openFailed(first.name, first.error));
    }
    this.#listen();
    performance.mark("bismillah:editor");
    // The native menu takes some sixty calls to Rust; nothing needs it before the text
    // is editable, so it is built after (ARCHITECTURE.md §14).
    // Then the fonts the first screen didn't need.
    this.ready = menu(this.context)
      .then(
        (built) => {
          this.#menu = built;
        },
        (error: unknown) => console.error("bismillah: couldn't build the menu", error),
      )
      .then(loadOtherFonts);
  }

  /** Resolves once the native menu is built and every font loaded, after the text is
   * editable (the test hooks wait for it). */
  ready: Promise<void> = Promise.resolve();

  /** Test hooks only: reads the installed native menu, rather than registry intent. */
  menuItemEnabledForTest(id: CommandId): Promise<boolean | null> {
    return this.#menu?.isEnabled(id) ?? Promise.resolve(null);
  }

  #listen(): void {
    const appWindow = getCurrentWindow();
    void listen<string>("open-requested", () => void this.#openRequested());
    // A setting, shortcut, theme or dictionary word saved in another program applies
    // at once (src-tauri/src/config.rs).
    void listen<ipc.ConfigChanged>("config-changed", ({ payload }) => {
      void this.#reloadConfig(payload);
    });
    void listen<ipc.DocumentChanged>("document-changed", ({ payload }) => {
      const session = this.session;
      if (session && session.id === payload.id) void this.#reactToDisk(session, payload.status);
    });
    void appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) void this.checkOnFocus();
      else void this.session?.flush();
    });
    void appWindow.onCloseRequested(async (event) => {
      // A failed or timed-out save is safe to leave only if recovery was confirmed.
      await Promise.race([
        this.session?.flush(),
        new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS)),
      ]);
      if (this.session && !this.session.canLeave) event.preventDefault();
    });
    // Shortcuts while focus is outside the editor (the first screen, the status line).
    // They don't act behind an open dialog (a panel handles its own), and keys without
    // Ctrl (F2) don't act in a field.
    window.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || this.locked || this.editor?.view.hasFocus) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"], [role="alertdialog"]')) return;
      const key = keyOf(event);
      const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (field && !key.startsWith("Mod-")) return;
      const bound = shortcuts
        .bound()
        .find((b) => normalise(b.key) === key && b.command.section !== "Edit");
      if (bound && runCommand(bound.command.id, "keymap", this.context)) event.preventDefault();
    });
    // Shift Shift opens the last panel from anywhere, the editor too (DESIGN.md §13),
    // and closes it again. Not behind another dialog or the lock view.
    const doubleShift = new DoubleShift();
    const onShift = (event: KeyboardEvent) => {
      const moment = {
        type: event.type === "keyup" ? ("keyup" as const) : ("keydown" as const),
        code: event.code,
        repeat: event.repeat,
        isComposing: event.isComposing,
        modified: event.ctrlKey || event.altKey || event.metaKey,
        time: event.timeStamp,
      };
      if (!doubleShift.feed(moment) || this.locked) return;
      const target = event.target instanceof Element ? event.target : null;
      const dialog = target?.closest('[role="dialog"], [role="alertdialog"]');
      if (this.panel !== null) {
        // In the panel it closes; not while Rename… or another dialog is over it.
        if (dialog && !dialog.classList.contains("panel")) return;
        this.panel = null;
      } else if (!dialog) runCommand("app.findAnything", "keymap", this.context);
    };
    window.addEventListener("keydown", onShift, true);
    window.addEventListener("keyup", onShift, true);
    window.addEventListener("mousedown", () => doubleShift.interrupt(), true);
    window.addEventListener("mousemove", () => (this.typing = false));
    if (this.stick) this.#watchStick();
  }

  /** The stick's lock handshake, clock and battery. */
  #watchStick(): void {
    void listen("appliance-lock", () => this.lock());
    const tick = () => {
      const now = correctedNow(
        Date.now(),
        settings.values.time_zone,
        settings.values.clock_keeps_local_time,
      );
      this.clock = clockText(now, settings.values.time_zone);
    };
    tick();
    setInterval(tick, CLOCK_MS);
    const read = async () => {
      this.battery = await ipc.applianceBattery().catch(() => null);
      this.#reactToBattery();
    };
    void read();
    setInterval(() => void read(), BATTERY_MS);
  }

  #poweringOff = false;
  #batteryWarned = false;

  /** A notice once the battery is low (again after it has charged); at critical, save
   * and power off. */
  #reactToBattery(): void {
    const level = batteryLevel(this.battery);
    if (level === "fine") {
      this.#batteryWarned = false;
      this.#dismiss("battery-low");
    } else if (this.battery && !this.#batteryWarned) {
      this.#batteryWarned = true;
      this.#notice("battery-low", "error", copy.stick.batteryLow(this.battery.percent), []);
      void ipc.applianceMark("battery-low");
    }
    if (level === "critical" && !this.#poweringOff) {
      this.#poweringOff = true;
      void ipc.applianceMark("battery-critical");
      void this.power("off");
    }
  }

  /** Shows the lock view over everything, then reports it painted to the helper. The
   * document is saved behind it. */
  lock(): void {
    this.locked = true;
    this.aboutOpen = false;
    this.panel = null;
    // Two frames: the lock view has been drawn (docs/spikes/os-suspend-lock.md).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void ipc.appliancePainted();
        void ipc.applianceMark("lock-painted");
      }),
    );
    void this.session?.flush();
  }

  /** The passphrase was verified: back to the text. */
  unlocked(): void {
    this.locked = false;
    void tick().then(() => this.focusEditor());
  }

  /** Saves (or leaves the text to recovery after a timeout), then asks the helper to
   * power off, restart or suspend. Suspending locks first. */
  async power(action: ipc.PowerAction): Promise<void> {
    if (action === "suspend") this.lock();
    await Promise.race([
      this.session?.flush(),
      new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS)),
    ]);
    try {
      await ipc.appliancePower(action);
    } catch {
      this.#notice("power-failed", "error", copy.stick.powerFailed, []);
    }
  }

  /** After a keyboard change restarted the session: the caret goes back where it was,
   * in the same document. */
  async restoreCaret(): Promise<void> {
    const caret = await ipc.applianceTakeCaret().catch(() => null);
    const view = this.context.view;
    if (caret === null || !view) return;
    const head = Math.min(caret, view.state.doc.length);
    view.dispatch({ selection: { anchor: head }, scrollIntoView: true });
  }

  /** Settings › Stick › Keyboard: saves, then stores the layouts; the session
   * restarts with them and comes back to this caret. Resolves with why it couldn't. */
  async applyKeyboard(layouts: string, options: string): Promise<string | null> {
    const saved = await this.session?.flush();
    if (saved === false) return copy.stick.keyboardUnsaved;
    const view = this.context.view;
    const caret = view ? view.state.selection.main.head : null;
    try {
      const answer = await ipc.applianceSetKeyboard(layouts, options, caret);
      return answer.answer === "invalid_keyboard"
        ? copy.stick.keyboardInvalid
        : copy.appliance.failed;
    } catch {
      return copy.appliance.helperDown;
    }
  }

  /** When the window regains focus: settings edited elsewhere apply, and the file is
   * checked for changes made by another program (no polling, ARCHITECTURE.md §5.4). */
  async checkOnFocus(): Promise<void> {
    // The watcher normally reports these at once; on focus they are read again in case
    // it couldn't watch (each read is cheap and changes nothing that didn't change).
    await this.#reloadConfig({ settings: true, keybindings: true, themes: true, dictionary: true });
    void ipc
      .libraryGet(true)
      .then((view) => this.library.apply(view))
      .catch(() => {});
    const session = this.session;
    if (!session?.saveable) return;
    const status = await ipc.checkDisk(session.id).catch(() => "unchanged" as const);
    await this.#reactToDisk(session, status);
  }

  /** Uses the writer's "Another font" only if it is installed; otherwise the custom
   * profile keeps Bismillah Duo, and Settings says why. */
  async #checkFont(name: string): Promise<void> {
    if (name === this.customFont.name) return;
    this.customFont = { name, installed: null };
    const installed = name ? await ipc.fontInstalled(name).catch(() => null) : false;
    if (this.customFont.name !== name) return;
    this.customFont = { name, installed };
    setCustomFont(installed === false ? "" : name);
    if (this.editor) remeasure(this.editor.view);
  }

  /** Reads what changed in the configuration folder and applies it. */
  async #reloadConfig(changed: ipc.ConfigChanged): Promise<void> {
    const work: Promise<unknown>[] = [];
    if (changed.settings)
      work.push(
        settings.reload().then((applied) => {
          if (applied) this.applySettings(settings.values);
        }),
      );
    if (changed.keybindings)
      work.push(
        shortcuts.load().then((keysChanged) => {
          if (keysChanged) this.#applyShortcuts();
        }),
      );
    if (changed.themes) work.push(colourThemes.load().then(() => applyColours(settings.values)));
    if (changed.dictionary)
      // The writer may have edited dictionary.txt in another program.
      work.push(
        ipc.lintRefresh().then((refreshed) => {
          if (refreshed) this.editor?.recheck();
        }),
      );
    await Promise.all(work.map((w) => w.catch(() => {})));
  }

  /** Settings › Files & privacy: writes a starting keybindings.toml. Resolves with why
   * it couldn't, or null. */
  async createKeybindings(): Promise<SaveError | null> {
    try {
      await shortcuts.create();
      this.#applyShortcuts();
      return null;
    } catch (error) {
      return isError<SaveError>(error) ? error : { kind: "other", detail: String(error) };
    }
  }

  /** The editor keymap and the menu follow the shortcuts the writer has now. */
  #applyShortcuts(): void {
    this.editor?.view.dispatch({ effects: this.#keySlot.reconfigure(this.#keymap()) });
    void this.#menu?.sync();
  }

  #keySlot = new Compartment();

  #keymap() {
    return Prec.high(
      keymap.of(
        shortcuts.bound().map(({ command, key }) => ({
          key,
          scope:
            command.id.startsWith("edit.find") || command.id === "edit.replace"
              ? "editor search-panel"
              : "editor",
          run: () => runCommand(command.id, "keymap", this.context),
        })),
      ),
    );
  }

  /** The open file changed on disk, found on focus or by the library's watcher. */
  async #reactToDisk(session: DocumentSession, status: DiskStatus): Promise<void> {
    if (!session.saveable || this.session !== session) return;
    if (status === "changed" && !session.dirty && session.state.kind !== "failed") {
      // No local edits: take the new version quietly (ARCHITECTURE.md §5.4). Text typed
      // while it is read is kept in recovery and offered, never replaced unseen.
      const editor = this.editor;
      if (!editor) return;
      const result = await quietReload({
        id: session.id,
        text: () => editor.text(),
        reload: (id, local) => ipc.reload(id, local),
      }).catch(() => null);
      if (result) this.#showReload(session, result, true);
    } else if (status === "changed" || status === "removed") {
      // Local edits: never overwrite. Saving now surfaces the conflict.
      session.state = {
        kind: "failed",
        error: { kind: status === "changed" ? "conflict" : "removed" },
      };
    }
  }

  /** Even a failed follow-up keep may have opened a new backend document. */
  #showReload(
    previous: DocumentSession,
    result: Awaited<ReturnType<typeof quietReload>>,
    quiet = false,
  ): void {
    const editor = this.editor;
    if (this.session !== previous || !editor) return;
    const local = editor.text();
    const selection = editor.view.state.selection;
    const top = editor.view.scrollDOM.scrollTop;
    this.#show(result.opened, { quiet });
    if (result.keepFailed && (local !== result.opened.text || result.opened.read_only)) {
      editor.replaceAll(local);
      editor.view.dispatch({ selection });
      editor.view.scrollDOM.scrollTop = top;
      // Older recovery offers cannot stand in for the unprotected latest text.
      this.recovery = null;
      this.session?.requireConflictResolution();
    }
  }

  /** Shows a newly opened document (replacing the current one, already flushed). */
  #show(opened: OpenedDocument, options: { quiet?: boolean } = {}): void {
    this.session?.dispose();
    // Before the text loads: its images are asked for by this id.
    this.#documentId = opened.id;
    this.welcome = false;
    const existing = this.editor;
    const editor = existing ?? this.#createEditor(opened.text, opened.read_only);
    if (existing && options.quiet) editor.reloadQuietly(opened.text);
    else if (existing) editor.load(opened.text, opened.read_only);
    editor.setLabel(opened.name);
    const session = new DocumentSession(opened, () => editor.text(), {
      save: (id, text, revision, force) => ipc.saveDocument(id, text, revision, force),
    });
    this.#onChange = () => {
      this.checking.clearNote();
      session.edited();
      this.typing = true;
      this.#countWords();
    };
    this.session = session;
    this.library.setActive(opened.library_path);
    this.recovery = opened.recovery;
    this.pending = this.pending.filter((p) => p.name !== opened.name);
    this.infos = [];
    if (opened.read_only) this.#info("read-only", copy.readOnly(opened.name));
    if (opened.mixed_line_endings)
      this.#info(
        "line-endings",
        copy.mixedLineEndings(opened.name, copy.lineEndings[opened.line_ending]),
      );
    this.transliteration = false;
    if (opened.sample && opened.name === GUIDE_NAME) this.checking.ignoreWords(GUIDE_WORDS);
    this.checking.documentShown();
    this.#countWords(0);
    void this.#setTitle(opened.name);
    if (!options.quiet) void tick().then(() => editor.view.focus());
  }

  /** Test hooks only: shows a document opened by `test_open`. */
  showForTest(opened: OpenedDocument): void {
    this.#show(opened);
  }

  /** Test hooks only: the first screen, as when nothing is open. */
  welcomeForTest(): void {
    this.session?.dispose();
    this.session = null;
    this.#showWelcome();
  }

  #showWelcome(): void {
    this.welcome = true;
    void this.#setTitle(null);
  }

  /** The open document went to the trash: nothing is open now. */
  #closeDocument(): void {
    this.session?.dispose();
    this.session = null;
    this.recovery = null;
    this.library.active = null;
    this.#showWelcome();
  }

  /** The open document's id in Rust, set before its text reaches the editor. */
  #documentId: number | null = null;

  #createEditor(text: string, readOnly: boolean): Editor {
    if (!this.#host) throw new Error("the workspace has not started");
    const keys = this.#keySlot.of(this.#keymap());
    this.editor = createEditor({
      parent: this.#host,
      doc: text,
      readOnly,
      steadyCaret: this.testMode,
      keys,
      config: this.#editorConfig(settings.values),
      onChange: () => this.#onChange?.(),
      lint: { check: (request) => ipc.lintCheck(request) },
      onContextMenu: (pos) => this.checking.contextMenu(pos),
      // The open document's id and the destination as written; Rust resolves and checks
      // it against the library (images.rs).
      imageAddress: (src) => {
        const id = this.#documentId;
        return id === null ? null : convertFileSrc(`${id}/${src}`, "bismillah-image");
      },
    });
    this.#dialect = settings.values.english_dialect;
    return this.editor;
  }

  #editorConfig(s: Settings) {
    return {
      basmallah: s.basmallah_opening,
      typewriter: s.typewriter_scrolling,
      zuhd: s.focus_mode,
      focusGranularity: s.focus_granularity,
      smartPunctuation: s.smart_punctuation,
      livePreview: !s.always_show_markdown,
      spelling: s.check_spelling,
      grammar: s.check_grammar,
    };
  }

  /** Applies settings to the page and the editor, and remeasures typography. */
  applySettings(s: Settings): void {
    applyAppearance(s);
    applyColours(s);
    void this.#checkFont(s.custom_font);
    if (this.editor) {
      this.editor.configure(this.#editorConfig(s));
      if (s.english_dialect !== this.#dialect) {
        this.#dialect = s.english_dialect;
        this.editor.recheck();
      }
      const view = this.editor.view;
      void document.fonts.ready.then(() => remeasure(view));
    }
  }

  /** A separate reactive bridge: menu availability never reapplies typography. */
  syncMenu(): void {
    void this.#menu?.sync();
  }

  #countWords(delay = WORD_COUNT_DELAY_MS): void {
    clearTimeout(this.#wordTimer);
    if (this.#wordCountPaused) return;
    this.#wordTimer = setTimeout(() => {
      if (this.testMode) this.#wordCountRuns++;
      this.words = this.#wordCounter.count(this.editor?.text() ?? "");
    }, delay);
  }

  /** Test hooks only: distinguish counting work from painting the status line. */
  wordCounterForTest(paused?: boolean): { runs: number; paused: boolean } {
    if (!this.testMode) throw new Error("word counter probe requires test mode");
    if (paused !== undefined && paused !== this.#wordCountPaused) {
      this.#wordCountPaused = paused;
      clearTimeout(this.#wordTimer);
      if (!paused) this.#countWords(0);
    }
    return { runs: this.#wordCountRuns, paused: this.#wordCountPaused };
  }

  async #setTitle(name: string | null): Promise<void> {
    document.title = name ? `${name} — bismillah` : "bismillah";
    await getCurrentWindow().setTitle(document.title);
  }

  /** A failed save may be left only after Rust confirmed durable recovery. */
  async #readyToLeave(): Promise<boolean> {
    const session = this.session;
    await session?.flush();
    return this.session === session && (!session || session.canLeave);
  }

  /** Saves the current document, then opens what `open` returns (null: cancelled). */
  async #openWith(open: () => Promise<OpenedDocument | null>): Promise<void> {
    if (!(await this.#readyToLeave())) return;
    try {
      const opened = await open();
      if (!opened) return;
      this.#show(opened);
      // Rust has moved it to the front of the recent files: Files lists it there.
      void this.#reloadLibrary().catch(() => {});
    } catch (error) {
      if (isError<OpenError>(error)) this.#info("open-failed", copy.openFailed("the file", error));
    }
  }

  openRecovered(token: number): Promise<void> {
    return this.#openWith(() => ipc.openRecovered(token));
  }

  /** Takes the listing as Rust has it now, right after an action changed it. */
  async #reloadLibrary(): Promise<void> {
    this.library.apply(await ipc.libraryGet(false));
  }

  /** A drop or a second launch: a file opens; a folder becomes the library. */
  async #openRequested(): Promise<void> {
    await this.#openWith(ipc.openRequested);
    await this.#reloadLibrary();
  }

  /** Opens a file from the library, then puts the caret back in the text. */
  async openFromLibrary(path: string): Promise<void> {
    if (path === this.library.active && this.session) {
      this.editor?.view.focus();
      return;
    }
    await this.#openWith(() => ipc.libraryOpenFile(path));
  }

  focusEditor(): void {
    if (!this.welcome) this.editor?.view.focus();
  }

  /** What Rename and Move to trash act on: `path` (the Files panel's highlighted row),
   * else the open document (when it is in the library). */
  #target(path?: string): { path: string; name: string; folder: boolean } | null {
    const lib = this.library;
    if (path !== undefined) {
      const node = findNode(lib.nodes, path);
      return node ? { path: node.path, name: node.name, folder: node.kind === "folder" } : null;
    }
    if (lib.active !== null && this.session)
      return { path: lib.active, name: this.session.name, folder: false };
    return null;
  }

  /** Whether `path` is the open document or a folder holding it. */
  #holdsOpen(path: string): boolean {
    const active = this.library.active;
    return (
      active !== null && this.session !== null && (active === path || active.startsWith(`${path}/`))
    );
  }

  /** Before moving the open document: its changes must be on disk and any recovered
   * text settled, so nothing the writer typed is left behind under the old name. */
  async #readyToMove(path: string): Promise<boolean> {
    const session = this.session;
    if (!session || !this.#holdsOpen(path)) return true;
    const saved = await session.flush();
    if (!saved || session.dirty) {
      this.#notice("unsaved-first", "error", copy.unsavedFirst(session.name), []);
      return false;
    }
    if (this.recovery) {
      this.#notice("recovery-first", "info", copy.recoveryFirst(session.name), []);
      return false;
    }
    return true;
  }

  /** Rename…: `path` from the Files panel, else the open document. The panel stays
   * open behind the name prompt, on the renamed row. */
  async rename(path?: string): Promise<void> {
    const target = this.#target(path);
    if (!target) return;
    const inPanel = this.panel !== null;
    if (!(await this.#readyToMove(target.path))) return;
    const dot = target.folder ? -1 : target.name.lastIndexOf(".");
    this.prompt = {
      title: copy.prompt.rename(target.name),
      value: target.name,
      select: dot > 0 ? dot : target.name.length,
      hint: target.folder ? null : copy.prompt.fileHint,
      action: copy.prompt.renameAction,
      returnTo: inPanel ? "panel" : "editor",
      submit: async (name) => {
        try {
          const outcome = await ipc.libraryRename(target.path, name);
          await this.#reloadLibrary();
          const moved = outcome.document;
          if (moved && this.session) {
            this.session.name = moved.name;
            void this.#setTitle(moved.name);
            this.editor?.setLabel(moved.name);
            this.library.setActive(moved.library_path);
          }
          // The panel lists everything again, on the renamed row: the query that
          // found it may not find its new name.
          if (inPanel && this.panel !== null)
            this.openPanel(this.panel, {
              query: "",
              focus: { value: `${target.folder ? "folder" : "file"}:${outcome.path}`, open: false },
            });
          return null;
        } catch (error) {
          return isError<LibraryError>(error) ? nameError(error) : String(error);
        }
      },
    };
  }

  /** Move to trash: `path` from the Files panel (which closes first, so the notice's
   * Undo can be reached), else the open document. */
  async trash(path?: string): Promise<void> {
    const target = this.#target(path);
    if (!target) return;
    const reopen = this.#holdsOpen(target.path) ? this.library.active : null;
    if (!(await this.#readyToMove(target.path))) return;
    try {
      const outcome = await ipc.libraryTrash(target.path);
      if (outcome.closed) this.#closeDocument();
      await this.#reloadLibrary();
      this.#notice("trashed", "info", copy.trashed(outcome.name), [
        {
          label: copy.actions.undo,
          primary: true,
          run: () => this.#untrash(outcome, reopen),
        },
      ]);
    } catch (error) {
      if (isError<LibraryError>(error))
        this.#notice("trash-failed", "error", copy.trashFailed(target.name, error), []);
    }
  }

  async #untrash(outcome: ipc.TrashOutcome, reopen: string | null): Promise<void> {
    this.#dismiss("trashed");
    try {
      await ipc.libraryUntrash(outcome.token);
      await this.#reloadLibrary();
      if (reopen) await this.#openWith(() => ipc.libraryOpenFile(reopen));
    } catch (error) {
      if (isError<LibraryError>(error))
        this.#notice("untrash-failed", "error", copy.untrashFailed(outcome.name, error), []);
    }
  }

  /** Where something new goes: beside `path` (a folder: in it), else beside the open
   * document, else at the top of the library. */
  #folderFor(path?: string): string {
    return folderFor(this.library.nodes, path ?? this.library.active);
  }

  /** New folder…: in `parent`, else beside the open document. Afterwards the Files
   * panel shows the new folder, so a file can be made in it. */
  newFolder(parent?: string): void {
    const lib = this.library;
    if (!lib.ready) return;
    const where = parent ?? this.#folderFor();
    const name = where ? (findNode(lib.nodes, where)?.name ?? where) : (lib.name ?? "");
    this.prompt = {
      title: copy.prompt.newFolder(name),
      value: "",
      select: 0,
      hint: null,
      action: copy.prompt.createAction,
      returnTo: "panel",
      submit: async (folder) => {
        try {
          const path = await ipc.libraryNewFolder(where, folder);
          await this.#reloadLibrary();
          this.openPanel("files", {
            query: `${path}/`,
            focus: { value: `folder:${path}`, open: false },
          });
          return null;
        } catch (error) {
          return isError<LibraryError>(error) ? nameError(error) : String(error);
        }
      },
    };
  }

  /** Called when the name prompt closes: focus goes back where it belongs. */
  promptClosed(prompt: NamePrompt): void {
    if (this.prompt === prompt) this.prompt = null;
    // Restore focus after the prompt's inert layer has been removed.
    setTimeout(() => {
      if (this.prompt) return;
      const field = document.querySelector<HTMLInputElement>(".panel-input");
      if (prompt.returnTo === "panel" && this.panel !== null && field) field.focus();
      else this.focusEditor();
    }, 0);
  }

  /** Open folder…: the chosen folder becomes the library, shown in the Files panel. */
  async openFolder(): Promise<void> {
    try {
      const view = await ipc.libraryOpenDialog();
      if (!view) return;
      this.library.apply(view);
      this.openPanel("files");
    } catch (error) {
      if (isError<LibraryError>(error)) console.error("bismillah: couldn't open the folder", error);
    }
  }

  /** New file…: the save dialog starts in `folder`, else beside the open document. */
  async newFile(folder?: string): Promise<void> {
    if (!(await this.#readyToLeave())) return;
    folder ??= this.library.ready ? this.#folderFor() : undefined;
    try {
      const opened = await ipc.newDialog(folder ?? null);
      if (opened) this.#show(opened);
    } catch (error) {
      if (isError<SaveError>(error)) this.#info("new-failed", copy.newFailed(error));
    }
  }

  /** "Save mine as…" / "Save elsewhere…": the text goes to a file the writer chooses. */
  async saveAs(): Promise<void> {
    const session = this.session;
    const editor = this.editor;
    if (!session || !editor) return;
    const snapshot = editor.text();
    try {
      const opened = await ipc.saveAs(session.id, snapshot);
      if (!opened || this.session !== session) return;
      const latest = editor.text();
      const selection = editor.view.state.selection;
      const top = editor.view.scrollDOM.scrollTop;
      this.#show(opened);
      if (latest !== snapshot) {
        // The dialog/write/IPC can outlast more typing. Only the snapshot reached
        // disk: retain later edits in the new session and let autosave protect them.
        editor.replaceAll(latest);
        editor.view.dispatch({ selection });
        editor.view.scrollDOM.scrollTop = top;
      }
    } catch (error) {
      if (this.session === session && isError<SaveError>(error))
        session.state = { kind: "failed", error };
    }
  }

  /** "Load theirs": the writer's version is kept in recovery, then the file reloads. */
  async loadTheirs(): Promise<void> {
    const session = this.session;
    const editor = this.editor;
    if (!session || !editor) return;
    const result = await quietReload({
      id: session.id,
      keepLocal: true,
      text: () => editor.text(),
      reload: (id, local) => ipc.reload(id, local),
    }).catch(() => null);
    if (result) this.#showReload(session, result);
  }

  /** Puts the recovered text in the editor as one undoable edit, then saves it. The
   * recovery entry is removed only once the restored text is on disk. */
  async restoreRecovered(): Promise<void> {
    const session = this.session;
    const entry = this.recovery;
    if (!session || !entry || !this.editor) return;
    this.recovery = null;
    this.editor.replaceAll(entry.text);
    if (await session.save()) await ipc.settleRecovery(session.id);
  }

  async discardRecovered(): Promise<void> {
    const session = this.session;
    this.recovery = null;
    if (session) await ipc.settleRecovery(session.id);
  }

  /** The commands' view of the workspace. */
  readonly context: CommandContext;

  /** Explicit saves acknowledge the result; autosave remains quiet. */
  async saveNow(): Promise<void> {
    const session = this.session;
    if (!session || this.welcome) return;
    this.typing = false;
    this.checking.clearNote();
    if (session.sample) {
      this.#info("sample-save", copy.save.sample);
      return;
    }
    if (session.readOnly) {
      this.#info("read-only", copy.readOnly(session.name));
      return;
    }
    const saved = await session.save();
    if (this.session === session && !this.welcome && saved && session.state.kind === "saved")
      this.checking.say(copy.save.confirmed);
  }

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the getter below needs the workspace
    const self = this;
    this.context = {
      get view() {
        return self.session && !self.welcome ? (self.editor?.view ?? null) : null;
      },
      newFile: () => void this.newFile(),
      openFile: () => void this.#openWith(ipc.openDialog),
      save: () => void this.saveNow(),
      openSettings: () => this.#togglePanel("settings"),
      openAbout: () => (this.aboutOpen = true),
      openGuide: () => void this.#openWith(ipc.openGuide),
      quit: () => void getCurrentWindow().close(),
      lock: () => this.lock(),
      power: (action) => void this.power(action),
      locked: () => this.locked,
      hasLibrary: () => this.library.ready,
      hasTarget: () => this.#target() !== null,
      newFolder: () => this.newFolder(),
      openFolder: () => void this.openFolder(),
      quickOpen: () => this.#togglePanel("files"),
      findAnything: () => this.#togglePanel(this.lastPanel),
      rename: () => void this.rename(),
      trash: () => void this.trash(),
      commandPalette: () => this.#togglePanel("commands"),
      isOn: (id) => {
        switch (id) {
          case "editor.toggleFocus":
            return settings.values.focus_mode;
          case "editor.toggleTypewriter":
            return settings.values.typewriter_scrolling;
          case "view.toggleMarkdown":
            return settings.values.always_show_markdown;
          case "editor.toggleTransliteration":
            return this.transliteration;
          case "view.fullscreen":
            return this.fullscreen;
          case "check.toggleSpelling":
            return settings.values.check_spelling;
          case "check.toggleGrammar":
            return settings.values.check_grammar;
        }
      },
      showSuggestions: () => void this.checking.atCaret(),
      nextIssue: (direction) => void this.checking.next(direction),
      toggleSpelling: () => void settings.set({ check_spelling: !settings.values.check_spelling }),
      toggleGrammar: () => void settings.set({ check_grammar: !settings.values.check_grammar }),
      toggleFocus: () => void settings.set({ focus_mode: !settings.values.focus_mode }),
      toggleTypewriter: () =>
        void settings.set({ typewriter_scrolling: !settings.values.typewriter_scrolling }),
      toggleMarkdown: () =>
        void settings.set({ always_show_markdown: !settings.values.always_show_markdown }),
      toggleTransliteration: () => {
        const view = this.editor?.view;
        if (!view) return;
        toggleTransliteration(view);
        this.transliteration = view.state.field(transliterationOn);
        void this.#menu?.sync();
      },
      changeTextSize: (step) => {
        const next =
          step === 0 ? 1 : clampScale(settings.values.text_scale + step * TEXT_SCALE.step);
        void settings.set({ text_scale: next });
      },
      cycleTheme: () => {
        const next =
          THEMES[(THEMES.indexOf(settings.values.theme) + 1) % THEMES.length] ?? "system";
        void settings.set({ theme: next });
      },
      toggleFullscreen: () => {
        this.fullscreen = !this.fullscreen;
        void getCurrentWindow().setFullscreen(this.fullscreen);
        void this.#menu?.sync();
      },
    };
  }
}

export const workspace = new Workspace();
