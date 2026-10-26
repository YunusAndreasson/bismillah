import type { LibraryView } from "./ipc.ts";
import { allFiles } from "./tree.ts";

/**
 * The library's state (DESIGN.md §6): the listing Rust sent and the open document's
 * place in it. The Files panel shows it; actions that touch files live in the
 * workspace.
 */
export class LibraryStore {
  // Rust supplies a fresh immutable listing on every change. Only replacement
  // needs to be reactive; proxying every file/folder makes large trees costly.
  view = $state.raw<LibraryView>({ kind: "none" });
  /** The open document's place in the library. */
  active = $state<string | null>(null);

  readonly nodes = $derived(this.view.kind === "ready" ? this.view.nodes : []);
  readonly files = $derived(allFiles(this.nodes));
  readonly recent = $derived(this.view.kind === "ready" ? this.view.recent : []);
  readonly name = $derived(this.view.kind === "none" ? null : this.view.name);
  readonly ready = $derived(this.view.kind === "ready");

  /**
   * Takes a new listing. A different folder starts afresh, with the open document's
   * place in it from Rust. Within the same folder the workspace keeps `active` itself
   * (open, rename, close): a listing can be sent before a file opens and arrive after,
   * and must never move it back.
   */
  apply(view: LibraryView): void {
    const generation = (v: LibraryView) => (v.kind === "ready" ? v.generation : null);
    const fresh = generation(view) !== generation(this.view);
    this.view = view;
    if (fresh) this.active = view.kind === "ready" ? view.active : null;
  }

  /** The open document changed. */
  setActive(path: string | null): void {
    this.active = path;
  }
}
