# 0015 — Nothing is handed to other apps

- **Status:** Accepted
- **Date:** 2026-10-23 (the author's decision)
- **Supersedes:** the link bullets of [0003](0003-offline-boundary.md) and *Copy as rich text* in [0012](0012-live-preview.md)

## Context
bismillah is now used through the stick (ADR-0013): no network, no browser, no mail app, no file manager and no other app to paste into. Three Phase 4–6 features existed only to hand something to another app: links opened on Ctrl+click or *Open link*, *Show in file manager* in Settings, and *Copy as rich text*. On the stick they were hidden or refused with a message. Each one also carried code, a dependency or a privacy exception that the rest of the app doesn't need.

## Decision
Remove all three, on the stick and on the desktop:
- **Links never open.** Hovering a link or an image still shows its address in a tooltip. `src-tauri/src/links.rs`, `link_open`, `platform::open_uri` (GIO) and the `url` crate are gone.
- **No *Show in file manager*.** Settings › Files & privacy still names each folder. `folder_show` is gone.
- **No *Copy as rich text*.** Plain copy (`Ctrl+C`) copies the Markdown source, as before. `src/richText`, `clipboard_write`, the GTK clipboard code, markdown-it, markdown-it-footnote and DOMPurify are gone.
- The guide drops the desktop-only *Open with*, *From a terminal* and graphics-driver/`fc-list` sections.

## Consequences
- No link or folder is handed to another app, so PRIVACY.md and the guide no longer need the "links you open yourself" exception. Plain copy and paste stay.
- ADR-0012's rule that a document can never run script now rests on the live preview alone: raw HTML still shows as text, and remote images are still never loaded.
- Fewer native paths to audit: bismillah no longer launches a browser, mail app or file manager, and the frontend loses three dependencies.
- A writer who wants formatted text or a link's target copies the Markdown and uses another computer.
