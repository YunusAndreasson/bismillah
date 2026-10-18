import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  accelerator,
  COMMANDS,
  runCommand,
  type CommandContext,
  type MenuSection,
} from "./commands.ts";
import { menuHide, menuReveal } from "./ipc.ts";

/**
 * The native application menu, generated from the command registry (ARCHITECTURE.md
 * §12.2). On Linux it stays hidden to keep the window calm; `Alt` (pressed and released
 * alone) or `F10` reveals it and puts keyboard focus on it, and it hides again when it
 * closes. Clipboard items are GTK's own, so they act on the webview natively.
 */
export async function installMenu(context: CommandContext): Promise<void> {
  const sections: MenuSection[] = ["File", "Edit", "View"];
  const submenus = await Promise.all(
    sections.map(async (section) => {
      const items: (MenuItem | PredefinedMenuItem)[] = await Promise.all(
        COMMANDS.filter((c) => c.section === section).map((c) =>
          MenuItem.new({
            id: c.id,
            text: c.label,
            accelerator: accelerator(c.key),
            action: () => runCommand(c.id, "menu", context),
          }),
        ),
      );
      if (section === "Edit") {
        items.push(
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Cut", text: "Cut" }),
          await PredefinedMenuItem.new({ item: "Copy", text: "Copy" }),
          await PredefinedMenuItem.new({ item: "Paste", text: "Paste" }),
        );
      }
      return Submenu.new({ text: section, items });
    }),
  );
  const menu = await Menu.new({ items: submenus });
  await menu.setAsWindowMenu(getCurrentWindow());
  await menuHide();
  listenForMenuKeys();
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
