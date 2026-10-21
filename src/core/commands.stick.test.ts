import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  runCommand,
  useStickCommands,
  type CommandContext,
  type CommandId,
} from "./commands.ts";

// The registry changes in place, so the stick's registry has a file of its own.
describe("the stick's commands (os/PLAN.md, OS-3)", () => {
  const ids = () => COMMANDS.map((c) => c.id);
  const desktopOnly: CommandId[] = [
    "app.quit",
    "file.open",
    "library.openFolder",
    "edit.copyRich",
    "edit.openLink",
    "view.fullscreen",
  ];
  const stickOnly: CommandId[] = ["stick.lock", "stick.suspend", "stick.restart", "stick.powerOff"];

  it("keeps the stick's commands out of the desktop", () => {
    for (const id of stickOnly) expect(ids()).not.toContain(id);
    for (const id of desktopOnly) expect(ids()).toContain(id);
  });

  it("swaps in power and lock, and quitting powers off", () => {
    useStickCommands();
    for (const id of desktopOnly) expect(ids()).not.toContain(id);
    for (const id of stickOnly) expect(ids()).toContain(id);
    expect(COMMANDS.find((c) => c.id === "stick.powerOff")?.key).toBe("Mod-q");
    expect(COMMANDS.find((c) => c.id === "stick.powerOff")?.aliases).toContain("quit");
    const keys = COMMANDS.map((c) => c.key).filter((k) => k !== undefined);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("runs nothing behind the lock view", () => {
    useStickCommands();
    const power: string[] = [];
    let locked = true;
    const context = {
      view: null,
      locked: () => locked,
      power: (action: string) => power.push(action),
      lock: () => {},
    } as unknown as CommandContext;
    expect(runCommand("stick.powerOff", "menu", context)).toBe(false);
    expect(power).toEqual([]);
    locked = false;
    expect(runCommand("stick.powerOff", "menu", context)).toBe(true);
    expect(runCommand("stick.suspend", "keymap", context)).toBe(true);
    expect(power).toEqual(["off", "suspend"]);
  });
});
