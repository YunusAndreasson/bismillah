import { COMMANDS, shortcutLabel, type Command, type CommandId } from "./commands.ts";
import type { KeybindingsFile } from "./ipc.ts";

/**
 * The rules for keybindings.toml (DESIGN.md §13): how a shortcut is written, which keys
 * a command may take, and how the file's lines apply over each command's own shortcut.
 * Pure functions; the store that follows the file is keybindings.svelte.ts.
 */

/** Why a line of the file wasn't used. Every such command keeps its own shortcut. */
export type ShortcutProblem =
  | { kind: "unknown_command"; command: string; line: number }
  | { kind: "not_text"; command: CommandId; line: number }
  | { kind: "unreadable"; command: CommandId; shortcut: string; line: number }
  /** Keys that edit or move through text, Ctrl+C/V/X/Z/Y/A and F10 stay with the text
   * and the menu. */
  | { kind: "kept"; command: CommandId; shortcut: string; line: number }
  /** Undo, Redo and Select all keep the desktop's standard keys. */
  | { kind: "fixed"; command: CommandId; line: number }
  | { kind: "repeated"; command: CommandId; line: number }
  | { kind: "twice"; shortcut: string; commands: [CommandId, CommandId]; line: number };

const MODIFIERS: Record<string, "Mod" | "Alt" | "Shift"> = {
  ctrl: "Mod",
  control: "Mod",
  mod: "Mod",
  cmd: "Mod",
  command: "Mod",
  cmdorctrl: "Mod",
  commandorcontrol: "Mod",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

/** Key names a writer may use, in either case → CodeMirror's. */
const NAMED: Record<string, string> = {
  equal: "=",
  minus: "-",
  comma: ",",
  period: ".",
  backslash: "\\",
  slash: "/",
  semicolon: ";",
  quote: "'",
  bracketleft: "[",
  bracketright: "]",
  backquote: "`",
  delete: "Delete",
  del: "Delete",
  backspace: "Backspace",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  space: "Space",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  insert: "Insert",
};

const PUNCTUATION = new Set(["=", "-", ",", ".", "\\", "/", ";", "'", "[", "]", "`"]);

/** Keys that edit or move through text: never a global shortcut, with any modifier. */
const TEXT_KEYS = new Set([
  "Delete",
  "Backspace",
  "Enter",
  "Tab",
  "Escape",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
]);

/** The clipboard's and the standard editing commands' keys, kept for the text. */
const RESERVED = new Set(["Mod-c", "Mod-v", "Mod-x", "Mod-z", "Mod-Shift-z", "Mod-y", "Mod-a"]);

/**
 * A shortcut as the menus print it ("Ctrl+Shift+T") or in CodeMirror's notation
 * ("Mod-Shift-t"), in CodeMirror's normal form; null if it isn't one.
 */
export function parseShortcut(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.includes("+") ? trimmed.split("+") : trimmed.split(/-(?!$)/);
  const name = parts.pop()?.trim() ?? "";
  const mods = new Set<string>();
  for (const part of parts) {
    const mod = MODIFIERS[part.trim().toLowerCase()];
    if (!mod || mods.has(mod)) return null;
    mods.add(mod);
  }
  let key: string;
  if (/^[a-z0-9]$/i.test(name)) key = name.toLowerCase();
  else if (PUNCTUATION.has(name)) key = name;
  else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(name)) key = name.toUpperCase();
  else {
    const named = NAMED[name.toLowerCase()];
    if (!named) return null;
    key = named;
  }
  return [...["Mod", "Alt", "Shift"].filter((m) => mods.has(m)), key].join("-");
}

/** Whether a shortcut may run `command`, or why not ("kept"). */
function allowed(key: string, command: Command): boolean {
  const parts = key.split(/-(?!$)/);
  const name = parts.at(-1) ?? "";
  const mods = parts.slice(0, -1);
  if (RESERVED.has(key) || name === "F10") return false;
  if (/^F\d+$/.test(name)) return true;
  // In the Files panel, on its highlighted file, Delete may act on files (DESIGN.md §13).
  if (command.keyScope === "files" && name === "Delete") return true;
  if (TEXT_KEYS.has(name)) return false;
  return mods.includes("Mod") || mods.includes("Alt");
}

export interface Resolved {
  /** Each command's shortcut now; absent: none. */
  keys: Map<CommandId, string>;
  problems: ShortcutProblem[];
  /** How many commands the file changed. */
  changed: number;
}

/** Applies the file's lines over the commands' own shortcuts (DESIGN.md §13). */
export function resolve(file: KeybindingsFile, commands: readonly Command[] = COMMANDS): Resolved {
  const problems: ShortcutProblem[] = [];
  const chosen = new Map<CommandId, { key: string | null; line: number }>();
  const byId = (id: string) => commands.find((c) => c.id === id);
  for (const entry of file.entries) {
    const command = byId(entry.command);
    if (!command) {
      problems.push({ kind: "unknown_command", command: entry.command, line: entry.line });
      continue;
    }
    const at = { command: command.id, line: entry.line };
    if (command.fixedKey) problems.push({ kind: "fixed", ...at });
    else if (chosen.has(command.id)) problems.push({ kind: "repeated", ...at });
    else if (entry.shortcut === null) problems.push({ kind: "not_text", ...at });
    else if (entry.shortcut.trim() === "") chosen.set(command.id, { key: null, line: entry.line });
    else {
      const key = parseShortcut(entry.shortcut);
      if (!key) problems.push({ kind: "unreadable", ...at, shortcut: entry.shortcut });
      else if (!allowed(key, command)) problems.push({ kind: "kept", ...at, shortcut: key });
      else chosen.set(command.id, { key, line: entry.line });
    }
  }
  // One shortcut given to two commands: neither line is used.
  for (const [id, { key, line }] of [...chosen]) {
    if (key === null || !chosen.has(id)) continue;
    const other = [...chosen].find(([o, c]) => o !== id && c.key === key);
    if (!other) continue;
    problems.push({ kind: "twice", shortcut: key, commands: [id, other[0]], line });
    chosen.delete(id);
    chosen.delete(other[0]);
  }
  const keys = new Map<CommandId, string>();
  for (const c of commands) if (c.key) keys.set(c.id, c.key);
  for (const [id, { key }] of chosen) {
    // A shortcut the writer gave to one command is no longer another's.
    if (key) for (const [other, k] of keys) if (k === key && other !== id) keys.delete(other);
  }
  for (const [id, { key }] of chosen) {
    if (key) keys.set(id, key);
    else keys.delete(id);
  }
  problems.sort((a, b) => a.line - b.line);
  return { keys, problems, changed: chosen.size };
}

/** The starting file *Create keybindings.toml* writes: every command, commented out. */
export function template(commands: readonly Command[] = COMMANDS): string {
  const lines = [
    "# Keyboard shortcuts for bismillah.",
    "#",
    "# To change a command's shortcut, remove the # at the start of its line and edit",
    '# the shortcut. A command not listed here keeps its own; "" leaves it without one.',
    "# Write shortcuts as the menus show them: Ctrl+Shift+T, Alt+F, F11. A shortcut",
    "# needs Ctrl or Alt with a letter, digit or punctuation key, or a function key.",
    "# Keys that edit or move through text stay with the text. bismillah applies this",
    "# file as soon as it is saved.",
    "schema = 1",
  ];
  let section = "";
  const rows = commands.filter((c) => !c.fixedKey);
  // A TOML string: Ctrl+\ is written "Ctrl+\\".
  const line = (c: Command) => `# "${c.id}" = "${shortcutLabel(c.key).replaceAll("\\", "\\\\")}"`;
  const width = Math.max(...rows.map((c) => line(c).length));
  for (const c of rows) {
    if (c.section !== section) {
      section = c.section;
      lines.push("", `# ${section}`);
    }
    lines.push(`${line(c).padEnd(width)}  # ${c.label}`);
  }
  return `${lines.join("\n")}\n`;
}
