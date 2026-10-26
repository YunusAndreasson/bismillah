import { describe, expect, it } from "vitest";
import { rankCommands } from "./fuzzy.ts";
import type { ColourTheme } from "./ipc.ts";
import {
  adjust,
  ALL_SETTING_ENTRIES,
  colourThemeName,
  settingEntries,
  shownValue,
  type SettingEntry,
  type SettingsContext,
} from "./settingEntries.ts";
import { DEFAULTS, type Settings } from "./settings.svelte.ts";

const context = (over: Partial<SettingsContext> = {}): SettingsContext => ({
  colours: [],
  stick: false,
  library: { kind: "ready", name: "Writing" },
  shortcuts: { exists: false, changed: 0, unreadable: false, problems: 0 },
  folders: { config: "~/.config/bismillah", data: "~/.local/share/bismillah" },
  ...over,
});
const entry = (id: string): SettingEntry => {
  const found = ALL_SETTING_ENTRIES.find((e) => e.id === id);
  if (!found) throw new Error(id);
  return found;
};
const values = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, ...over });

describe("the Settings panel's rows", () => {
  it("has a row for every setting there is", () => {
    const keys = new Set<string>();
    for (const e of ALL_SETTING_ENTRIES) {
      if (e.kind === "switch") keys.add(e.key);
      if (e.kind === "choice" || e.kind === "stepper")
        for (const key of Object.keys(
          e.kind === "choice" ? e.set(e.options(context())[0]?.value ?? "") : e.reset,
        ))
          keys.add(key);
    }
    keys.add("custom_font"); // Font name
    keys.add("time_zone"); // Time zone
    expect([...keys].sort()).toEqual(Object.keys(DEFAULTS).sort());
  });

  it("keeps each place's own rows", () => {
    const desktop = settingEntries(DEFAULTS, context()).map((e) => e.id);
    const stick = settingEntries(DEFAULTS, context({ stick: true })).map((e) => e.id);
    expect(desktop).toContain("shortcuts");
    expect(desktop).not.toContain("keyboard");
    expect(stick).toEqual(expect.arrayContaining(["keyboard", "zone", "localClock"]));
    expect(stick).not.toContain("shortcuts");
    expect(stick).not.toContain("yourFiles");
  });

  it("lists Font name only while Another font is chosen", () => {
    const ids = (s: Settings) => settingEntries(s, context()).map((e) => e.id);
    expect(ids(DEFAULTS)).not.toContain("fontName");
    expect(ids(values({ writing_profile: "custom" }))).toContain("fontName");
    // The stick offers no other font.
    const font = entry("font");
    if (font.kind !== "choice") throw new Error("Writing font is a choice");
    expect(font.options(context({ stick: true }))).not.toContainEqual(
      expect.objectContaining({ value: "custom" }),
    );
  });

  it("shows each row's value as Settings words it", () => {
    const shown = (id: string, s = DEFAULTS, c = context()) => shownValue(entry(id), s, c);
    expect(shown("measure")).toBe("Standard");
    expect(shown("colours")).toBe("bismillah");
    expect(shown("line")).toBe("1.6 (font default)");
    expect(shown("line", values({ line_height: 2 }))).toBe("2.0");
    expect(shown("size", values({ text_scale: 1.2 }))).toBe("120%");
    expect(shown("contrast")).toBe("Off");
    expect(shown("smart")).toBe("On");
    expect(shown("font", values({ writing_profile: "custom", custom_font: "Gentium" }))).toBe(
      "Gentium",
    );
    expect(shown("library")).toBe("Writing");
    expect(shown("library", DEFAULTS, context({ library: { kind: "none", name: null } }))).toBe(
      "No folder is open.",
    );
    expect(shown("shortcuts")).toBe("Not changed");
    expect(
      shown(
        "shortcuts",
        DEFAULTS,
        context({ shortcuts: { exists: true, changed: 2, unreadable: false, problems: 1 } }),
      ),
    ).toBe("1 line not used");
  });

  it("steps a choice or a stepper with ← and →, and stops at either end", () => {
    const step = (id: string, s: Settings, d: -1 | 1) => adjust(entry(id), s, context(), d);
    expect(step("measure", DEFAULTS, 1)).toEqual({ measure: "wide" });
    expect(step("measure", values({ measure: "wide" }), 1)).toBeNull();
    expect(step("measure", DEFAULTS, -1)).toEqual({ measure: "narrow" });
    expect(step("size", DEFAULTS, 1)).toEqual({ text_scale: 1.1 });
    expect(step("size", values({ text_scale: 3 }), 1)).toBeNull();
    // Line height steps from the font's own.
    expect(step("line", DEFAULTS, 1)).toEqual({ line_height: 1.7 });
    expect(step("contrast", DEFAULTS, 1)).toBeNull();
  });

  it("finds rows by other words", () => {
    const rank = (q: string) => rankCommands(q, ALL_SETTING_ENTRIES)[0]?.id;
    expect(rank("quotes")).toBe("smart");
    expect(rank("leading")).toBe("line");
    expect(rank("dark")).toBe("theme");
    expect(rank("keybindings")).toBe("shortcuts");
    expect(rank("zoom")).toBe("size");
  });

  it("names colour themes as Settings does", () => {
    const theme = (id: string, light: boolean, dark: boolean, usable = true): ColourTheme => ({
      id,
      name: id === "night" ? "Night ink" : id,
      builtin: false,
      file: `${id}.toml`,
      light: light ? {} : null,
      dark: dark ? {} : null,
      usable,
      problems: [],
    });
    const themes = [
      theme("night", false, true),
      theme("paper", true, true),
      theme("bad", true, true, false),
    ];
    expect(colourThemeName("night", themes)).toBe("Night ink (dark only)");
    expect(colourThemeName("paper", themes)).toBe("paper");
    expect(colourThemeName("bad", themes)).toBe("bismillah");
    const colours = entry("colours");
    expect(colours.kind === "choice" && colours.options(context({ colours: themes }))).toEqual([
      { value: "bismillah", label: "bismillah" },
      { value: "night", label: "Night ink (dark only)" },
      { value: "paper", label: "paper" },
    ]);
  });
});
