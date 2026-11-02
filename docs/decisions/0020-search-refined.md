# 0020 — Search: a lighter palette, measured against Notion

- **Status:** Accepted
- **Date:** 2026-10-30 (the author's request and approval of the plan)
- **Amends:** [0018](0018-one-palette.md)'s description line and highlighted row; DESIGN.md §9.4's edge bar

## Context
The author asked for Search's interface to be refined with Notion's `Ctrl+K` as the benchmark. It looked like a bordered form: three hard rules, a highlight with a green bar, and a two-line description band that stood empty for many rows and limited the list to seven. In dark themes its shadow glowed, because it was drawn in `text-primary`. Three of the changes depart from recorded rules.

## Decision
- **The highlighted row is a neutral fill, with no edge bar.** The fill (`surface-selected`) doesn't reach §9.4's 3:1 for state indicators, a deliberate exception chosen for the benchmark. The row is still exposed as selected, and the edge returns in high contrast and forced colours.
- **The description band stays only in Settings,** where a hint says what a change does and can run long. Elsewhere the footer is one line. A file's or folder's folder sits after its name on every row. A command's or setting's description sits along the highlighted row only, cut short with its full text on hover, and is still the row's accessible description.
- **The field has no focus underline,** except in high contrast. Focus never leaves the field, and the caret shows it.
- **What matched is marked** with a neutral tint, through the CSS Custom Highlight API. Spans would split a name, and Arabic letters and their marks must stay one run (ADR-0011). Runs of letters only: scattered letters and aliases mark nothing.
- **A narrowed search that finds nothing offers *Search everything*,** with the query kept.
- **Overlays share tokens:** `shadow-overlay`, `shadow-popover` (dark in every theme) and `scrim`, so the glow is gone from every dialog, menu and tooltip.

Kept from ADR-0018: one fixed height, no motion, no suggestions when empty, no tabs, fixed sections and the same keys. Not taken from Notion: icons on rows (the sections name the kinds, and they would crowd), filter chips (the author rejected tabs), and recents by date (the library keeps no opening times). Keys stay words, as elsewhere in the app.

## Consequences
- About three more rows fit in the same palette outside Settings.
- A keyboard user sees a long command description only as far as the row allows; a screen reader gets all of it.
- A blank band remains in Settings for rows without a hint, so that the list's height doesn't change between rows.
- Tests: `src/core/fuzzy.test.ts` (`matchRanges`), `src/styles/tokens.test.ts` (text on the highlighted row and on a match), `tests/e2e/panels.e2e.ts`, visual baselines `search-*`. Evidence: [the audit](../audits/2026-10-30-search-polish.md).
