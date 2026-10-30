import { redo, redoDepth, selectAll, undo, undoDepth } from "@codemirror/commands";
import { findNext, findPrevious, openSearchPanel } from "@codemirror/search";
import { openGoToLine } from "../editor/goToLine.ts";
import { openReplace } from "../editor/search.ts";
import type { EditorView } from "@codemirror/view";

/**
 * The command registry (DESIGN.md §13): one ID, one label and one shortcut per action,
 * shared by the native menu, the editor keymap, the Commands panel and Settings.
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
  | "app.guide"
  | "app.about"
  | "app.quit"
  | "stick.lock"
  | "stick.suspend"
  | "stick.restart"
  | "stick.powerOff"
  | "edit.undo"
  | "edit.redo"
  | "edit.selectAll"
  | "edit.find"
  | "edit.replace"
  | "edit.findNext"
  | "edit.findPrevious"
  | "edit.goToLine"
  | "editor.toggleTransliteration"
  | "check.suggestions"
  | "check.next"
  | "check.previous"
  | "check.toggleSpelling"
  | "check.toggleGrammar"
  | "editor.toggleFocus"
  | "editor.toggleTypewriter"
  | "view.toggleMarkdown"
  | "view.textBigger"
  | "view.textSmaller"
  | "view.textReset"
  | "view.cycleTheme"
  | "view.fullscreen"
  | "app.commandPalette"
  | "app.findAnything";

/** The switches whose state the menu and palette show. */
export type ToggleId =
  | "editor.toggleFocus"
  | "editor.toggleTypewriter"
  | "view.toggleMarkdown"
  | "editor.toggleTransliteration"
  | "check.toggleSpelling"
  | "check.toggleGrammar"
  | "view.fullscreen";

export type MenuSection = "File" | "Edit" | "View" | "Help";

export interface Command {
  id: CommandId;
  label: string;
  section: MenuSection;
  /** Its own shortcut, in CodeMirror key notation; `Mod` is Ctrl on Linux and Windows,
   * Cmd on macOS. A command without one is reached from the menu and the palette. The
   * writer may change it in keybindings.toml: use `shortcuts.keyFor(id)` for the one it
   * has now (keybindings.svelte.ts). */
  key?: string;
  /** A fixed gesture that isn't a shortcut, shown where its shortcut would be ("Shift
   * Shift" for Search). It can't be changed; the shortcut can. */
  gesture?: string;
  /** Keeps the desktop's standard key whatever keybindings.toml says (Undo, Redo,
   * Select all: the text field's own keys everywhere). */
  fixedKey?: boolean;
  /**
   * Where the shortcut works. Everywhere by default; "files" binds it only in the Files
   * panel, on its highlighted file or folder, never in the editor or the menu, for keys
   * that mean something else in text (Delete).
   */
  keyScope?: "files";
  /** Other words the Commands panel finds it by (DESIGN.md §11.1). */
  aliases?: readonly string[];
  /** One sentence shown beneath it in the Commands panel. */
  description?: string;
  /** A switch: the menu shows it with a check mark. */
  toggle?: (context: CommandContext) => boolean;
  /** Whether it can run now; the Commands panel lists only commands that can. */
  available?: (context: CommandContext) => boolean;
  /** Starts a new group in its menu. */
  separatorBefore?: boolean;
  /** Only on the desktop, or only on the bismillah stick (os/PLAN.md, OS-3); both
   * when absent. The other place's commands are left out of the registry at start. */
  place?: "desktop" | "stick";
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
  openAbout(): void;
  /** Opens the guide as a sample document (Help › Guide). */
  openGuide(): void;
  quit(): void;
  /** The stick's lock view, and its power actions (they save first). */
  lock(): void;
  power(action: "off" | "reboot" | "suspend"): void;
  /** The lock view is up: no command runs behind it. */
  locked(): boolean;
  isOn(id: ToggleId): boolean;
  /** A library folder is open (and available). */
  hasLibrary(): boolean;
  /** Rename and Move to trash have something to act on outside the Files panel: the
   * open document. */
  hasTarget(): boolean;
  newFolder(): void;
  openFolder(): void;
  /** The Files panel. */
  quickOpen(): void;
  rename(): void;
  trash(): void;
  /** The Commands panel. */
  commandPalette(): void;
  /** The panel used last, Files the first time (Shift Shift). */
  findAnything(): void;
  toggleFocus(): void;
  toggleTypewriter(): void;
  /** Always show Markdown, or live preview (ADR-0012). */
  toggleMarkdown(): void;
  toggleTransliteration(): void;
  /** Opens the suggestions for the issue at the caret (Mod-.). */
  showSuggestions(): void;
  /** Selects the next or previous issue and opens its suggestions (F7 / Shift-F7). */
  nextIssue(direction: 1 | -1): void;
  toggleSpelling(): void;
  toggleGrammar(): void;
  changeTextSize(step: -1 | 0 | 1): void;
  cycleTheme(): void;
  toggleFullscreen(): void;
}

const withView = (c: CommandContext, f: (view: EditorView) => unknown) => {
  if (c.view) f(c.view);
};

const ALL: readonly Command[] = [
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
    place: "desktop",
    run: (c) => c.openFile(),
  },
  {
    id: "library.openFolder",
    label: "Open folder…",
    section: "File",
    key: "Mod-Shift-o",
    aliases: ["library", "directory", "choose"],
    place: "desktop",
    run: (c) => c.openFolder(),
  },
  {
    id: "file.quickOpen",
    label: "Files",
    section: "File",
    key: "Mod-p",
    aliases: ["quick open", "find file", "go to file", "switch", "library", "folder"],
    description: "Search your files: find, open, rename and move them.",
    run: (c) => c.quickOpen(),
  },
  {
    id: "file.save",
    label: "Save now",
    section: "File",
    key: "Mod-s",
    separatorBefore: true,
    available: (c) => c.view !== null,
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
    keyScope: "files",
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
    description: "Search the settings; each changes in place.",
    run: (c) => c.openSettings(),
  },
  {
    id: "app.guide",
    label: "Guide",
    section: "Help",
    key: "F1",
    aliases: ["help", "manual", "documentation", "how to", "shortcuts"],
    description: "How bismillah works, in a document you can try things in.",
    run: (c) => c.openGuide(),
  },
  {
    id: "app.about",
    label: "About bismillah",
    section: "Help",
    aliases: ["version", "licence", "license", "credits", "inspiration"],
    run: (c) => c.openAbout(),
  },
  {
    id: "app.quit",
    label: "Quit",
    section: "File",
    key: "Mod-q",
    separatorBefore: true,
    place: "desktop",
    run: (c) => c.quit(),
  },
  // On the stick, quitting is powering off (os/PLAN.md, OS-3).
  {
    id: "stick.lock",
    label: "Lock",
    section: "File",
    separatorBefore: true,
    place: "stick",
    aliases: ["passphrase", "screen", "away"],
    description: "Hides your texts until the passphrase is typed.",
    run: (c) => c.lock(),
  },
  {
    id: "stick.suspend",
    label: "Suspend",
    section: "File",
    place: "stick",
    aliases: ["sleep", "standby", "lid"],
    description: "Saves, locks, and puts the computer to sleep.",
    run: (c) => c.power("suspend"),
  },
  {
    id: "stick.restart",
    label: "Restart",
    section: "File",
    place: "stick",
    aliases: ["reboot"],
    description: "Saves, then restarts the computer.",
    run: (c) => c.power("reboot"),
  },
  {
    id: "stick.powerOff",
    label: "Power off",
    section: "File",
    key: "Mod-q",
    place: "stick",
    aliases: ["quit", "shut down", "turn off", "exit"],
    description: "Saves, then turns the computer off.",
    run: (c) => c.power("off"),
  },
  {
    id: "edit.undo",
    fixedKey: true,
    label: "Undo",
    section: "Edit",
    key: "Mod-z",
    available: (c) => c.view !== null && !c.view.state.readOnly && undoDepth(c.view.state) > 0,
    run: (c) => withView(c, undo),
  },
  {
    id: "edit.redo",
    fixedKey: true,
    label: "Redo",
    section: "Edit",
    key: "Mod-Shift-z",
    available: (c) => c.view !== null && !c.view.state.readOnly && redoDepth(c.view.state) > 0,
    run: (c) => withView(c, redo),
  },
  {
    id: "edit.selectAll",
    fixedKey: true,
    label: "Select all",
    section: "Edit",
    key: "Mod-a",
    available: (c) => c.view !== null,
    run: (c) => withView(c, selectAll),
  },
  {
    id: "edit.find",
    label: "Find…",
    section: "Edit",
    key: "Mod-f",
    separatorBefore: true,
    aliases: ["search", "document"],
    available: (c) => c.view !== null,
    run: (c) => withView(c, openSearchPanel),
  },
  {
    id: "edit.replace",
    label: "Replace…",
    section: "Edit",
    key: "Mod-h",
    available: (c) => c.view !== null && !c.view.state.readOnly,
    run: (c) => withView(c, openReplace),
  },
  {
    id: "edit.findNext",
    label: "Find next",
    section: "Edit",
    key: "F3",
    available: (c) => c.view !== null,
    run: (c) => withView(c, findNext),
  },
  {
    id: "edit.findPrevious",
    label: "Find previous",
    section: "Edit",
    key: "Shift-F3",
    available: (c) => c.view !== null,
    run: (c) => withView(c, findPrevious),
  },
  {
    id: "edit.goToLine",
    label: "Go to line…",
    section: "Edit",
    key: "Mod-Alt-g",
    aliases: ["jump", "position", "percent", "percentage", "column"],
    description: "A line number, +10 or -10 lines, 50%, or a line:column (column starts at 0).",
    available: (c) => c.view !== null,
    run: (c) => withView(c, openGoToLine),
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
    id: "check.suggestions",
    label: "Show suggestions",
    section: "Edit",
    key: "Mod-.",
    separatorBefore: true,
    aliases: ["spelling", "grammar", "correct", "fix"],
    description: "Corrections for the possible mistake at the caret.",
    available: (c) => c.view !== null,
    run: (c) => c.showSuggestions(),
  },
  {
    id: "check.next",
    label: "Next issue",
    section: "Edit",
    key: "F7",
    aliases: ["spelling", "grammar", "mistake", "proofread"],
    available: (c) => c.view !== null,
    run: (c) => c.nextIssue(1),
  },
  {
    id: "check.previous",
    label: "Previous issue",
    section: "Edit",
    key: "Shift-F7",
    aliases: ["spelling", "grammar", "mistake", "proofread"],
    available: (c) => c.view !== null,
    run: (c) => c.nextIssue(-1),
  },
  {
    id: "check.toggleSpelling",
    label: "Check spelling",
    section: "Edit",
    aliases: ["spellcheck", "dictionary", "underline"],
    description: "Marks possible spelling mistakes in English and Arabic.",
    toggle: (c) => c.isOn("check.toggleSpelling"),
    run: (c) => c.toggleSpelling(),
  },
  {
    id: "check.toggleGrammar",
    label: "Grammar suggestions",
    section: "Edit",
    aliases: ["grammar", "harper", "underline"],
    description: "Marks possible grammar mistakes in English.",
    toggle: (c) => c.isOn("check.toggleGrammar"),
    run: (c) => c.toggleGrammar(),
  },
  {
    id: "app.commandPalette",
    label: "Commands",
    section: "View",
    key: "Mod-Shift-p",
    aliases: ["command palette", "actions"],
    description: "Search the commands.",
    run: (c) => c.commandPalette(),
  },
  {
    id: "app.findAnything",
    label: "Search",
    section: "View",
    key: "Mod-k",
    gesture: "Shift Shift",
    aliases: ["find anything", "palette", "go to", "shift shift"],
    description: "Files, commands and settings in one place. Or tap Shift twice.",
    run: (c) => c.findAnything(),
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
    id: "view.toggleMarkdown",
    label: "Always show Markdown",
    section: "View",
    key: "Mod-r",
    aliases: ["markup", "source", "live preview", "rendered", "marks", "syntax"],
    description: "Shows every Markdown mark, not only in the paragraph you're writing.",
    toggle: (c) => c.isOn("view.toggleMarkdown"),
    run: (c) => c.toggleMarkdown(),
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
    place: "desktop",
    run: (c) => c.toggleFullscreen(),
  },
];

/** The commands of this place: the desktop's until `useStickCommands()`. */
export const COMMANDS: readonly Command[] = ALL.filter((c) => c.place !== "stick");

/** On the bismillah stick: its power and lock commands instead of the desktop's
 * Quit, Open…, Open folder… and Fullscreen. Called once,
 * before anything reads the registry. */
export function useStickCommands(): void {
  (COMMANDS as Command[]).splice(0, COMMANDS.length, ...ALL.filter((c) => c.place !== "desktop"));
}

/** Every command, in both places (for the registry's own tests). */
export const ALL_COMMANDS = ALL;

/** Commands whose shortcut works everywhere: the editor keymap, the menu and the
 * window's own shortcut handler. */
export const GLOBAL_COMMANDS: readonly Command[] = ALL.filter((c) => !c.keyScope);

/** Punctuation keys by their accelerator names. */
const KEY_NAMES: Record<string, string> = {
  "=": "Equal",
  "-": "Minus",
  ",": "Comma",
  ".": "Period",
  "\\": "Backslash",
  "/": "Slash",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "`": "Backquote",
};

function parts(key: string): string[] {
  return key.split(/-(?!$)/);
}

/** CodeMirror key notation → Tauri accelerator ("Mod-Shift-l" → "CmdOrCtrl+Shift+L"). */
export function accelerator(key: string): string {
  return parts(key)
    .map((part) => {
      if (part === "Mod") return "CmdOrCtrl";
      return KEY_NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part);
    })
    .join("+");
}

/** The shortcut as the writer reads it on Linux ("Ctrl+Shift+T", "Ctrl+="). */
export function shortcutLabel(key: string | undefined): string {
  if (!key) return "";
  return parts(key)
    .map((part) => {
      if (part === "Mod") return "Ctrl";
      if (part.startsWith("Arrow")) return part.slice(5);
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join("+");
}

export const commandById = (id: CommandId): Command | undefined =>
  COMMANDS.find((c) => c.id === id);

/** Every command run, with how it was triggered; read by the native-menu tests. */
export const commandLog: { id: CommandId; source: CommandSource }[] = [];

export function runCommand(id: CommandId, source: CommandSource, context: CommandContext): boolean {
  const command = commandById(id);
  if (!command || context.locked() || (command.available && !command.available(context)))
    return false;
  commandLog.push({ id, source });
  command.run(context, source);
  return true;
}
