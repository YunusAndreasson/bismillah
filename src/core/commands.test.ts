import { describe, expect, it } from "vitest";
import { accelerator, COMMANDS, GLOBAL_COMMANDS, shortcutLabel } from "./commands.ts";

describe("command registry", () => {
  it("translates CodeMirror keys into Tauri accelerators", () => {
    expect(accelerator("Mod-s")).toBe("CmdOrCtrl+S");
    expect(accelerator("Mod-Shift-l")).toBe("CmdOrCtrl+Shift+L");
    expect(accelerator("Mod-=")).toBe("CmdOrCtrl+Equal");
    expect(accelerator("Mod--")).toBe("CmdOrCtrl+Minus");
    expect(accelerator("F11")).toBe("F11");
    expect(accelerator("Mod-\\")).toBe("CmdOrCtrl+Backslash");
    expect(shortcutLabel("Mod-\\")).toBe("Ctrl+\\");
  });

  it("never binds a key that edits text everywhere", () => {
    // Ctrl+Backspace deletes the previous word and Delete the next character in every
    // Linux text field; neither may ever trash a file from the editor.
    const editing = /^(Mod-)?(Shift-)?(Backspace|Delete)$/;
    for (const command of GLOBAL_COMMANDS) expect(command.key).not.toMatch(editing);
    expect(COMMANDS.find((c) => c.id === "file.trash")?.keyScope).toBe("library");
  });

  it("finds Zuhd mode by its aliases (DESIGN.md §11.1)", () => {
    const zuhd = COMMANDS.find((c) => c.id === "editor.toggleFocus");
    expect(zuhd?.aliases).toEqual(
      expect.arrayContaining(["focus", "distraction-free", "sentence", "paragraph", "زهد"]),
    );
  });

  it("gives every command a unique ID, label and key", () => {
    for (const field of ["id", "label", "key"] as const) {
      const values = COMMANDS.map((c) => c[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
