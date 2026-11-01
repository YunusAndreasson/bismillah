# 0023 — Sealed prints

- **Status:** Proposed 2026-11-01, with M4 in [mobile/PLAN.md](../../mobile/PLAN.md). It waits for the author's review. Its choice of HPKE over age differs from the plan's wording.
- **Date:** 2026-11-01
- **Related:** [0021](0021-print-to-phone.md) prints through a QR code, [0022](0022-phone-app.md) is the phone that reads it.

## Context
A print is a film of the writer's text. Until now, anyone who could film the screen, or who later found the film, could read it with the format's public description. The stick's texts are encrypted at rest, so its only way out shouldn't be the weak point.

The channel runs one way. The stick can't scan a code or hear from the phone, so a key can only reach it by typing.

## Decision
- **The phone makes a key pair, and the writer types its public half into the stick once.** The stick holds only that half, which can't open anything. Each print is sealed with a fresh key that's gone at once, so **the stick can't read its own exports**.
- **HPKE (RFC 9180), base mode:** X25519, HKDF-SHA256 and ChaCha20-Poly1305, through the `hpke` crate. The plan said age. In this repo `age` brings 120 to 140 crates, including a translation stack (`fluent`, `i18n-embed`, `rust-embed`) and `scrypt`, which we'd never use, into an image we've worked to shrink. `hpke` and `bech32` bring 43. We give up compatibility with the `age` tool, which nothing here needs. **Neither is a formal audit we can point to:** `hpke`'s README says it hasn't been formally audited, and we didn't establish one for `age`'s Rust crate either.
- **The key is 61 characters of Bech32m,** `bk1…`, shown in groups of four. Its checksum catches a typing slip, and a test tries every single substitution, deletion, doubling and neighbouring swap. Case, spaces and dashes don't matter. A key that passed with a slip would seal to nobody, and the writer would film a text no one can open.
- **Both sides show four check words,** from a hash of the key, in BC-UR's bytewords, which the format already carries. The stick shows them after pairing and in every print dialog.
- **Everything is inside the seal:** the name, the digest, the place in a run and the text. A camera learns the print's approximate size, and nothing else.
- **A stick that isn't paired still prints, and says plainly that it isn't sealed.** The print is the stick's only protection against loss, so a missing pairing must not stop a backup. The dialog warns, and the phone says *Not sealed* beside what arrives.
- **The stick says *Sealed to your phone*,** never *Received* (ADR-0021).
- **The phone's secret stays in its private folder,** which backup and device transfer leave out. It isn't in the system keystore: the texts it opens lie beside it as plain bytes, so a keystore would protect nothing more.

## What a seal doesn't do
- **It doesn't say who made a print.** A public key isn't secret, so anyone who has it can seal to it. *Exact* still means only that the bytes match the digest the print carried. An earlier note in docs/print-format.md said sealing would authenticate the name, which was wrong.
- **It doesn't protect a text on the phone.** Texts are stored as bytes, under whatever protects the phone itself (mobile/PLAN.md, *Promises on a phone*).
- **It doesn't keep a film from someone who later gets the phone's secret.** A film of a sealed print can be opened by anyone holding that key, then or later. The stick's per-print key adds no forward secrecy against that.

## Consequences
- Losing the phone's key costs only what hasn't arrived yet, since stored texts don't need it. A new key makes old films unreadable, and the stick must be paired again. The phone says so when it refuses such a print.
- Sealing is random, so two showings of a print no longer combine, and a library run seals each text afresh every round. A camera loses only the frames it gathered for an unfinished text.
- The root `Cargo.lock` gains crates, so the stick's offline build needs `pnpm os:fetch` again, online, before its next image.
- **Randomness at early boot is not yet tested on the stick.** It was left out of M4's testing because the image builds a committed ref. The stick makes no long-term key, and it seals only after the writer has unlocked it, well after boot, using the kernel's `getrandom`, which waits until it's seeded. A VM run must still confirm this, after `pnpm os:fetch`.
