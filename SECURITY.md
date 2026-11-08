# Security policy

bismillah promises that a writer's text stays on their computer and is saved
exactly as typed. A hole in bismillah is a way to read someone's writing, send it
somewhere, or lose it, so please report one privately.

## Reporting a vulnerability

Use GitHub's private reporting:
[report a vulnerability](https://github.com/YunusAndreasson/bismillah/security/advisories/new).
Please don't open a public issue.

Include the version (`bismillah --version`, or *Help › About bismillah*), your
OS and how you installed it, what you did, what happened, and what an attacker
would gain. A document that triggers it helps, if it holds nothing private.
Reports are acknowledged within a week. A fix is coordinated with you before
anything is published, and you're credited in the advisory unless you'd rather
not be.

## Supported versions

There are no published releases yet. Fixes land on `main`, which is what the Arch
package in `packaging/arch` builds. Once the stick's image and the macOS app are
published, only the latest of each gets fixes.

## What counts as a security issue

Because bismillah promises local-only, private writing, these are security
issues here, even where another editor would call them bugs:

- any way the app makes a network request or loads remote content
- a link followed, or anything handed to another program
- reading or writing files outside the library the writer chose (path traversal,
  symlink escape)
- script running from a document's content, for example through live preview
- document contents appearing in logs
- lost or silently changed text, or *Saved* shown before the text is on disk

## Scope

In scope:

- the desktop app (`src/`, `src-tauri/`) and its Rust crates (`crates/`)
- the bismillah stick (`os/`): its boot chain, the encrypted home partition,
  unlocking and the helper, `bismillah-install`, and the install scripts served at
  https://bismillah.ink/install.sh and `/install.ps1`
- Print to Phone, sealed prints and the phone app (`mobile/`)
- the website (`web/`) and this repository's workflows

Out of scope: vulnerabilities in WebKitGTK, Tauri, Debian's packages or a
laptop's firmware themselves (report those to their projects, and tell us if
bismillah should work around one), and the attacks the stick doesn't claim to
stop, listed under
[What the stick promises, and what it doesn't](os/README.md#what-the-stick-promises-and-what-it-doesnt).
