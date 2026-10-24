import { SvelteSet } from "svelte/reactivity";
import type { LibraryView } from "./ipc.ts";
import { DEFAULT_COLUMN, libraryLayout, type LibraryLayout } from "./layout.ts";
import { allFiles, ancestors, findNode, folderFor, parentOf, visibleRows } from "./tree.ts";

/**
 * The library panel's state (DESIGN.md §6–7): the listing Rust sent, which folders are
 * open, the row with keyboard focus, the open document's row, and whether the panel is
 * shown docked or as an overlay. Actions that touch files live in the workspace.
 */
export class LibraryStore {
  // Rust supplies a fresh immutable listing on every change. Only replacement
  // needs to be reactive; proxying every file/folder makes large trees costly.
  view = $state.raw<LibraryView>({ kind: "none" });
  /** The writer wants the docked library shown (remembered by Rust). */
  docked = $state(false);
  /** The overlay is open: narrow windows, and never remembered. */
  overlay = $state(false);
  layout = $state<LibraryLayout>({ mode: "overlay", offset: 0 });
  readonly expanded = new SvelteSet<string>();
  /** The row that holds the tree's single tab stop. */
  focused = $state<string | null>(null);
  /** The open document's place in the library. */
  active = $state<string | null>(null);
  /** Bumped to ask the tree to put keyboard focus on the focused row. */
  focusRequests = $state(0);
  /** Find anything's own tree is mounted: requests go to it, not to the library behind
   * the panel (`embeddedRequests`). */
  embedded = false;
  embeddedRequests = $state(0);

  #editorFocusAfterClose = false;

  /** A chosen document should receive focus after the overlay's focus trap closes,
   * even when the panel was opened by clicking its status-line button. */
  closeForDocument(): void {
    if (this.overlay) this.#editorFocusAfterClose = true;
    this.overlay = false;
  }

  takeEditorFocusRequest(): boolean {
    const requested = this.#editorFocusAfterClose;
    this.#editorFocusAfterClose = false;
    return requested;
  }

  readonly nodes = $derived(this.view.kind === "ready" ? this.view.nodes : []);
  readonly rows = $derived(visibleRows(this.nodes, this.expanded));
  readonly files = $derived(allFiles(this.nodes));
  readonly recent = $derived(this.view.kind === "ready" ? this.view.recent : []);
  readonly name = $derived(this.view.kind === "none" ? null : this.view.name);
  readonly ready = $derived(this.view.kind === "ready");
  /** Shown now, docked or as the overlay. */
  readonly visible = $derived(this.layout.mode === "docked" ? this.docked : this.overlay);

  /**
   * Takes a new listing. A different folder starts afresh, with the open document's
   * place in it from Rust. Within the same folder the workspace keeps `active` itself
   * (open, rename, close): a listing can be sent before a file opens and arrive after,
   * and must never move the highlight or focus back. Focus on something that's gone
   * moves to its folder.
   */
  apply(view: LibraryView): void {
    const generation = (v: LibraryView) => (v.kind === "ready" ? v.generation : null);
    const fresh = generation(view) !== generation(this.view);
    this.view = view;
    if (fresh) {
      this.expanded.clear();
      this.focused = null;
      this.active = null;
      if (view.kind === "ready") this.setActive(view.active);
    }
    if (this.focused !== null && !findNode(this.nodes, this.focused)) {
      let folder = parentOf(this.focused);
      while (folder && !findNode(this.nodes, folder)) folder = parentOf(folder);
      this.focused = folder || (this.rows[0]?.node.path ?? null);
    }
    for (const path of this.expanded) if (!findNode(this.nodes, path)) this.expanded.delete(path);
  }

  /** Opens the folders around `path` so its row shows. */
  reveal(path: string): void {
    for (const folder of ancestors(path)) this.expanded.add(folder);
  }

  /** The open document changed: show and focus its row. */
  setActive(path: string | null): void {
    this.active = path;
    if (path) {
      this.reveal(path);
      this.focused = path;
    }
  }

  /** Asks the tree to move keyboard focus to the focused row (or the open file's, or the
   * first) once it is shown. */
  requestFocus(): void {
    if (this.focused === null || !findNode(this.nodes, this.focused))
      this.focused = this.active ?? this.rows[0]?.node.path ?? null;
    if (this.embedded) this.embeddedRequests++;
    else this.focusRequests++;
  }

  toggleFolder(path: string): void {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
  }

  /** Works out docked or overlay for the window and writing column (layout.ts). */
  measure(windowWidth: number, columnWidth = DEFAULT_COLUMN): void {
    const next = libraryLayout(windowWidth, columnWidth);
    if (next.mode !== this.layout.mode || next.offset !== this.layout.offset) this.layout = next;
    if (next.mode === "docked") this.overlay = false;
  }

  /** The folder a new file or folder goes in: the focused entry's when `inTree`,
   * else the open document's, else the top of the library. */
  folderForNew(inTree: boolean): string {
    const active = document.activeElement;
    const row =
      active instanceof HTMLElement ? active.closest<HTMLElement>('[role="treeitem"]') : null;
    if (inTree && row?.dataset.path) this.focused = row.dataset.path;
    return folderFor(this.nodes, inTree ? this.focused : this.active);
  }
}
