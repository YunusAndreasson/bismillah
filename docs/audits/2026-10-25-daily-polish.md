# Daily writing polish — 2026-10-25

The author selected six refinements after a design critique. This is a local design
pass, not a review by Steve Jobs or a user study. It preserves the offline, plain-text
and durable-save contracts and follows DESIGN.md §7–12, §17–19.

## Changes

1. **Opening proportions.** The Basmallah has half a body line above and one below,
   reducing its combined padding by one body line. Content top padding is capped at
   4vh in short windows. Its estimate is updated too, so CodeMirror need not start
   from the old larger widget. No font size or document bytes change.
2. **Mixed-script balance.** Ordinary Amiri runs in Duo/custom change from 1.20× to
   1.15×, and in Serif from 1.15× to 1.10×. Arabic-primary profiles, Qur’anic sizing,
   mark-clearance rules, shaping and bidi isolation retain their existing behaviour.
3. **Quieter checking.** Spelling remains wavy and grammar dotted, in the existing
   contrast-tested colours. Normal strokes are finer and still scale with text;
   high contrast keeps the previous heavier strokes. Suggestion actions are unchanged.
4. **Stable transitions.** Find previously shifted the reading row by 109.78 CSS px.
   The editor now compensates changes to the scroller’s top before paint when the
   previous caret row fits below the panel. Near the document’s start or an occluded
   row, normal scrolling keeps content reachable. Escape already preserved the tested
   row; its behaviour is retained. The appliance reserves room for routine feedback.
5. **Status hierarchy.** The filename has medium weight, ordinary save labels share
   a fixed slot, and reading time reserves digit-count space. Previously the filename
   moved 13.27 CSS px from Saved to Saving…. Existing faint-text and no-word-count
   decisions remain; failures retain full contrast and honest durable-save semantics.
6. **One visual family.** Setup/unlock/lock use a 195px wordmark, page-coloured inputs
   and selects, quieter headings, 24px between groups, 8px within fields and consistent
   4px corners. Selects remain native elements; forced colours restores their platform
   appearance. Two-line feedback space prevents routine responses recentering the form;
   longer feedback grows rather than being clipped.

## Evidence and design review

The five writing regressions in `tests/e2e/polish.e2e.ts` cover short-screen opening
proportions, unchanged mixed-script geometry while moving the caret, Escape folding,
Find open/close, real saving acknowledgements and a 9-to-10-minute reading-time change.
The old app fails the Find and save-position checks; the refined app passes all five.
The existing appliance suite additionally compares input geometry after a wrong
passphrase and checks keyboard reachability in a 480×360 window. Existing bidi/caret/click, checking, keyboard and file-failure tests cover
the surrounding contracts.

Real WebKitGTK specimens were captured at 640/1280/1920/2560 CSS px in both themes
(`/tmp/bismillah-polish-after`), Duo/Serif mixed text in both themes
(`/tmp/bismillah-polish-mixed-after`), and enlarged Arabic in a short window
(`/tmp/bismillah-polish-zoom`). Appliance screenshots are in `target/appliance-shots`.
Before/after baseline comparisons are preserved in `/tmp/bismillah-polish-review-*.png`;
the previous baselines are in `/tmp/bismillah-polish-old-baselines`.

DESIGN.md §18 review: prose and recovery remain primary; filenames, modes and actions
remain understandable; spacing groups labels with controls; native keyboard semantics,
focus rings and accessible names remain; both themes, mixed text, narrow/short views
and enlarged writing are checked in the real app. No dependency or animation is added.
The diagnostic colours retain their contrast and pattern distinction. Existing
WebKit Arabic-mark positioning defects (ADR-0011) remain an upstream limitation.

## Verification

**Pass with the existing acceptance notes below.**

- `pnpm verify --fast`: Svelte/TypeScript, formatting, ESLint, 435 frontend tests,
  Rust formatting/Clippy, 188 Rust tests and cached dependency-policy checks passed.
- All 258 real-app checks across 28 suites passed. The final appliance rerun also
  passed all eight cases with the short-window and wrong-passphrase geometry checks.
- All 16 visual checks passed in normal comparison mode after deliberate inspection
  and updates to the 13 PNG baselines. Comparison tolerances and the independent
  Arabic-rendering JSON reference remain unchanged.
- `pnpm a11y` found no problems. Final type/lint checks passed after the last test edits.
- Both stick images were rebuilt offline from HEAD plus the recorded runtime patch
  `b994e8c92ada` (`os/out/startup-app.patch`). VM startup passed all four checks,
  including zero changed pixels in the lower form after first input. The pointer
  detector now distinguishes the actual black/white arrow from control focus rings
  and validates itself against the pointer shown after motion.
- Both image/initrd audits passed. Size budgets passed: root 356.4 MiB, ESP 23.6 MiB,
  initrd 9.9 MiB. Logs are `os/out/polish-{app-build,debug-build,release-build,
  startup-vm,contents,sizes}.log`; app-check logs are `/tmp/bismillah-polish-*.log`.

The UI is ready for the author’s visual acceptance. Physical laptop acceptance,
native Wayland/GPU rendering and the separate OS timing gate remain open. No timing
baseline, kernel policy, file format or durable-save protocol was changed.
