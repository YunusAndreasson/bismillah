<script lang="ts">
  import { copy } from "../core/copy.ts";
  import { GUIDE_NAME } from "../core/guide.ts";
  import type { Battery } from "../core/ipc.ts";
  import type { SaveState } from "../core/session.svelte.ts";
  import { readingMinutes } from "../editor/wordCount.ts";
  import { shortcuts } from "../core/keybindings.svelte.ts";

  /**
   * The status line (DESIGN.md §12): the library toggle at the start; file name · save
   * state · reading time at the end, both in faint text so they stay out of
   * the writing's way. Quiet parts may fade while the writer types; a failure, anything
   * with focus and the transliteration indicator never do. Routine saves are not
   * announced to screen readers; failures are, by their notice.
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
    /** The bismillah stick's clock ("15:04") and battery, at the very end; null on the
     * desktop, and without a battery. */
    clock?: string | null;
    battery?: Battery | null;
  }
  let {
    name,
    state,
    words,
    transliteration,
    note,
    faded,
    libraryShown,
    toggleLibrary,
    clock = null,
    battery = null,
  }: Props = $props();

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
        return name === GUIDE_NAME ? copy.status.guide : copy.status.sample;
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
  const libraryShortcut = $derived(shortcuts.label("view.toggleLibrary"));
</script>

<footer class="status" aria-label={copy.status.region}>
  <div class="quiet start" class:faded={faded && !failed}>
    <button
      type="button"
      class="library-toggle"
      aria-expanded={libraryShown}
      aria-keyshortcuts={libraryShortcut.replace("Ctrl+", "Control+") || undefined}
      title={libraryShortcut ? `${copy.library.toggle} (${libraryShortcut})` : undefined}
      onclick={toggleLibrary}>{copy.library.toggle}</button
    >
  </div>
  {#if name !== null && state !== null}
    <div class="quiet info" class:faded={faded && !failed}>
      <span class="name" title={name}><bdi>{stem}</bdi>{ending}</span>
      <span class="sep" aria-hidden="true">·</span>
      <span
        class="save"
        class:routine={state.kind === "saved" || state.kind === "saving"}
        class:error={failed}>{saveText}</span
      >
      {#if minutes > 0}
        <span class="sep" aria-hidden="true">·</span>
        <span class="count">{copy.status.minutes(minutes)}</span>
      {/if}
    </div>
  {/if}
  <!-- Always present, so a screen reader announces each new message. Drawn before the
       file's details, so they never shift when a message comes and goes. -->
  <span class="note" role="status">{note ?? ""}</span>
  {#if transliteration}
    <span class="mode" role="status">{copy.status.transliteration}</span>
  {/if}
  {#if clock !== null}
    <div class="quiet stick" class:faded>
      {#if battery}
        <span class="battery" title={copy.stick.batteryTitle(battery.percent, battery.charging)}
          >{copy.stick.battery(battery.percent, battery.charging)}</span
        >
        <span class="sep" aria-hidden="true">·</span>
      {/if}
      <time class="clock">{clock}</time>
    </div>
  {/if}
</footer>

<style>
  .status {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    color: var(--text-faint);
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
  .start {
    flex-shrink: 0;
  }
  .info {
    order: 2;
    align-items: baseline;
  }
  .save.routine {
    /* Durable save acknowledgement must not move the filename on every edit. */
    inline-size: 9ch;
    flex-shrink: 0;
  }
  .count {
    min-inline-size: 11ch;
    flex-shrink: 0;
    text-align: end;
  }
  /* A quiet text button. Its hover boundary is drawn inside it, so the status line
     keeps the height of one line of text. */
  .library-toggle {
    font: inherit;
    color: var(--text-faint);
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
    color: var(--text-secondary);
  }
  .library-toggle:focus-visible {
    color: var(--text-primary);
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  .name {
    min-inline-size: 0;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .error {
    color: var(--status-error);
  }
  /* The message takes the space between, flush against the file's details. */
  .note {
    order: 1;
    flex: 1 1 0;
    min-width: 0;
    text-align: end;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mode {
    order: 3;
    color: var(--accent);
  }
  .stick {
    order: 4;
    flex-shrink: 0;
  }
</style>
