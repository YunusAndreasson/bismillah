# Search: a lighter palette, measured against Notion (2026-10-30)

The author asked for the `Ctrl+K` palette's interface and experience to be refined, with Notion as the benchmark. Recorded as [ADR-0020](../decisions/0020-search-refined.md), amending ADR-0018. The comparison rests on knowledge of Notion's current interface; Notion wasn't opened during this work.

## What changed

| Area | Before | After |
|---|---|---|
| Frame | `border-control` round the palette and between its parts, 8px radius | `border-subtle` hairlines, 12px radius |
| Shadow | `text-primary` at 14%, which glowed round dark themes | `shadow-overlay`, black in every theme; menus and tooltips use `shadow-popover` |
| Scrim | 60% (About 70%), the letter still legible beside the palette | `scrim`, 80%, for Search, About and the name prompt |
| Highlight | Faint fill and a 3px green edge | `surface-selected` fill; the edge only in high contrast and forced colours |
| Field | Text alone, a 2px underline while focused | A magnifier; a borderless scope; the underline only in high contrast |
| Description | A band two lines tall in every scope, often empty | Only in Settings; elsewhere along the highlighted row |
| A file's folder | At the row's far end, and again under the list | After its name, once |
| Key line | One run of words | Keys in `text-primary`, what they do in `text-secondary` |
| Matches | Not shown | A neutral tint on each word's best run of letters |
| Nothing found, narrowed | A note | A centred note and *Search everything*, with the query kept |

## Bugs fixed

- **The dark themes' glow,** at all five places that drew this shadow.
- **An opened setting's controls were cut off by the footer** (visible in the old `search-settings-measure-dark-1280` baseline): opening now scrolls the whole block into view.
- **A group's heading could stay hidden** above its first row after wrapping round the list.
- **The key line's end vanished in short windows** although it took no height there; it now goes only when the palette is narrow.

Found while running the gate, outside Search: `format-bar.e2e.ts`'s read-only test made its file read-only with `chmod`, but the app opens a file read-only only when it isn't UTF-8 (`app.rs`), so the bar rightly appeared and the test failed whatever the code did. It now uses a file that isn't UTF-8.

## Marking matches

`matchRanges` (`fuzzy.ts`) maps a word found in the folded text back to whole letters with their marks in the name as written. The tint is painted with the CSS Custom Highlight API rather than spans, because the app's text must not be split where ADR-0011's WebKit bug can show. A spike in the real WebKitGTK 2.54 webview compared plain and marked Arabic, vocalised and mixed names side by side before building on it: joining and marks were unchanged.

## Evidence

- Unit: `src/core/fuzzy.test.ts` (diacritics, ʿ, vocalised Arabic, whole letters, word starts, overlaps, scattered letters, aliases); `src/styles/tokens.test.ts` (text on the highlighted row and on a match, ≥ 4.5:1 in all four themes).
- Real app: five new tests in `tests/e2e/panels.e2e.ts` (steady heights and the description's link; marks that don't split a name; *Search everything*; an opened setting clear of the footer; a group's heading in view).
- Visual: the five `search-*` baselines were rewritten and reviewed; the other baselines still match within their tolerance and were left as they were.

## Design review (DESIGN.md §18)

Checked in the real app with `pnpm app:shot` at 480 by 360 and 1280, light, dark and high contrast, with Arabic names and queries. The focused field was checked by focusing the window inside the private display: the caret shows and there is no underline.

1. **The important content is apparent:** the field, then the highlighted row. Rules and headings stepped back.
2. **The current scope, file and action:** the scope is in the field, the open file is weight 600, and the key line says what `Enter` and `Tab` do.
3. **Grouping:** a name and its folder are now adjacent; an opened setting continues its row in one fill.
4. **Keyboard and semantics match:** unchanged keys and one tab stop. An inline description is the row's accessible description, hidden from its name so that it isn't read twice.
5. **Widths, themes, RTL, short windows:** one height everywhere; Arabic stays isolated with `<bdi>`.

Noted, not changed:

- The highlight's fill is below §9.4's 3:1, the exception ADR-0020 records.
- In Settings the band stands blank for a row without a hint, so that the list's height holds.
- A long description outside Settings is cut short for sighted keyboard users; hover and screen readers get all of it.
- Forced colours and widths 640, 1920 and 2560 were not looked at by eye in this change, beyond the `search-commands-dark-640` baseline. Forced colours can't be turned on in the harness.
