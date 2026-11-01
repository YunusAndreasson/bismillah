# 0021 — Print to Phone: the stick's only way out

- **Status:** Accepted
- **Date:** 2026-10-31 (the author's decision: "from the stick i only want to be able to 'print' through the qr code"). Written after the code, which already cited it.
- **Related:** [0015](0015-nothing-handed-on.md) removed what handed things to other apps on the same machine, and this stays within it: nothing here launches or talks to another program. The phone that reads the code is [0022](0022-phone-app.md).

## Context
The stick has no network, no shell and no other app, and its texts are encrypted. A writer still needs their text somewhere else one day, and a stick can be lost. Every way out is also a way in, or a new promise to break. Bluetooth would end *no radio*, a webcam *no camera*, and a USB gadget mode or a second stick opens a path to the decrypted texts. A paper printer needs drivers and a spooler.

A code on the screen needs none of those. It adds no driver, no radio and no input, and the writer can see it happening. Research (`os/reports/Getting text off the stick.md`) found faster codes than QR, such as cimbar, but no measurement on a laptop panel or under software rendering, and none has the plain readers QR has.

## Decision
- **Printing through a QR code is the only way text leaves the stick.** There's no backup or courier stick, no USB gadget mode and no paper printer (os/PLAN.md, *Out of scope*).
- **It's output only.** The stick shows codes and never scans them, so its image keeps no camera drivers. Nothing enters except by typing.
- **One-way means honest words.** The stick can't know what arrived, so it never says *sent*, *received* or *delivered*, and a test checks this copy. It tells the writer that the phone will say when it has the text.
- **Exact bytes, or nothing.** A print is the bytes a save would write, checked by SHA-256 on the phone. The format is [docs/print-format.md](../print-format.md).
- **Fountain-coded QR frames**, BC-UR through the `ur` crate, so that any frame helps and a camera's misses only cost time.
- **Offered only by debug builds until the phone app exists.** The command is a preview, left out of the registry otherwise, so a release and the stick don't offer a print that nothing can read yet.

## Consequences
- The frame rate and densities are provisional until a real phone has read them (mobile/PLAN.md, M2). A faster code can replace QR later without changing this decision, if it's measured on real panels.
- A print from a stick that isn't paired can be read by anyone who films the screen, and its dialog says so. A paired stick seals every print ([0023](0023-sealed-prints.md)).
- The phone holds the writer's only backup. *Print whole library* (M3) is the stick's protection against loss, so a long run must be resumable and say how long it takes.
- `crates/bismillah-print` holds both sides, free of Tauri. It adds `ur`, `qrcode` and `minicbor`, which brings in BlueOak-1.0.0 (allowed in `deny.toml`).
- Tests: `crates/bismillah-print/tests/`, `tests/fixtures/print/`, `src/core/printer.test.ts`, `tests/e2e/print.e2e.ts`, `tests/visual/print.visual.ts`, and the reading side in `tests/mobile/receive.ts`.
