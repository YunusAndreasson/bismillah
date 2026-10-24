import type { Command, CommandContext, CommandId } from "./commands.ts";
import { copy } from "./copy.ts";
import { rankCommands, rankFiles, type FileCandidate } from "./fuzzy.ts";
import type { ColourTheme } from "./ipc.ts";
import type { SettingEntry } from "./settingEntries.ts";
import { DEFAULT_THEME } from "./themes.svelte.ts";

/**
 * What Find anything lists (DESIGN.md §6), apart from its component so it can be tested:
 * its scopes and their words, and the files, commands and settings each scope shows for
 * a query.
 */

/** Everything, or only files (quick open), commands (the palette) or settings. */
export type Scope = "everything" | "quickOpen" | "palette" | "settings";

export const SCOPES: readonly Scope[] = ["everything", "quickOpen", "palette", "settings"];

/** The window width from which the library tree sits beside the list. */
export const TREE_MIN_WIDTH = 760;

/** What Find anything offers before anything is typed: the main commands. */
const MAIN: readonly CommandId[] = [
  "file.new",
  "file.save",
  "view.toggleLibrary",
  "editor.toggleFocus",
  "editor.toggleTypewriter",
  "view.toggleMarkdown",
  "edit.find",
  "edit.goToLine",
  "view.cycleTheme",
  "app.settings",
  "app.guide",
];
/** Settings offered before anything is typed: the switches, then the most used. */
const MAIN_SETTINGS = new Set(["contrast", "fade", "basmallah", "smart", "font", "measure"]);
/** How many of each kind Everything shows for a query, and recent files without one. */
const EACH = 8;
const RECENT = 6;

const t = copy.picker;

export const WORDS: Record<
  Scope,
  { title: string; placeholder: string; keys: string; empty: string }
> = {
  everything: {
    title: t.everything,
    placeholder: t.everythingPlaceholder,
    keys: t.everythingKeys,
    empty: t.noMatch,
  },
  quickOpen: {
    title: t.quickOpen,
    placeholder: t.quickOpenPlaceholder,
    keys: t.fileKeys,
    empty: t.noFile,
  },
  palette: {
    title: t.palette,
    placeholder: t.palettePlaceholder,
    keys: t.commandKeys,
    empty: t.noCommand,
  },
  settings: {
    title: t.settings,
    placeholder: t.settingsPlaceholder,
    keys: t.settingKeys,
    empty: t.noSetting,
  },
};

export interface Lists<F extends FileCandidate> {
  files: F[];
  commands: Command[];
  settings: SettingEntry[];
}

/** The files, commands and settings `scope` lists for `query`, best first. */
export function lists<F extends FileCandidate>(
  scope: Scope,
  query: string,
  input: {
    files: readonly F[];
    recent: readonly string[];
    commands: readonly Command[];
    context: CommandContext;
    settings: readonly SettingEntry[];
  },
): Lists<F> {
  const all = scope === "everything";
  const searching = query.trim() !== "";
  const out: Lists<F> = { files: [], commands: [], settings: [] };

  if (all || scope === "quickOpen") {
    if (!all) out.files = rankFiles(query, input.files, input.recent);
    else if (searching) out.files = rankFiles(query, input.files, input.recent, EACH);
    else {
      const recent = new Set(input.recent);
      out.files = rankFiles("", input.files, input.recent, RECENT).filter((f) =>
        recent.has(f.path),
      );
    }
  }

  if (all || scope === "palette") {
    // The palette lists Find anything itself, so its Shift Shift can be learned there.
    const usable = input.commands.filter(
      (c) =>
        c.id !== "app.commandPalette" &&
        (scope === "palette" || c.id !== "app.findAnything") &&
        (!c.available || c.available(input.context)),
    );
    if (!all) out.commands = rankCommands(query, usable);
    else if (searching) out.commands = rankCommands(query, usable).slice(0, EACH);
    else out.commands = MAIN.flatMap((id) => usable.find((c) => c.id === id) ?? []);
  }

  if (all || scope === "settings") {
    if (!all) out.settings = rankCommands(query, input.settings);
    else if (searching) out.settings = rankCommands(query, input.settings).slice(0, EACH);
    else out.settings = input.settings.filter((e) => MAIN_SETTINGS.has(e.id));
  }
  return out;
}

/** The value of the item listed first, which Enter runs. */
export function firstValue(l: Lists<FileCandidate>): string {
  const file = l.files[0];
  if (file) return `file:${file.path}`;
  const command = l.commands[0];
  if (command) return `command:${command.id}`;
  const setting = l.settings[0];
  return setting ? `setting:${setting.id}` : "";
}

/** A colour theme's name as Settings lists it ("Night ink (dark only)"). A choice that
 * can't be used reads as bismillah's own colours, which are what apply. */
export function colourThemeName(id: string, themes: readonly ColourTheme[]): string {
  const theme = themes.find((th) => th.id === id && th.usable);
  if (id === DEFAULT_THEME || !theme) return copy.themes.builtin;
  const only = !theme.dark ? copy.themes.lightOnly : !theme.light ? copy.themes.darkOnly : null;
  return only ? `${theme.name} (${only})` : theme.name;
}
