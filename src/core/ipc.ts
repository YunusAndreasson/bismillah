import { invoke } from "@tauri-apps/api/core";

/**
 * Typed bridge to the Rust commands in src-tauri/src/app.rs, app/library_commands.rs
 * and lib.rs (ARCHITECTURE.md §4). The frontend never sends an absolute path: Rust opens
 * files the writer chose and the frontend refers to the open document by id. Inside the
 * library it names entries by their path relative to the library root, `/`-separated,
 * and Rust checks every one (ARCHITECTURE.md §6).
 */

export type LineEnding = "lf" | "crlf" | "cr";

export interface RecoveryEntry {
  text: string;
  saved_at_ms: number;
}

/** Another file with text from an earlier session waiting in recovery. */
export interface PendingRecovery {
  token: number;
  name: string;
  saved_at_ms: number;
}

export interface OpenedDocument {
  id: number;
  /** File name only, never the full path. */
  name: string;
  /** Where the file is in the library; null outside it. */
  library_path: string | null;
  /** The text with `\n` line breaks. */
  text: string;
  line_ending: LineEnding;
  mixed_line_endings: boolean;
  /** The file isn't UTF-8, so it opened for reading only. */
  read_only: boolean;
  /** A document bundled with the app (the guide; the specimen in test mode): edits
   * are never saved. */
  sample: boolean;
  recovery: RecoveryEntry | null;
  pending_recovery: PendingRecovery[];
}

export type SaveError =
  | { kind: "disk_full" }
  | { kind: "read_only_volume" }
  | { kind: "permission_denied" }
  | { kind: "removed" }
  | { kind: "unavailable" }
  | { kind: "conflict" }
  | { kind: "not_utf8" }
  | { kind: "not_a_file" }
  | { kind: "closed" }
  | { kind: "exists" }
  | { kind: "outside" }
  | { kind: "other"; detail: string };

export type OpenError =
  | { kind: "not_found" }
  | { kind: "permission_denied" }
  | { kind: "not_a_file" }
  | { kind: "outside" }
  | { kind: "other"; detail: string };

export type NameProblem = "empty" | "slash" | "dot" | "too_long" | "control";

export type LibraryError =
  | { kind: "outside" }
  | { kind: "invalid_path" }
  | { kind: "invalid_name"; reason: NameProblem }
  | { kind: "not_found" }
  | { kind: "exists" }
  | { kind: "permission_denied" }
  | { kind: "read_only_volume" }
  | { kind: "disk_full" }
  | { kind: "unavailable" }
  | { kind: "other"; detail: string };

export interface LibraryNode {
  name: string;
  /** Relative to the library root, `/`-separated. */
  path: string;
  kind: "folder" | "file";
  /** A link leading outside the library (or round in a loop): shown, never opened. */
  unavailable: boolean;
  children: LibraryNode[];
}

export type LibraryView =
  | { kind: "none" }
  | {
      kind: "ready";
      /** Changes when a different folder becomes the library. */
      generation: number;
      name: string;
      nodes: LibraryNode[];
      truncated: boolean;
      /** Recently opened files in the library, newest first. */
      recent: string[];
      /** The open document's place in the library; null outside it. */
      active: string | null;
    }
  | { kind: "unavailable"; name: string };

export interface LibraryPanel {
  view: LibraryView;
  open: boolean;
}

export interface RenameOutcome {
  path: string;
  document: { name: string; library_path: string | null } | null;
}

export interface TrashOutcome {
  token: number;
  name: string;
  closed: boolean;
}

export interface DocumentChanged {
  id: number;
  status: DiskStatus;
}

export type Startup =
  | { kind: "document"; document: OpenedDocument }
  | { kind: "welcome"; pending_recovery: PendingRecovery[] }
  | { kind: "failed"; name: string; error: OpenError };

export type DiskStatus = "unchanged" | "changed" | "removed";

export interface AppInfo {
  test_mode: boolean;
  pid: number;
  version: string;
  /** Where bismillah keeps its files, as the writer reads them ("~/.config/bismillah"). */
  folders: { config: string; data: string };
  /** On the bismillah stick: what it was built from. Null on the desktop. */
  stick: StickInfo | null;
}

export interface StickInfo {
  commit: string;
  /** The Debian snapshot the system was built from ("20261021T083704Z"). */
  snapshot: string;
}

/** Narrows a rejected `invoke` to a typed error. */
export function isError<E extends { kind: string }>(value: unknown): value is E {
  return typeof value === "object" && value !== null && "kind" in value;
}

export const appInfo = () => invoke<AppInfo>("app_info");
export const startup = () => invoke<Startup>("startup");
export const openDialog = () => invoke<OpenedDocument | null>("doc_open_dialog");
/** Help › Guide: the bundled guide, as a sample that is never saved. */
export const openGuide = () => invoke<OpenedDocument>("doc_open_guide");
/** `folder`: a library folder to start the dialog in. */
export const newDialog = (folder: string | null = null) =>
  invoke<OpenedDocument | null>("doc_new_dialog", { folder });
export const openRequested = () => invoke<OpenedDocument | null>("doc_open_requested");
export const openRecovered = (token: number) =>
  invoke<OpenedDocument>("doc_open_recovered", { token });

/** Resolves with the revision now durably on disk, or rejects with a `SaveError`. */
export const saveDocument = (id: number, text: string, revision: number, force: boolean) =>
  invoke<number>("doc_save", { id, text, revision, force });
export const saveAs = (id: number, text: string) =>
  invoke<OpenedDocument | null>("doc_save_as", { id, text });
export const checkDisk = (id: number) => invoke<DiskStatus>("doc_check", { id });
export const reload = (id: number, localText: string | null) =>
  invoke<OpenedDocument>("doc_reload", { id, localText });
export const settleRecovery = (id: number) => invoke<null>("recovery_settle", { id });

export const libraryGet = (refresh: boolean) => invoke<LibraryPanel>("library_get", { refresh });
export const libraryRememberOpen = (open: boolean) =>
  invoke<null>("library_remember_open", { open });
export const libraryOpenDialog = () => invoke<LibraryView | null>("library_open_dialog");
export const libraryOpenFile = (path: string) =>
  invoke<OpenedDocument>("library_open_file", { path });
/** Resolves with the new folder's path. */
export const libraryNewFolder = (parent: string, name: string) =>
  invoke<string>("library_new_folder", { parent, name });
export const libraryRename = (path: string, name: string) =>
  invoke<RenameOutcome>("library_rename", { path, name });
export const libraryTrash = (path: string) => invoke<TrashOutcome>("library_trash", { path });
/** Resolves with the restored entry's path in the library, if it is in it. */
export const libraryUntrash = (token: number) =>
  invoke<string | null>("library_untrash", { token });

export type SettingValue = string | number | boolean | null;
export type SettingsNotice =
  { kind: "unreadable"; backup: string } | { kind: "invalid_values"; keys: string[] };
export interface SettingsSnapshot {
  values: Record<string, SettingValue>;
  notices: SettingsNotice[];
}
export const settingsGet = () => invoke<SettingsSnapshot>("settings_get");
export const settingsSet = (patch: Record<string, SettingValue>) =>
  invoke<SettingsSnapshot>("settings_set", { patch });
export const settingsReload = () => invoke<SettingsSnapshot | null>("settings_reload");

export type ThemeVariant = "light" | "dark";
/** Something wrong with a theme file (src-tauri/src/themes.rs). */
export type ThemeProblem =
  | { kind: "unreadable"; line: number | null }
  | { kind: "too_large" }
  | { kind: "schema" }
  | { kind: "unknown_key"; key: string }
  | { kind: "wrong_type"; key: string }
  | { kind: "invalid_colour"; key: string; value: string }
  | { kind: "no_colours" }
  | { kind: "same_name" }
  | {
      kind: "contrast";
      variant: ThemeVariant;
      foreground: string;
      background: string;
      ratio: number;
      needed: number;
    };

export interface ColourTheme {
  /** The file's name without its ending: what `colour_theme` holds. */
  id: string;
  name: string;
  builtin: boolean;
  file: string | null;
  /** Token name (without `--`) → colour, for each variant the theme sets. */
  light: Record<string, string> | null;
  dark: Record<string, string> | null;
  usable: boolean;
  problems: ThemeProblem[];
}

export interface ThemeList {
  themes: ColourTheme[];
  truncated: boolean;
}

export const themesList = () => invoke<ThemeList>("themes_list");
/** Whether a font family is installed (fontconfig); null when that can't be asked. */
export const fontInstalled = (family: string) =>
  invoke<boolean | null>("font_installed", { family });

/** One line of keybindings.toml, as Rust read it (src-tauri/src/keybindings.rs). */
export interface KeybindingEntry {
  command: string;
  /** null: the value wasn't text. */
  shortcut: string | null;
  line: number;
}

export interface KeybindingsFile {
  exists: boolean;
  entries: KeybindingEntry[];
  unreadable:
    { kind: "syntax"; line: number | null } | { kind: "too_large" } | { kind: "io" } | null;
}

export const keybindingsGet = () => invoke<KeybindingsFile>("keybindings_get");
/** Writes a starting keybindings.toml; rejects with a SaveError ("exists") if there is one. */
export const keybindingsCreate = (text: string) =>
  invoke<KeybindingsFile>("keybindings_create", { text });

/** Sent when files in the configuration folder change (src-tauri/src/config.rs). */
export interface ConfigChanged {
  settings: boolean;
  keybindings: boolean;
  themes: boolean;
  dictionary: boolean;
}

/** One block of the document for the checker (ARCHITECTURE.md §7.1). Offsets are UTF-16
 * code units relative to the block. */
export interface LintBlock {
  text: string;
  /** Code, URLs and HTML: they stand for words but aren't prose. */
  skip: [number, number][];
  /** Markdown punctuation: `#`, `**`, `[`, `](`… */
  marks: [number, number][];
}

export interface LintRequest {
  /** The editor's revision when the blocks were taken; it comes back with the results. */
  revision: number;
  /** The document's frontmatter `lang:`. */
  lang: string | null;
  blocks: LintBlock[];
}

export interface Diagnostic {
  from_utf16: number;
  to_utf16: number;
  kind: "spelling" | "grammar";
  lang: "en" | "ar";
  /** Harper's explanation of a grammar suggestion; empty for spelling. */
  message: string;
  /** Each the text that would replace the range ("" removes it). Spelling corrections
   * come from `lintSuggest` when the writer asks. */
  suggestions: string[];
  rule_id: string;
}

export interface LintResponse {
  revision: number;
  /** One list per block, in the request's order. */
  blocks: Diagnostic[][];
}

export type AddWordError =
  | { kind: "invalid_word"; reason: "empty" | "not_one_word" | "too_long" }
  | { kind: "not_saved"; error: SaveError };

export const lintCheck = (request: LintRequest) => invoke<LintResponse>("lint_check", { request });
export const lintSuggest = (word: string, lang: Diagnostic["lang"], docLang: string | null) =>
  invoke<string[]>("lint_suggest", { word, lang, docLang });
export const lintAddWord = (word: string) => invoke<null>("lint_add_word", { word });
/** True if `dictionary.txt` changed outside the app since it was last read. */
export const lintRefresh = () => invoke<boolean>("lint_refresh");

/** Test mode only: opens a file by path in place of the native dialog. */
export const testOpen = (path: string) => invoke<OpenedDocument>("test_open", { path });
/** Test mode only: the next native file dialog answers `path` (null: cancelled). */
export const testDialog = (path: string | null) => invoke<null>("test_dialog", { path });
/** Test mode only: makes `path` the library, in place of the folder dialog. */
export const testLibrary = (path: string) => invoke<LibraryView>("test_library", { path });
/** Test mode only: makes every save fail at one step until cleared with null. */
export const testFault = (fault: "disk_full" | "rename_fails" | null) =>
  invoke<null>("test_fault", { fault });

export interface MenuState {
  visible: boolean;
  active: boolean;
}

export const menuReveal = () => invoke<null>("menu_reveal");
export const menuHide = () => invoke<null>("menu_hide");
export const menuState = () => invoke<MenuState>("menu_state");

// The bismillah stick (os/PLAN.md, src-tauri/src/appliance.rs, crates/bismillah-appliance).

/** Why the helper won't read home, or can't tell which partition it is. */
export type Trouble =
  | "foreign"
  | "damaged_header"
  | "unknown_token"
  | "damaged_file_system"
  | "two_sticks"
  | "no_home"
  | "no_boot_disk";

export type Home =
  | { state: "blank" | "initialising" | "ready" | "unlocked" }
  | { state: "unreadable" | "not_found"; reason: Trouble };

export interface HelperKeyboard {
  layouts: string;
  options: string;
  source: "token" | "pending" | "default" | "damaged";
}

export interface GateState {
  home: Home;
  keyboard: HelperKeyboard;
  /** The session restarted for a keyboard change: reopen without the passphrase. */
  resume: boolean;
}

export type HelperAnswer =
  | { answer: "ok" | "wrong_passphrase" | "too_weak" | "invalid_keyboard" | "locked" }
  | { answer: "refused"; state: Home }
  | { answer: "failed"; step: string }
  | { answer: "status"; home: Home; keyboard: HelperKeyboard; resume: boolean };

export type PowerAction = "off" | "reboot" | "suspend";

/** The battery as one: null on a machine without one. */
export interface Battery {
  percent: number;
  charging: boolean;
}

export interface Strength {
  score: number;
  enough: boolean;
  warning: string | null;
}

export interface KeyboardLayout {
  id: string;
  name: string;
}

export interface KeyboardState {
  /** The layouts cage was started with, in group order. */
  layouts: string[];
  /** Their XKB options, such as the switch key ("grp:alt_shift_toggle"). */
  options: string;
  /** The active group, as of the last key press. */
  group: number;
  rtl: boolean;
  caps: boolean;
}

/** Home's state while the app waits for it; null on the desktop or once started. */
export const applianceGate = () => invoke<GateState | null>("appliance_gate");
export const applianceOpen = (
  verb: "setup" | "finish" | "unlock" | "verify" | "resume",
  passphrase: string,
) => invoke<HelperAnswer>("appliance_open", { verb, passphrase });
export const applianceStartOver = () => invoke<HelperAnswer>("appliance_start_over");
/** On success the session restarts, and this page with it. `caret`: where to put the
 * caret in the same document once it has. */
export const applianceSetKeyboard = (
  layouts: string,
  options: string,
  caret: number | null = null,
) => invoke<HelperAnswer>("appliance_set_keyboard", { layouts, options, caret });
/** The caret a keyboard change left, once (null if there is none). */
export const applianceTakeCaret = () => invoke<number | null>("appliance_take_caret");
export const appliancePower = (action: PowerAction) =>
  invoke<HelperAnswer>("appliance_power", { action });
/** The lock view is on screen (the helper's lock handshake). */
export const appliancePainted = () => invoke<null>("appliance_painted");
export const applianceBattery = () => invoke<Battery | null>("appliance_battery");
export const applianceStrength = (passphrase: string) =>
  invoke<Strength>("appliance_strength", { passphrase });
export const applianceGenerate = () => invoke<string>("appliance_generate");
export const applianceLayouts = () => invoke<KeyboardLayout[]>("appliance_layouts");
export const applianceKeyboard = () => invoke<KeyboardState>("appliance_keyboard");
export const applianceMark = (name: string) => invoke("appliance_mark", { name });
