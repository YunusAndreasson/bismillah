<script lang="ts">
  import { commandById, shortcutLabel, type CommandId } from "../core/commands.ts";
  import { copy } from "../core/copy.ts";

  /**
   * The first screen when nothing is open (DESIGN.md §15): a simple choice, nothing
   * else. Labels and shortcuts come from the command registry.
   */
  let { run }: { run: (id: CommandId) => void } = $props();

  const actions = [
    { id: "file.open" as const, label: copy.welcome.open },
    { id: "file.new" as const, label: copy.welcome.create },
  ];
</script>

<div class="welcome">
  <h1 class="title">{copy.welcome.title}</h1>
  <div class="actions">
    {#each actions as action (action.id)}
      <button type="button" onclick={() => run(action.id)}>
        <span>{action.label}</span>
        <kbd>{shortcutLabel(commandById(action.id)?.key ?? "")}</kbd>
      </button>
    {/each}
  </div>
  <p class="hint">{copy.welcome.drop}</p>
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
</style>
