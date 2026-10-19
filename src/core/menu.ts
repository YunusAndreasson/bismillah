import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
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
  const submenus = await Promise.all(
    sections.map(async (section) => {
      const entries: (MenuItem | CheckMenuItem | PredefinedMenuItem)[] = [];
      for (const c of COMMANDS.filter((command) => command.section === section)) {
        if (c.separatorBefore) entries.push(await PredefinedMenuItem.new({ item: "Separator" }));
        const key = acceleratorFor(c.id, c.keyScope !== undefined);
        shown.set(c.id, key);
        const options = {
          id: c.id,
          text: c.label,
          ...(key ? { accelerator: key } : {}),
          action: () => runCommand(c.id, "menu", context),
        };
        let item: MenuItem | CheckMenuItem;
        if (c.toggle) {
          const check = await CheckMenuItem.new({ ...options, checked: c.toggle(context) });
          checks.set(c.id, check);
          item = check;
        } else {
          item = await MenuItem.new(options);
        }
        items.set(c.id, item);
        entries.push(item);
        if (c.id === "edit.redo") {
          entries.push(
            await PredefinedMenuItem.new({ item: "Separator" }),
            await PredefinedMenuItem.new({ item: "Cut", text: "Cut" }),
            await PredefinedMenuItem.new({ item: "Copy", text: "Copy" }),
            await PredefinedMenuItem.new({ item: "Paste", text: "Paste" }),
          );
        }
      }
      return Submenu.new({ text: section, items: entries });
    }),
  );
  const menu = await Menu.new({ items: submenus });
  await menu.setAsWindowMenu(getCurrentWindow());
  await menuHide();
  listenForMenuKeys();
  return {
    async sync() {
      const work: Promise<void>[] = [];
      for (const [id, item] of checks) {
        const toggle = COMMANDS.find((c) => c.id === id)?.toggle;
        if (toggle) work.push(item.setChecked(toggle(context)));
      }
      for (const [id, item] of items) {
        const scoped = COMMANDS.find((c) => c.id === id)?.keyScope !== undefined;
        const key = acceleratorFor(id, scoped);
        if (shown.get(id) === key) continue;
        shown.set(id, key);
        work.push(item.setAccelerator(key));
      }
      await Promise.all(work);
    },
  };
}

function listenForMenuKeys(): void {
  // Alt reveals the menu only when pressed and released on its own, so Alt-based
  // shortcuts and AltGr (compose, Arabic layout) never open it.
  let altAlone = false;
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "F10" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        void menuReveal();
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
        void menuReveal();
      }
      altAlone = false;
    },
    true,
  );
  window.addEventListener("mousedown", () => (altAlone = false), true);
}
