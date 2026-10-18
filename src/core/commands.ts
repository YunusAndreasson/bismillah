import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";

/**
 * The command registry (DESIGN.md §13): one ID, one label and one shortcut per action,
 * shared by the native menu, the editor keymap and, later, the palette and Settings.
 */

export type CommandId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "app.settings"
  | "app.quit"
  | "edit.undo"
  | "edit.redo"
  | "edit.selectAll"
  | "editor.toggleTransliteration"
  | "editor.toggleFocus"
  | "editor.toggleTypewriter"
  | "view.textBigger"
  | "view.textSmaller"
  | "view.textReset"
  | "view.cycleTheme"
  | "view.fullscreen";

export type MenuSection = "File" | "Edit" | "View";

export interface Command {
  id: CommandId;
  label: string;
  section: MenuSection;
  /** CodeMirror key notation; `Mod` is Ctrl on Linux and Windows, Cmd on macOS. */
  key: string;
  /** A switch: the menu shows it with a check mark. */
  toggle?: (context: CommandContext) => boolean;
  /** Starts a new group in its menu. */
  separatorBefore?: boolean;
  run(context: CommandContext): void;
}

/** What commands act on. `view` is null while no document is open. */
export interface CommandContext {
  view: EditorView | null;
  newFile(): void;
  openFile(): void;
  save(): void;
  openSettings(): void;
  quit(): void;
  isOn(
    id:
      | "editor.toggleFocus"
      | "editor.toggleTypewriter"
      | "editor.toggleTransliteration"
      | "view.fullscreen",
  ): boolean;
  toggleFocus(): void;
  toggleTypewriter(): void;
  toggleTransliteration(): void;
  changeTextSize(step: -1 | 0 | 1): void;
  cycleTheme(): void;
  toggleFullscreen(): void;
}

const withView = (c: CommandContext, f: (view: EditorView) => unknown) => {
  if (c.view) f(c.view);
};

export const COMMANDS: readonly Command[] = [
  { id: "file.new", label: "New file…", section: "File", key: "Mod-n", run: (c) => c.newFile() },
  { id: "file.open", label: "Open…", section: "File", key: "Mod-o", run: (c) => c.openFile() },
  { id: "file.save", label: "Save now", section: "File", key: "Mod-s", run: (c) => c.save() },
  {
    id: "app.settings",
    label: "Settings",
    section: "File",
    key: "Mod-,",
    separatorBefore: true,
    run: (c) => c.openSettings(),
  },
  {
    id: "app.quit",
    label: "Quit",
    section: "File",
    key: "Mod-q",
    separatorBefore: true,
    run: (c) => c.quit(),
  },
  {
    id: "edit.undo",
    label: "Undo",
    section: "Edit",
    key: "Mod-z",
    run: (c) => withView(c, undo),
  },
  {
    id: "edit.redo",
    label: "Redo",
    section: "Edit",
    key: "Mod-Shift-z",
    run: (c) => withView(c, redo),
  },
  {
    id: "edit.selectAll",
    label: "Select all",
    section: "Edit",
    key: "Mod-a",
    run: (c) => withView(c, selectAll),
  },
  {
    id: "editor.toggleTransliteration",
    label: "Transliteration mode",
    section: "Edit",
    key: "Mod-Shift-t",
    separatorBefore: true,
    toggle: (c) => c.isOn("editor.toggleTransliteration"),
    run: (c) => c.toggleTransliteration(),
  },
  {
    id: "editor.toggleFocus",
    label: "Zuhd mode",
    section: "View",
    key: "Mod-d",
    toggle: (c) => c.isOn("editor.toggleFocus"),
    run: (c) => c.toggleFocus(),
  },
  {
    id: "editor.toggleTypewriter",
    label: "Typewriter scrolling",
    section: "View",
    key: "Mod-t",
    toggle: (c) => c.isOn("editor.toggleTypewriter"),
    run: (c) => c.toggleTypewriter(),
  },
  {
    id: "view.textBigger",
    label: "Bigger text",
    section: "View",
    key: "Mod-=",
    separatorBefore: true,
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
    separatorBefore: true,
    run: (c) => c.cycleTheme(),
  },
  {
    id: "view.fullscreen",
    label: "Fullscreen",
    section: "View",
    key: "F11",
    toggle: (c) => c.isOn("view.fullscreen"),
    run: (c) => c.toggleFullscreen(),
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
      if (part === ",") return "Comma";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join("+");
}

/** The shortcut as the writer reads it on Linux ("Ctrl+Shift+T"). */
export function shortcutLabel(key: string): string {
  return accelerator(key)
    .replace("CmdOrCtrl", "Ctrl")
    .replace("Equal", "=")
    .replace("Minus", "-")
    .replace("Comma", ",");
}

export const commandById = (id: CommandId): Command | undefined =>
  COMMANDS.find((c) => c.id === id);

/** Every command run, with how it was triggered; read by the native-menu tests. */
export const commandLog: { id: CommandId; source: "menu" | "keymap" | "ui" }[] = [];

export function runCommand(
  id: CommandId,
  source: "menu" | "keymap" | "ui",
  context: CommandContext,
): boolean {
  const command = commandById(id);
  if (!command) return false;
  commandLog.push({ id, source });
  command.run(context);
  return true;
}
