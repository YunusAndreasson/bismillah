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
  /** The bundled specimen (test mode); edits are never saved. */
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
}

/** Narrows a rejected `invoke` to a typed error. */
export function isError<E extends { kind: string }>(value: unknown): value is E {
  return typeof value === "object" && value !== null && "kind" in value;
}

export const appInfo = () => invoke<AppInfo>("app_info");
export const startup = () => invoke<Startup>("startup");
export const openDialog = () => invoke<OpenedDocument | null>("doc_open_dialog");
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
