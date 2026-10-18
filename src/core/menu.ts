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

/**
 * The native application menu, generated from the command registry (ARCHITECTURE.md
 * §12.2). On Linux it stays hidden to keep the window calm; `Alt` (pressed and released
 * alone) or `F10` reveals it and puts keyboard focus on it, and it hides again when it
 * closes. Clipboard items are GTK's own, so they act on the webview natively. Switches
 * show their state with a check mark; call `sync()` after one changes.
 */
export interface NativeMenu {
  sync(): Promise<void>;
}

export async function installMenu(context: CommandContext): Promise<NativeMenu> {
  const sections: MenuSection[] = ["File", "Edit", "View"];
  const checks = new Map<CommandId, CheckMenuItem>();
  const submenus = await Promise.all(
    sections.map(async (section) => {
      const items: (MenuItem | CheckMenuItem | PredefinedMenuItem)[] = [];
      for (const c of COMMANDS.filter((command) => command.section === section)) {
        if (c.separatorBefore) items.push(await PredefinedMenuItem.new({ item: "Separator" }));
        const options = {
          id: c.id,
          text: c.label,
          accelerator: accelerator(c.key),
          action: () => runCommand(c.id, "menu", context),
        };
        if (c.toggle) {
          const item = await CheckMenuItem.new({ ...options, checked: c.toggle(context) });
          checks.set(c.id, item);
          items.push(item);
        } else {
          items.push(await MenuItem.new(options));
        }
        if (c.id === "edit.redo") {
          items.push(
            await PredefinedMenuItem.new({ item: "Separator" }),
            await PredefinedMenuItem.new({ item: "Cut", text: "Cut" }),
            await PredefinedMenuItem.new({ item: "Copy", text: "Copy" }),
            await PredefinedMenuItem.new({ item: "Paste", text: "Paste" }),
          );
        }
      }
      return Submenu.new({ text: section, items });
    }),
  );
  const menu = await Menu.new({ items: submenus });
  await menu.setAsWindowMenu(getCurrentWindow());
  await menuHide();
  listenForMenuKeys();
  return {
    async sync() {
      await Promise.all(
        [...checks].map(([id, item]) => {
          const toggle = COMMANDS.find((c) => c.id === id)?.toggle;
          return toggle ? item.setChecked(toggle(context)) : undefined;
        }),
      );
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
