import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_COMMANDS } from "./commands.ts";
import { rankCommands } from "./fuzzy.ts";
import { ALL_SETTING_ENTRIES, settingEntries } from "./settingEntries.ts";
import { DEFAULTS } from "./settings.svelte.ts";

const dialog = readFileSync(resolve(import.meta.dirname, "../ui/SettingsDialog.svelte"), "utf8");

describe("Find anything's settings", () => {
  it("points every entry at a control Settings has", () => {
    for (const entry of ALL_SETTING_ENTRIES) {
      const id = entry.control;
      expect(
        dialog.includes(`id="${id}"`) || dialog.includes(`"${id}",`),
        `${entry.id}: ${id}`,
      ).toBe(true);
    }
  });

  it("doesn't list a setting that is already a command", () => {
    const labels = new Set(ALL_COMMANDS.map((c) => c.label));
    for (const entry of ALL_SETTING_ENTRIES)
      expect(labels.has(entry.label), entry.label).toBe(false);
  });

  it("keeps each place's own settings", () => {
    const desktop = settingEntries(false).map((e) => e.id);
    const stick = settingEntries(true).map((e) => e.id);
    expect(desktop).toContain("shortcuts");
    expect(desktop).not.toContain("keyboard");
    expect(stick).toContain("keyboard");
    expect(stick).not.toContain("shortcuts");
  });

  it("shows each choice's value and finds settings by other words", () => {
    const value = (id: string) =>
      ALL_SETTING_ENTRIES.find((e) => e.id === id)?.value?.(DEFAULTS, (c) => c);
    expect(value("measure")).toBe("Standard");
    expect(value("colours")).toBe("bismillah");
    expect(value("line")).toMatch(/font default/);
    expect(rankCommands("quotes", ALL_SETTING_ENTRIES)[0]?.id).toBe("smart");
    expect(rankCommands("leading", ALL_SETTING_ENTRIES)[0]?.id).toBe("line");
  });
});
