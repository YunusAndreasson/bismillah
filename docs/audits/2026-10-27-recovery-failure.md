# When saving and recovery both fail (2026-10-27)

The real app could discard unsaved text when a document save and its recovery write
both failed. The frontend ignored the failed flush when opening or creating another
document, and quitting assumed that a failed save always left recovery. The notice
also claimed “Your text is kept in recovery” even when Rust had logged that writing
the recovery copy failed. This matters particularly on the stick, where both copies
live on the same disk, and for documents above the recovery entry size limit.

## Reproduction and result

The headless Tauri reproduction used scratch Markdown containing vocalised Arabic
and English. A regular file at the private recovery path made recovery fail; the
debug save fault simulated a full document disk. Creating a new file then replaced
the unsaved text. The old app reported `claimedRecovery: true` and
`retainedUnsavedText: false`; the corrected app reports false and true respectively.
No author document, configuration or desktop window was touched.

## What changed

- Failed `doc_save` replies include an explicit `recovered` boolean while preserving
  the original error kind. Only a successful durable recovery write sets it true.
- `DocumentSession` records the protected revision. Later edits are unprotected;
  starting a retry invalidates earlier confirmation because the mirror can be
  overwritten. Missing or interrupted IPC confirmation never proves recovery.
- Opening or creating another document, closing the window, and the app's power-off
  or restart request keep unprotected edits open. A failed save with confirmed
  recovery still allows navigation. Suspend keeps RAM and continues to lock first.
- The failure notice claims recovery only when confirmed for the current revision.
  Otherwise it says the text is only in the window and offers the existing Try again
  and Save elsewhere actions. Saving elsewhere remains possible with recovery blocked.
- ARCHITECTURE, DESIGN, PRIVACY and the bundled guide describe the actual guarantee.

## Validation

- `pnpm verify --fast`: passed, including 442 frontend and 191 Rust tests, strict
  checking, lint, formatting, Clippy and dependency policy checks.
- Four added session tests cover dual failure, revision changes, edits arriving
  during a pending save, and invalidation of protection during a retry.
- Three Rust tests distinguish failed recovery, confirmed recovery, and a successful
  document save despite unavailable recovery; the serialized error is checked too.
- The 28 existing real-app suites passed in the broad run. Its initial new-suite
  fixture failed because the app repairs directory permissions. The corrected
  `recovery-unavailable.e2e.ts` was run separately on the final build: both cases pass,
  covering opening, New file, Quit, retries, recovery becoming available and Save elsewhere.
- `pnpm test:visual`: all 17 checks pass without changing baselines.

The fixture preserves any previous private recovery directory by moving it aside,
blocks the path with a file, then restores it. It never fills a real disk.

## Design review — pass

The failed-save notice remains the prominent recovery action (§18.1), names the file
and explains where the text exists (§18.2), and uses the existing notice frame and
grouped actions (§18.3). Actions, accessible names, focus order and alert semantics
are unchanged; the real-app quit command is vetoed without closing the text (§18.4).
Contrast tests pass on the existing semantic tokens, and the notice and scratch
specimen were inspected at 640/1280/1920/2560 CSS px, in a 480px-high window, in both
themes and with 200% text (§18.5). Arabic marks and mixed-script text remain intact.

Session screenshots are in `/tmp/bismillah-recovery-unavailable-{light,dark}-{width}.png`
and `/tmp/bismillah-recovery-specimen-{light,dark}-{width}.png`, with `-640-200` variants
for enlarged text. They are scratch evidence, not new visual baselines.

This does not promise recovery from power loss before a completed save or recovery
write. The outstanding OS firmware boot investigation is separate from this fix.


## Follow-up: retaining completed recovery on an unwritable volume

After a failed document save with successful durable recovery, switching documents
used two renames to retain the mirror. If the journal became read-only, the renames
failed and the mirror was still excluded from recovery offers in the running
session. A failure between the two renames could also separate the text from its
sidecar, leaving the copy undiscoverable after restart.

The regression created a durable mirror, made its directory read-only, then retired
it. Before the fix, retention logged `PermissionDenied` and the offer was absent.
Retention now only advances an in-memory mirror generation. Completed files keep
their names, later writes and clean-save removal use a fresh key, and earlier copies
remain discoverable both immediately and after restart. Existing journal entries
remain readable.

Validation on the rebuilt app:

- All 13 recovery unit tests pass. The new read-only regression confirms both
  filenames stay unchanged and the text is offered before and after restart.
- The second added test advances 1,000 generations, then confirms that writing and
  clearing a new mirror cannot overwrite or remove the retired text.
- `pnpm verify --fast` passes: 442 frontend and 193 Rust tests, strict checking,
  lint, formatting, Clippy and dependency policy checks.
- The headless real-app recovery-unavailable, file-safety and recovery suites all
  pass: 17 checks, including save failures and recovery after a killed process.

This follow-up changes no visible UI, typography or copy.


## Follow-up: failed metadata write during a library rename

`Recovery::moved` previously renamed the recovery text before writing its new
sidecar. A failure at that second step (for example, a full recovery volume) left
the old sidecar pointing to missing text and the new text without a sidecar. The
copy became undiscoverable even after restarting.

The new regression blocks replacement of the destination sidecar after a real
document rename. Before the fix it fails: a fresh `Recovery` instance cannot find
the original unsaved English and vocalised Arabic text. The corrected code writes
both replacements durably, then removes the original pair. The regression now
finds the original copy after restart and successfully retries the migration after
the obstruction is removed. Existing file/folder rename tests also check private
permissions and recovery under the new path.

If migration fails, the original pair still names the old document path; this fix
preserves the recoverable bytes and permits retry, but does not make a failed
migration follow the new name. The filesystem error is logged by kind only.


Validation: all 14 recovery unit tests and `pnpm verify --fast` pass (442 frontend,
194 Rust tests, strict checking, lint, formatting, Clippy and dependency checks).
After `pnpm app:build`, the private headless library and recovery suites pass all
17 checks, including keyboard renames, continued saving at the renamed path and
recovery after a killed process. No visible UI changed.


## Follow-up: opening recovery when its original has disappeared

The startup notice offered Open for a recovery entry whose original file was gone,
but the action only tried to open the original. It reported a missing-file error
and never exposed Restore. A killed-process real-app regression reproduced this
with a durable recovery copy and a subsequently removed original.

The pending-recovery command now falls back to an in-memory missing document only
when opening reports NotFound and a readable recovery entry exists. It retains
Restore/Discard and creates nothing on disk. Restore then uses existing removed-file
and unavailable-folder notices: recreating a file requires Save it again; a missing
folder requires another save location. The stick's path boundary is checked before
opening. Other errors, including permission denied, still fail normally.

The document remembers that the original was absent, so a file reappearing before
the restored text is saved is a conflict, even if that new file is empty. A normal
explicit save clears that state. Existing files still open with their actual bytes,
encoding, line endings and disk state.

Three Rust tests cover missing-file restoration and explicit saving, disappearance
of the entire folder, absence of recovery, permission errors and reappearance. The
real-app regression kills and restarts the app for both a deleted file and a missing
folder, follows the offered recovery action, and checks that neither opening nor
Restore recreates the original. It then verifies explicit recreation or Save
elsewhere preserves vocalised Arabic and English exactly.


On the stick, a known document/recovery path may have missing subfolders: its
nearest existing ancestor must resolve within the library, with parent traversal
and symlink escapes refused. Every document save repeats that check; the normal
save implementation still refuses to create missing folders. New dialog
destinations retain their stricter existing-parent check. The existing appliance
boundary test now covers nested missing paths, traversal, relative paths and a
symlink escaping the library.

Validation: `pnpm verify --fast` passes with 442 frontend and 197 Rust tests,
strict checking, lint, formatting, Clippy and dependency policy checks. The rebuilt
app's missing-original, crash-recovery, file-safety and appliance suites pass.

Design review: pass for the existing recovery notice and save controls. The real
app's restored English, vocalised Arabic and mixed lines were inspected at
640/1280/1920/2560 CSS px in a 480px-high window, light/dark themes and 200% text.
The actions remain prominent and grouped; the status says Not saved, with the
filename visible. Tab/Shift+Tab moves between save actions and Enter explicitly
recreates the missing file. Existing semantic colours, accessible names, contrast,
layout and typography are unchanged. Screenshots are temporary evidence at
`/tmp/bismillah-missing-{light,dark}-{width}.png` and `-640-200` variants.


## Headless display allocation found during validation

Starting the real-app suite alongside the screenshot review exposed a harness race:
this machine's `xvfb-run --auto-servernum` calculates a display number before
starting Xvfb and does not retry startup. Both commands can use the same display;
the shorter command's cleanup then removes the longer command's X server. The
suite lost its page session and later apps failed to initialize GTK. That run was
stopped and was not counted as product validation.

`scripts/headless.sh` now uses the installed `--auto-display` mode, which asks Xvfb
to allocate a free display through `-displayfd`. The simultaneous screenshot and
suite runs both complete with the fix; the suite continues after the screenshot
command exits. The shell syntax check and `git diff --check` pass. All displays,
runtime folders, D-Bus sessions and app data remain private to their run.


## Follow-up: typing during Save elsewhere

Save elsewhere captured the editor text, awaited the native dialog/write/IPC and
then loaded the saved snapshot into the editor. Any edits arriving during that
interval were discarded. The real-app regression starts the actual save action,
changes the text before its asynchronous reply arrives, then awaits the action.
Before the fix, both newly added English/Arabic text and a deletion to empty text
were replaced by the older snapshot. Cancellation already preserved the edits.

The workspace now reads the latest text and selection before showing the saved
destination. If the text changed during the request, it reapplies the newer version
as an unsaved edit in the new session, preserving the caret and scroll. The normal
autosave and recovery protocol then protects those edits. The destination is not
reported saved for text that only exists in memory. A reply for a different frontend
session does not replace its editor or set its failure state.

The three real-app cases use the production Save elsewhere notice action and the
debug dialog/fault hooks; no native bridge is mocked or replaced. They verify the
destination first contains only the actual saved snapshot, newer text remains
dirty, and a subsequent successful save preserves exact vocalised Arabic, the BOM
and CRLF. The empty-text and cancelled-dialog cases check the same guarantees.


Validation: all three new Save elsewhere cases pass on the rebuilt Tauri app;
the file-safety and recovery-unavailable suites also pass (19 checks across three
suites). `pnpm verify --fast` passes with 442 frontend and 197 Rust tests, strict
checking, lint, formatting, Clippy and dependency policy checks. No controls, copy,
layout or typography changed; vocalised Arabic and mixed text were checked in the
real app, including exact BOM/CRLF output. The first gate run stopped on test-file
formatting; the formatted test and the complete fast gate then passed.


## Follow-up: typing during Load theirs

Load theirs kept the local text captured when clicked, then reloaded the file and
replaced the editor. Edits arriving during that request were lost: Restore offered
only the earlier snapshot. Both real-app regressions failed before the fix, for
new English/vocalised-Arabic text and for deletion to an empty document.

Explicit Load theirs now uses the existing quiet-reload loop with initial local
preservation enabled. It keeps the initial snapshot, then keeps any newer text
using the returned document ID, repeating if further edits arrive. Only then does
the workspace show the requested disk version with the newest local text offered
through Restore/Discard. The existing automatic reload behavior is unchanged.

Two added unit tests cover the initial snapshot and multiple edits, including an
empty final version. Two headless real-app cases start the production Load theirs
action and edit immediately before its asynchronous reply. They check the disk
version stays on disk and is shown in the editor, then verify Restore recovers the
latest text exactly and saves it with the existing BOM and CRLF.


Validation: both new real-app regressions pass on the rebuilt Tauri app, alongside
file-safety and Save elsewhere race coverage (19 checks across three suites).
`pnpm verify --fast` passes with 444 frontend and 197 Rust tests, strict checking,
lint, formatting, Clippy and dependency policy checks. No UI copy, controls,
layout, colours or typography changed; the real-app cases verify exact English,
vocalised Arabic, BOM and CRLF through recovery and the final durable save.


## Follow-up: recovery fails after a reload has already reopened the file

A later keep in the reload loop could fail after an earlier request had installed
a new Rust document. The frontend swallowed that failure and retained its old ID:
the latest local text remained on screen, but saves and Save elsewhere targeted a
closed document. A real-app regression reproduced this by starting Load theirs
with a small snapshot, then inserting slightly more than the actual 16 MiB
recovery limit before its reply. Recovery refused the larger text and Save
elsewhere created no destination file. No disk was filled or made read-only.

The loop now returns the last confirmed opened document on a follow-up failure.
The workspace adopts that live ID, keeps the latest local text, caret and scroll,
hides older recovery offers and applies an explicit conflict hold. Autosave and
ordinary flushes cannot overwrite the disk version just read. Keep mine gives
explicit approval and normal retries remain possible if that approved write fails;
Save mine as can rescue the text immediately. An external replacement becoming
read-only also cannot make those unkept local edits safe to close.

Three reload unit tests cover failures after a successful reopen in both automatic
and explicit reloads, plus an initial failure with no replacement. Three session
tests cover the overwrite hold, resumed normal saving after approval, retry after
an approved write fails, and holding local text over a read-only replacement. The
real-app case verifies the original disk version remains unchanged and hashes the
rescued file to prove all local bytes, the BOM and CRLF were saved intact.


Validation: `pnpm verify --fast` passes with 450 frontend and 197 Rust tests,
strict checking, lint, formatting, Clippy and dependency policy checks. The rebuilt
app passes all 22 targeted real-app checks across Load theirs, file safety, Save
elsewhere and unavailable recovery. The new failure case preserves the other
version on disk and successfully rescues the complete larger document to a new
file. Existing conflict controls and copy are reused; no styling, layout or
typography changed.


## Follow-up: recovery timestamp precision

The journal stored and compared only whole milliseconds. Distinct recovery copies
from one millisecond were offered in directory enumeration order, which could
select an older snapshot. Comparing against a file timestamp truncated to the same
millisecond also hid a recovery copy actually written later. Budget pruning used
the same lossy ordering and could remove a newer copy before an older one.

Three regressions failed on the old implementation: selecting the newest copy
after restart, offering a copy newer than the file within the same millisecond,
and preserving legacy text whose exact ordering is unknowable. A fourth regression
also failed for pruning. It uses 17 sparse 16 MiB entries to cross the 256 MiB total
budget without allocating that disk space.

Sidecars now include optional `saved_at_ns` metadata captured from the same clock
reading as `saved_at_ms`. Selection and pruning retain that precision, and file
comparisons use the complete filesystem modification time. The existing public
display time remains in milliseconds. Older sidecars without the new field still
load; equal-millisecond legacy text is offered conservatively rather than hidden.
Known older copies remain suppressed, and copies identical to the file are still
removed. Renaming an entry preserves both timestamps.


Validation: all 18 recovery unit tests pass, including the four new precision and
legacy cases. `pnpm verify --fast` passes with 450 frontend and 201 Rust tests,
strict checking, lint, formatting, Clippy and dependency policy checks. After
`pnpm app:build`, all 18 real-app checks pass across crash recovery, Load theirs
and file safety. No UI, document bytes or display-time format changed.


## Final integration pass

After the author asked to keep the review bounded and avoid unnecessary testing,
the final pass reused the current successful fast gate (450 frontend and 201 Rust
tests) and the existing debug build. No unit checks or build were repeated.

- `pnpm test:e2e`: all 32 real-app suites passed in one run.
- `pnpm test:visual`: all 17 checks passed in one run, without baseline changes.
- The binary was newer than the changed runtime sources; the tests exercised the
  current fixes. Formatting and `git diff --check` passed.

This closes the bug-review pass. No new failures, fixes or retries were needed in
the final integration run. The separately documented OS firmware boot failure
remains unresolved; no OS image rebuild, VM boot success or hardware acceptance
is claimed by these app results.
