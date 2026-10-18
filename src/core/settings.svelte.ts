import { setProfile, setTheme, type Profile, type Theme } from "./appearance.ts";
import {
  isError,
  settingsGet,
  settingsReload,
  settingsSet,
  type SaveError,
  type SettingsNotice,
  type SettingsSnapshot,
  type SettingValue,
} from "./ipc.ts";
import type { FocusGranularity } from "../editor/zuhd.ts";

/**
 * The writer's settings (ARCHITECTURE.md §9). Rust owns `settings.toml` and validates
 * every value; this mirrors them for the UI and applies the appearance ones.
 */

export type Measure = "narrow" | "standard" | "wide";
export type EnglishDialect = "british" | "american" | "canadian" | "australian" | "indian";

export interface Settings {
  theme: Theme;
  writing_profile: Profile;
  /** Multiplies the profile's writing size (Mod-= / Mod-- / Mod-0). */
  text_scale: number;
  measure: Measure;
  /** Overrides the profile's line height; null keeps the profile's. */
  line_height: number | null;
  fade_chrome: boolean;
  basmallah_opening: boolean;
  smart_punctuation: boolean;
  typewriter_scrolling: boolean;
  /** Every Markdown mark visible, as in Phase 1 (ADR-0012); off: live preview. */
  always_show_markdown: boolean;
  focus_mode: boolean;
  focus_granularity: FocusGranularity;
  check_spelling: boolean;
  check_grammar: boolean;
  english_dialect: EnglishDialect;
}

export const DEFAULTS: Settings = {
  theme: "system",
  writing_profile: "duo",
  text_scale: 1,
  measure: "standard",
  line_height: null,
  fade_chrome: true,
  basmallah_opening: true,
  smart_punctuation: true,
  typewriter_scrolling: true,
  always_show_markdown: false,
  focus_mode: false,
  focus_granularity: "paragraph",
  check_spelling: true,
  check_grammar: true,
  english_dialect: "british",
};

export const TEXT_SCALE = { min: 0.5, max: 3, step: 0.1 } as const;
export const LINE_HEIGHT = { min: 1.2, max: 3, step: 0.1 } as const;
/** Each profile's own line height (src/styles/profiles.css), shown when not overridden. */
export const PROFILE_LINE_HEIGHT: Record<Profile, number> = {
  duo: 1.6,
  serif: 1.6,
  amiri: 1.8,
  "plex-arabic": 1.7,
};

export function clampLineHeight(n: number): number {
  return round(Math.min(LINE_HEIGHT.max, Math.max(LINE_HEIGHT.min, n)));
}

const MEASURE_SCALE: Record<Measure, number> = { narrow: 0.85, standard: 1, wide: 1.15 };

/** Takes Rust's validated values, falling back to defaults for anything unexpected. */
export function fromSnapshot(values: Record<string, SettingValue>): Settings {
  const out: Settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const value = values[key];
    const fallback = DEFAULTS[key];
    if (
      key === "line_height"
        ? value === null || typeof value === "number"
        : typeof value === typeof fallback
    ) {
      (out as unknown as Record<string, SettingValue>)[key] = value ?? null;
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function clampScale(n: number): number {
  return round(Math.min(TEXT_SCALE.max, Math.max(TEXT_SCALE.min, n)));
}

/** Applies the appearance settings to the document root (CSSOM only, for the CSP). */
export function applyAppearance(s: Settings): void {
  setTheme(s.theme);
  setProfile(s.writing_profile);
  const root = document.documentElement.style;
  root.setProperty("--doc-scale", String(s.text_scale));
  root.setProperty("--measure-scale", String(MEASURE_SCALE[s.measure]));
  if (s.line_height === null) root.removeProperty("--doc-line");
  else root.setProperty("--doc-line", String(s.line_height));
}

class SettingsStore {
  values = $state<Settings>({ ...DEFAULTS });
  notices = $state<SettingsNotice[]>([]);
  /** Set when the last change couldn't be written to settings.toml. */
  notSaved = $state<SaveError | null>(null);

  #take(snapshot: SettingsSnapshot): void {
    this.values = fromSnapshot(snapshot.values);
    this.notices = snapshot.notices;
  }

  async load(): Promise<void> {
    this.#take(await settingsGet());
  }

  /** Re-reads settings.toml if it changed outside the app. True if it did. */
  async reload(): Promise<boolean> {
    const snapshot = await settingsReload();
    if (!snapshot) return false;
    this.#take(snapshot);
    return true;
  }

  /** Applies a change at once and persists it; a failed write stays visible. */
  async set(patch: Partial<Settings>): Promise<void> {
    this.values = { ...this.values, ...patch };
    try {
      const snapshot = await settingsSet(patch as Record<string, SettingValue>);
      this.values = fromSnapshot(snapshot.values);
      this.notSaved = null;
    } catch (error) {
      if (isError<{ kind: string; error?: SaveError }>(error) && error.kind === "not_saved") {
        this.notSaved = error.error ?? { kind: "other", detail: "unknown" };
      } else {
        // A rejected value is a bug in the UI; the file keeps its last good state.
        console.error("bismillah: a setting was refused", error);
      }
    }
  }
}

export const settings = new SettingsStore();
