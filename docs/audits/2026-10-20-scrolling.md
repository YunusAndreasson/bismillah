# Scrolling and responsiveness — 2026-10-20

This follow-up targets the author's scrolling flicker and responsiveness request.
Three changes are retained: stable default typography measurement in CodeMirror,
lazy direction detection, and viewport-bounded block styling. Text, fonts, spacing,
source preservation, checking, saving and the editor's virtualization stay intact.

## What caused blank frames

The baseline reproduced an entirely blank page during rapid scrolling through a
book made of 25 copies of the specimen (headings, lists, code, tables, Arabic and
mixed text). This occurred with scripted scroll reversals and with real X11 wheel
input. Painted webview screenshots, not just DOM probes, confirmed the blank page.

CodeMirror's `DocView.measureTextSize` tries to infer default font and line metrics
from a short ASCII line already in the viewport. In a rich Markdown editor that line
can be a heading with vertical padding, a different font, or a code line. Treating
those dimensions as the default for unseen prose changes the height estimate for
most of the book. The next viewport then contains different typography, which changes
the estimate again. A trace captured alternating viewport ranges and repeated
geometry/height updates until the measure loop reached its retry limit. The last
height model and painted virtual spacers could then describe different viewports.

The pinned `@codemirror/view@6.43.14` pnpm patch removes that shortcut and always uses
CodeMirror's existing undecorated measuring line. Actual visible line measurements
still use their real fonts and heights. Both shipped ESM and CommonJS builds carry
the same correction. `pnpm-workspace.yaml` and the lockfile pin the patch to this
version; upgrading it requires checking whether upstream has addressed the issue.
There is no runtime monkey patch or dependency version change.

| Reproduction | Before | Rebuilt app |
|---|---:|---:|
| Scripted reversals, centre of viewport occupied by a virtual spacer | 47 / 240 frames | 0 / 240 frames |
| Real X11 wheel input, same check | 12 / 116 frames | 0 / 115 frames |

Wheel input uses `xdotool` on the harness's private X display, 150 downward wheel
clicks at 25 ms spacing. It covers a different distance after the fix because the
old unstable height estimate also adjusted scrolling. These counts establish the
observed removal of blank frames in these reproductions, not a universal promise
about every GPU/Wayland session. Four stationary anchors after jumping to different
parts of the document moved 0 px in both versions after settling.

The temporary default-metrics experiment first established the cause before the
permanent patch was built. Two scan fixes alone had left 43 blank frames; changing
the metric probe eliminated them. No temporary probe changes are in production.

Raw results: [baseline wheel and scroll](performance/scroll-wheel-before.json),
[rebuilt wheel and scroll](performance/scroll-wheel-after.json),
[scan fixes alone](performance/scroll-scans-only.json).

## Work removed from scrolling

**Direction detection (`src/editor/bidi.ts`).** Previously every visible physical
line of a paragraph collected syntax exclusions for the entire paragraph and copied
its text before finding the first strong letter. A long paragraph containing many
mixed-script links/marks repeatedly scanned thousands of lines. It now walks the
text lazily, tests candidate letters against their parsed syntax ancestors, skips
whole excluded code/URL spans, and stops at the first prose letter. UTF-16 offsets,
Markdown exclusions and paragraph direction rules are unchanged.

**Block styling (`src/editor/markdownStyling.ts`).** A visible slice of a code block
or quote used to walk every preceding line from the block's beginning. Traversal now
starts at the visible slice and stops at its end, including each clipped edge's
whole line. Heading adjacency classes and quote/code combinations are unchanged.

The stress probe measures real editor plugin updates during scroll reversals and
jumps. Its synthetic cases are 20,000 code lines and a single 4,000-line paragraph
with English, vocalised Arabic, emphasis and links. Before the fixes, the slowest
measured direction update was 250 ms and block styling took 36 ms. With just the
scan fixes these fell to 3 ms and 1 ms respectively. This is local plugin timing,
not a claim that every complete frame takes 1–3 ms.

The final build's complete stress-frame intervals (median / p95) were:

| Scroll case | Before | After |
|---|---:|---:|
| Repeated rich specimen | 25 / 70 ms | 17 / 24 ms |
| 20,000-line code block | 22 / 27 ms | 17 / 17 ms |
| 4,000-line mixed paragraph | 44 / 152 ms | 18 / 41 ms |

Final peak plugin update costs were 2 ms for paragraph direction and 1 ms for
code-block styling. The final stress sample ran after artifact copying/hashing
finished, avoiding that extra host load. As with all software-rendered frame
measurements, these characterize the tested workloads rather than every document.

Raw samples: [baseline stress](performance/scroll-stress-before.json),
[scan fixes](performance/scroll-scans-only.json),
[final stress run](performance/scroll-stress-after.json).

## Ordinary writing benchmark

Both binaries use the same debug profile, the production frontend, private settings,
WebKitGTK and Xvfb software rendering at 2× scale. The baseline binary was preserved
before editing. These are controlled local comparisons, not new release-budget or
native GPU measurements. Builds/tests did not run alongside these benchmark samples.

| Measurement in 1.01 MB book | Before median / p95 | After median / p95 |
|---|---:|---:|
| Prose edit, synchronous dispatch | 12 / 19 ms | 8 / 12 ms |
| Inline-code line edit, synchronous dispatch | 22 / 27 ms | 15 / 18 ms |
| Line-break edit, synchronous dispatch | 18 / 23 ms | 14 / 16 ms |
| Typing in prose, key to painted frame | 34 / 63 ms | 30 / 41 ms |
| Typing on inline-code line, key to painted frame | 42 / 86 ms | 38 / 60 ms |
| Scrolling downward, frame interval | 21 / 28 ms | 16 / 25 ms |

The new reversal probe in `scripts/perf.ts` recorded 17 ms median / 23 ms p95 and
0 virtual-spacer frames out of 240 after the fix. The previous basic scroll test
only travelled downward and did not check viewport coverage. It now retains that
measurement and adds three down/up trips with source-text preservation checked.

The short-document control was 27 / 34 ms before and 17 / 46 ms after: median
improved, but p95 worsened. Memory snapshots at the end of inline-code typing were
940 MiB before and 986 MiB after; these single snapshots do not establish a memory
change. Host scheduling and background checking vary, so modest frame differences
need care. The causal evidence is strongest for the removed viewport oscillation
and the two large synchronous scan costs.

Long-document typing still has slow frames; the Markdown parser's existing block
traversal remains a limit. No claim that every 1 MB edit is instant is justified.
No spell/grammar feature, Arabic shaping or rich rendering was removed to get these
results.

Raw data: [before](performance/scroll-before.json),
[after](performance/scroll-after.json). Reproduce with:

```bash
pnpm app:build
pnpm perf -- --binary target/debug/bismillah --parts typing,editing,scrolling --out /tmp/scrolling.json
```

## Quality and regression verification

The new direction tests cover a long paragraph, multiline code, long link addresses,
and a comparison with the original syntax-exclusion behavior at every boundary in a
mixed fixture. Block-styling tests cover a clipped slice deep in a 20,000-line code
block, quotes around code and adjacent heading spacing.

`tests/e2e/scrolling.e2e.ts` exercises the specimen book in Duo, Serif, Plex Arabic
and Amiri, checks all 240 reversal frames for visible virtual spacers, verifies the
scroll travelled over 5,000 px, and checks exact source preservation. Existing real-app
suites cover keyboard navigation, RTL/mixed selections and caret placement. Visual
baselines must remain unchanged.

Final `pnpm verify`: **pass** — strict type checking, Prettier, ESLint, 398 frontend
tests, Rust formatting, Clippy, 149 Rust tests, dependency policy, all 23 real-app
suites and all 16 visual checks. No visual baselines were rewritten. The initial
gate attempt stopped on formatting of the newly saved JSON artifacts; formatting
was corrected before the passing full run.

Design review (DESIGN.md §18): **pass**. Keyboard/caret/selection and RTL/mixed-line
suites pass, including typing/undo and all four bundled writing profiles. Contrast
tests pass in both themes. All eight fresh Arabic specimen screenshots at
640/1280/1920/2560 in light/dark, plus mixed text at 200% in a 640 px window in both
themes, were inspected: no missing glyphs, clipped diacritics or broken layout.
Screenshots are in `/tmp/bismillah-scroll-arabic-shots/` and
`/tmp/bismillah-scroll-mixed-zoom-shots/`.

The measured/rebuilt binary's SHA-256 is
`246640ed29a6817cf5f748cb2d90ae5c195232288e8fc8c899cdcda76d3b6edc`.
Personal 1.0 acceptance remains with the author. The installed package has not
been replaced.
