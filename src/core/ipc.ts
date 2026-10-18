import { invoke } from "@tauri-apps/api/core";

/**
 * Typed bridge to the Rust commands in src-tauri/src/app.rs and lib.rs
 * (ARCHITECTURE.md §4). The frontend never sends a path: Rust opens files the writer
 * chose and the frontend refers to the open document by id.
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
  | { kind: "other"; detail: string };

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
export const newDialog = () => invoke<OpenedDocument | null>("doc_new_dialog");
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
