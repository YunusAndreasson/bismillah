# 0017 — A published stick image, and one command that installs or updates a stick

- **Status:** Accepted; hosting pending
- **Date:** 2026-10-29 (the author's decision)
- **Answers:** os/PLAN.md's open question "whether other writers get pre-made sticks, or a published image plus `flash.sh`"

## Context
A stick could only be made from a build of this repository on Linux (`os/scripts/flash.sh`). The website's close promises three steps that someone who has never opened a terminal can follow, the second being one command that puts bismillah on the stick. That command has to run on macOS, Linux and Windows, download the image from the site, and keep every safeguard `flash.sh` has: only a USB disk that isn't the computer's own, nothing written until the stick's name is typed back, its own GUIDs so two sticks are never twins, the backup GPT at the stick's end, and an update that never opens home.

## Decision
- **One command per kind of computer**, served by the site: `curl -fsSL …/install.sh | sh` on macOS and Linux, `irm …/install.ps1 | iex` on Windows. Run again on a bismillah stick, the same command offers to update it and keep its texts, or to erase it.
- **The scripts are thin; one program writes.** The scripts download, check each part's sha256, list and check the disks, elevate (sudo; UAC) and unmount or lock the stick's volumes. `bismillah-install` (`crates/bismillah-install`, a static binary for each OS in the same download) checks the whole image against the manifest before writing a byte, writes it with the stick's own disk, ESP and home GUIDs, its stick-id, a protective MBR and a backup GPT at its end, and reads everything back. Its update follows `stick.ts update`: root and verity first, the ESP last, home's first MiB compared before and after. It opens no network connection, so the offline boundary (ADR-0003, `deny.toml`) is untouched.
- **The stick vouches for itself.** A writer has no `os/sticks.toml`, so an update needs the stick's GPT and its ESP's stick-id to name the same disk, ESP and home GUIDs. An update cut off inside the ESP leaves no stick-id; a journal on the computer that ran it (one file per stick while it writes) lets a rerun there finish it. `flash.sh` and its registry stay as they are for the author's builds, and a stick either one made can be updated by the other.
- **Trust is HTTPS from our own origin plus a sha256 for every part**, in a manifest from the same server as the script. A signature would add nothing while the script and its key come from the same place; signing waits for a key a writer gets some other way.
- **The bundle** (`pnpm os:publish`): a line-based `manifest`, the gzip of the raw image in parts under 24 MiB (Workers static assets cap files at 25 MiB), and the five installers (`pnpm os:installer`). A `current` file names the version; it is uploaded last, so no one is sent to a half-uploaded version.
- **Hosting is decided later.** R2 is the likely home. Until then the site serves `stick/current` reading `none`, and the command says no image is published yet. The scripts read the base address from one constant.
- The stick itself still never fetches, installs or changes its own system.

## Consequences
- A writer needs no repository, no Linux and no build. A Mac or a Windows PC can make or update a stick.
- Two implementations of the stick's identity rules now exist, `stick.ts` (TypeScript, the author's builds and the VM tests) and `bismillah-install` (Rust, the published path). `os/tests/install.test.ts` runs the published path end to end and checks its sticks with `stick.ts`, and updates a stick `stick.ts` made.
- Building the macOS and Windows installers needs rustup's targets, zig and cargo-zigbuild on the author's machine. macOS binaries must carry an ad-hoc signature.
- The Windows and macOS scripts can only be run on those systems: their first real runs are part of the author's acceptance.
- Tests: `crates/bismillah-install/tests/install.rs` (made-up images: identity, backup GPT, MBR, damaged downloads, small sticks, updates and their refusals); `os/tests/install.test.ts` (publish.ts, a local server, `curl … | sh`, a cut-off script, no terminal); the VM scenario `published` (the real image installed, booted with each set of Secure Boot keys, updated with a text kept); `web/scripts/smoke-test.sh` (the scripts served as uncached text).
