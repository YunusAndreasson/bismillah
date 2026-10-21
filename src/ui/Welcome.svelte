<script lang="ts">
  import { commandById, type CommandId } from "../core/commands.ts";
  import { shortcuts } from "../core/keybindings.svelte.ts";
  import { copy } from "../core/copy.ts";

  /**
   * The first screen when nothing is open (DESIGN.md §15): a simple choice, nothing
   * else. Labels and shortcuts come from the command registry.
   */
  let { run, stick = false }: { run: (id: CommandId) => void; stick?: boolean } = $props();

  // Only the commands this place has: on the stick the library is always ~/Texts.
  const actions = [
    { id: "library.openFolder" as const, label: copy.welcome.openFolder },
    { id: "file.open" as const, label: copy.welcome.open },
    { id: "file.new" as const, label: copy.welcome.create },
  ].filter((action) => commandById(action.id));
</script>

<div class="welcome">
  <h1 class="title">{copy.welcome.title}</h1>
  <div class="actions">
    {#each actions as action (action.id)}
      <button type="button" onclick={() => run(action.id)}>
        <span>{action.label}</span>
        <kbd>{shortcuts.label(action.id)}</kbd>
      </button>
    {/each}
  </div>
  {#if !stick}<p class="hint">{copy.welcome.drop}</p>{/if}
  <button type="button" class="guide" onclick={() => run("app.guide")}>
    <span>{copy.welcome.guide}</span><kbd>{shortcuts.label("app.guide")}</kbd>
  </button>
</div>

<style>
  .welcome {
    box-sizing: border-box;
    height: 100%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-4);
    padding: var(--space-6);
    color: var(--text-primary);
  }
  .title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .actions {
    display: grid;
    gap: var(--space-2);
    min-width: 16rem;
  }
  button {
    display: flex;
    justify-content: space-between;
    gap: var(--space-6);
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 6px;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
  }
  button:hover {
    background: var(--surface-panel);
  }
  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  kbd {
    font: inherit;
    color: var(--text-secondary);
  }
  .hint {
    margin: 0;
    color: var(--text-secondary);
  }
  .guide {
    border: 0;
    color: var(--accent);
    padding: var(--space-1) var(--space-2);
  }
</style>
