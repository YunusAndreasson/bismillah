/**
 * Shortcuts outside the editor. CodeMirror's keymap handles the registry's shortcuts
 * while the editor has focus; on the first screen, in Settings or anywhere else, this
 * matcher does, so Mod-O or Mod-, work wherever focus is (DESIGN.md §13).
 */

/** Physical keys by `KeyboardEvent.code`, so shortcuts work on any layout (Arabic too). */
function base(event: KeyboardEvent): string {
  const { code, key } = event;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const named: Record<string, string> = {
    Equal: "=",
    Minus: "-",
    Comma: ",",
    Period: ".",
    Backslash: "\\",
    Slash: "/",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Backquote: "`",
    Space: "Space",
  };
  return named[code] ?? key;
}

/** The event in CodeMirror key notation ("Mod-Shift-t"); Mod is Ctrl, or Cmd on macOS. */
export function keyOf(event: KeyboardEvent, mac = /Mac/.test(navigator.platform)): string {
  const mod = mac ? event.metaKey : event.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(base(event));
  return parts.join("-");
}

/** Normalises registry notation so "Mod-Shift-l" and an event's key compare equal. */
export function normalise(key: string): string {
  const parts = key.split(/-(?!$)/);
  const name = parts.pop() ?? "";
  const order = ["Mod", "Alt", "Shift"].filter((m) => parts.includes(m));
  return [...order, name.length === 1 ? name.toLowerCase() : name].join("-");
}
