import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { createEditor, type Editor } from "../editor/setup.ts";
import { remeasure } from "../editor/typography.ts";
import { toggleTransliteration, transliterationOn } from "../editor/typingAids.ts";
import { countWords } from "../editor/wordCount.ts";
import { COMMANDS, runCommand, type CommandContext } from "./commands.ts";
import { copy, when } from "./copy.ts";
import * as ipc from "./ipc.ts";
import { isError, type OpenedDocument, type OpenError, type SaveError } from "./ipc.ts";
import { keyOf, normalise } from "./keys.ts";
import type { NativeMenu } from "./menu.ts";
import { DocumentSession } from "./session.svelte.ts";
import {
  applyAppearance,
  clampScale,
  settings,
  TEXT_SCALE,
  type Settings,
} from "./settings.svelte.ts";
import type { Theme } from "./appearance.ts";

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

/** How long quitting waits for a save before leaving the text to recovery. */
const QUIT_TIMEOUT_MS = 4000;
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
  settingsOpen = $state(false);
  recovery = $state<ipc.RecoveryEntry | null>(null);
  pending = $state<ipc.PendingRecovery[]>([]);
  infos = $state<Notice[]>([]);
  testMode = false;

  #host: HTMLElement | null = null;
  #menu: NativeMenu | null = null;
  #wordTimer: ReturnType<typeof setTimeout> | undefined;
  #onChange: (() => void) | null = null;

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
        message: copy.conflict(name),
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
        message: copy.removed(name),
        actions: [
          { label: copy.actions.saveAgain, run: () => session.save(true), primary: true },
          { label: copy.actions.saveElsewhere, run: () => this.saveAs() },
        ],
      };
    }
    return {
      id: "failure",
      tone: "error",
      message: copy.failure(name, error),
      actions: [
        { label: copy.actions.tryAgain, run: () => session.save(), primary: true },
        { label: copy.actions.saveElsewhere, run: () => this.saveAs() },
      ],
    };
  }

  #info(id: string, message: string): void {
    const notice: Notice = {
      id,
      tone: "info",
      message,
      actions: [
        {
          label: copy.actions.dismiss,
          run: () => (this.infos = this.infos.filter((n) => n !== notice)),
        },
      ],
    };
    this.infos = [...this.infos.filter((n) => n.id !== id), notice];
  }

  /** Starts the window: settings, the first document or screen, menus and events. */
  async start(
    host: HTMLElement,
    menu: (context: CommandContext) => Promise<NativeMenu>,
  ): Promise<void> {
    this.#host = host;
    const [info] = await Promise.all([ipc.appInfo(), settings.load()]);
    this.testMode = info.test_mode;
    applyAppearance(settings.values);
    const first = await ipc.startup();
    if (first.kind === "document") {
      this.#show(first.document);
      // Other files' recovered text is mentioned at launch only, never on every open.
      this.pending = first.document.pending_recovery;
    } else {
      this.#showWelcome();
      if (first.kind === "welcome") this.pending = first.pending_recovery;
      else this.#info("open-failed", copy.openFailed(first.name, first.error));
    }
    this.#menu = await menu(this.context);
    this.#listen();
  }

  #listen(): void {
    const appWindow = getCurrentWindow();
    void listen<string>("open-requested", () => void this.#openWith(ipc.openRequested));
    void appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) void this.checkOnFocus();
      else void this.session?.flush();
    });
    void appWindow.onCloseRequested(async () => {
      // Flush first; on timeout or failure the text is already in recovery.
      await Promise.race([
        this.session?.flush(),
        new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS)),
      ]);
    });
    // Shortcuts while focus is outside the editor (the first screen, Settings).
    window.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || this.editor?.view.hasFocus) return;
      const key = keyOf(event);
      const command = COMMANDS.find((c) => normalise(c.key) === key && c.section !== "Edit");
      if (command && runCommand(command.id, "keymap", this.context)) event.preventDefault();
    });
    window.addEventListener("mousemove", () => (this.typing = false));
  }

  /** When the window regains focus: settings edited elsewhere apply, and the file is
   * checked for changes made by another program (no polling, ARCHITECTURE.md §5.4). */
  async checkOnFocus(): Promise<void> {
    if (await settings.reload()) this.applySettings(settings.values);
    const session = this.session;
    if (!session?.saveable) return;
    const status = await ipc.checkDisk(session.id).catch(() => "unchanged" as const);
    if (status === "changed" && !session.dirty && session.state.kind !== "failed") {
      // No local edits: take the new version quietly (ARCHITECTURE.md §5.4).
      const opened = await ipc.reload(session.id, null).catch(() => null);
      if (opened && this.session === session) this.#show(opened, { quiet: true });
    } else if (status === "changed" || status === "removed") {
      // Local edits: never overwrite. Saving now surfaces the conflict.
      session.state = {
        kind: "failed",
        error: { kind: status === "changed" ? "conflict" : "removed" },
      };
    }
  }

  /** Shows a newly opened document (replacing the current one, already flushed). */
  #show(opened: OpenedDocument, options: { quiet?: boolean } = {}): void {
    this.session?.dispose();
    this.welcome = false;
    const existing = this.editor;
    const editor = existing ?? this.#createEditor(opened.text, opened.read_only);
    if (existing && options.quiet) editor.reloadQuietly(opened.text);
    else if (existing) editor.load(opened.text, opened.read_only);
    const session = new DocumentSession(opened, () => editor.text(), {
      save: (id, text, revision, force) => ipc.saveDocument(id, text, revision, force),
    });
    this.#onChange = () => {
      session.edited();
      this.typing = true;
      this.#countWords();
    };
    this.session = session;
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
    this.#countWords(0);
    void this.#setTitle(opened.name);
    if (!options.quiet) editor.view.focus();
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

  #createEditor(text: string, readOnly: boolean): Editor {
    if (!this.#host) throw new Error("the workspace has not started");
    const keys = Prec.high(
      keymap.of(
        COMMANDS.map((c) => ({ key: c.key, run: () => runCommand(c.id, "keymap", this.context) })),
      ),
    );
    this.editor = createEditor({
      parent: this.#host,
      doc: text,
      readOnly,
      steadyCaret: this.testMode,
      keys,
      config: this.#editorConfig(settings.values),
      onChange: () => this.#onChange?.(),
    });
    return this.editor;
  }

  #editorConfig(s: Settings) {
    return {
      basmallah: s.basmallah_opening,
      typewriter: s.typewriter_scrolling,
      zuhd: s.focus_mode,
      focusGranularity: s.focus_granularity,
      smartPunctuation: s.smart_punctuation,
    };
  }

  /** Applies settings to the page and the editor, and remeasures typography. */
  applySettings(s: Settings): void {
    applyAppearance(s);
    if (this.editor) {
      this.editor.configure(this.#editorConfig(s));
      const view = this.editor.view;
      void document.fonts.ready.then(() => remeasure(view));
    }
    void this.#menu?.sync();
  }

  #countWords(delay = WORD_COUNT_DELAY_MS): void {
    clearTimeout(this.#wordTimer);
    this.#wordTimer = setTimeout(() => {
      this.words = this.editor ? countWords(this.editor.text()) : 0;
    }, delay);
  }

  async #setTitle(name: string | null): Promise<void> {
    document.title = name ? `${name} — bismillah` : "bismillah";
    await getCurrentWindow().setTitle(document.title);
  }

  /** Saves the current document, then opens what `open` returns (null: cancelled). */
  async #openWith(open: () => Promise<OpenedDocument | null>): Promise<void> {
    await this.session?.flush();
    try {
      const opened = await open();
      if (opened) this.#show(opened);
    } catch (error) {
      if (isError<OpenError>(error)) this.#info("open-failed", copy.openFailed("the file", error));
    }
  }

  openRecovered(token: number): Promise<void> {
    return this.#openWith(() => ipc.openRecovered(token));
  }

  async newFile(): Promise<void> {
    await this.session?.flush();
    try {
      const opened = await ipc.newDialog();
      if (opened) this.#show(opened);
    } catch (error) {
      if (isError<SaveError>(error)) this.#info("new-failed", copy.newFailed(error));
    }
  }

  /** "Save mine as…" / "Save elsewhere…": the text goes to a file the writer chooses. */
  async saveAs(): Promise<void> {
    const session = this.session;
    if (!session || !this.editor) return;
    try {
      const opened = await ipc.saveAs(session.id, this.editor.text());
      if (opened) this.#show(opened);
    } catch (error) {
      if (isError<SaveError>(error)) session.state = { kind: "failed", error };
    }
  }

  /** "Load theirs": the writer's version is kept in recovery, then the file reloads. */
  async loadTheirs(): Promise<void> {
    const session = this.session;
    if (!session || !this.editor) return;
    const opened = await ipc.reload(session.id, this.editor.text()).catch(() => null);
    if (opened) this.#show(opened);
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

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the getter below needs the workspace
    const self = this;
    this.context = {
      get view() {
        return self.editor?.view ?? null;
      },
      newFile: () => void this.newFile(),
      openFile: () => void this.#openWith(ipc.openDialog),
      save: () => {
        this.typing = false;
        void this.session?.save();
      },
      openSettings: () => (this.settingsOpen = true),
      quit: () => void getCurrentWindow().close(),
      isOn: (id) => {
        switch (id) {
          case "editor.toggleFocus":
            return settings.values.focus_mode;
          case "editor.toggleTypewriter":
            return settings.values.typewriter_scrolling;
          case "editor.toggleTransliteration":
            return this.transliteration;
          case "view.fullscreen":
            return this.fullscreen;
        }
      },
      toggleFocus: () => void settings.set({ focus_mode: !settings.values.focus_mode }),
      toggleTypewriter: () =>
        void settings.set({ typewriter_scrolling: !settings.values.typewriter_scrolling }),
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
