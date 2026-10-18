# Spike: keyboard input

*Phase 0, 2026-10-18.* Question (PLAN.md): do XKB layout switching (English ↔ Arabic), dead keys and compose sequences behave in the editor, and does the transliteration table avoid collisions?

**Verdict: go** for input on the X11/GTK path; **adjust** for the transliteration table ([transliteration.md](transliteration.md)). The Wayland path with fcitx5, which the author's session uses, needs a two-minute manual check (PLAN.md).

## Layouts, dead keys, compose

`spikes/webview/keyboard.ts` types into the real editor with raw XTEST keycodes (`xtest.py`), so XKB and GTK's input method do all the work, as with a physical keyboard. The layout mirrors the author's: **Swedish** with a Compose key, plus Arabic (Caps Lock switches, Right Alt composes, Menu is AltGr). xdotool can't be used for this: it resets the XKB group on every key.

| Case | Typed | Result |
|---|---|---|
| Swedish letters | å ä ö keys | åäö ✓ |
| Dead acute, grave, circumflex | ´ e, ` u, ^ a | é ù â ✓ |
| Compose | Compose - a, Compose a a | ā å ✓ |
| AltGr | AltGr+2 | @ ✓ (menu stays closed) |
| Switch to Arabic | Caps, h j k l | اتنم ✓ |
| Switch mid-word | Caps h, space, j, Caps h | ا تh ✓ |
| Arabic, back, dead key | Caps n, Caps, ´ e | نé ✓ |
| Dead key, then a switch | ´ Caps | ´ (GTK commits the accent) ✓ |

No lost or doubled characters in any case.

## Not covered headless

- **Wayland + fcitx5.** The author's Hyprland session runs fcitx5 and has Compose on Shift+Caps (`omarchy:shift_caps_compose`); GTK then uses the Wayland text-input protocol, a different path from the one tested. Checklist in PLAN.md.
- No Arabic layout is configured in the author's Hyprland yet; adding one is the author's choice.

## Transliteration table (corpus half)

Run by a separate harness over 1.8M words of English and Islamic-studies prose: [transliteration.md](transliteration.md). Final table: `a= i= u=` → ā ī ū (was `a-`, which broke IJMES particles such as *wa-l-* and *bi-llāh*); `.h .s .d .t .z` → ḥ ṣ ḍ ṭ ẓ with a guard for upper case after a letter (A.H., U.S.); `` ` `` → ʿ with two backtick rules for code; `''` → ʾ.
