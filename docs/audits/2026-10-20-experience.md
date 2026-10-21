# Experience review — 2026-10-20

The author requested a UX review through Don Norman's perspective, obvious
improvements, and a complete change list. This is one evaluator's inspection of the
real Linux Tauri app, not a review by Norman or a user study. The method follows his
accounts of [signifiers](https://jnd.org/signifiers-not-affordances/),
[constraints and conventions](https://jnd.org/affordance-conventions-and-design-part-2/)
and [design as communication](https://jnd.org/design-as-communication/).

The earlier Nielsen pass covered basic discovery and visible escape routes. This
pass asks whether a writer can form the right intention, execute it, perceive the
result, interpret it and decide whether it worked.

## Findings and every improvement

| Finding | Change | Norman principle |
|---|---|---|
| Go to line gives no examples and closes after invalid input without moving | Added accepted-form examples and a field-linked explanation; invalid/empty submissions stay open and selected for correction. Leading/trailing field spaces are ignored. Escape still cancels | Signifiers; error recovery; feedback |
| Done could be mistaken for Apply | Settings visibly says Changes apply immediately, also as the dialog's accessible description | Conceptual model |
| Size and line-height buttons remain available when they cannot change the value | Disabled each direction at its actual limit | Constraints; action/result mapping |
| A profile-dependent default looks like a fixed number | The line-height output identifies font default and updates with the selected font; Reset restores it | Conceptual model; mapping |
| Settings write failures appear behind the open modal | Added an alert and Try again inside its sticky header. Retry persists the current choices, retaining them after failure | Feedback; recovery |
| A short window leaves insufficient space between sticky controls | Reduced header/footer padding in short windows and reserved scroll clearance at both boundaries. Tests check body space and actual Tab focus during a settings failure | Discoverability; execution |
| Section navigation mixes fractional and rounded header measurements | Use the same rounded measurement as the layout binding, so later size updates do not shift the section. The visual test uses the real Writing button, and a regression compares eight successive opens | Consistency; feedback |
| Save now has no distinct acknowledgement | Added Saved now only after the same document's latest revision is durably saved; autosave remains quiet | Feedback; evaluation |
| A previous action's confirmation could outlive the context | Passing messages clear on edits and document changes; a late save cannot acknowledge another document | Feedback; evaluation |
| Save now on a sample or read-only file appears to do nothing | Samples explain copying wanted text into a new file. Read-only files repeat their encoding explanation. Neither claims a save | Conceptual model; constraints |

## Review across Norman's principles

- **Affordances and signifiers:** controls use familiar desktop buttons, fields and
  native dialogs. New examples and default labels clarify what existing actions do.
- **Mapping:** size buttons now correspond to available changes; font defaults track
  the font rather than suggesting a fixed setting. Existing library selection and
  explicit Replace/Undo continue to map to the document the writer sees.
- **Constraints:** invalid navigation is contained and recoverable, stepper limits
  are visible, and read-only/sample states do not imply that saving succeeded.
- **Feedback:** explicit saves acknowledge their durable result. Settings failures
  are visible where the writer is working and offer a direct retry.
- **Conceptual model:** writing is saved automatically to plain files; samples are
  temporary; Settings applies immediately; a default can follow the writing profile.
  These existing rules are now conveyed at the point where confusion arose.
- **Human error and recovery:** corrections remain local. The save-failure fixture
  proves that failed text remains in the editor and the original file stays intact;
  retry saves the exact English, vocalised Arabic and mixed text.

## Evidence and design review

`/tmp/bismillah-norman-review/` holds before/after real-webview screenshots of
navigation, Settings limits/defaults, save explanations, and the settings failure.
The new real-app suite checks 480×360, 640, 1280, 1920 and 2560 px, light/dark and
200% writing size. The short-window failure check exercises Tab and measures the
focused control between the actual sticky header and footer. No author desktop
capture or personal document is used.

The DESIGN.md §18 review checks task priority, understandable file/mode/action,
grouping, keyboard/accessible structure and layout in the specified conditions.
Styles use existing semantic tokens; the contrast suite checks those pairs. No
motion or dependency was added. CodeMirror retains navigation calculation, the
Rust write protocol is unchanged, and document bytes are never normalised.

Only the Settings Writing screenshot baseline is deliberately updated after
inspection for the explanatory header and footer clearance. The small alignment
variation found in full verification came from random private folder labels wrapping
above Writing. A test-mode-only fixture now supplies fixed display labels without
changing Rust storage paths. Section navigation also uses consistent measurements;
the comparison tolerance is unchanged. Its starting version is preserved at
`/tmp/bismillah-norman-review/before-settings-baseline.png`.

## Verification

**Pass with the acceptance notes below.** The final `pnpm verify` run passed:

- Svelte/TypeScript checks, Prettier, ESLint, Rust formatting and Clippy.
- 413 frontend tests across 36 files, including three new navigation tests.
- 153 Rust tests and the offline cached supply-chain checks.
- 240 real-app tests across 26 suites, including seven new experience cases.
- All 16 visual checks, with the existing comparison tolerance unchanged.

`pnpm a11y` separately passed all 16 AT-SPI states, including the new invalid
navigation and Settings-save-failure states. `git diff --check` is clean.
The fixed-label Settings visual fixture also passed in a separate fresh session
and in the full visual suite before the final gate. No baseline other than
Settings Writing was changed for this review.

## Remaining acceptance

This inspection does not replace watching a new writer use the app or listening
to Orca speak. The author's deliberate faint-status preference and personal 1.0
acceptance remain as recorded in DESIGN.md and PLAN.md. No install or commit was
requested or performed.
