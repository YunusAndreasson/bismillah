import { invoke } from "@tauri-apps/api/core";

/** Typed bridge to the Rust commands in src-tauri/src/lib.rs (ARCHITECTURE.md §4). */

export interface InitialDocument {
  name: string;
  text: string;
}

export interface AppInfo {
  test_mode: boolean;
}

export function initialDocument(): Promise<InitialDocument> {
  return invoke<InitialDocument>("initial_document");
}

export function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}

export interface MenuState {
  visible: boolean;
  active: boolean;
}

export function menuReveal(): Promise<void> {
  return invoke("menu_reveal");
}

export function menuHide(): Promise<void> {
  return invoke("menu_hide");
}

export function menuState(): Promise<MenuState> {
  return invoke<MenuState>("menu_state");
}
