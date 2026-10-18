import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";

/**
 * The command registry (DESIGN.md §13): one ID, one label and one shortcut per action,
 * shared by the native menu, the editor keymap and, later, the palette and Settings.
 * Phase 0 holds only the commands the native-menu spike exercises.
 */

export type CommandId =
  | "file.save"
  | "app.quit"
  | "edit.undo"
  | "edit.redo"
  | "edit.selectAll"
  | "editor.toggleTypewriter"
  | "view.textBigger"
  | "view.textSmaller"
  | "view.textReset"
  | "view.cycleTheme";

export type MenuSection = "File" | "Edit" | "View";

export interface Command {
  id: CommandId;
  label: string;
  section: MenuSection;
  /** CodeMirror key notation; `Mod` is Ctrl on Linux and Windows, Cmd on macOS. */
  key: string;
  run(context: CommandContext): void;
}

export interface CommandContext {
  view: EditorView;
  toggleTypewriter(): void;
  changeTextSize(step: -1 | 0 | 1): void;
  cycleTheme(): void;
  quit(): void;
}

export const COMMANDS: readonly Command[] = [
  { id: "file.save", label: "Save now", section: "File", key: "Mod-s", run: () => {} },
  { id: "app.quit", label: "Quit", section: "File", key: "Mod-q", run: (c) => c.quit() },
  { id: "edit.undo", label: "Undo", section: "Edit", key: "Mod-z", run: (c) => undo(c.view) },
  {
    id: "edit.redo",
    label: "Redo",
    section: "Edit",
    key: "Mod-Shift-z",
    run: (c) => redo(c.view),
  },
  {
    id: "edit.selectAll",
    label: "Select all",
    section: "Edit",
    key: "Mod-a",
    run: (c) => selectAll(c.view),
  },
  {
    id: "editor.toggleTypewriter",
    label: "Typewriter scrolling",
    section: "View",
    key: "Mod-t",
    run: (c) => c.toggleTypewriter(),
  },
  {
    id: "view.textBigger",
    label: "Bigger text",
    section: "View",
    key: "Mod-=",
    run: (c) => c.changeTextSize(1),
  },
  {
    id: "view.textSmaller",
    label: "Smaller text",
    section: "View",
    key: "Mod--",
    run: (c) => c.changeTextSize(-1),
  },
  {
    id: "view.textReset",
    label: "Default text size",
    section: "View",
    key: "Mod-0",
    run: (c) => c.changeTextSize(0),
  },
  {
    id: "view.cycleTheme",
    label: "Theme: System / Light / Dark",
    section: "View",
    key: "Mod-Shift-l",
    run: (c) => c.cycleTheme(),
  },
];

/** CodeMirror key notation → Tauri accelerator ("Mod-Shift-l" → "CmdOrCtrl+Shift+L"). */
export function accelerator(key: string): string {
  return key
    .split(/-(?!$)/)
    .map((part) => {
      if (part === "Mod") return "CmdOrCtrl";
      if (part === "=") return "Equal";
      if (part === "-") return "Minus";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join("+");
}

/** Every command run, with how it was triggered; read by the native-menu spike tests. */
export const commandLog: { id: CommandId; source: "menu" | "keymap" }[] = [];

export function runCommand(
  id: CommandId,
  source: "menu" | "keymap",
  context: CommandContext,
): boolean {
  const command = COMMANDS.find((c) => c.id === id);
  if (!command) return false;
  commandLog.push({ id, source });
  command.run(context);
  return true;
}
