import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { COMMANDS, type CommandContext } from "./commands.ts";
import { colourThemeName, firstValue, lists, WORDS, type Scope } from "./findAnything.ts";
import type { ColourTheme } from "./ipc.ts";
import { settingEntries } from "./settingEntries.ts";

// Every command can run: a document is open and every check passes.
const context = new Proxy(
  {},
  { get: (_, prop) => (prop === "view" ? { state: EditorState.create() } : () => true) },
) as unknown as CommandContext;

const files = [
  { path: "Chapter 2.md", name: "Chapter 2.md" },
  { path: "Notes/notes.md", name: "notes.md" },
  { path: "Essays/ʿIlm and adab.md", name: "ʿIlm and adab.md" },
];

const listFor = (scope: Scope, query: string, recent: string[] = []) =>
  lists(scope, query, {
    files,
    recent,
    commands: COMMANDS,
    context,
    settings: settingEntries(false),
  });

describe("Find anything's lists", () => {
  it("offers recent files, the main commands and settings before anything is typed", () => {
    const l = listFor("everything", "", ["Notes/notes.md"]);
    expect(l.files.map((f) => f.path)).toEqual(["Notes/notes.md"]);
    expect(l.commands.map((c) => c.id)).toEqual([
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
    ]);
    expect(l.settings.map((e) => e.id)).toContain("smart");
  });

  it("lists a setting once, as its command where it has one", () => {
    for (const query of ["dark", "appearance", "zoom", "font size", "zuhd", "spelling"]) {
      const l = listFor("everything", query);
      const labels = [...l.commands.map((c) => c.label), ...l.settings.map((e) => e.label)];
      expect(new Set(labels).size, query).toBe(labels.length);
      expect(
        l.settings.map((e) => e.id),
        query,
      ).not.toContain("theme");
    }
    expect(listFor("everything", "dark").commands[0]?.id).toBe("view.cycleTheme");
  });

  it("keeps each scope to its own kind", () => {
    expect(listFor("quickOpen", "notes").commands).toEqual([]);
    expect(listFor("palette", "notes").files).toEqual([]);
    expect(listFor("settings", "").files).toEqual([]);
    expect(listFor("settings", "").settings.length).toBe(settingEntries(false).length);
    expect(WORDS.quickOpen.title).toBe("Quick open");
    expect(WORDS.palette.title).toBe("Command palette");
  });

  it("lists Find anything, with Shift Shift, in the palette but not in itself", () => {
    const inPalette = listFor("palette", "find anything").commands[0];
    expect(inPalette?.id).toBe("app.findAnything");
    expect(inPalette?.gesture).toBe("Shift Shift");
    expect(listFor("everything", "find anything").commands.map((c) => c.id)).not.toContain(
      "app.findAnything",
    );
  });

  it("starts on the first item listed", () => {
    expect(firstValue(listFor("everything", "ilm"))).toBe("file:Essays/ʿIlm and adab.md");
    expect(firstValue(listFor("palette", "zuhd"))).toBe("command:editor.toggleFocus");
    expect(firstValue(listFor("settings", "quotes"))).toBe("setting:smart");
    expect(firstValue({ files: [], commands: [], settings: [] })).toBe("");
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
    // A choice that can't be used: bismillah's own colours are what apply.
    expect(colourThemeName("bad", themes)).toBe("bismillah");
    expect(colourThemeName("gone", themes)).toBe("bismillah");
    expect(colourThemeName("bismillah", themes)).toBe("bismillah");
  });
});
