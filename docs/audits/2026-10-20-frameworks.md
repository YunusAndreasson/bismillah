# Framework-guided performance follow-up — 2026-10-20

The next pass uses the framework documentation and the previous scrolling audit to
reduce remaining synchronous work. Four changes are retained: bounded checker tree
traversal, preview mapping beside unchanged inline code, immutable library snapshots
without deep Svelte proxies, and library-query dispatch off GTK's main thread.

## Framework guidance and source checks

- [CodeMirror's decoration example](https://codemirror.net/examples/decoration/)
  recommends mapping retained ranges through document changes and keeping viewport
  decorations bounded. The app already does that for ordinary prose. The remaining
  inline-code-line fallback rebuilt tables, images and definitions unnecessarily.
- [Lezer's guide](https://lezer.codemirror.net/docs/guide/) describes cursors for
  efficient bulk traversal. Its [public cursor API and implementation](https://github.com/lezer-parser/common/blob/main/src/tree.ts)
  confirm that an iterator callback returning false only skips children; it does
  not end traversal. The installed declarations/source were checked too.
- [Svelte's best practices](https://svelte.dev/docs/svelte/best-practices) recommend
  `$state.raw` for large snapshots that are replaced rather than mutated. Every
  library listing already comes from Rust as a fresh snapshot; folder expansion,
  focus and active-file state are separate.
- [Tauri's command documentation](https://v2.tauri.app/develop/calling-rust/#async-commands)
  specifies that ordinary synchronous commands run on the main thread. `library_get`
  can wait for startup restoration and rescan the filesystem. It now uses
  `#[tauri::command(async)]`, preserving its function, result, locks and path checks
  while dispatching it off GTK's UI thread. The existing checker already uses a
  dedicated Rust thread and `spawn_blocking` to wait for its answer; it needed no
  execution-model change.

No dependency was added or upgraded. The existing pinned CodeMirror typography
patch remains in place.

## Changes and correctness boundaries

**Checker (`src/editor/lintBlocks.ts`).** The old `Tree.iterate` callback kept
visiting remaining siblings after reaching the 6,000 UTF-16 batch budget. A manual
cursor can terminate the whole traversal, and `childAfter(from - 1)` skips earlier
subtrees while retaining the old inclusive boundary semantics. The same whole
blocks and skip/mark offsets go to Rust; no checking is dropped or delayed. Nested
quotes/lists/tasks/table cells, exact range boundaries and whole-block budgets are
compared with the contract in the new test.

**Preview (`src/editor/livePreview.ts`).** Ordinary prose edits on a line with
unchanged inline code can map existing table/image decorations and retain reference
maps. The fast path excludes delimiter edits, delimiter adjacency, backslashes,
links/images/tables/HTML/fences, structural edits, changed enclosing block boundaries
and advancing parse coverage. Line-end lookups use both sides of the syntax boundary;
without the negative-side fallback, the first candidate still rebuilt at paragraph
ends. Tests cover that boundary, typing/undo in English and Arabic, grid preservation
and opening a fence that must remove the grid. The source text is never rewritten.

**Library (`src/core/library.svelte.ts`).** Only `view` uses `$state.raw`. Immutable
snapshot replacement remains reactive; folder expansion still uses `SvelteSet` and
focus/selection remain reactive. Nodes are read, never mutated in place. Rust remains
the authority for every filesystem action. Existing library QA exercises refreshes,
rename, deletion, unavailable folders and keyboard focus.

**Library command (`src-tauri/src/app/library_commands.rs`).** Execution dispatch is
the only backend change. The IPC payload and the listing/validation logic are
unchanged. No claim of reduced filesystem scan time is made: the benefit is keeping
that work off the native UI thread.

## Measurements

The baseline binary was preserved before this pass. Both binaries use the same debug
profile and embedded frontend, WebKitGTK under private Xvfb at 2× scale, and the same
1.01 MB guide/specimen book. Each run starts with private settings/data and leaves
checking, autosave and typewriter scrolling enabled. Builds and tests did not run
alongside the samples. These are not replacement release budgets or native Wayland
GPU measurements.

| 1 MB measurement | Before median / p95 | Final median / p95 |
|---|---:|---:|
| Prose, synchronous edit | 13 / 17 ms | 8 / 10 ms |
| Inline-code line, synchronous edit | 21 / 27 ms | 9 / 12 ms |
| Line break, synchronous edit | 19 / 22 ms | 16 / 19 ms |
| Prose, key to painted frame | 30 / 58 ms | 31 / 41 ms |
| Inline-code line, key to painted frame | 38 / 76 ms | 33 / 44 ms |
| Downward scrolling, frame interval | 18 / 26 ms | 16 / 23 ms |
| Reversing scrolling, frame interval | 18 / 27 ms | 17 / 23 ms |
| Virtual spacers at viewport centre during reversals | 0 / 240 frames | 0 / 240 frames |

The inline-code path is now close to plain prose in synchronous cost (9 vs 8 ms).
Its measured median fell about 57%, with the source and rendering preserved. The
plain-prose control also became faster, so not all timing differences should be
attributed to code changes. Short-document typing was 24 / 42 ms before and 20 / 59 ms
after: the p95 worsened. Long-document typing still has slow frames; this pass does
not establish instant response for every document. Memory snapshots were 949 MiB
before and 926 MiB after, not enough to establish a memory reduction.

Raw results: [before](performance/framework-before.json),
[final](performance/framework-after.json). An
[exploratory candidate](performance/framework-exploratory.json) is retained, labelled
with its earlier source variant; it is not the final result.

### Separate CPU microbenchmarks

These run in Node, not WebKit, and exclude DOM rendering and Rust filesystem time.
The checker benchmark invokes the actual old/new functions on the same fully parsed
states, asserting identical results. Thirty samples follow five warm-ups, alternating
old/new order. The limit remains 6,000 UTF-16 units.

| Paragraphs; range begins at | Before median | After median |
|---|---:|---:|
| 1,000; beginning | 0.289 ms | 0.136 ms |
| 10,000; beginning | 2.755 ms | 0.170 ms |
| 30,000; beginning | 5.342 ms | 0.122 ms |
| 30,000; middle | 2.413 ms | 0.125 ms |
| 30,000; 95% | 0.262 ms | 0.138 ms |

The small 1,000-paragraph, 95%-range case worsened from 0.041 to 0.051 ms; the raw
results retain it. The improvement targets the full-range background scan rather
than promising a gain for every tiny range.

The Svelte benchmark compiles the actual old/new `LibraryStore` modules with the
installed production Svelte compiler. It applies fresh snapshots and reads both the
file list and all expanded rows, verifying equal counts. Twenty measured samples
follow five warm-ups, with alternating old/new order and cloning outside the timed
region. Applying and flattening 1,000 files fell from 3.018 to 0.144 ms median;
10,000 files fell from 30.394 to 1.052 ms. This demonstrates less store CPU work,
not a 96% improvement in full library rendering time.

Raw samples: [CPU microbenchmarks](performance/framework-micro.json).

## Verification

`pnpm verify` passed: 402 frontend tests, 149 Rust tests, all 23 real-app suites
and 16 visual checks, plus strict type checking, lint, formatting, Clippy and
dependency policy. The two added real-app cases passed: typing, exact source preservation, undo and structural
invalidation beside inline code in English and Arabic. Fresh 1280 px light/dark
mixed-text screenshots were inspected in the real WebKitGTK app: Arabic marks,
English filenames, links, code and diagnostics remain readable. Existing
four-profile scrolling, RTL/caret/selection and visual suites passed. No screenshot
baseline was rewritten during this pass. The gate's rebuilt binary SHA-256 matches
the final benchmark artifact: `c2a0d9a02f5549fa4d15d1514072764ede6bfd2ca77ecc928ed03c1b0da3f6a5`.
The installed package has not been replaced; personal 1.0 acceptance remains with
the author.
