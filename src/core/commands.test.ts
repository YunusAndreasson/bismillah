import { describe, expect, it } from "vitest";
import { accelerator, COMMANDS } from "./commands.ts";

describe("command registry", () => {
  it("translates CodeMirror keys into Tauri accelerators", () => {
    expect(accelerator("Mod-s")).toBe("CmdOrCtrl+S");
    expect(accelerator("Mod-Shift-l")).toBe("CmdOrCtrl+Shift+L");
    expect(accelerator("Mod-=")).toBe("CmdOrCtrl+Equal");
    expect(accelerator("Mod--")).toBe("CmdOrCtrl+Minus");
    expect(accelerator("F11")).toBe("F11");
  });

  it("gives every command a unique ID, label and key", () => {
    for (const field of ["id", "label", "key"] as const) {
      const values = COMMANDS.map((c) => c[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
