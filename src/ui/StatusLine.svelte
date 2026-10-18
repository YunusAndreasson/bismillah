<script lang="ts">
  import { copy } from "../core/copy.ts";
  import type { SaveState } from "../core/session.svelte.ts";
  import { readingMinutes } from "../editor/wordCount.ts";

  /**
   * The status line (DESIGN.md §12): the library toggle, then file name · save state ·
   * word count · reading time. Quiet parts may fade while the writer types; a failure,
   * anything with focus and the transliteration indicator never do. Routine saves are
   * not announced to screen readers; failures are, by their notice.
   */
  interface Props {
    name: string | null;
    state: SaveState | null;
    words: number;
    transliteration: boolean;
    /** A passing message ("No spelling or grammar issues."). */
    note: string | null;
    faded: boolean;
    libraryShown: boolean;
    toggleLibrary: () => void;
  }
  let { name, state, words, transliteration, note, faded, libraryShown, toggleLibrary }: Props =
    $props();

  const failed = $derived(state?.kind === "failed");
  const saveText = $derived.by(() => {
    switch (state?.kind) {
      case undefined:
        return "";
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
  // The name is isolated without its ending, so an Arabic name reads "سلام.md" in the
  // interface's direction rather than "md.سلام".
  const match = $derived(name === null ? null : /\.(md|markdown)$/i.exec(name));
  const stem = $derived(name === null || !match ? (name ?? "") : name.slice(0, match.index));
  const ending = $derived(match?.[0] ?? "");
</script>

<footer class="status" aria-label={copy.status.region}>
  <div class="quiet" class:faded={faded && !failed}>
    <button
      type="button"
      class="library-toggle"
      aria-expanded={libraryShown}
      aria-keyshortcuts="Control+\"
      onclick={toggleLibrary}>{copy.library.toggle}</button
    >
    {#if name !== null && state !== null}
      <span class="name"><bdi>{stem}</bdi>{ending}</span>
      <span class="sep" aria-hidden="true">·</span>
      <span class="save" class:error={failed}>{saveText}</span>
      <span class="sep" aria-hidden="true">·</span>
      <span class="count">{copy.status.words(words)}</span>
      {#if minutes > 0}
        <span class="sep" aria-hidden="true">·</span>
        <span class="count">{copy.status.minutes(minutes)}</span>
      {/if}
    {/if}
  </div>
  <div class="end">
    <!-- Always present, so a screen reader announces each new message. -->
    <span class="note" role="status">{note ?? ""}</span>
    {#if transliteration}
      <span class="mode" role="status">{copy.status.transliteration}</span>
    {/if}
  </div>
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
  .quiet.faded:not(:focus-within) {
    opacity: 0;
  }
  /* A quiet text button. Its hover boundary is drawn inside it, so the status line
     keeps the height of one line of text. */
  .library-toggle {
    font: inherit;
    color: var(--text-secondary);
    background: none;
    border: none;
    border-radius: 4px;
    margin-inline-start: calc(-1 * var(--space-2));
    padding: 0 var(--space-2);
    cursor: pointer;
  }
  .library-toggle:hover {
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px var(--border-control);
  }
  .library-toggle[aria-expanded="true"] {
    color: var(--text-primary);
  }
  .library-toggle:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .error {
    color: var(--status-error);
  }
  .end {
    display: flex;
    gap: var(--space-4);
    min-width: 0;
  }
  .note {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mode {
    color: var(--accent);
  }
</style>
