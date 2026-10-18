<script lang="ts">
  import type { Notice } from "../core/workspace.svelte.ts";

  /**
   * Save failures, conflicts, recovered text and other notices (DESIGN.md §6, §14). They
   * sit above the writing surface, never over it, and an error stays until resolved.
   * Errors are announced as alerts; the rest politely.
   */
  let { notices }: { notices: Notice[] } = $props();
</script>

{#if notices.length > 0}
  <div class="notices">
    {#each notices as notice (notice.id)}
      <section
        class="notice"
        class:error={notice.tone === "error"}
        role={notice.tone === "error" ? "alert" : "status"}
      >
        <p>{notice.message}</p>
        <div class="actions">
          {#each notice.actions as action (action.label)}
            <button type="button" class:primary={action.primary} onclick={() => action.run()}>
              {action.label}
            </button>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}

<style>
  .notices {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4) 0;
  }
  .notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    max-width: 52rem;
    width: 100%;
    margin-inline: auto;
    box-sizing: border-box;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-panel);
    border: 1px solid var(--border-control);
    border-radius: 6px;
    color: var(--text-primary);
  }
  .notice.error {
    border-inline-start: 4px solid var(--status-error);
  }
  p {
    margin: 0;
    flex: 1 1 24rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  button {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  button.primary {
    color: var(--accent);
    font-weight: 600;
  }
  button:hover {
    background: var(--surface-panel);
  }
  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
