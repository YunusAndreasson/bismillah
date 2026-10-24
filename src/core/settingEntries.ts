import { copy } from "./copy.ts";
import { PROFILE_LINE_HEIGHT, type Settings } from "./settings.svelte.ts";

/**
 * The settings Find anything lists (DESIGN.md §6), beside the commands. Settings that
 * already have a command (Zuhd mode, Typewriter scrolling, Always show Markdown, the
 * checkers, Theme, the text size) are found as that command, so nothing is listed
 * twice. A switch changes in
 * place; a choice opens Settings with focus on its control.
 */

export type SettingsSection = "appearance" | "writing" | "checking" | "files" | "stick";

/** Where Settings opens: a section, and the control in it to give focus to. */
export interface SettingsTarget {
  section: SettingsSection;
  /** The id of the control's element, or of its label, in SettingsDialog. */
  control?: string;
}

/** Settings whose value is on or off. */
type SwitchKey = "high_contrast" | "fade_chrome" | "basmallah_opening" | "smart_punctuation";

export interface SettingEntry {
  id: string;
  label: string;
  aliases?: readonly string[];
  section: SettingsSection;
  control: string;
  /** A switch: Enter changes it in place. */
  key?: SwitchKey;
  /** The current value as Settings shows it; for a switch, On or Off is shown instead. */
  value?: (s: Settings, colourName: (id: string) => string) => string;
  place?: "desktop" | "stick";
}

const t = copy.settings;

const ENTRIES: readonly SettingEntry[] = [
  {
    id: "colours",
    label: t.colours,
    aliases: ["colour theme", "color"],
    section: "appearance",
    control: "set-colours",
    value: (s, name) => name(s.colour_theme),
  },
  {
    id: "contrast",
    label: t.highContrast,
    aliases: ["black and white", "accessibility"],
    section: "appearance",
    control: "set-contrast",
    key: "high_contrast",
  },
  {
    id: "font",
    label: t.font,
    aliases: ["typeface", "family", "amiri", "serif"],
    section: "appearance",
    control: "set-font",
    value: (s) =>
      s.writing_profile === "custom" && s.custom_font !== ""
        ? s.custom_font
        : t.fonts[s.writing_profile],
  },

  {
    id: "measure",
    label: t.measure,
    aliases: ["width", "column", "measure"],
    section: "appearance",
    control: "set-measure",
    value: (s) => t.measures[s.measure],
  },
  {
    id: "line",
    label: t.lineHeight,
    aliases: ["leading", "spacing"],
    section: "appearance",
    control: "set-line",
    value: (s) =>
      s.line_height === null
        ? `${PROFILE_LINE_HEIGHT[s.writing_profile].toFixed(1)} (${t.fontDefault})`
        : s.line_height.toFixed(1),
  },
  {
    id: "fade",
    label: t.fadeChrome,
    aliases: ["status", "chrome", "quiet"],
    section: "appearance",
    control: "set-fade",
    key: "fade_chrome",
  },
  {
    id: "basmallah",
    label: t.basmallah,
    aliases: ["bismillah", "opening", "بسملة"],
    section: "appearance",
    control: "set-basmallah",
    key: "basmallah_opening",
  },
  {
    id: "smart",
    label: t.smartPunctuation,
    aliases: ["quotes", "dashes", "typography"],
    section: "writing",
    control: "set-smart",
    key: "smart_punctuation",
  },
  {
    id: "focusOn",
    label: `${t.zuhd}: ${t.focusOn}`,
    aliases: ["sentence", "paragraph", "focus"],
    section: "writing",
    control: "set-focus",
    value: (s) => t.granularities[s.focus_granularity],
  },
  {
    id: "dimming",
    label: `${t.zuhd}: ${t.focusDimming}`,
    aliases: ["faint", "quiet", "focus"],
    section: "writing",
    control: "set-dimming",
    value: (s) => t.dimmings[s.focus_dimming],
  },
  {
    id: "dialect",
    label: t.dialect,
    aliases: ["british", "american", "language", "dictionary"],
    section: "checking",
    control: "set-dialect",
    value: (s) => t.dialects[s.english_dialect],
  },
  {
    id: "library",
    label: t.library,
    aliases: ["folder", "directory"],
    section: "files",
    control: "settings-library",
  },
  {
    id: "shortcuts",
    label: copy.shortcuts.title,
    aliases: ["keybindings", "keys"],
    section: "files",
    control: "settings-shortcuts",
    place: "desktop",
  },
  {
    id: "keyboard",
    label: t.stick.keyboard,
    aliases: ["layout", "arabic"],
    section: "stick",
    control: "set-keyboard",
    place: "stick",
  },
  {
    id: "zone",
    label: t.stick.timeZone,
    aliases: ["clock", "time"],
    section: "stick",
    control: "set-zone",
    place: "stick",
  },
];

/** The entries for this place, the desktop or the stick. */
export function settingEntries(stick: boolean): readonly SettingEntry[] {
  return ENTRIES.filter((e) => e.place !== (stick ? "desktop" : "stick"));
}

/** Every entry, in both places (for tests). */
export const ALL_SETTING_ENTRIES = ENTRIES;
