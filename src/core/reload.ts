import type { OpenedDocument } from "./ipc.ts";

/**
 * The quiet reload (ARCHITECTURE.md §5.4): another program changed the open file and
 * the writer had no unsaved edits, so the new version is taken. Reading it takes a
 * moment, and the writer may type in it; that text is never replaced unseen. It is
 * kept in recovery (Rust's `doc_reload` with the local text) and the new version
 * opens with it on offer (*Restore* · *Discard*), as *Load theirs* does. If they type
 * again meanwhile, the newest text is kept.
 */
export async function quietReload(options: {
  id: number;
  /** The editor's text now. */
  text: () => string;
  /** Rust's `doc_reload`: reopens the file, first keeping `local` in recovery if given. */
  reload: (id: number, local: string | null) => Promise<OpenedDocument>;
}): Promise<{ opened: OpenedDocument; kept: boolean }> {
  let seen = options.text();
  let opened = await options.reload(options.id, null);
  let kept = false;
  for (let now = options.text(); now !== seen; now = options.text()) {
    opened = await options.reload(opened.id, now);
    seen = now;
    kept = true;
  }
  return { opened, kept };
}
