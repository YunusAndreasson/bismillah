# Spike: native menu

*Phase 0, 2026-10-18.* Question (PLAN.md): can a menu generated from the command registry be hidden on Linux and revealed with `Alt`/`F10`, with accelerators that don't fight CodeMirror's keymap? Tested under GTK (X11) in the private Xvfb server with real X key events (`xdotool`).

**Verdict: go** on GTK/X11. Hyprland adds no conflicting bindings; **GNOME is untested** (no GNOME session on this machine); Wayland-native input should be confirmed by hand (checklist in PLAN.md).

## How

- `src/core/commands.ts` is the registry: ID, label, menu section, key (CodeMirror notation) and action. `accelerator()` converts keys to Tauri accelerators (`Mod-Shift-l` → `CmdOrCtrl+Shift+L`).
- `src/core/menu.ts` builds the menu with Tauri's JS menu API from the registry (File · Edit · View; GTK's own Cut/Copy/Paste items) and sets it as the window menu, then hides it.
- The same registry feeds a high-precedence CodeMirror keymap. Every run is logged with its source (`menu` or `keymap`), which the tests read.
- `Alt` pressed and released alone, or `F10`, calls `menu_reveal` (Rust): `show_menu()` plus, in `platform.rs`, GTK's `select_first` on the menu bar so the keyboard is in the menu. The bar's `deactivate` signal hides it again.

## Verified

| Action | Result |
|---|---|
| Start | menu hidden |
| `F10` | shown, first menu selected |
| `Esc` | hidden |
| `Alt` alone | shown, first menu selected; `Down` opens File; `Esc Esc` hides |
| `Alt+b`, `AltGr+2` | menu stays hidden; `@` typed |
| `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+T`, `Ctrl+A` | each runs once, through the CodeMirror keymap |
| `Ctrl+C` / `Ctrl+V` | native copy and paste work |

**Accelerators don't fight the editor:** while the bar is hidden, GTK doesn't fire menu accelerators, so CodeMirror's keymap handles the keys and nothing runs twice. While a menu is open, keys go to the menu. Both paths call the same registry command, so the result is identical either way.

Hyprland: none of the author's 239 bindings use `Alt` alone or `F10`.

## For Phase 1

- macOS needs the standard App and Edit menus (ARCHITECTURE.md §12.2); not exercised here.
- Menu labels show GTK's accelerator text (`Ctrl+S`), which matches the palette's planned display.
