# 0003 — Offline boundary and privacy claims

- **Status:** Accepted; links superseded by [0015](0015-nothing-handed-on.md) (2026-10-23): they never open
- **Date:** 2026-10-18

## Context
"No connections" is a core promise. A Content Security Policy and dependency bans help, but they are not an operating-system network sandbox, and crate names cannot prove that code cannot open sockets. Overclaiming would break the principle of care in claims.

## Decision
- Keep a strict CSP, a navigation guard (no external navigation, no new windows), no network-capable Tauri plugins, and `cargo deny` bans.
- Test runtime behaviour: the e2e suite runs offline (`unshare -rn`) and under `strace` with no non-local connections.
- **Public wording** separates two claims: "works without a network" (tested) and "contains no networking features" (audited). We never claim the app *cannot* reach the network.
- Flatpak builds ship without network permission, which gives OS-level confinement where available.
- Logs never include document contents.

## Consequences
- Every release includes a dependency and native-feature audit.
- Links in the editor open in the system browser only on explicit `Mod-click`.
- Remote images are never loaded.

## Phase 6 result (2026-10-19)

- **Links open on `Mod-click`, and on *Open link* from the keyboard,** as decided above. Only `https:`, `http:` and `mailto:` addresses go, checked in Rust (`src-tauri/src/links.rs`), and they reach the browser through the desktop (GIO, already in the tree through GTK) rather than `tauri-plugin-opener`, whose D-Bus stack `cargo deny` flags. bismillah requests nothing itself; under the test harness nothing is launched and the address is recorded instead.
- **The 1.0 audit** (docs/audits/2026-10-19-personal-1.0.md) found no HTTP, TLS or DNS crate in the tree, `tokio` without `net`, and only Unix-domain socket use in the binary; `pnpm test:offline` passes with the link suite included.
- No Flatpak exists yet, so PRIVACY.md now says so instead of pointing to one.
