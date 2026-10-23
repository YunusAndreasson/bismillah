<script lang="ts">
  import type { CommandId } from "../core/commands.ts";
  import { copy } from "../core/copy.ts";
  import type { LibraryStore } from "../core/library.svelte.ts";
  import LibraryTree from "./LibraryTree.svelte";

  /**
   * The library's contents, docked or in the overlay (DESIGN.md §6–7): the folder's name,
   * then its tree, or the state it is in. Empty, missing and unavailable folders say so
   * here, in the area they belong to.
   */
  interface Props {
    library: LibraryStore;
    open: (path: string) => void;
    run: (id: CommandId) => void;
    newHere: (kind: "file" | "folder", folder: string) => void;
    escape: () => void;
    retry: () => void;
    dismiss?: () => void;
    /** See LibraryTree. */
    followFocusRequests?: boolean;
  }
  let {
    library,
    open,
    run,
    newHere,
    escape,
    retry,
    dismiss,
    followFocusRequests = true,
  }: Props = $props();
  const t = copy.library;
  const view = $derived(library.view);
</script>

<div class="panel">
  {#if dismiss}
    <div class="heading">
      <h2 class="title" title={view.kind === "none" ? t.region : view.name}>
        <bdi>{view.kind === "none" ? t.region : view.name}</bdi>
      </h2>
      <button type="button" class="button close" aria-label={t.close} onclick={dismiss}>
        {copy.picker.close}
      </button>
    </div>
  {/if}
  {#if view.kind === "none"}
    <p class="state">{t.none}</p>
    <button type="button" class="button" onclick={() => run("library.openFolder")}>
      {t.openFolder}
    </button>
  {:else}
    {#if !dismiss}<h2 class="title" title={view.name}><bdi>{view.name}</bdi></h2>{/if}
    {#if view.kind === "unavailable"}
      <p class="state">{t.unavailable(view.name)}</p>
      <div class="actions">
        <button type="button" class="button" onclick={retry}>{t.tryAgain}</button>
        <button type="button" class="button" onclick={() => run("library.openFolder")}>
          {t.chooseFolder}
        </button>
      </div>
    {:else}
      {#if view.nodes.length === 0}
        <p class="state">{t.empty(view.name)}</p>
        <button type="button" class="button" onclick={() => newHere("file", "")}>
          {t.newFile}
        </button>
      {:else}
        <div class="scroll">
          <LibraryTree {library} {open} {run} {newHere} {escape} {followFocusRequests} />
          {#if view.truncated}<p class="state">{t.truncated}</p>{/if}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .panel {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 100%;
    min-height: 0;
    color: var(--text-primary);
  }
  .title {
    margin: 0;
    padding-inline: var(--space-2);
    font-size: 1em;
    font-weight: 600;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .heading {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .heading .title {
    flex: 1;
    min-width: 0;
  }
  .heading .close {
    flex-shrink: 0;
    margin: 0;
  }
  /* The tree fills the rest of the panel, so its context menu also opens on the empty
     space below the last row, without making the panel scroll. */
  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .state {
    margin: 0;
    padding-inline: var(--space-2);
    color: var(--text-secondary);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-inline: var(--space-2);
  }
  .button {
    justify-self: start;
    align-self: flex-start;
    margin-inline: var(--space-2);
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  .actions .button {
    margin-inline: 0;
  }
  .button:hover {
    background: var(--surface-panel);
  }
  .button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
