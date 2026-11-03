import { describe, expect, it } from "vitest";
import type { SubmenuOptions } from "@tauri-apps/api/menu";
import { ariaShortcut, shortcutLabel, type Command } from "./commands.ts";
import { menuLayout } from "./menu.ts";

const own = (c: Command) => ({ id: c.id, text: c.label });

/** Each submenu's title and its entries: a command ID, or a native item's name. */
function outline(menus: SubmenuOptions[]): [string, string[]][] {
  return menus.map((menu) => [
    menu.text ?? "",
    (menu.items ?? []).map((entry) => {
      if ("id" in entry && typeof entry.id === "string") return entry.id;
      if ("item" in entry && typeof entry.item === "string") return entry.item;
      return "?";
    }),
  ]);
}

describe("the native menu", () => {
  it("keeps the registry's sections on Linux, with the clipboard after Redo", () => {
    const menus = outline(menuLayout(false, own));
    expect(menus.map(([title]) => title)).toEqual(["File", "Edit", "Format", "View", "Help"]);
    const [, file] = menus[0] ?? [];
    const [, edit] = menus[1] ?? [];
    expect(file).toContain("app.settings");
    expect(file).toContain("app.quit");
    expect(edit?.slice(0, 7)).toEqual([
      "edit.undo",
      "edit.redo",
      "Separator",
      "Cut",
      "Copy",
      "Paste",
      "edit.selectAll",
    ]);
  });

  it("on macOS has the App and Window menus and the system's own editing items", () => {
    const menus = outline(menuLayout(true, own));
    expect(menus.map(([title]) => title)).toEqual([
      "bismillah",
      "File",
      "Edit",
      "Format",
      "View",
      "Window",
      "Help",
    ]);
    const app = menus[0]?.[1] ?? [];
    expect(app[0]).toBe("app.about");
    expect(app.some((item, i) => item === "Separator" && app[i + 1] === "Separator")).toBe(false);
    expect(app).toContain("app.settings");
    expect(app).toContain("Hide");
    expect(app.at(-1)).toBe("app.quit");
    const everywhereElse = menus.slice(1).flatMap(([, items]) => items);
    for (const id of ["app.about", "app.settings", "app.quit"]) {
      expect(everywhereElse).not.toContain(id);
    }
    // Their shortcuts reach the focused field, so Cmd+Z in Find undoes the field.
    expect(menus[2]?.[1].slice(0, 7)).toEqual([
      "Undo",
      "Redo",
      "Separator",
      "Cut",
      "Copy",
      "Paste",
      "SelectAll",
    ]);
    expect(menus.at(-1)?.[1]).toContain("app.guide");
    // AppKit puts its own Enter Full Screen in the View menu.
    expect(everywhereElse).not.toContain("view.fullscreen");
    expect(outline(menuLayout(false, own)).flatMap(([, items]) => items)).toContain(
      "view.fullscreen",
    );
  });

  it("labels shortcuts with each platform's key names", () => {
    expect(shortcutLabel("Mod-Alt-g", false)).toBe("Ctrl+Alt+G");
    expect(shortcutLabel("Mod-Alt-g", true)).toBe("Cmd+Option+G");
    expect(shortcutLabel("Mod-Shift-ArrowUp", true)).toBe("Cmd+Shift+Up");
    expect(ariaShortcut(shortcutLabel("Mod-Alt-b", true))).toBe("Meta+Alt+B");
    expect(ariaShortcut(shortcutLabel("Mod-b", false))).toBe("Ctrl+B");
  });
});
