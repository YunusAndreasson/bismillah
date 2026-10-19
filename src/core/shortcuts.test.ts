import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.ts";
import type { KeybindingEntry } from "./ipc.ts";
import { parseShortcut, resolve, template } from "./shortcuts.ts";

const file = (entries: [string, string | null, number?][]) => ({
  exists: true,
  unreadable: null,
  entries: entries.map(([command, shortcut, line], i): KeybindingEntry => ({
    command,
    shortcut,
    line: line ?? i + 1,
  })),
});

describe("reading a shortcut", () => {
  it("reads the menus' notation and CodeMirror's alike", () => {
    expect(parseShortcut("Ctrl+Shift+T")).toBe("Mod-Shift-t");
    expect(parseShortcut("shift+ctrl+t")).toBe("Mod-Shift-t");
    expect(parseShortcut("Mod-Shift-t")).toBe("Mod-Shift-t");
    expect(parseShortcut("Alt+F")).toBe("Alt-f");
    expect(parseShortcut("Ctrl+-")).toBe("Mod--");
    expect(parseShortcut("Mod--")).toBe("Mod--");
    expect(parseShortcut("Ctrl+Minus")).toBe("Mod--");
    expect(parseShortcut("Ctrl+/")).toBe("Mod-/");
    expect(parseShortcut("Ctrl+BracketLeft")).toBe("Mod-[");
    expect(parseShortcut("f11")).toBe("F11");
    expect(parseShortcut("Shift+F7")).toBe("Shift-F7");
    expect(parseShortcut(" Ctrl + 1 ")).toBe("Mod-1");
    expect(parseShortcut("Delete")).toBe("Delete");
  });

  it("refuses what isn't a shortcut", () => {
    for (const bad of ["", "Ctrl+", "Ctrl+Ctrl+S", "Hyper+S", "Ctrl+Shft+S", "Ctrl+SS", "F25", "é"])
      expect(parseShortcut(bad), bad).toBeNull();
  });
});

describe("applying keybindings.toml", () => {
  it("keeps every command's own shortcut without a file", () => {
    const { keys, problems, changed } = resolve({ exists: false, entries: [], unreadable: null });
    for (const c of COMMANDS) expect(keys.get(c.id)).toBe(c.key);
    expect(problems).toEqual([]);
    expect(changed).toBe(0);
  });

  it("changes, adds and removes shortcuts", () => {
    const { keys, changed } = resolve(
      file([
        ["editor.toggleFocus", "Ctrl+Shift+D"],
        ["app.about", "F1"],
        ["view.fullscreen", ""],
      ]),
    );
    expect(keys.get("editor.toggleFocus")).toBe("Mod-Shift-d");
    expect(keys.get("app.about")).toBe("F1");
    expect(keys.has("view.fullscreen")).toBe(false);
    expect(changed).toBe(3);
  });

  it("takes a shortcut the writer gives one command from the command that had it", () => {
    const { keys } = resolve(file([["editor.toggleFocus", "Ctrl+T"]]));
    expect(keys.get("editor.toggleFocus")).toBe("Mod-t");
    expect(keys.has("editor.toggleTypewriter")).toBe(false);
  });

  it("keeps the text's keys, the menu's and the standard editing ones", () => {
    const { keys, problems } = resolve(
      file([
        ["file.save", "Ctrl+C"],
        ["view.toggleLibrary", "F10"],
        ["file.trash", "Ctrl+Backspace"],
        ["app.settings", "Enter"],
        ["app.commandPalette", "Shift+P"],
        ["edit.undo", "Ctrl+U"],
      ]),
    );
    expect(problems.map((p) => p.kind)).toEqual(["kept", "kept", "kept", "kept", "kept", "fixed"]);
    expect(keys.get("file.save")).toBe("Mod-s");
    expect(keys.get("file.trash")).toBe("Delete");
    expect(keys.get("edit.undo")).toBe("Mod-z");
  });

  it("lets Move to trash, which works only in the library, take Delete with a modifier", () => {
    const { keys, problems } = resolve(file([["file.trash", "Shift+Delete"]]));
    expect(problems).toEqual([]);
    expect(keys.get("file.trash")).toBe("Shift-Delete");
  });

  it("uses neither line when one shortcut is given to two commands", () => {
    const { keys, problems } = resolve(
      file([
        ["editor.toggleFocus", "Ctrl+K", 3],
        ["view.toggleLibrary", "Ctrl+K", 5],
      ]),
    );
    expect(problems).toEqual([
      {
        kind: "twice",
        shortcut: "Mod-k",
        commands: ["editor.toggleFocus", "view.toggleLibrary"],
        line: 3,
      },
    ]);
    expect(keys.get("editor.toggleFocus")).toBe("Mod-d");
    expect(keys.get("view.toggleLibrary")).toBe("Mod-\\");
  });

  it("says which lines it couldn't use, in file order", () => {
    const { problems } = resolve(
      file([
        ["file.saev", "Ctrl+S", 2],
        ["file.save", null, 4],
        ["file.open", "Ctrl+Shft+O", 6],
        ["file.new", "Ctrl+Alt+N", 7],
        ["file.new", "Ctrl+Alt+M", 9],
      ]),
    );
    expect(problems.map((p) => [p.kind, p.line])).toEqual([
      ["unknown_command", 2],
      ["not_text", 4],
      ["unreadable", 6],
      ["repeated", 9],
    ]);
  });
});

describe("the starting file", () => {
  it("lists every command but Undo, Redo and Select all, all commented out", () => {
    const text = template();
    const lines = text.split("\n");
    expect(lines).toContain("schema = 1");
    expect(lines.some((l) => /^[^#\s]/.test(l) && l !== "schema = 1")).toBe(false);
    expect(text).toContain('# "editor.toggleFocus" = "Ctrl+D"');
    expect(text).toContain("# Zuhd mode");
    expect(text).toContain('# "view.textBigger" = "Ctrl+="');
    expect(text).not.toContain("edit.undo");
    expect(text).toContain('# "view.toggleLibrary" = "Ctrl+\\\\"');
  });

  it("gives back every command's own shortcut when its lines are uncommented", () => {
    const entries = template()
      .split("\n")
      .flatMap((line, i) => {
        // A TOML basic string, whose only escape here is a doubled backslash.
        const m = /^# "([\w.]+)" = "((?:[^"\\]|\\\\)*)"/.exec(line);
        const shortcut = m?.[2]?.replaceAll("\\\\", "\\");
        return m?.[1] && shortcut !== undefined ? [{ command: m[1], shortcut, line: i + 1 }] : [];
      });
    const { keys, problems } = resolve({ exists: true, unreadable: null, entries });
    expect(problems).toEqual([]);
    for (const c of COMMANDS) expect(keys.get(c.id)).toBe(c.key);
  });
});
