<script lang="ts">
  import type { Snippet } from "svelte";
  import { copy } from "../core/copy.ts";
  import { BASMALLAH_INK as ink } from "../editor/basmallahInk.ts";

  /**
   * The frame of the stick's first screens: the ﷽ wordmark above one centred column.
   * The wordmark is the Basmallah opening's pre-shaped ink (ADR-0011), so it needs no
   * font and draws before any has loaded (docs/spikes/os-unlock-in-app.md, finding 6).
   */
  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<main class="screen" aria-labelledby="screen-title">
  <svg
    class="wordmark"
    role="img"
    aria-label={copy.appliance.wordmark}
    viewBox={`${String(ink.xMin)} ${String(-ink.yMax)} ${String(ink.xMax - ink.xMin)} ${String(ink.yMax - ink.yMin)}`}
  >
    <path d={ink.d} />
  </svg>
  <h1 id="screen-title">{title}</h1>
  {@render children()}
</main>

<style>
  .screen {
    box-sizing: border-box;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-4);
    color: var(--text-primary);
    background: var(--surface-editor);
  }
  .wordmark {
    width: min(14rem, 60vw);
    height: auto;
    margin-bottom: var(--space-4);
    fill: var(--text-secondary);
  }
  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }
  /* The column's shared controls. */
  .screen :global(.column) {
    display: grid;
    gap: var(--space-4);
    width: min(26rem, 100%);
  }
  .screen :global(.field) {
    display: grid;
    gap: var(--space-2);
  }
  .screen :global(.hint),
  .screen :global(label) {
    margin: 0;
    color: var(--text-secondary);
  }
  .screen :global(input[type="password"]),
  .screen :global(input[type="text"]),
  .screen :global(select) {
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-panel);
    border: 1px solid var(--border-control);
    border-radius: 4px;
  }
  .screen :global(.check) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .screen :global(input[type="checkbox"]) {
    accent-color: var(--accent);
    margin: 0;
  }
  .screen :global(.actions) {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  /* A step back, or aside, sits at the start of the row; the main action at the end. */
  .screen :global(.actions .start) {
    margin-inline-end: auto;
  }
  .screen :global(button) {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 6px;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
  }
  .screen :global(button.primary) {
    color: var(--surface-editor);
    background: var(--accent);
    border-color: var(--accent);
  }
  .screen :global(button:hover:not(:disabled)) {
    background: var(--surface-panel);
  }
  .screen :global(button.primary:hover:not(:disabled)) {
    background: var(--accent);
  }
  .screen :global(button.quiet) {
    border-color: transparent;
    color: var(--text-secondary);
  }
  .screen :global(button.destructive) {
    color: var(--status-error);
    border-color: var(--status-error);
  }
  .screen :global(button:disabled) {
    cursor: default;
    color: var(--text-secondary);
    background: var(--surface-editor);
    border-color: var(--border-control);
  }
  .screen :global(:focus-visible),
  .screen :global(input:focus),
  .screen :global(select:focus) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .screen :global(.note) {
    min-height: 1.5em;
    margin: 0;
    color: var(--text-secondary);
  }
  .screen :global(.problem) {
    margin: 0;
    color: var(--status-error);
  }
  .screen :global(.power) {
    margin-top: var(--space-8);
  }
</style>
