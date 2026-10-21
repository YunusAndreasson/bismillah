# Usability review — 2026-10-20

Requested by the author: review the app using Jakob Nielsen's usability perspective,
make obvious improvements, and list every change. This is a heuristic inspection of
the real Linux Tauri app, not a user study or a review by Nielsen himself. The
framework is [Nielsen's ten usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).

The private headless harness was used throughout. The author's running desktop,
documents and installed package were not touched. Existing worktree changes were
preserved.

## Findings and changes

Severity: 2 = recurring task friction; 1 = smaller clarity or discovery problem.

| Severity | Finding | Improvement | Heuristics |
|---|---|---|---|
| 2 | Searching for absent text gives no visible explanation | The search panel now distinguishes an empty query, a match and no matches, with useful next steps | Visibility of status; recovery |
| 2 | An invalid regular expression silently does nothing | A plain explanation appears beside the field; its boundary and accessible invalid state identify the problem | Error prevention; recovery |
| 2 | The overlay library has no visible exit | A Close button returns focus to writing; the folder's complete name remains available on hover | User control and freedom |
| 2 | Quick open and the palette rely on remembered dismissal and navigation conventions | Visible titles and Close buttons, plus arrow/Enter/Escape hints; initial focus stays in the search field | Recognition; control; efficiency |
| 2 | An empty library says that no file matches, with no way forward | Separate empty-folder and no-match states; New file opens the native dialog. If the folder disappears while quick open is open, Choose another folder opens the native folder dialog | Status; recovery |
| 1 | Switches only identify their enabled state | The palette explicitly says On or Off | Status; consistency |
| 1 | Shortened picker names, paths and descriptions cannot be inspected in full | Hover titles expose complete text; accessible item text remains complete | Recognition |
| 1 | A newcomer must know F1 or the hidden menu to discover the guide | A quiet Guide button on the first screen shows its current shortcut | Help and documentation |

Search and replacement inputs also use their own text direction, so Arabic queries
and mixed-script replacements read naturally. Feedback uses CodeMirror's own query
cursor, preserves vocalisation, stops at the first match and skips selection-only
updates. It never edits text. The status region is explicitly named for WebKitGTK's
accessibility tree and describes the Find field.

## Review of all ten heuristics

1. **Visibility of status:** durable save state and persistent errors retained;
   search results and both toggle states made explicit.
2. **Match with the writer's world:** filenames remain the identity, native dialogs
   keep desktop conventions, search failures use plain words. The palette's hint
   says Enter to run; quick open says Enter to open.
3. **Control and freedom:** visible exits added; Escape, focus return, Undo and
   recoverable trash retained.
   Cancelling a native dialog opened from an empty-state action also restores the
   previous keyboard focus, using the same command handoff as ordinary palette actions.
4. **Consistency and standards:** existing semantic tokens, controls, command names
   and shortcuts retained; both pickers use the same header and footer pattern.
5. **Error prevention:** invalid search patterns are identified before attempting a
   replacement. No document transformation or file operation was added.
6. **Recognition rather than recall:** titles, explicit mode states, full-text hover
   descriptions and keyboard hints reduce guesswork.
7. **Efficiency:** search input still receives initial focus; no new steps are needed
   for expert shortcuts. Results do not require counting all matches.
8. **Minimalism:** changes appear in task panels or the first screen. The normal
   writing surface and its typography are unchanged.
9. **Recovery:** search and unavailable/empty-folder states now explain what to do;
   save-failure, conflict, recovery and trash flows remain covered by real-app tests.
10. **Help:** the bundled guide is directly discoverable; the guide and design/
    architecture documentation describe the new behaviour.

## Design review and evidence

Before and after screenshots are in `/tmp/bismillah-usability-review/`; Settings
review screenshots are in `/tmp/bismillah-nielsen-before-settings/`. The inspected
images show the first screen, palette, overlay library, invalid search, minimum-size
panels and enlarged writing in both themes. Existing specimen and search suites
cover vocalised Arabic and mixed lines at 640, 1280, 1920 and 2560 px.
The updated vocalised-Arabic search at 640 px and mixed-script selection at 200%
were also inspected in `/tmp/bismillah-search-review/`.

The five DESIGN.md §18 questions pass: the task and recovery action are apparent;
the current panel/mode is named; spacing groups related controls; keyboard focus
and accessible names follow the visible controls; layouts remain bounded across
the desktop sizes, themes and enlarged writing. Contrast uses the existing tested
semantic pairs. No motion was added.

Only `library-overlay-dark-640.png` was deliberately updated after inspection: the
new Close control increases its heading row. The other visual baselines remain as
they were at the start of this review. The prior overlay baseline is preserved at
`/tmp/bismillah-usability-review/before-library-baseline.png`.

## Verification

- `pnpm verify`: passes. Type checking, Prettier/ESLint, all 410 frontend tests,
  Rust fmt/Clippy and 153 Rust tests, dependency checks, the embedded app build,
  all 25 real-app suites and all 16 visual checks pass.
- `pnpm a11y`: all 14 states pass, including an invalid search pattern whose
  explanation reaches the Find field's accessible description.
- `tests/e2e/usability.e2e.ts`: eight real-app tests cover Guide discovery, palette
  focus and toggle state, empty-library creation and cancellation, missing-folder
  recovery, search feedback, visible library dismissal, desktop layout and minimum
  first-screen size. The new-file test waits for the library watcher's update.
- `src/editor/search.test.ts`: a new regression verifies invalid/empty results,
  whole-word matching, description linkage and feedback refresh after document edits.
- `git diff --check`: clean. No commit or installation was made.

## Limits

This is one evaluator's review. It does not establish first-time-user success rates
or what Orca speaks aloud. The deliberately faint routine status line follows the
author's existing design decision; changing it would require that decision to be
revisited. The personal 1.0 acceptance check remains with the author.
