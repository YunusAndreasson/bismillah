import type { Theme } from "./appearance.ts";
import { themesList, type ColourTheme, type ThemeVariant } from "./ipc.ts";

/**
 * Colour themes (ARCHITECTURE.md §8, ADR-0005). Rust reads and checks the theme files
 * (src-tauri/src/themes.rs); this lists them for Settings and applies the chosen one's
 * tokens, for the variant on screen, over the stylesheet's (tokens.css). High contrast
 * overrides any theme, and "bismillah" is the stylesheet's own colours.
 */

export const DEFAULT_THEME = "bismillah";

class ColourThemes {
  list = $state<ColourTheme[]>([]);
  truncated = $state(false);
  /** The list has been read at least once (a missing theme is only reported then). */
  loaded = $state(false);

  async load(): Promise<void> {
    const result = await themesList();
    this.list = result.themes;
    this.truncated = result.truncated;
    this.loaded = true;
  }

  /** The usable theme with this id; built-in themes come first, so they win a tie. */
  find(id: string): ColourTheme | undefined {
    return this.list.find((t) => t.id === id && t.usable);
  }
}

export const colourThemes = new ColourThemes();

/** Which variant is on screen: the writer's choice, or the system's under System. */
export function variantShown(mode: Theme): ThemeVariant {
  if (mode !== "system") return mode;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The tokens set on the root element by the last `applyColours`, to take off again. */
let applied: string[] = [];

/**
 * Sets the chosen theme's tokens on the root element (CSSOM only, for the CSP); none
 * for bismillah's own colours, under high contrast, or for a theme without colours for
 * the variant on screen (its other variant is the stylesheet's).
 */
export function applyColours(
  choice: { theme: Theme; colour_theme: string; high_contrast: boolean },
  theme: ColourTheme | undefined = colourThemes.find(choice.colour_theme),
): void {
  const root = document.documentElement.style;
  for (const name of applied) root.removeProperty(`--${name}`);
  applied = [];
  if (choice.high_contrast || !theme) return;
  const tokens = theme[variantShown(choice.theme)] ?? {};
  for (const [name, value] of Object.entries(tokens)) {
    root.setProperty(`--${name}`, value);
    applied.push(name);
  }
}

/** Calls `changed` when the system switches between light and dark. */
export function onSystemScheme(changed: () => void): void {
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", changed);
}
