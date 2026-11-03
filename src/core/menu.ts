import {
  CheckMenuItem,
  Menu,
  MenuItem,
  Submenu,
  type CheckMenuItemOptions,
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  accelerator,
  COMMANDS,
  runCommand,
  type Command,
  type CommandContext,
  type CommandId,
  type MenuSection,
} from "./commands.ts";
import { menuHide, menuReveal } from "./ipc.ts";
import { shortcuts } from "./keybindings.svelte.ts";
import { onMac } from "./keys.ts";

/**
 * The native application menu, generated from the command registry (ARCHITECTURE.md
 * §12.2). On Linux it stays hidden to keep the window calm; `Alt` (pressed and released
 * alone) or `F10` reveals it and puts keyboard focus on it, and it hides again when it
 * closes. On macOS it is the app-wide menu bar, always shown (`menuLayout`). Clipboard
 * items are the platform's own, so they act on the webview natively. Switches show their
 * state with a check mark and accelerators follow keybindings.toml; call `sync()` after
 * either changes.
 */
export interface NativeMenu {
  sync(): Promise<void>;
  /** Reads the native item's state for the real-app test harness. */
  isEnabled(id: CommandId): Promise<boolean | null>;
}

type MenuEntry = MenuItemOptions | CheckMenuItemOptions | PredefinedMenuItemOptions;

const SECTIONS: MenuSection[] = ["File", "Edit", "Format", "View", "Help"];
/** macOS keeps these in the App menu, named after the app, as its writers expect. */
const APP_MENU: CommandId[] = ["app.about", "app.settings", "app.quit"];
/**
 * On macOS a menu item's shortcut is taken before the page sees it, so these stay the
 * system's own and act on whichever field has focus. CodeMirror answers the native undo
 * and redo (`historyUndo`, `historyRedo`). Their keys are fixed, so nothing is lost.
 */
const NATIVE_ON_MAC: Partial<Record<CommandId, "Undo" | "Redo" | "SelectAll">> = {
  "edit.undo": "Undo",
  "edit.redo": "Redo",
  "edit.selectAll": "SelectAll",
};

/** AppKit adds its own *Enter Full Screen* (⌃⌘F) to a macOS View menu; F11 stays a key. */
const SYSTEM_ON_MAC: CommandId[] = ["view.fullscreen"];

/** The menu bar's submenus, with each command's own item from `item`. */
export function menuLayout(mac: boolean, item: (command: Command) => MenuEntry): SubmenuOptions[] {
  const separator: MenuEntry = { item: "Separator" };
  const entries = (commands: Command[]): MenuEntry[] =>
    commands.flatMap((c) => {
      const native = mac ? NATIVE_ON_MAC[c.id] : undefined;
      const own: MenuEntry = native ? { item: native, text: c.label } : item(c);
      const clipboard: MenuEntry[] =
        c.id === "edit.redo"
          ? [
              separator,
              { item: "Cut", text: "Cut" },
              { item: "Copy", text: "Copy" },
              { item: "Paste", text: "Paste" },
            ]
          : [];
      return [...(c.separatorBefore ? [separator] : []), own, ...clipboard];
    });
  const sections = SECTIONS.map((section) => ({
    text: section,
    items: entries(
      COMMANDS.filter(
        (c) =>
          c.section === section &&
          !(mac && (APP_MENU.includes(c.id) || SYSTEM_ON_MAC.includes(c.id))),
      ),
    ),
  }));
  if (!mac) return sections;
  // The App menu draws its own separators, so a command's own separator would double one.
  const [about, settings, quit] = APP_MENU.map((id) =>
    COMMANDS.filter((c) => c.id === id).map((c) => ({ ...c, separatorBefore: false })),
  );
  const app: SubmenuOptions = {
    text: "bismillah",
    items: [
      ...entries(about ?? []),
      separator,
      ...entries(settings ?? []),
      separator,
      { item: "Services" },
      separator,
      { item: "Hide" },
      { item: "HideOthers" },
      { item: "ShowAll" },
      separator,
      ...entries(quit ?? []),
    ],
  };
  const windows: SubmenuOptions = {
    text: "Window",
    items: [{ item: "Minimize" }, { item: "Maximize" }, separator, { item: "BringAllToFront" }],
  };
  const help = sections.pop();
  return [app, ...sections, windows, ...(help ? [help] : [])];
}

export async function installMenu(context: CommandContext): Promise<NativeMenu> {
  const mac = onMac();
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
  const submenus = menuLayout(mac, (c) => {
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
    return c.toggle ? { ...options, checked: c.toggle(context) } : options;
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
  if (mac) {
    await menu.setAsAppMenu();
  } else {
    await menu.setAsWindowMenu(getCurrentWindow());
    await menuHide();
  }
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
  // giving it focus, so visible items describe what can actually run now. On macOS the
  // menu is always there, and Option alone types characters.
  if (!mac) listenForMenuKeys(() => void native.sync().then(menuReveal));
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
