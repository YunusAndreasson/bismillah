# The bismillah phone app — plan

An app that reads the stick's animated QR codes and feels like the stick's editor, because it shares the editor's code. It's built with Tauri 2 for Android first, then iOS (ADR-0022). Android development goes on against the emulator on the Linux machine, and iOS development on the author's Mac. The only real phone is the author's iPhone.

*Written 2026-10-31. Each milestone stops at its acceptance check for the author's review.*

## Where we are

**M4 is built, and it's the last milestone the emulator can do (2026-11-01). It waits for the author's review of ADR-0023, and M3 for a look at the sheet.** Next is M6, which needs the author's Apple credentials. The phone work was committed on 2026-11-01, so a VM run can now do M4's early-boot check. M1 is built, and the author moved on from it on 2026-10-31. The iPhone build can wait (the author, 2026-10-31), and it's the only route to a real phone, so everything that needs one waits with it. The order is now **M1, M3, M4, then M6, M2, M5, M7**. The numbers stay as they were, because other documents cite them.

**The Mac is ready for M6 (2026-11-03).** `tauri ios init` made `gen/apple`, and the app's Rust library builds for the iPhone and the simulator. The simulator app itself waits for the iOS 27.2 simulator runtime (see *What the Mac has*).

Keep this section current as milestones finish.

**Running it:** `pnpm mobile:show` opens the installed app in an emulator with a window, `pnpm mobile:dev` builds and installs a debug build, `pnpm mobile:build` makes the release APK, and `pnpm mobile:shot <dir> <pages>` takes screenshots, and `pnpm mobile:test [shots-dir]` runs the suite for M1, M3 and M4 on the emulator. The emulator is driven with `adb` through `mobile/run.sh`, which finds the `bismillah` AVD by name because other sessions may have their own running. These commands are for Android on the Linux machine: `mobile/env.sh` points at its SDK and private Rust. On the Mac, iOS runs through the Tauri CLI from `mobile/`, as in `../node_modules/.bin/tauri ios build --debug --target aarch64-sim`.

## What the Linux machine has (checked 2026-10-31)

| Need | State |
|---|---|
| Android SDK, platforms 34 to 37, build-tools | Present in `/opt/android-sdk` |
| NDK | 27.0 and 27.1 present, `NDK_HOME` not set |
| Emulator, KVM | Present, `/dev/kvm` is usable |
| AVDs | `pixel` and `zuhd-qa`, on the Android 35 `google_apis` x86_64 image, without Play |
| Java | `JAVA_HOME` is Java 17, while `java` on the path is Java 27 |
| Rust Android targets | **Missing.** Rust comes from pacman (1.99.0), with the host target only and no rustup |
| `@tauri-apps/cli` | 2.12.3 in the repo |
| Xcode | None, so nothing for iOS can be built here |

## What the Mac has (checked 2026-11-03)

An Apple-silicon Mac (arm64). Here Rust comes from rustup in `~/.cargo`, so no private toolchain is needed.

| Need | State |
|---|---|
| Xcode | 27.2 (27B52), with the iOS 27.2 SDKs |
| iOS simulator runtimes | 18.1, 18.2 and 26.5. **27.2 is missing**, so `tauri ios build --target aarch64-sim` stops with "Xcode Simulator SDK 27.2 is not installed". Install it with `xcodebuild -downloadPlatform iOS`, or from Xcode › Settings › Components |
| Rust | 1.99.0, as on the Linux machine, with `aarch64-apple-ios` and `aarch64-apple-ios-sim` |
| `xcodegen`, CocoaPods, `libimobiledevice`, `ios-deploy` | Present through Homebrew. `tauri ios init` installed `libimobiledevice` itself |
| Node, pnpm | 24.16.0 and 11.2.2 |
| Signing | No `APPLE_DEVELOPMENT_TEAM` yet, so only simulator builds work for now |

## Layout

```
mobile/
  PLAN.md
  index.html, vite.config.ts   the phone app's frontend entry
  src-tauri/                   crate bismillah-mobile; gen/android, gen/apple
  plugins/camera/              Kotlin, later Swift
tests/mobile/                  the suite that drives the debug app on the emulator
src/mobile/                    phone screens; imports src/editor, src/styles
crates/bismillah-print/        gains the receiving side
```

**Why a separate shell and not `#[cfg(mobile)]` inside `src-tauri`:** `src-tauri` carries the stick (`appliance.rs`), the native menu, the file watcher, the trash and GTK. Gating each of those is a risk to the code that protects the writer's files, and it would put phone code into the stick's build. A separate crate leaves the desktop app and the stick untouched. Code moves into a shared crate only when the phone needs it.

**The seam in the editor:** none was needed. `src/editor` imports `core/ipc.ts` for types only, and `core/copy.ts` pulls in no IPC, so the phone runs the editor unchanged.

**Its own Cargo workspace:** `mobile/src-tauri` keeps its own lockfile, so the phone's dependencies never enter the root `Cargo.lock`, which the stick's offline build vendors. `cargo deny` needs a separate run there before anything ships.

## Milestones

### M0 — The specimen on the emulator (the first step)

*Question: does our editor, with our fonts, run and look right in Android's WebView?*

1. **Toolchain, without touching the system's Rust.** Install rustup into a private home, on Rust 1.99.0 to match the host, with `x86_64-linux-android` and `aarch64-linux-android`. Only the mobile scripts put it on the path, so desktop builds and the OS image keep using pacman's Rust. Set `NDK_HOME` to 27.1 and check that Gradle runs on Java 17.
2. **Shell.** Create `mobile/` with `tauri android init`. `bismillah-mobile` is its own workspace (see *Layout*).
3. **Screen.** A read-only view of `docs/specimen.md` using the real editor, tokens and fonts.
4. **Commands.** `pnpm mobile:dev`, `pnpm mobile:build`, and `pnpm mobile:shot` for screenshots in both themes.
5. **A dedicated AVD**, `bismillah`, so that `pixel` and `zuhd-qa` stay as they are.
6. **Permission check.** `INTERNET` is removed from the manifest for every build, debug too, and both run. So `pnpm mobile:dev` builds and installs the app with its files inside, and there is no dev server or hot reload. `pnpm mobile:build` fails if a release APK declares the permission.

**Accepted when:**
- The app builds and opens on the emulator from one command.
- The specimen is right in both themes: RTL, vocalised Arabic, Uthmani text, IJMES and mixed lines. Screenshots are compared side by side with the desktop's.
- A check on the release APK finds no `INTERNET` permission, and that build still runs.
- `pnpm verify` still passes, and the desktop app and the stick's build are unchanged.
- The WebView version is recorded, along with how the specimen differs from WebKitGTK.

ADR-0022 is accepted here or rewritten. If the specimen can't be made right, the plan stops here.

**Result, 2026-10-31: accepted by the author ("this is a good start"), who also asked for narrower margins.**

| Check | State |
|---|---|
| One command builds and opens it | Yes: `pnpm mobile:dev` |
| Specimen, both themes | Right against the desktop's screenshots, and seen by the author in the emulator |
| Release APK has no `INTERNET`, and runs | Yes, by `aapt2` and on the emulator. 24.7 MB for two architectures |
| `pnpm verify` | Passes, after the fixes below |
| WebView | Chrome 124.0.6367.219, the version in this Android 15 image. Real phones update theirs, so M2 records the real one |

**How it differs from WebKitGTK:**
- Glyphs and marks match in the Arabic, Uthmani, IJMES and mixed lines, in the screens compared.
- A line can break next to a hidden Markdown mark: *trust* / `, and`, and a line that starts with a stray space after **mistakes**. CodeMirror's invisible `cm-widgetBuffer` images give Chrome a break opportunity. This needs a change in the shared editor. It was left for M3 and **is still open**.
- The desktop's 56 px gutter took 27% of a phone's width, so the phone uses 20 px, at the author's request (`src/mobile/mobile.css`). List and quote markers now indent their own lines, and the reading view keeps no caret on the heading. A tapped heading would show its `#` cut off at the edge, which M5 must solve.
- A table header that wraps has its rule running through the second line (*Line height*). This was left for M3 and **is still open**.

**Network crates:** Tauri lists `reqwest` and `hyper` as dependencies on mobile, including iOS. Settled for Android on 2026-10-31: the release library has no `reqwest`, `hyper` or `rustls` symbols, no such crate paths in its strings, and imports no socket, connect or name-lookup call from libc. The same search does find `bismillah_print`, `tauri` and an imported `open`, so it can find things. Android refuses network access without `INTERNET` in any case. This covers the Rust library, not the WebView, whose limits are the CSP and the missing permission.

**Getting `pnpm verify` to pass:** it failed on the Print to Phone work, which hadn't been through the gate, and it passes now.
- `deny.toml` allows BlueOak-1.0.0, for `minicbor` through `ur` (the author's decision).
- The print tests used a repeated sentence, which deflates into one frame and so shows a still code. They now use words that don't compress.
- `tests/visual/format-bar.visual.ts` caught WebKit's overlay scrollbar, flashed by the theme change, so it now waits for it to fade. Its baselines lost the glow ADR-0020 removed.
- `tests/visual/print.visual.ts` had no baselines, and now has four, checked by eye. They showed one flaw: at the 480 × 360 minimum window, the dialog's text column scrolled and hid its title. That's fixed: the title and buttons now stay, and only the words between them scroll. The baselines were redrawn on 2026-11-01 for format version 2, which draws different codes.
- `tests/e2e/basmallah.e2e.ts`, *selects with the mouse*, failed once in a full run while the machine was loaded, on its double-click. It then passed 8 of 8 alone and in the next full run. It's probably sensitive to load, and it's unchanged.

### M1 — Receiving, proved without a camera

Add the receiving side to `bismillah-print`: fountain decoder, envelope, SHA-256 check. A debug-only hook feeds the app frames drawn by the real `Printer`.

**Accepted when:** a document round-trips byte for byte through the app on the emulator, including BOM, CRLF and vocalised Arabic. Frames arriving out of order, lost or from another document cost time and never produce wrong bytes. Corrupt data shows an error and stores nothing.

**Result, 2026-10-31: built, waiting for the author.**

| Check | State |
|---|---|
| Byte for byte through the app: BOM, CRLF, vocalised Arabic, lone CR, NUL, unnormalised marks | Yes. The stored file is read back off the emulator with `adb` and compared outside the app |
| A 50 KB chapter at all four densities | Yes |
| Frames out of order, 3 in 10 lost, strays from another document, a new print taking over | Cost time only. The right bytes arrive, and the stray document isn't stored |
| Other QR codes and garbage | Ignored, and the screen doesn't change |
| A digest that disagrees | Shows an error and stores nothing, and the next print still works |
| The comparison can fail | Yes: a test alters the stored file and expects a failure |
| Release APK | Runs without `INTERNET`, and its frontend has no test hook |

`pnpm mobile:test` passed three runs in a row. Frames are drawn by the real `Printer` at 3 pixels a module and read back from the picture by `rqrr` on the host, then fed in as text. So the frames are real, but no camera or phone reader has seen one. `pnpm mobile:test` isn't part of `pnpm verify`, which only runs the crate's tests.

**What the format work found,** all fixed unless marked:
- A part claiming a huge fragment count made the `ur` decoder try to allocate tens of gigabytes before any check. A small message could also inflate without limit. The limits are now 65,536 fragments and 64 MiB, on both sides.
- The first frame sets a decoder's stream for good, so one stray frame could block a print forever. Three strays in a row now switch to the new print.
- The `bom-crlf-many` vector had no BOM, so it was regenerated. The format didn't change.
- **Settled in M3:** version 1 had no folder or place in a run, so M3 brought version 2 (`docs/print-format.md`).
- **Measured in M3:** the `ur` decoder copies quadratically when it reassembles (see M3's result).
- **Not fixed, for the author:** the print dialog says "Open bismillah Reader", while the app is called bismillah.

**Left for later:**
- **Done in M3:** the library on `received/<sha256>`, a kill during a write, device-to-device transfer excluded and checked on the APK, and the bars following the theme.

### M2 — The real camera on the iPhone

*Later, after M6.* A Swift camera plugin feeding frames to the decoder. **This needs the iPhone and M6's build.** Choose the QR reader by bench test. Start with AVFoundation's own QR reader, which adds no dependency to audit, and check whether it keeps up with a moving code. The app needs a camera purpose string. Android's Kotlin plugin, with CameraX, waits until there's an Android phone to test it on. The stick's `FRAMES_PER_SECOND` and densities get tested here too: 6 fps today, against the research's higher settings.

**Accepted when:** a 50 KB chapter scans by hand from a real laptop screen in under 30 s, with exact bytes. The result is recorded for each density and frame rate, and this replaces the estimates in the research report.

### M3 — The reader

A list of received documents and a reading view with the same typography, marked *Exact, N bytes*. A text's path in the library links versions of it (see the result below). New versions never replace old ones. Storage goes through Rust, with cloud backup turned off.

**Menus and settings: the Search palette, as a sheet.** The quiet line at the bottom opens one list of documents, commands and settings, as Search does on the desktop, with the keyboard only when the field is tapped. There is no tab bar, hamburger menu or floating button. Settings hold what applies on a phone: theme, font, text size and margins. The author hasn't reviewed this yet, so show it early. If the line proves awkward on a real phone, near Android's home gesture, the fallback is a swipe up from it or a small button.

**Print whole library.** A stick command prints every file in one QR run, and the phone stores them with their folders. This is the stick's only protection against loss, because QR is its only way out. It needs a resumable run, so a long scan can stop and pick up where it left off. The stick must say how long a real library takes before the run starts. Until M2 has measured a real phone, that estimate stays provisional.

**Accepted when:** failure paths are tested (disk full, killed during a write), a killed app loses nothing it reported as stored, and a whole test library arrives byte for byte, including after an interrupted run.

**Result, 2026-11-01: built, waiting for the author's look at the sheet.** `pnpm mobile:test` passes all 23 tests, and `pnpm mobile:build` makes a release APK that its checks pass.

| Check | State |
|---|---|
| A whole library arrives byte for byte, with its folders | Yes, frames from the real `Playlist`, read back from their pictures. Folders live in the notes, and no path reaches the disk |
| After an interrupted run | The process is killed mid-text. After the restart the phone says how far it got and which numbers it lacks. Going to those numbers finishes the library, byte for byte |
| Killed during a write | Nothing reported as stored is lost, and no half-written file remains |
| Disk full, read-only folder | Unit tests in `store.rs`. Reported, and nothing kept. Not provoked on the emulator's own disk |
| New versions never replace old ones | Yes. The older one stays readable from the sheet, is called an earlier version, and is still *Exact* |
| Backup | Cloud backup and device-to-device transfer are off. `pnpm mobile:build` fails if the APK allows either. This checks the manifest, and no real transfer was tried |
| System bars | Follow the app's theme setting and a system change while open, by what Android reports |

**Decided while building it:**
- **The path links versions, not a document ID.** The stick's files can't carry an ID (AGENTS.md, *Save exactly what the writer typed*), and a side table on the stick would be new state to protect for little gain. So **a renamed file starts a new document on the phone**, and its older versions stay under the old name.
- **The same bytes under two paths are two documents,** which the first design would have lost: it kept one name for each digest.
- **An old text printed again counts as the latest,** because that's what the stick now holds. A code left on the screen repeats too, so the same text within a minute changes nothing.
- **A run's texts wait in the library,** so the page doesn't change under a writer reading it, unless all it holds is the sample.

**Measured, the `ur` decoder's quadratic copying:** on this machine the largest print, 65,536 fragments at the smallest density, took 4.7 s to decode, with 4.5 s of that on the last frame. 8,000 fragments at the largest density took 1.5 s. It's one pause at the end, off the UI thread, on a text that takes hours to show, so it isn't worth working around. The arithmetic's 97 GB was an upper bound. These fragments were all alike, and a real phone is slower, so M2 should check a long text.

**Known limits:**
- A library that changed makes a new run, so the phone counts from zero again and needs to see every text once more. It keeps what it has, but it can't know a text's new number until it has read it.
- The stick's numbers are typed by hand, because nothing comes back.
- On this emulator, under load on software rendering, System UI sometimes shows "isn't responding". It isn't the app, and the suite dismisses it.

**For the author to look at:** the sheet (`pnpm mobile:show`, then Search), including the fallback question above, which only a real phone can settle.

### M4 — Sealing and pairing

The phone creates a key, and the writer types its public key into the stick once. Exports are sealed to that key, and both sides show check words. This changes the stick too, and it needs its own ADR, including testing key generation at early boot. The stick says *Shown*, never *Received*.

**Accepted when:** filmed frames can't be opened without the phone's key, a typo in the key is caught, and the stick can't read its own exports.

**Result, 2026-11-01: built, waiting for the author.** The decision is [ADR-0023](../docs/decisions/0023-sealed-prints.md), still *Proposed*.

| Check | State |
|---|---|
| Filmed frames can't be opened without the phone's key | Yes. On the emulator a print sealed to another key is refused and stores nothing, and the next print still arrives. In the crate, a receiver without the key gets no text from a whole library run, the name isn't in the sealed message, and every altered byte is refused |
| A typo in the key is caught | Yes. A test tries every substitution, deletion, doubling and neighbouring swap, and the stick's real dialog keeps the field and explains |
| The stick can't read its own exports | By construction: it holds only the public half, and has no code path that opens with it. Each seal's own key is gone at once |
| Sealed bytes | A text and a whole library arrive byte for byte, sealed, through the app on the emulator. `pnpm mobile:test` passed all 28 tests twice in a row |
| Both sides show check words | Yes: the phone's pairing screen, and the stick's notice and print dialog |
| The stick says *Shown*, never *Received* | It says *Sealed to your phone*. The existing test on its wording still holds |
| Key generation at early boot | **Not tested on the stick.** The image builds a committed ref, so this can run now that the work is committed, after `pnpm os:fetch` (see the ADR) |

**Decided while building it:**
- **HPKE instead of age,** for 43 crates against 120 to 140 (see the ADR). This is the one choice that differs from this plan, so it's the first thing to review.
- **An unpaired stick still prints, and says it isn't sealed,** because a print is its only protection against loss.
- **Sealing doesn't authenticate the sender,** which the format notes had wrongly claimed.

**Found while testing:** at start-up the app could overwrite what a frame or a tap had just said on the quiet line, so a stored print could show "A sample. Nothing has been received yet." It's fixed, and an opening now never overwrites something newer.

**Before the stick's next image:** `pnpm os:fetch` must run online, because the root lockfile gained crates.

### M5 — The editor

A touch design with the same writing page, and editing on the phone, marked *Edited from exact*. The stick's copy is the master: phone edits are separate versions, a new print never overwrites them, and they reach the stick only if the writer retypes them. **This needs the iPhone**, with its own keyboard, and an Android phone before Android ships.

**Accepted when:** vocalised Arabic typed on the phone produces the expected bytes and marks stay intact, on the iPhone. **If this fails, the app ships as a reader with notes.**

### M6 — The iPhone

*Later, when the author chooses. Its steps are ready. Question: does the app install on the author's iPhone, and is the specimen right in WKWebView?*

Every Tauri iOS command needs macOS, so iOS builds run on the author's Mac (see *What the Mac has*), not on the Linux machine.

1. **Commit the phone work.** Done on 2026-11-01. A runner builds a committed ref, so anything since needs committing before a build sees it.
2. **Repeat the network check on the iOS binary.** On Android a missing permission refuses network access whatever the code does. iOS has no such switch, so *no network code* has to be true of the build itself. Android's release library passed (see *Network crates* under M0), and the iOS one needs the same inspection.
3. **The Apple side, in the author's hands:** the author has an active Developer Program membership. They create the App Store Connect record for `org.bismillah.reader` and an API key with Admin access, and add the issuer, key ID, `.p8` and team ID as repository secrets. Tauri's automatic signing then needs `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH` and `APPLE_DEVELOPMENT_TEAM`.
4. **The build,** on the author's Mac. `gen/apple` was made there on 2026-11-03. `tauri ios build --export-method app-store-connect` builds the upload for TestFlight. The author chose a GitHub macOS runner when there was no Mac. Whether the upload now runs from the Mac or on a runner is open (*Open decisions*), and AGENTS.md's "no hosted CI" changes only if it's the runner.
5. **The specimen,** compared with the desktop's and the Android emulator's screenshots, using photos or screenshots from the iPhone.

**Accepted when:**
- One command puts a build on the author's iPhone through TestFlight.
- The specimen is right in both themes: RTL, vocalised Arabic, Uthmani text, IJMES and mixed lines.
- The iOS and WebKit versions are recorded, along with how the specimen differs from WebKitGTK. WebKit's Arabic mark bug (ADR-0011) needs a specific look, since WKWebView shares that engine.
- The build is shown to hold no network code, or the difference is reported to the author before anything else is built on it.

The macOS desktop app is built on the same Mac (ARCHITECTURE.md §12.3).

### M7 — Publishing

One command, `gh workflow run mobile.yml`, builds both apps and uploads them to TestFlight and Play's internal track. iOS builds on a macOS runner and uploads with `altool`, which M6 brings forward. Android uploads with `eas submit --path` or `fastlane supply`. The first Android upload is done by hand, as Google Play requires.

### Later — OCR

A second way in, for books and paper only, marked *Read by camera, unverified*. It can't produce exact Arabic bytes (see the research report), so it can be dropped without harm. It also needs the author's ruling on ADR-0004 if the reader is a vision-language model.

## What the emulator can and can't prove

| Can prove | Can't prove |
|---|---|
| The build, the WebView's typography, layout and touch targets | Camera speed and hand-held scanning |
| Decoding from injected frames, storage, failure paths | Real keyboards: this image has no Play Store, so no Gboard, and `adb` can't produce real Arabic composition |
| The permission check on the APK | Real performance and battery |

AGENTS.md's rule that mobile tooling doesn't apply still holds for the desktop app and the stick. It doesn't apply to `mobile/`.

## Promises on a phone

The app makes fewer promises than the stick, and it says which:

- **It can promise:** no network code in the app, no accounts, no telemetry, received text stored as untouched bytes, and no false *Exact*.
- **It can't promise:** what the phone's keyboard sees, what the OS does outside the app, or anything after the writer shares a file onward.
- **Android can prove offline** through the missing permission. iOS has no such switch, so there it rests on the app having no network code.

## Open decisions

| Decision | Assumed until the author says otherwise | Needed by |
|---|---|---|
| Whether the stick's frame rate changes | Wait for M2's bench results | M2 |
| HPKE or age for sealing (ADR-0023) | HPKE, as built | Before any sealed print is relied on |
| The app's display name | *bismillah*, while the print dialog says "bismillah Reader". The bundle ID is settled: `org.bismillah.reader` | Before release |
| Where the TestFlight upload runs | From the author's Mac. A GitHub macOS runner was chosen before there was a Mac | M6 |
| Which Android phone to test on | None for now: Android stays on the emulator, and M5's keyboard check waits for a real phone | Before Android ships |
