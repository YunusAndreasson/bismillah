import { COMMANDS, shortcutLabel, type Command, type CommandId } from "./commands.ts";
import { keybindingsCreate, keybindingsGet, type KeybindingsFile } from "./ipc.ts";
import { resolve, template, type ShortcutProblem } from "./shortcuts.ts";

/**
 * The writer's shortcuts (DESIGN.md §13): every command's own, changed by the lines of
 * `keybindings.toml`. Rust reads the file (src-tauri/src/keybindings.rs); this checks
 * each line against the command registry and keeps the shortcut each command has now,
 * which the editor keymap, the native menu, the palette and the window's own handler
 * all follow. The file applies as soon as it is saved (the configuration watcher).
 */

class Shortcuts {
  /** Each command's shortcut now (CodeMirror notation). */
  keys = $state(resolve({ exists: false, entries: [], unreadable: null }).keys);
  problems = $state<ShortcutProblem[]>([]);
  file = $state<Pick<KeybindingsFile, "exists" | "unreadable">>({
    exists: false,
    unreadable: null,
  });
  changed = $state(0);

  keyFor(id: CommandId): string | undefined {
    return this.keys.get(id);
  }

  /** The shortcut as the writer reads it ("Ctrl+Shift+T"), or "". */
  label(id: CommandId): string {
    return shortcutLabel(this.keys.get(id));
  }

  /** Commands whose shortcut works everywhere, with it. */
  bound(): { command: Command; key: string }[] {
    return COMMANDS.flatMap((command) => {
      const key = this.keys.get(command.id);
      return key && !command.keyScope ? [{ command, key }] : [];
    });
  }

  apply(file: KeybindingsFile): boolean {
    const next = resolve(file);
    const same =
      next.keys.size === this.keys.size &&
      [...next.keys].every(([id, key]) => this.keys.get(id) === key);
    this.keys = next.keys;
    this.problems = next.problems;
    this.changed = next.changed;
    this.file = { exists: file.exists, unreadable: file.unreadable };
    return !same;
  }

  /** Reads the file again; true if any shortcut changed. */
  async load(): Promise<boolean> {
    return this.apply(await keybindingsGet());
  }

  async create(): Promise<void> {
    this.apply(await keybindingsCreate(template()));
  }
}

export const shortcuts = new Shortcuts();
