import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, shortcutLabel } from "./commands.ts";
import { GUIDE_WORDS } from "./guide.ts";

const guide = readFileSync(resolve(import.meta.dirname, "../../docs/guide.md"), "utf8");

/** The guide's "Every shortcut" table: each command's label and its shortcut cell. */
function shortcutTable(): Map<string, string> {
  const section = guide.split("## Every shortcut")[1]?.split("\n## ")[0] ?? "";
  const rows = new Map<string, string>();
  for (const line of section.split("\n")) {
    const cells = /^\| (.+?) \| (.+?) \|$/.exec(line);
    if (cells?.[1] && cells[2] && cells[1] !== "Command" && !cells[1].startsWith("---")) {
      rows.set(cells[1], cells[2]);
    }
  }
  return rows;
}

describe("the guide", () => {
  it("lists every command with its own shortcut, as the registry has it", () => {
    const rows = shortcutTable();
    for (const command of COMMANDS) {
      const cell = rows.get(command.label);
      expect(cell, command.label).toBeDefined();
      if (command.gesture && !command.key)
        expect(cell, command.label).toBe(`\`${command.gesture}\``);
      else if (!command.key) expect(cell, command.label).toBe("—");
      else expect(cell, command.label).toContain(`\`${shortcutLabel(command.key)}\``);
      if (command.keyScope === "library") expect(cell).toContain("(in the library)");
    }
    // Nothing that isn't a command, except the menu bar, which GTK shows.
    const labels = new Set(COMMANDS.map((c) => c.label));
    expect([...rows.keys()].filter((label) => !labels.has(label))).toEqual(["Show the menu bar"]);
  });

  it("uses every word it asks the checker to ignore", () => {
    for (const word of GUIDE_WORDS) expect(guide, word).toContain(word);
  });
});
