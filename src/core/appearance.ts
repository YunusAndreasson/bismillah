/** Theme and writing-profile switches on the root element (DESIGN.md §8.3, §9.1). */

export type Theme = "system" | "light" | "dark";
export type Profile = "duo" | "serif" | "plex-arabic" | "amiri";

export const PROFILES: readonly Profile[] = ["duo", "serif", "plex-arabic", "amiri"];

export function setTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function setProfile(profile: Profile): void {
  document.documentElement.dataset.profile = profile;
}

/** Loads every bundled face so the first measurement uses the real fonts. */
export async function loadFonts(): Promise<void> {
  await Promise.all([...document.fonts].map((face) => face.load().catch(() => face)));
  await document.fonts.ready;
}
