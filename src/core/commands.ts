import { redo, selectAll, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";

/**
 * The command registry (DESIGN.md §13): one ID, one label and one shortcut per action,
 * shared by the native menu, the editor keymap, the command palette and Settings.
 */

export type CommandId =
  | "file.new"
  | "library.newFolder"
  | "file.open"
  | "library.openFolder"
  | "file.quickOpen"
  | "file.save"
  | "file.rename"
  | "file.trash"
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
  | "view.fullscreen"
  | "view.toggleLibrary"
  | "app.commandPalette";

/** The switches whose state the menu and palette show. */
export type ToggleId =
  | "editor.toggleFocus"
  | "editor.toggleTypewriter"
  | "editor.toggleTransliteration"
  | "view.fullscreen"
  | "view.toggleLibrary";

export type MenuSection = "File" | "Edit" | "View";

export interface Command {
  id: CommandId;
  label: string;
  section: MenuSection;
  /** CodeMirror key notation; `Mod` is Ctrl on Linux and Windows, Cmd on macOS. */
  key: string;
  /**
   * Where the shortcut works. Everywhere by default; "library" binds it only while the
   * library has focus, never in the editor or the menu, for keys that mean something
   * else in text (Delete).
   */
  keyScope?: "library";
  /** Other words the palette finds it by (DESIGN.md §11.1). */
  aliases?: readonly string[];
  /** One sentence shown beneath it in the palette. */
  description?: string;
  /** A switch: the menu shows it with a check mark. */
  toggle?: (context: CommandContext) => boolean;
  /** Whether it can run now; the palette lists only commands that can. */
  available?: (context: CommandContext) => boolean;
  /** Starts a new group in its menu. */
  separatorBefore?: boolean;
  run(context: CommandContext, source: CommandSource): void;
}

/** How a command was triggered. */
export type CommandSource = "menu" | "keymap" | "ui";

/** What commands act on. `view` is null while no document is open. */
export interface CommandContext {
  view: EditorView | null;
  newFile(): void;
  openFile(): void;
  save(): void;
  openSettings(): void;
  quit(): void;
  isOn(id: ToggleId): boolean;
  /** A library folder is open (and available). */
  hasLibrary(): boolean;
  /** Rename and Move to trash have something to act on: the entry focused in the
   * library, else the open document. */
  hasTarget(): boolean;
  newFolder(): void;
  openFolder(): void;
  quickOpen(): void;
  rename(): void;
  trash(): void;
  /** Shows or hides the library. From the keyboard, a library that is shown but
   * doesn't have focus gets focus instead. */
  toggleLibrary(fromKeyboard: boolean): void;
  commandPalette(): void;
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
  {
    id: "file.new",
    label: "New file…",
    section: "File",
    key: "Mod-n",
    aliases: ["create", "document"],
    run: (c) => c.newFile(),
  },
  {
    id: "library.newFolder",
    label: "New folder…",
    section: "File",
    key: "Mod-Shift-n",
    aliases: ["create", "directory"],
    available: (c) => c.hasLibrary(),
    run: (c) => c.newFolder(),
  },
  {
    id: "file.open",
    label: "Open…",
    section: "File",
    key: "Mod-o",
    separatorBefore: true,
    run: (c) => c.openFile(),
  },
  {
    id: "library.openFolder",
    label: "Open folder…",
    section: "File",
    key: "Mod-Shift-o",
    aliases: ["library", "directory", "choose"],
    run: (c) => c.openFolder(),
  },
  {
    id: "file.quickOpen",
    label: "Quick open…",
    section: "File",
    key: "Mod-p",
    aliases: ["find file", "go to file", "switch"],
    available: (c) => c.hasLibrary(),
    run: (c) => c.quickOpen(),
  },
  {
    id: "file.save",
    label: "Save now",
    section: "File",
    key: "Mod-s",
    separatorBefore: true,
    run: (c) => c.save(),
  },
  {
    id: "file.rename",
    label: "Rename…",
    section: "File",
    key: "F2",
    aliases: ["name"],
    available: (c) => c.hasTarget(),
    run: (c) => c.rename(),
  },
  {
    id: "file.trash",
    label: "Move to trash",
    section: "File",
    key: "Delete",
    keyScope: "library",
    aliases: ["delete", "remove", "bin"],
    description: "Undo puts it back.",
    available: (c) => c.hasTarget(),
    run: (c) => c.trash(),
  },
  {
    id: "app.settings",
    label: "Settings",
    section: "File",
    key: "Mod-,",
    separatorBefore: true,
    aliases: ["preferences", "options"],
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
    aliases: ["ijmes", "macron", "diacritics"],
    description: "Typed sequences become IJMES letters: a= ā, .h ḥ, ` ʿ, '' ʾ.",
    toggle: (c) => c.isOn("editor.toggleTransliteration"),
    available: (c) => c.view !== null,
    run: (c) => c.toggleTransliteration(),
  },
  {
    id: "view.toggleLibrary",
    label: "Library",
    section: "View",
    key: "Mod-\\",
    aliases: ["files", "folder", "sidebar", "tree"],
    toggle: (c) => c.isOn("view.toggleLibrary"),
    run: (c, source) => c.toggleLibrary(source === "keymap"),
  },
  {
    id: "app.commandPalette",
    label: "Command palette",
    section: "View",
    key: "Mod-Shift-p",
    aliases: ["commands", "actions"],
    run: (c) => c.commandPalette(),
  },
  {
    id: "editor.toggleFocus",
    label: "Zuhd mode",
    section: "View",
    key: "Mod-d",
    separatorBefore: true,
    aliases: ["focus", "distraction-free", "sentence", "paragraph", "zuhd", "زهد"],
    description: "Focus on the current sentence or paragraph.",
    toggle: (c) => c.isOn("editor.toggleFocus"),
    run: (c) => c.toggleFocus(),
  },
  {
    id: "editor.toggleTypewriter",
    label: "Typewriter scrolling",
    section: "View",
    key: "Mod-t",
    aliases: ["centre", "center", "scroll"],
    description: "Keeps the line you're writing near the middle of the window.",
    toggle: (c) => c.isOn("editor.toggleTypewriter"),
    run: (c) => c.toggleTypewriter(),
  },
  {
    id: "view.textBigger",
    label: "Bigger text",
    section: "View",
    key: "Mod-=",
    separatorBefore: true,
    aliases: ["zoom in", "font size", "larger"],
    run: (c) => c.changeTextSize(1),
  },
  {
    id: "view.textSmaller",
    label: "Smaller text",
    section: "View",
    key: "Mod--",
    aliases: ["zoom out", "font size"],
    run: (c) => c.changeTextSize(-1),
  },
  {
    id: "view.textReset",
    label: "Default text size",
    section: "View",
    key: "Mod-0",
    aliases: ["zoom", "font size", "reset"],
    run: (c) => c.changeTextSize(0),
  },
  {
    id: "view.cycleTheme",
    label: "Theme: System / Light / Dark",
    section: "View",
    key: "Mod-Shift-l",
    separatorBefore: true,
    aliases: ["dark", "light", "appearance", "colour", "color"],
    run: (c) => c.cycleTheme(),
  },
  {
    id: "view.fullscreen",
    label: "Fullscreen",
    section: "View",
    key: "F11",
    aliases: ["full screen"],
    toggle: (c) => c.isOn("view.fullscreen"),
    run: (c) => c.toggleFullscreen(),
  },
];

/** Commands whose shortcut works everywhere: the editor keymap, the menu and the
 * window's own shortcut handler. */
export const GLOBAL_COMMANDS: readonly Command[] = COMMANDS.filter((c) => !c.keyScope);

/** CodeMirror key notation → Tauri accelerator ("Mod-Shift-l" → "CmdOrCtrl+Shift+L"). */
export function accelerator(key: string): string {
  return key
    .split(/-(?!$)/)
    .map((part) => {
      if (part === "Mod") return "CmdOrCtrl";
      if (part === "=") return "Equal";
      if (part === "-") return "Minus";
      if (part === ",") return "Comma";
      if (part === "\\") return "Backslash";
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
    .replace("Comma", ",")
    .replace("Backslash", "\\");
}

export const commandById = (id: CommandId): Command | undefined =>
  COMMANDS.find((c) => c.id === id);

/** Every command run, with how it was triggered; read by the native-menu tests. */
export const commandLog: { id: CommandId; source: CommandSource }[] = [];

export function runCommand(id: CommandId, source: CommandSource, context: CommandContext): boolean {
  const command = commandById(id);
  if (!command || (command.available && !command.available(context))) return false;
  commandLog.push({ id, source });
  command.run(context, source);
  return true;
}
