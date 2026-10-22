<script lang="ts">
  import { ContextMenu } from "bits-ui";
  import { tick, untrack } from "svelte";
  import { commandById, type CommandId } from "../core/commands.ts";
  import { shortcuts } from "../core/keybindings.svelte.ts";
  import { keyOf, normalise } from "../core/keys.ts";
  import { copy } from "../core/copy.ts";
  import type { LibraryStore } from "../core/library.svelte.ts";
  import { findNode, folderFor, move, typeahead, type Row, type TreeKey } from "../core/tree.ts";

  /**
   * The library tree (DESIGN.md §6, §9.4, §16): the WAI-ARIA tree pattern with one tab
   * stop that moves with the arrow keys, type-ahead, Enter to open, Delete to move to
   * the trash. The open document's row is selected: an edge bar, heavier weight and
   * `aria-selected`, never colour alone. Bits UI has no tree, so the keyboard model is
   * our own and tested in src/core/tree.test.ts.
   */
  interface Props {
    library: LibraryStore;
    open: (path: string) => void;
    /** Runs a command on the focused row (Rename…, Move to trash, New file…). */
    run: (id: CommandId) => void;
    /** "New file here…" / "New folder here…" for a folder. */
    newHere: (kind: "file" | "folder", folder: string) => void;
    /** Esc: back to the text. */
    escape: () => void;
  }
  let { library, open, run, newHere, escape }: Props = $props();

  // Row elements by path, only for moving focus: not state anything renders from.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const elements = new Map<string, HTMLElement>();
  const t = copy.library;

  /** The row that is the tree's one tab stop. */
  const tabStop = $derived.by(() => {
    const rows = library.rows;
    const has = (p: string | null) => p !== null && rows.some((r) => r.node.path === p);
    if (has(library.focused)) return library.focused;
    if (has(library.active)) return library.active;
    return rows[0]?.node.path ?? null;
  });

  function register(element: HTMLElement, row: Row) {
    let path = row.node.path;
    elements.set(path, element);
    element.style.setProperty("--level", String(row.level));
    return {
      update(next: Row) {
        if (elements.get(path) === element) elements.delete(path);
        path = next.node.path;
        elements.set(path, element);
        element.style.setProperty("--level", String(next.level));
      },
      destroy() {
        if (elements.get(path) === element) elements.delete(path);
      },
    };
  }

  async function focusRow(path: string | null) {
    if (path === null) return;
    library.focused = path;
    await tick();
    const element = elements.get(path);
    element?.focus();
    element?.scrollIntoView({ block: "nearest" });
  }

  // The workspace asks for focus when the library opens or after an action. Only a
  // request moves focus: the tab stop also follows the open document, and tracking
  // it took focus from the text whenever a file opened beside the docked library.
  $effect(() => {
    if (library.focusRequests > 0) void focusRow(untrack(() => tabStop));
  });

  function activate(row: Row) {
    if (row.node.unavailable) return;
    if (row.node.kind === "folder") library.toggleFolder(row.node.path);
    else open(row.node.path);
  }

  let typed = "";
  let typedAt = 0;
  const TREE_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"]);

  function onkeydown(event: KeyboardEvent) {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const row = library.rows.find((r) => r.node.path === tabStop);
    if (plain && !event.shiftKey && TREE_KEYS.has(event.key)) {
      event.preventDefault();
      const result = move(library.rows, library.expanded, tabStop, event.key as TreeKey);
      if (result.expand) library.expanded.add(result.expand);
      if (result.collapse) library.expanded.delete(result.collapse);
      if (result.focus) void focusRow(result.focus);
    } else if (plain && event.key === "Enter" && row) {
      event.preventDefault();
      activate(row);
    } else if (plain && event.key === "Escape") {
      event.preventDefault();
      escape();
    } else if (row && trashKey && keyOf(event) === normalise(trashKey)) {
      event.preventDefault();
      run("file.trash");
    } else if (plain && event.key.length === 1 && (event.key !== " " || typed)) {
      event.preventDefault();
      const now = Date.now();
      typed = now - typedAt > 700 ? event.key : typed + event.key;
      typedAt = now;
      const found = typeahead(library.rows, tabStop, typed);
      if (found) void focusRow(found);
    } else if (plain && event.key === " " && row) {
      event.preventDefault();
      activate(row);
    }
  }

  // The context menu acts on the row it was opened over (or the top of the library).
  let menuPath = $state<string | null>(null);
  const menuNode = $derived(menuPath === null ? null : findNode(library.nodes, menuPath));

  function oncontextmenu(event: MouseEvent) {
    const row = event.target instanceof Element ? event.target.closest("[data-path]") : null;
    menuPath = row instanceof HTMLElement ? (row.dataset.path ?? null) : null;
  }

  async function onRow(id: CommandId) {
    if (menuPath === null) return;
    await focusRow(menuPath);
    run(id);
  }

  const key = (id: CommandId) => shortcuts.label(id);
  // Move to trash works only here, on its own key (Delete unless keybindings.toml says).
  const trashKey = $derived(shortcuts.keyFor("file.trash"));

  function split(name: string, file: boolean): [string, string] {
    const match = file ? /\.(md|markdown)$/i.exec(name) : null;
    return match ? [name.slice(0, match.index), match[0]] : [name, ""];
  }
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger class="tree-area" {oncontextmenu}>
    <div class="tree" role="tree" aria-label={library.name ?? t.region} tabindex="-1" {onkeydown}>
      {#each library.rows as row (row.node.path)}
        {@const node = row.node}
        {@const folder = node.kind === "folder"}
        {@const [stem, ext] = split(node.name, !folder)}
        <!-- Keys are handled once, on the tree (onkeydown above), as the ARIA tree
             pattern has it; rows take clicks. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          use:register={row}
          class="row"
          class:folder
          class:active={node.path === library.active}
          class:unavailable={node.unavailable}
          role="treeitem"
          data-path={node.path}
          aria-level={row.level}
          aria-posinset={row.position}
          aria-setsize={row.siblings}
          aria-expanded={folder && !node.unavailable ? library.expanded.has(node.path) : undefined}
          aria-selected={node.path === library.active}
          aria-disabled={node.unavailable || undefined}
          tabindex={node.path === tabStop ? 0 : -1}
          onclick={() => {
            library.focused = node.path;
            activate(row);
          }}
          onfocus={() => (library.focused = node.path)}
        >
          {#if folder}
            <svg
              class="chevron"
              class:open={library.expanded.has(node.path)}
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          {/if}
          <span class="name"
            ><bdi>{stem}</bdi>{#if ext}<span class="ext">{ext}</span>{/if}</span
          >
          {#if node.unavailable}<span class="note">· {t.outside}</span>{/if}
        </div>
      {/each}
    </div>
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="menu" onCloseAutoFocus={(e) => e.preventDefault()}>
      {#if menuNode}
        {#if menuNode.kind === "file" && !menuNode.unavailable}
          <ContextMenu.Item class="menu-item" onSelect={() => open(menuNode.path)}>
            {t.menu.open}
          </ContextMenu.Item>
        {/if}
        <ContextMenu.Item class="menu-item" onSelect={() => void onRow("file.rename")}>
          <span>{t.menu.rename}</span><kbd>{key("file.rename")}</kbd>
        </ContextMenu.Item>
        <ContextMenu.Item class="menu-item" onSelect={() => void onRow("file.trash")}>
          <span>{t.menu.trash}</span><kbd>{key("file.trash")}</kbd>
        </ContextMenu.Item>
        {#if !menuNode.unavailable}
          <ContextMenu.Separator class="menu-separator" />
          <ContextMenu.Item
            class="menu-item"
            onSelect={() => newHere("file", folderFor(library.nodes, menuNode.path))}
          >
            {t.menu.newFile}
          </ContextMenu.Item>
          <ContextMenu.Item
            class="menu-item"
            onSelect={() => newHere("folder", folderFor(library.nodes, menuNode.path))}
          >
            {t.menu.newFolder}
          </ContextMenu.Item>
        {/if}
      {:else}
        <ContextMenu.Item class="menu-item" onSelect={() => newHere("file", "")}>
          <span>{commandById("file.new")?.label}</span><kbd>{key("file.new")}</kbd>
        </ContextMenu.Item>
        <ContextMenu.Item class="menu-item" onSelect={() => newHere("folder", "")}>
          <span>{commandById("library.newFolder")?.label}</span><kbd>{key("library.newFolder")}</kbd
          >
        </ContextMenu.Item>
      {/if}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>

<style>
  :global(.tree-area) {
    flex: 1 0 auto;
  }
  .tree {
    display: grid;
    padding-block: var(--space-1);
    outline: none;
  }
  .row {
    --indent: 16px;
    position: relative;
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    min-width: 0;
    padding-block: var(--space-1);
    padding-inline: calc(var(--space-2) + (var(--level) - 1) * var(--indent)) var(--space-2);
    border-radius: 4px;
    color: var(--text-primary);
    cursor: default;
    white-space: nowrap;
  }
  /* Files line up with folder names, past the chevron. */
  .row:not(.folder) {
    padding-inline-start: calc(var(--space-2) + (var(--level) - 1) * var(--indent) + 16px);
  }
  .row:hover {
    background: var(--surface-editor);
  }
  .row:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  /* The open document: an edge bar and weight, not colour alone (DESIGN.md §9.4). */
  .row.active {
    font-weight: 600;
  }
  .row.active::before {
    content: "";
    position: absolute;
    inset-block: var(--space-1);
    inset-inline-start: 0;
    inline-size: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .row.unavailable,
  .row.unavailable .ext {
    color: var(--text-secondary);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .ext,
  .note {
    color: var(--text-secondary);
    font-weight: 400;
  }
  .chevron {
    flex: none;
    inline-size: 12px;
    block-size: 12px;
    margin-inline-end: 4px;
    align-self: center;
    fill: none;
    stroke: var(--text-secondary);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--motion-fast) ease-out;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  :global([dir="rtl"]) .chevron:not(.open) {
    transform: scaleX(-1);
  }
</style>
