# 0003 — Offline boundary and privacy claims

- **Status:** Accepted
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
