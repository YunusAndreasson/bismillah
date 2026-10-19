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

/** The families the first screen sets text in, by writing profile: the profile's own,
 * Mono for code, and Amiri for Arabic and the Basmallah (DESIGN.md §8.2). */
const FIRST_FAMILIES: Record<Profile, readonly string[]> = {
  duo: ["Bismillah Duo", "Bismillah Mono", "Amiri"],
  custom: ["Bismillah Duo", "Bismillah Mono", "Amiri"],
  serif: ["Source Serif 4", "Bismillah Mono", "Amiri"],
  amiri: ["Amiri", "Bismillah Duo", "Bismillah Mono"],
  "plex-arabic": ["IBM Plex Sans Arabic", "Bismillah Duo", "Bismillah Mono"],
};

/**
 * Loads the upright faces the first screen uses, so its first measurement uses the real
 * fonts. Loading all sixteen, 5.6 MB, would hold up every launch (ARCHITECTURE.md §14);
 * `loadOtherFonts` loads the rest once the window is ready.
 */
export async function loadFonts(profile: Profile): Promise<void> {
  const families = FIRST_FAMILIES[profile];
  const first = [...document.fonts].filter(
    (face) => face.style === "normal" && families.includes(face.family.replace(/^["']|["']$/g, "")),
  );
  await Promise.all(first.map((face) => face.load().catch(() => face)));
}

/**
 * Loads every other bundled face (italics, the other profiles' fonts, Amiri Quran), so
 * the first italic or Qur'anic run the writer types never waits for its font, invisible,
 * and moves the line when it arrives. The editor measures again once they are in
 * (`loadingdone`).
 */
export async function loadOtherFonts(): Promise<void> {
  await Promise.all([...document.fonts].map((face) => face.load().catch(() => face)));
}
