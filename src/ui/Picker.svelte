<script lang="ts">
  import { Command, Dialog } from "bits-ui";
  import {
    COMMANDS,
    shortcutLabel,
    type Command as AppCommand,
    type CommandContext,
    type CommandId,
  } from "../core/commands.ts";
  import { copy } from "../core/copy.ts";
  import { rankCommands, rankFiles } from "../core/fuzzy.ts";
  import type { LibraryStore } from "../core/library.svelte.ts";
  import { parentOf } from "../core/tree.ts";
  import type { Picker } from "../core/workspace.svelte.ts";

  /**
   * Quick open (Mod-P) and the command palette (Mod-Shift-P), DESIGN.md §6. Quick open
   * shows each file's folders beside its name, so files with the same name can be told
   * apart. The palette lists every command that can run now with its shortcut, finds
   * them by aliases too, and says which switches are on. Bits UI provides the focus
   * trap, Esc and the listbox keyboard; our own ranking orders the items (fuzzy.ts).
   */
  interface Props {
    kind: Picker | null;
    library: LibraryStore;
    context: CommandContext;
    close: () => void;
    openFile: (path: string) => void;
    runCommand: (id: CommandId) => void;
  }
  let { kind, library, context, close, openFile, runCommand }: Props = $props();

  const t = copy.picker;
  let query = $state("");
  /** What to do once the dialog has closed and focus is back where it was. */
  let pending: { run: () => void; ownFocus: boolean } | null = null;

  $effect(() => {
    if (kind) query = "";
  });

  const files = $derived(
    kind === "quickOpen" ? rankFiles(query, library.files, library.recent) : [],
  );
  const commands = $derived.by(() => {
    if (kind !== "palette") return [];
    const usable = COMMANDS.filter(
      (c) => c.id !== "app.commandPalette" && (!c.available || c.available(context)),
    );
    return rankCommands(query, usable);
  });

  function choose(run: () => void, ownFocus: boolean) {
    pending = { run, ownFocus };
    close();
  }

  function segments(path: string): string[] {
    const folder = parentOf(path);
    return folder ? folder.split("/") : [library.name ?? ""];
  }

  function split(name: string): [string, string] {
    const match = /\.(md|markdown)$/i.exec(name);
    return match ? [name.slice(0, match.index), match[0]] : [name, ""];
  }

  function shortcut(c: AppCommand): string {
    const key = shortcutLabel(c.key);
    return c.keyScope === "library" ? `${key} ${t.libraryOnly}` : key;
  }
</script>

<Dialog.Root
  open={kind !== null}
  onOpenChange={(open) => {
    if (!open) close();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="picker-overlay" />
    <Dialog.Content
      class="picker"
      aria-describedby={undefined}
      onCloseAutoFocus={(event) => {
        const next = pending;
        pending = null;
        if (!next) return;
        // Opening a file puts the caret in it; a command runs where focus was.
        if (next.ownFocus) event.preventDefault();
        setTimeout(next.run, 0);
      }}
    >
      <Dialog.Title class="visually-hidden">
        {kind === "palette" ? t.palette : t.quickOpen}
      </Dialog.Title>
      <Command.Root
        class="picker-command"
        shouldFilter={false}
        loop
        label={kind === "palette" ? t.palette : t.quickOpen}
      >
        <Command.Input
          class="picker-input"
          bind:value={query}
          placeholder={kind === "palette" ? t.palettePlaceholder : t.quickOpenPlaceholder}
          dir="auto"
          spellcheck="false"
          autocomplete="off"
        />
        <Command.List class="picker-list">
          <Command.Viewport>
            <Command.Empty class="picker-empty">
              {kind === "palette" ? t.noCommand : t.noFile}
            </Command.Empty>
            {#each files as file (file.path)}
              {@const [stem, ext] = split(file.name)}
              <Command.Item
                class="picker-item"
                value={file.path}
                onSelect={() => choose(() => openFile(file.path), true)}
              >
                <span class="primary"
                  ><bdi>{stem}</bdi>{#if ext}<span class="ext">{ext}</span>{/if}</span
                >
                <span class="secondary">
                  {#each segments(file.path) as segment, i (i)}
                    {#if i > 0}<span class="slash">/</span>{/if}<bdi>{segment}</bdi>
                  {/each}
                </span>
              </Command.Item>
            {/each}
            {#each commands as command (command.id)}
              {@const on = command.toggle?.(context) ?? false}
              <Command.Item
                class="picker-item"
                value={command.id}
                onSelect={() => choose(() => runCommand(command.id), false)}
              >
                <span class="primary">
                  {command.label}{#if on}<span class="on"> · {t.on}</span>{/if}
                </span>
                {#if command.description}<span class="secondary">{command.description}</span>{/if}
                <kbd>{shortcut(command)}</kbd>
              </Command.Item>
            {/each}
          </Command.Viewport>
        </Command.List>
      </Command.Root>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.picker-overlay) {
    position: fixed;
    z-index: var(--layer-popover);
    inset: 0;
  }
  :global(.picker) {
    position: fixed;
    z-index: var(--layer-popover);
    inset-block-start: 12vh;
    inset-inline-start: 50%;
    transform: translateX(-50%);
    width: min(36rem, calc(100vw - 2 * var(--space-4)));
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    background: var(--surface-editor);
    color: var(--text-primary);
    border: 1px solid var(--border-control);
    border-radius: 8px;
    box-shadow: 0 8px 32px color-mix(in srgb, var(--text-primary) 14%, transparent);
    overflow: hidden;
  }
  :global(.picker-command) {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  :global(.picker-input) {
    font: inherit;
    font-size: 1.05em;
    color: var(--text-primary);
    background: transparent;
    border: none;
    border-block-end: 1px solid var(--border-control);
    padding: var(--space-3) var(--space-4);
    outline: none;
  }
  :global(.picker-input:focus-visible) {
    box-shadow: inset 0 -2px 0 var(--focus-ring);
  }
  :global(.picker-input::placeholder) {
    color: var(--text-secondary);
    opacity: 1;
  }
  :global(.picker-list) {
    overflow: auto;
    min-height: 0;
    padding: var(--space-1);
  }
  :global(.picker-empty) {
    padding: var(--space-3) var(--space-4);
    color: var(--text-secondary);
  }
  :global(.picker-item) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border-inline-start: 3px solid transparent;
    border-radius: 4px;
    cursor: default;
  }
  :global(.picker-item[data-selected]) {
    background: var(--surface-panel);
    border-inline-start-color: var(--accent);
  }
  .primary {
    grid-column: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .secondary {
    grid-column: 1;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ext,
  .on {
    color: var(--text-secondary);
  }
  .slash {
    padding-inline: var(--space-1);
  }
  kbd {
    grid-column: 2;
    grid-row: 1;
    align-self: baseline;
    font: inherit;
    color: var(--text-secondary);
  }
</style>
