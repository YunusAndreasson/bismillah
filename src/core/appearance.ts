/** Theme and writing-profile switches on the root element (DESIGN.md §8.3, §9.1). */

export type Theme = "system" | "light" | "dark";
/** "custom": a font installed on the system, chosen by name (DESIGN.md §8.2). */
export type Profile = "duo" | "serif" | "plex-arabic" | "amiri" | "custom";

export function setTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function setProfile(profile: Profile): void {
  document.documentElement.dataset.profile = profile;
}

/** The custom profile's font, as a CSS string; "" falls back to Bismillah Duo. Set only
 * for an installed font (the workspace asks Rust): WebKitGTK draws an unknown family in
 * a substitute rather than falling back. Rust refuses names with quotes or backslashes,
 * so the string can't end early. */
export function setCustomFont(name: string): void {
  const root = document.documentElement.style;
  if (name) root.setProperty("--custom-font", `"${name}"`);
  else root.removeProperty("--custom-font");
}

/** High contrast: black and white, over any colour theme (tokens.css). */
export function setHighContrast(on: boolean): void {
  if (on) document.documentElement.dataset.contrast = "high";
  else delete document.documentElement.dataset.contrast;
}

/** How faint Zuhd mode draws the text outside the focus (DESIGN.md §11.1). */
export function setFocusDimming(dimming: "quiet" | "faint"): void {
  document.documentElement.dataset.focusDimming = dimming;
}

/** Loads every bundled face so the first measurement uses the real fonts. */
export async function loadFonts(): Promise<void> {
  await Promise.all([...document.fonts].map((face) => face.load().catch(() => face)));
  await document.fonts.ready;
}
