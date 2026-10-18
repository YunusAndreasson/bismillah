<script lang="ts">
  import { copy } from "../core/copy.ts";
  import type { SaveState } from "../core/session.svelte.ts";
  import { readingMinutes } from "../editor/wordCount.ts";

  /**
   * The status line (DESIGN.md §12): file name · save state · word count · reading time.
   * Quiet parts may fade while the writer types; a failure and the transliteration
   * indicator never do. Routine saves are not announced to screen readers; failures are,
   * by their notice.
   */
  interface Props {
    name: string;
    state: SaveState;
    words: number;
    transliteration: boolean;
    faded: boolean;
  }
  let { name, state, words, transliteration, faded }: Props = $props();

  const failed = $derived(state.kind === "failed");
  const saveText = $derived.by(() => {
    switch (state.kind) {
      case "saved":
        return copy.status.saved;
      case "saving":
        return copy.status.saving;
      case "failed":
        return copy.status.notSaved(state.error);
      case "sample":
        return copy.status.sample;
      case "read_only":
        return copy.status.readOnly;
    }
  });
  const minutes = $derived(readingMinutes(words));
</script>

<footer class="status" aria-label={copy.status.region}>
  <div class="quiet" class:faded={faded && !failed}>
    <span class="name">{name}</span>
    <span class="sep" aria-hidden="true">·</span>
    <span class="save" class:error={failed}>{saveText}</span>
    <span class="sep" aria-hidden="true">·</span>
    <span class="count">{copy.status.words(words)}</span>
    {#if minutes > 0}
      <span class="sep" aria-hidden="true">·</span>
      <span class="count">{copy.status.minutes(minutes)}</span>
    {/if}
  </div>
  {#if transliteration}
    <span class="mode" role="status">{copy.status.transliteration}</span>
  {/if}
</footer>

<style>
  .status {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
  }
  .quiet {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
    transition: opacity var(--motion-slow) ease-out;
  }
  .quiet.faded {
    opacity: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .error {
    color: var(--status-error);
  }
  .mode {
    color: var(--accent);
  }
</style>
