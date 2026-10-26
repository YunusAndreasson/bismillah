import { copy } from "./copy.ts";
import type { ColourTheme } from "./ipc.ts";
import {
  clampLineHeight,
  clampScale,
  DEFAULTS,
  LINE_HEIGHT,
  PROFILE_LINE_HEIGHT,
  TEXT_SCALE,
  type Settings,
} from "./settings.svelte.ts";
import { DEFAULT_THEME } from "./themes.svelte.ts";

/**
 * Every setting, as the Settings panel lists it (DESIGN.md §6, ADR-0016): one row each,
 * in four sections (five on the stick). A switch changes with Enter; a choice or a
 * stepper changes with ← and →, or opens in place with Enter; the rest open in place to
 * show what they hold. The values and the steps are worked out here, apart from the
 * component, so they can be tested.
 */

export type SettingsSection = "appearance" | "writing" | "checking" | "files" | "stick";

export const SECTIONS: readonly SettingsSection[] = [
  "appearance",
  "writing",
  "checking",
  "files",
  "stick",
];

/** Settings whose value is on or off. */
export type SwitchKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

/** What a row needs beyond the settings themselves. */
export interface SettingsContext {
  /** Every colour theme, usable or not (themes.svelte.ts). */
  colours: readonly ColourTheme[];
  stick: boolean;
  /** The library as Settings names it. */
  library: { kind: "none" | "ready" | "unavailable"; name: string | null };
  /** keybindings.toml: how many shortcuts it changes, or why it couldn't be read. */
  shortcuts: { exists: boolean; changed: number; unreadable: boolean; problems: number };
  /** Where bismillah keeps its files, as the writer reads them. */
  folders: { config: string; data: string };
}

export interface Option {
  value: string;
  label: string;
}

interface Base {
  id: string;
  label: string;
  aliases?: readonly string[];
  section: SettingsSection;
  /** One sentence shown under the row while it is highlighted. */
  hint?: (s: Settings, c: SettingsContext) => string | null;
  place?: "desktop" | "stick";
  /** Listed only while this holds (Font name, while Another font is chosen). */
  when?: (s: Settings, c: SettingsContext) => boolean;
}

export type SettingEntry = Base &
  (
    | { kind: "switch"; key: SwitchKey }
    | {
        kind: "choice";
        options: (c: SettingsContext) => Option[];
        get: (s: Settings) => string;
        set: (value: string) => Partial<Settings>;
      }
    | {
        kind: "stepper";
        /** −1 or +1 steps; null at a limit. */
        step: (s: Settings, direction: -1 | 1) => Partial<Settings> | null;
        reset: Partial<Settings>;
        atDefault: (s: Settings) => boolean;
        show: (s: Settings) => string;
      }
    /** The custom font's name, typed in place. */
    | { kind: "fontName" }
    /** The stick's time zone, chosen from a list in place. */
    | { kind: "zone" }
    /** The stick's keyboard layouts, chosen and then applied in place. */
    | { kind: "keyboard" }
    /** keybindings.toml: its state and problems in place, or Create keybindings.toml. */
    | { kind: "shortcuts" }
    /** The library folder: Enter is Open folder… on the desktop. */
    | { kind: "library" }
    /** A sentence to read (where files are kept, privacy): shown as the hint. */
    | { kind: "note"; text: (c: SettingsContext) => string }
    | { kind: "about" }
  );

/** Where a notice's Show in Settings, or a test, opens the Settings panel. */
export interface SettingsTarget {
  /** The row to highlight. */
  row: string;
  /** Open it in place too. */
  open?: boolean;
}

const t = copy.settings;

const choice = <V extends string>(
  values: readonly V[],
  names: Record<V, string>,
): ((c: SettingsContext) => Option[]) => {
  const options = values.map((value) => ({ value, label: names[value] }));
  return () => options;
};

/** A colour theme's name as Settings lists it ("Night ink (dark only)"). A choice that
 * can't be used reads as bismillah's own colours, which are what apply. */
export function colourThemeName(id: string, themes: readonly ColourTheme[]): string {
  const theme = themes.find((th) => th.id === id && th.usable);
  if (id === DEFAULT_THEME || !theme) return copy.themes.builtin;
  const only = !theme.dark ? copy.themes.lightOnly : !theme.light ? copy.themes.darkOnly : null;
  return only ? `${theme.name} (${only})` : theme.name;
}

const lineHeight = (s: Settings) => s.line_height ?? PROFILE_LINE_HEIGHT[s.writing_profile];

const ENTRIES: readonly SettingEntry[] = [
  // Appearance
  {
    id: "theme",
    kind: "choice",
    label: t.theme,
    aliases: ["dark", "light", "system", "appearance"],
    section: "appearance",
    options: choice(["system", "light", "dark"], t.themes),
    get: (s) => s.theme,
    set: (v) => ({ theme: v as Settings["theme"] }),
  },
  {
    id: "colours",
    kind: "choice",
    label: t.colours,
    aliases: ["colour theme", "color", "palette"],
    section: "appearance",
    options: (c) => {
      const out: Option[] = [{ value: DEFAULT_THEME, label: copy.themes.builtin }];
      for (const theme of c.colours)
        if (theme.usable && !out.some((o) => o.value === theme.id))
          out.push({ value: theme.id, label: colourThemeName(theme.id, c.colours) });
      return out;
    },
    get: (s) => s.colour_theme,
    set: (v) => ({ colour_theme: v }),
  },
  {
    id: "contrast",
    kind: "switch",
    label: t.highContrast,
    aliases: ["black and white", "accessibility"],
    section: "appearance",
    key: "high_contrast",
    hint: () => t.highContrastHint,
  },
  {
    id: "font",
    kind: "choice",
    label: t.font,
    aliases: ["typeface", "family", "amiri", "serif"],
    section: "appearance",
    options: (c) =>
      choice(c.stick ? ["duo", "serif", "amiri"] : ["duo", "serif", "amiri", "custom"], t.fonts)(c),
    get: (s) => s.writing_profile,
    set: (v) => ({ writing_profile: v as Settings["writing_profile"] }),
    hint: () => t.fontHint,
  },
  {
    id: "fontName",
    kind: "fontName",
    label: t.customFont,
    aliases: ["typeface", "family", "another font"],
    section: "appearance",
    place: "desktop",
    when: (s) => s.writing_profile === "custom",
  },
  {
    id: "size",
    kind: "stepper",
    label: t.textSize,
    aliases: ["zoom", "font size", "bigger", "smaller"],
    section: "appearance",
    step: (s, d) => {
      const next = clampScale(s.text_scale + d * TEXT_SCALE.step);
      return next === s.text_scale ? null : { text_scale: next };
    },
    reset: { text_scale: DEFAULTS.text_scale },
    atDefault: (s) => s.text_scale === DEFAULTS.text_scale,
    show: (s) => `${Math.round(s.text_scale * 100)}%`,
  },
  {
    id: "measure",
    kind: "choice",
    label: t.measure,
    aliases: ["width", "column", "measure"],
    section: "appearance",
    options: choice(["narrow", "standard", "wide"], t.measures),
    get: (s) => s.measure,
    set: (v) => ({ measure: v as Settings["measure"] }),
  },
  {
    id: "line",
    kind: "stepper",
    label: t.lineHeight,
    aliases: ["leading", "spacing"],
    section: "appearance",
    step: (s, d) => {
      const now = lineHeight(s);
      const next = clampLineHeight(now + d * LINE_HEIGHT.step);
      return next === now ? null : { line_height: next };
    },
    reset: { line_height: null },
    atDefault: (s) => s.line_height === null,
    show: (s) =>
      s.line_height === null
        ? `${lineHeight(s).toFixed(1)} (${t.fontDefault})`
        : s.line_height.toFixed(1),
  },
  {
    id: "fade",
    kind: "switch",
    label: t.fadeChrome,
    aliases: ["status", "chrome", "quiet"],
    section: "appearance",
    key: "fade_chrome",
  },
  {
    id: "basmallah",
    kind: "switch",
    label: t.basmallah,
    aliases: ["bismillah", "opening", "بسملة"],
    section: "appearance",
    key: "basmallah_opening",
    hint: () => t.basmallahHint,
  },
  // Writing
  {
    id: "smart",
    kind: "switch",
    label: t.smartPunctuation,
    aliases: ["quotes", "dashes", "typography"],
    section: "writing",
    key: "smart_punctuation",
    hint: () => t.smartPunctuationHint,
  },
  {
    id: "typewriter",
    kind: "switch",
    label: t.typewriter,
    aliases: ["centre", "center", "scroll"],
    section: "writing",
    key: "typewriter_scrolling",
    hint: () => t.typewriterHint,
  },
  {
    id: "markdown",
    kind: "switch",
    label: t.alwaysShowMarkdown,
    aliases: ["markup", "source", "live preview", "rendered", "marks", "syntax"],
    section: "writing",
    key: "always_show_markdown",
    hint: () => t.alwaysShowMarkdownHint,
  },
  {
    id: "zuhd",
    kind: "switch",
    label: t.zuhd,
    aliases: ["focus", "distraction-free", "زهد"],
    section: "writing",
    key: "focus_mode",
    hint: () => t.zuhdHint,
  },
  {
    id: "focusOn",
    kind: "choice",
    label: t.focusOn,
    aliases: ["zuhd", "sentence", "paragraph", "focus"],
    section: "writing",
    options: choice(["sentence", "paragraph"], t.granularities),
    get: (s) => s.focus_granularity,
    set: (v) => ({ focus_granularity: v as Settings["focus_granularity"] }),
  },
  {
    id: "dimming",
    kind: "choice",
    label: t.focusDimming,
    aliases: ["zuhd", "faint", "quiet", "focus"],
    section: "writing",
    options: choice(["quiet", "faint"], t.dimmings),
    get: (s) => s.focus_dimming,
    set: (v) => ({ focus_dimming: v as Settings["focus_dimming"] }),
    hint: () => t.focusDimmingHint,
  },
  // Language & checking
  {
    id: "spelling",
    kind: "switch",
    label: t.spelling,
    aliases: ["dictionary", "mistakes", "arabic"],
    section: "checking",
    key: "check_spelling",
    hint: () => t.spellingHint,
  },
  {
    id: "grammar",
    kind: "switch",
    label: t.grammar,
    aliases: ["harper", "underline"],
    section: "checking",
    key: "check_grammar",
    hint: () => t.grammarHint,
  },
  {
    id: "dialect",
    kind: "choice",
    label: t.dialect,
    aliases: ["british", "american", "language", "dictionary"],
    section: "checking",
    options: choice(["british", "american", "canadian", "australian", "indian"], t.dialects),
    get: (s) => s.english_dialect,
    set: (v) => ({ english_dialect: v as Settings["english_dialect"] }),
    hint: () => t.dialectHint,
  },
  // Files & privacy
  {
    id: "library",
    kind: "library",
    label: t.library,
    aliases: ["folder", "directory", "open folder"],
    section: "files",
  },
  {
    id: "shortcuts",
    kind: "shortcuts",
    label: copy.shortcuts.title,
    aliases: ["keybindings", "keys"],
    section: "files",
    place: "desktop",
  },
  {
    id: "yourFiles",
    kind: "note",
    label: t.yourFiles,
    aliases: ["config", "settings.toml", "folder"],
    section: "files",
    place: "desktop",
    text: (c) => t.yourFilesText(c.folders.config),
  },
  {
    id: "recovery",
    kind: "note",
    label: t.recovery,
    aliases: ["recovery", "backup", "lost"],
    section: "files",
    text: (c) => t.recoveryText(c.folders.data),
  },
  {
    id: "privacy",
    kind: "note",
    label: t.privacy,
    aliases: ["network", "offline", "data"],
    section: "files",
    text: (c) => (c.stick ? t.stick.privacyText : t.privacyText),
  },
  {
    id: "about",
    kind: "about",
    label: t.about,
    aliases: ["version", "licence", "license", "credits", "inspiration"],
    section: "files",
  },
  // This stick
  {
    id: "keyboard",
    kind: "keyboard",
    label: t.stick.keyboard,
    aliases: ["layout", "arabic"],
    section: "stick",
    place: "stick",
    hint: () => t.stick.keyboardHint,
  },
  {
    id: "zone",
    kind: "zone",
    label: t.stick.timeZone,
    aliases: ["clock", "time"],
    section: "stick",
    place: "stick",
  },
  {
    id: "localClock",
    kind: "switch",
    label: t.stick.localClock,
    aliases: ["clock", "time", "windows"],
    section: "stick",
    place: "stick",
    key: "clock_keeps_local_time",
    hint: () => t.stick.localClockHint,
  },
];

/** Every row, in both places (for the catalogue's own tests). */
export const ALL_SETTING_ENTRIES = ENTRIES;

/** The rows for this place and these settings, in order. */
export function settingEntries(s: Settings, c: SettingsContext): SettingEntry[] {
  return ENTRIES.filter(
    (e) => e.place !== (c.stick ? "desktop" : "stick") && (!e.when || e.when(s, c)),
  );
}

/** The value shown at a row's end: On or Off, the choice, the size, the folder. */
export function shownValue(entry: SettingEntry, s: Settings, c: SettingsContext): string {
  switch (entry.kind) {
    case "switch":
      return s[entry.key] ? copy.panels.on : copy.panels.off;
    case "choice": {
      if (entry.id === "colours") return colourThemeName(s.colour_theme, c.colours);
      if (entry.id === "font" && s.writing_profile === "custom" && s.custom_font !== "")
        return s.custom_font;
      const value = entry.get(s);
      return entry.options(c).find((o) => o.value === value)?.label ?? value;
    }
    case "stepper":
      return entry.show(s);
    case "fontName":
      return s.custom_font || copy.panels.noneYet;
    case "zone":
      return (s.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone).replaceAll("_", " ");
    case "library":
      return c.library.kind === "none" ? t.libraryNone : (c.library.name ?? "");
    case "shortcuts":
      if (c.shortcuts.unreadable) return copy.panels.shortcuts.unreadable;
      if (!c.shortcuts.exists) return copy.panels.shortcuts.none;
      return c.shortcuts.problems > 0
        ? copy.panels.shortcuts.problems(c.shortcuts.problems)
        : copy.panels.shortcuts.changed(c.shortcuts.changed);
    case "keyboard":
    case "note":
    case "about":
      return "";
  }
}

/** ← and →: the previous or next choice, or a step down or up; null at an end or for a
 * row that has no such value. */
export function adjust(
  entry: SettingEntry,
  s: Settings,
  c: SettingsContext,
  direction: -1 | 1,
): Partial<Settings> | null {
  if (entry.kind === "stepper") return entry.step(s, direction);
  if (entry.kind !== "choice") return null;
  const options = entry.options(c);
  const at = options.findIndex((o) => o.value === entry.get(s));
  const next = options[at + direction];
  return next ? entry.set(next.value) : null;
}

/** Whether ← and → change the row. */
export const adjustable = (entry: SettingEntry): boolean =>
  entry.kind === "choice" || entry.kind === "stepper";
