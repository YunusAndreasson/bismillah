# Resource use and navigation — 2026-10-20

The author requested further suitable optimizations for low memory/CPU use, quick
startup and fast navigation. This pass measures the current app, retains three
targeted changes, and preserves the document save/recovery/path contracts. No
dependency, network access, styling or document transformation was added.

## Retained changes

1. **English data on demand.** The checker no longer loads English dictionaries,
   grammar and correction automata after one idle second regardless of need. It
   blocks on its job channel until there is actual work. Masked Arabic, code,
   unsupported scripts and transliteration can leave whitespace, numbers and
   punctuation behind; those are not English prose and do not initialize Harper.
   The first English block still checks normally, and its correction thread warms
   once afterward. English data stays available once used, rather than repeatedly
   unloading/rebuilding it during navigation. Turning checking off after English
   has already loaded does not release that memory.
2. **Quick open retains its best page.** Folded names/paths are cached in a weak map
   by candidate, with original-field checks so a rename cannot return stale matches.
   Old snapshots can be collected. Nonempty queries retain only their best 50
   matches with binary insertion; empty queries gather recents and the first page
   directly. Scores, every-word matching, multilingual folding, recency and all
   tie-breaks remain the same. The exhaustive-sort oracle checks exact results
   across queries, ties and limits; the new real-app test searches 1,200 added
   multilingual files and opens an exact keyboard selection without changing bytes.
3. **Identical remembered metadata needs no write.** `state::Store` remembers the
   last successfully persisted snapshot. Reopening the same library/document at
   startup avoids fsyncing identical `state.json` again. Its failure test obstructs
   the destination directory, restores it, and verifies that an unchanged retry
   still saves. Any failed write invalidates the saved snapshot entirely: even a
   subsequent change back to an older value must retry, because a directory-sync
   failure can happen after rename. A separate regression covers that case. Real
   document writes and their durable “Saved” contract are untouched.

Startup marks distinguish initial UI/module work, settings, document/library
loading, fonts and editor setup. A fourth candidate, deferring closed dialog roots,
was rejected after visual review (below).

## Measurements and limits

All app samples use embedded production frontend code in the debug binary, private
Xvfb/WebKitGTK at 2× scale, private configuration/data, and real local files. The
baseline executable was preserved before changes. Builds/tests did not run during
the benchmark samples. These are controlled experiments, not replacement release
budgets or native Wayland/GPU measurements. RSS sums shared pages across processes;
it is useful for a matched comparison, not an exclusive physical-memory accounting.

### Memory and background CPU

After an independently launched short document has settled for 15 seconds:

| Session at launch | Before RSS | Final RSS | Before CPU | Final CPU |
|---|---:|---:|---:|---:|
| Both checkers disabled | 734 MiB | 539 MiB | 2,470 ms | 70 ms |
| Arabic-only prose, checking enabled | 775 MiB | 588 MiB | 2,530 ms | 120 ms |
| English prose, checking enabled | 741 MiB | 698 MiB | 2,390 ms | 2,040 ms |

CPU sums the app/WebKit process family after the ready marker during that interval;
it includes deferred work, not the entire process startup. The disabled and Arabic
cases avoid about 190 MiB and almost all speculative CPU work. English still needs
its dictionaries/model. English RSS in earlier candidates ranged from 736 to
744 MiB; this single final snapshot does not establish a general English memory
reduction. Diagnostic counts were identical (0/0/2). The earlier
15-second default idle comparison was 20 versus 10 ms CPU, too small to claim a
steady-idle improvement. English data remains resident after it has been used.

Raw samples: [before](performance/resources-before.json),
[final kept variant](performance/resources-after.json). These include total and main-process RSS
at 5/10/15 seconds and executable SHA-256 values.

### Quick-open navigation

The real-app workload has 10,000 files in 40 folders and English, transliterated and
Arabic names. Four rounds open the picker and send ten successive input events,
including narrowing, script changes and an empty result. Timing ends in a
MessageChannel task after the next animation frame, including Svelte/Bits UI layout
and painting. Every expected query returns 50 items; the unmatched query returns 0.
This is scripted query-to-paint timing, not native keyboard latency or filesystem
document-opening time.

| Metric | Before | Final |
|---|---:|---:|
| Picker open p50 (four samples) | 56 ms | 44 ms |
| First picker open | 147 ms | 116 ms |
| Query median | 56 ms | 42 ms |
| Query p95 | 89 ms | 73 ms |
| First query | 104 ms | 91 ms |

The script uses nearest-rank p50/p95. The four open samples were 147/56/60/53 ms
before and 116/68/43/44 ms after; that small, variable sample does not establish a
stable opening-speed improvement. The first query must build folded keys and still
takes 91 ms. Warm queries are faster; this is not universally instant navigation.
The same raw files retain every open/query sample, including tails. The first candidate's
[exploratory results](performance/resources-exploratory.json) remain labelled
separately; they preceded the startup markers and deferred dialog roots.
The [discarded dialog variant](performance/resources-deferred-dialogs.json) is also
retained separately; its faster samples are not used for the final claims.

### Startup investigation

The initial baseline warm-launch medians (four samples after a first launch) were
652 ms for the short document, 581 ms with a remembered 1,000-file library, and
559 ms for the 51,448-word document. A first candidate measured 578/594/614 ms;
that mixed result prompted instrumentation rather than a startup speed claim.

The final retained variant measured 545/537/548 ms warm medians in those same three
cases, with slowest warm samples of 792/654/637 ms. Native GTK/WebKit startup alone
took 254–266 ms median, and the frontend after script start took 244–249 ms. This
does not establish a universal startup improvement: the samples are small, native
launch time varies, and the no-library scenarios start with fresh remembered state.
The metadata test directly verifies that identical state is not rewritten; no
isolated millisecond claim is made for skipping those fsyncs.

With markers, before deferring closed roots, script-to-workspace-start took about
108 ms, and script-to-editable about 226 ms in the short case. After deferring them,
those were 101 and 219 ms. That variant's warm-launch medians were 528/528/519 ms, but
native GTK/WebKit startup varied too. The deferral removes a few milliseconds of
measured frontend work; the much larger total-launch difference cannot all be
credited to it. All 23 real-app suites passed, but the Writing section screenshot
then differed by 0.2154%, above its existing 0.1% tolerance. Inspection found a
one-pixel vertical offset in Settings' scrolled content. The small gain did not
justify that regression: the deferral was removed and the baseline retained.
The 400 ms release startup budget remains unproven in this pass.

Raw samples: [baseline launches](performance/resources-launch-before.json),
[startup trace before dialog deferral](performance/resources-startup-trace.json),
[discarded deferral launches](performance/resources-launch-deferred-dialogs.json),
[final retained launches](performance/resources-launch-after.json). Launch output keeps the
original three stage fields and adds named frontend milestones relative to script
start; milestones are cumulative, not durations to add together.

### Separate search CPU benchmark

Node invokes the actual saved old/current ranking functions on the same objects,
asserting exact ordered results. Five warm-ups precede 30 samples in alternating
old/new order. These timings exclude DOM, Svelte/Bits UI and Rust filesystem work.
For 10,000 files, empty-query ranking fell from 1.649 to 0.369 ms median; a broad
`part` query from 26.523 to 1.742 ms, `hadith` from 16.857 to 2.124 ms, and Arabic
`سلام` from 16.613 to 1.831 ms. Real app query-to-paint gains are smaller because
layout, focus and rendering still take time. The cache adds folded strings for the
current listing, trading a bounded amount of memory for less repeated CPU work.

Raw samples: [search CPU microbenchmark](performance/resources-search-micro.json).

## Verification and design review

`pnpm verify` passed: strict type/lint checks, formatting, Clippy, dependency policy,
404 frontend tests, 153 Rust tests, all 23 real-app suites and 16 visual comparisons.
Coverage includes unchanged-write and both failed-write retry cases. The large-library
keyboard test searches both scripts and opens the exact file byte for byte.
`pnpm a11y` passed in all 11 screens/states with no problems.
The final benchmark and verified binary match SHA-256
`1ba3ab23281247658c9a9c72c0aa7c4a078f84ae79017fa59d75bec1adb638c1`.

Fresh mixed Arabic/English screenshots were inspected at 640/1280/1920/2560 px in
both themes (`pnpm app:shot`, `--scroll-to 'نستخدم Markdown' --caret 'notes.md'`).
Marks, mixed filenames, punctuation, code and diagnostic underlines remain readable.
Fresh light/dark Settings captures at 1280×500 keep the heading, section links and
Done control visible while the body scrolls. Screenshots are in the session's
`/tmp/bismillah-resources-mixed` and `/tmp/bismillah-resources-settings` folders.

Design review: pass with the timing limitations above. Content and the current file
stay apparent; grouping, semantic colours and contrast are unchanged; keyboard and
accessible structure are covered by real-app and AT-SPI checks. Narrow/wide and
mixed-text rendering were inspected; the caret suite also covers both themes at
200% and every specimen width. No screenshot baseline was rewritten.

The installed package is unchanged. The author's personal 1.0 acceptance remains
pending; these experiments do not establish universal instant response or a new
native Wayland idle measurement.
