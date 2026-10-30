# 0016 — Files, Commands and Settings: three panels in place of the tree and the dialog

- **Status:** Superseded by [0018](0018-one-palette.md) (2026-10-29): one palette, *Search*, in place of the three panels and their tabs
- **Date:** 2026-10-26 (the author's decision)
- **Supersedes:** the library tree, the docked library and its overlay (Phase 2, DESIGN.md §6–7), the four-section Settings dialog (Phase 5), and *Find anything*'s one panel (2026-10-23)

## Context
Find anything (`Shift Shift`) put the library tree, recent files, the main commands, settings, four scope buttons and a long key hint in one 60rem panel. The author found it too crowded. The library was also in two more places: docked beside the text, and as an overlay in narrow windows. Settings was a fourth surface, a dialog in four sections. The same files and the same settings could each be reached in more than one shape, with different keys in each.

## Decision
- **Three panels: Files, Commands and Settings.** Their names sit at the start of the status line, in its quiet type. Each opens a panel that rises from the window's bottom-start corner; the panel's foot repeats the three names exactly where the status line has them, as its tabs. `Ctrl+P`, `Ctrl+Shift+P` and `Ctrl+,` open them, and `Shift Shift` reopens the one used last.
- **One way to move.** Focus stays in the search field: `↑ ↓` (and `Page Up/Down`) move the highlight, `Enter` acts, `Tab` and `Shift+Tab` move to the next or previous panel **with the query kept**, and `← →` change a highlighted choice or size. `Esc` closes an opened row, then the panel.
- **No folder tree, anywhere.** Files lists recent files and then every file, each with its folder; folders appear when a search finds them, and `Enter` on one (or typing `Essays/`) shows what is in it. Rename (`F2`), Move to trash (`Delete`, once nothing follows the caret) and New file/folder act on the highlighted row. Links that lead outside the library are no longer listed: they could never be opened.
- **The Settings panel replaces the Settings dialog.** Every setting is one row: a switch changes with `Enter`, a choice or size with `← →`, and `Enter` opens any other row in place (every choice, the stepper, the font's name, the stick's keyboard and time zone, keybindings.toml and the colour themes' problems). *Show in Settings* opens the panel at its row.
- The `view.toggleLibrary` command and `Mod-\` are gone, with the remembered *library shown* state in Rust.

## Consequences
- One surface per job, with the same keys everywhere: the writer learns ↑ ↓ Enter Tab once.
- The writing column never moves for a docked library, so `layout.ts`, the library offset and the tree's keyboard model are gone. A folder with hundreds of files is reached by typing rather than browsing; Files lists the first 500 with nothing typed.
- An empty new folder is shown by narrowing Files to it, so a file can be made there.
- WebKitGTK reports Shift+Tab as `Unidentified` with code `Tab`; the panel reads the code.
- Tests: `tests/e2e/panels.e2e.ts` and the rewritten `library.e2e.ts`, `settings.e2e.ts` and `experience.e2e.ts`; unit tests in `src/core/panels.test.ts` and `settingEntries.test.ts`; visual baselines `panel-*`; `pnpm a11y` audits the three panels and an opened row.
