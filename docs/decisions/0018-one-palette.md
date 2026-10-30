# 0018 — Search: one palette for files, commands and settings

- **Status:** Accepted
- **Date:** 2026-10-29 (the author's decision)
- **Supersedes:** [0016](0016-three-panels.md)'s three panels, their tabs and their place at the bottom left

## Context
ADR-0016 split *Find anything* into three panels, Files, Commands and Settings, each rising from the status line's bottom-left names with the three names repeated as tabs. The author found the three tabs non-standard and asked for one palette on `Ctrl+K`, as in Notion, Linear, Raycast and VS Code, with `Ctrl+P`, `Ctrl+Shift+P` and `Ctrl+,` kept as ways into it. *Find anything*, three days earlier, had been too crowded (tree, recent files, commands, settings, four scope buttons and a long hint at once), and the author has asked that no row change height as the highlight moves. The new palette must be one place without either.

## Decision
- **One palette, *Search*,** centred near the top of the window and always the same size, whatever it lists. `Ctrl+K` (`app.findAnything`, now labelled *Search*) and `Shift Shift` open it over everything. `Ctrl+P`, `Ctrl+Shift+P` and `Ctrl+,` open it narrowed to files, commands or settings, shown as a small scope at the start of the field; a click on it, or `Backspace` in an empty field, widens to everything. `Tab` and `Shift+Tab` move through everything, files, commands and settings **with the query and, where still listed, the highlighted row kept**. The open scope's own key closes Search; another switches to it.
- **Little until you type.** Over everything, nothing typed lists only recent files, without the open one, so `Ctrl+K Enter` returns to the previous file. Narrowed, nothing typed keeps ADR-0016's lists (recent and all files; commands by menu; settings by section).
- **With a query, fixed sections.** Files, Commands and Settings, in that order, a few of each; a cut section's heading gives its total. Scattered-letter matches are left out whenever anything matches as a run of letters, and a setting that is also a command is listed once, as the command.
- **Steady:** one height, a description line always two lines tall (a file's folder, a command's description, a setting's hint), one key line naming `Tab`'s next scope, no tabs and no Close button. `Esc`, a click outside, or *Search* in the status line close it.
- **Keys keep their meaning in the field.** `← →` change a highlighted setting only when Search is narrowed to settings (and the query has no right-to-left text); elsewhere they move the caret. File keys (`F2`, `Delete`, `Ctrl+N`, `Ctrl+Shift+N`) act on a highlighted file or folder in any scope. A command opened from the status line runs in the text.
- **The status line** keeps one quiet *Search* button with its shortcut, in place of the three names.
- `Ctrl+K` belongs to Search. bismillah has no link command (ADR-0015); one would need another key.

## Consequences
- Files, commands and settings are found from one field, and the scopes keep the old panels' browsing without their tabs.
- Settings keeps everything ADR-0016 gave it (rows changed in place, *Show in Settings*), which now clears the query so the row is listed.
- The command IDs stay; `app.findAnything`'s label, key and description change, and keybindings.toml files naming it keep working.
- Tests: `src/core/panels.test.ts` (everything's lists, sections, noise floor, one row per switch), `fuzzy.test.ts` (match tiers), `tests/e2e/panels.e2e.ts`, the updated `usability`, `ui-review`, `library` and `settings` specs, visual baselines `search-*`, and `pnpm a11y` checking Search's name by scope.
