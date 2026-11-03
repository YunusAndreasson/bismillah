import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Theme } from "./appearance.ts";
import { windowEdited } from "./ipc.ts";
import { onMac } from "./keys.ts";

/*
 * macOS's own window cues, kept in step with the page (DESIGN.md §7). Elsewhere these do
 * nothing: Linux keeps its native decorations as they are.
 */

/** A computed CSS colour ("rgb(247, 246, 242)") as Tauri's colour; null if it isn't one. */
export function rgb(css: string): [number, number, number] | null {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * The traffic lights follow the writer's theme, and the window is the page's colour,
 * colour themes and high contrast included, so a resize never shows another.
 */
export function matchWindow(theme: Theme): void {
  if (!onMac()) return;
  const window = getCurrentWebviewWindow();
  void window.setTheme(theme === "system" ? null : theme).catch(() => {});
  const page = rgb(getComputedStyle(document.body).backgroundColor);
  if (page) void window.setBackgroundColor(page).catch(() => {});
}

let shownEdited = false;

/** The close button's dot: shown while changes aren't on disk, as on every Mac. */
export function showEdited(edited: boolean): void {
  if (!onMac() || edited === shownEdited) return;
  shownEdited = edited;
  void windowEdited(edited).catch(() => {});
}

/**
 * Calls `changed` when the window enters or leaves fullscreen, by any control, once the
 * transition's resizing has settled.
 */
export function watchFullscreen(changed: (fullscreen: boolean) => void): void {
  if (!onMac()) return;
  const window = getCurrentWindow();
  let shown: boolean | null = null;
  let settle: ReturnType<typeof setTimeout> | undefined;
  void window.onResized(() => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      void window.isFullscreen().then((fullscreen) => {
        if (fullscreen === shown) return;
        shown = fullscreen;
        changed(fullscreen);
      });
    }, 300);
  });
}
