import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.ts";
import { keyOf, normalise } from "./keys.ts";

const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("shortcuts outside the editor", () => {
  it("reads physical keys, so an Arabic layout still gives Ctrl+O", () => {
    expect(keyOf(press({ key: "خ", code: "KeyO", ctrlKey: true }), false)).toBe("Mod-o");
    expect(keyOf(press({ key: "T", code: "KeyT", ctrlKey: true, shiftKey: true }), false)).toBe(
      "Mod-Shift-t",
    );
    expect(keyOf(press({ key: "=", code: "Equal", ctrlKey: true }), false)).toBe("Mod-=");
    expect(keyOf(press({ key: ",", code: "Comma", ctrlKey: true }), false)).toBe("Mod-,");
    expect(keyOf(press({ key: "F11", code: "F11" }), false)).toBe("F11");
  });

  it("uses Cmd as Mod on macOS", () => {
    expect(keyOf(press({ key: "o", code: "KeyO", metaKey: true }), true)).toBe("Mod-o");
    expect(keyOf(press({ key: "o", code: "KeyO", ctrlKey: true }), true)).toBe("o");
  });

  it("matches every registry shortcut in its normal form", () => {
    for (const command of COMMANDS) {
      expect(normalise(command.key)).toBe(command.key.replace(/[A-Z]$/, (c) => c.toLowerCase()));
    }
    expect(normalise("Mod-Shift-L")).toBe("Mod-Shift-l");
    expect(normalise("Mod--")).toBe("Mod--");
  });
});
