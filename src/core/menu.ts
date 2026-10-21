import { CheckMenuItem, Menu, MenuItem, Submenu, type SubmenuOptions } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  accelerator,
  COMMANDS,
  runCommand,
  type CommandContext,
  type CommandId,
  type MenuSection,
} from "./commands.ts";
import { menuHide, menuReveal } from "./ipc.ts";
import { shortcuts } from "./keybindings.svelte.ts";

/**
 * The native application menu, generated from the command registry (ARCHITECTURE.md
 * §12.2). On Linux it stays hidden to keep the window calm; `Alt` (pressed and released
 * alone) or `F10` reveals it and puts keyboard focus on it, and it hides again when it
 * closes. Clipboard items are GTK's own, so they act on the webview natively. Switches
 * show their state with a check mark and accelerators follow keybindings.toml; call
 * `sync()` after either changes.
 */
export interface NativeMenu {
  sync(): Promise<void>;
  /** Reads the native item's state for the real-app test harness. */
  isEnabled(id: CommandId): Promise<boolean | null>;
}

export async function installMenu(context: CommandContext): Promise<NativeMenu> {
  const sections: MenuSection[] = ["File", "Edit", "View", "Help"];
  const checks = new Map<CommandId, CheckMenuItem>();
  const items = new Map<CommandId, MenuItem | CheckMenuItem>();
  // A library-only key (Delete) is never a menu accelerator: it would act in text.
  const acceleratorFor = (id: CommandId, scoped: boolean) => {
    const key = shortcuts.keyFor(id);
    return scoped || !key ? null : accelerator(key);
  };
  const shown = new Map<CommandId, string | null>();
  const enabled = new Map<CommandId, boolean>();
  // Tauri recursively creates these fresh descriptions in one IPC request.
  const submenus = sections.map((section): SubmenuOptions => {
    const entries: NonNullable<SubmenuOptions["items"]> = [];
    for (const c of COMMANDS.filter((command) => command.section === section)) {
      if (c.separatorBefore) entries.push({ item: "Separator" });
      const key = acceleratorFor(c.id, c.keyScope !== undefined);
      shown.set(c.id, key);
      const options = {
        id: c.id,
        text: c.label,
        enabled: c.available?.(context) ?? true,
        ...(key ? { accelerator: key } : {}),
        action: () => runCommand(c.id, "menu", context),
      };
      enabled.set(c.id, options.enabled);
      entries.push(c.toggle ? { ...options, checked: c.toggle(context) } : options);
      if (c.id === "edit.redo") {
        entries.push(
          { item: "Separator" },
          { item: "Cut", text: "Cut" },
          { item: "Copy", text: "Copy" },
          { item: "Paste", text: "Paste" },
        );
      }
    }
    return { text: section, items: entries };
  });
  const menu = await Menu.new({ items: submenus });
  // Retrieve native handles by section, rather than constructing each item over IPC.
  await Promise.all(
    (await menu.items()).map(async (section) => {
      if (!(section instanceof Submenu)) return;
      for (const item of await section.items()) {
        const command = COMMANDS.find((c) => c.id === item.id);
        if (!command || !(item instanceof MenuItem || item instanceof CheckMenuItem)) continue;
        items.set(command.id, item);
        if (item instanceof CheckMenuItem) checks.set(command.id, item);
      }
    }),
  );
  await menu.setAsWindowMenu(getCurrentWindow());
  await menuHide();
  const native: NativeMenu = {
    isEnabled: (id) => items.get(id)?.isEnabled() ?? Promise.resolve(null),
    async sync() {
      const work: Promise<void>[] = [];
      for (const [id, item] of checks) {
        const toggle = COMMANDS.find((c) => c.id === id)?.toggle;
        if (toggle) work.push(item.setChecked(toggle(context)));
      }
      for (const [id, item] of items) {
        const command = COMMANDS.find((c) => c.id === id);
        const usable = command?.available?.(context) ?? true;
        if (enabled.get(id) !== usable) {
          enabled.set(id, usable);
          work.push(item.setEnabled(usable));
        }
        const scoped = command?.keyScope !== undefined;
        const key = acceleratorFor(id, scoped);
        if (shown.get(id) === key) continue;
        shown.set(id, key);
        work.push(item.setAccelerator(key));
      }
      await Promise.all(work);
    },
  };
  // Availability and history can change while the menu is hidden. Refresh before
  // giving it focus, so visible items describe what can actually run now.
  listenForMenuKeys(() => void native.sync().then(menuReveal));
  return native;
}

function listenForMenuKeys(reveal: () => void): void {
  // Alt reveals the menu only when pressed and released on its own, so Alt-based
  // shortcuts and AltGr (compose, Arabic layout) never open it.
  let altAlone = false;
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "F10" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        reveal();
        return;
      }
      altAlone = event.key === "Alt" && !event.repeat;
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (event) => {
      if (event.key === "Alt" && altAlone) {
        event.preventDefault();
        reveal();
      }
      altAlone = false;
    },
    true,
  );
  window.addEventListener("mousedown", () => (altAlone = false), true);
}
