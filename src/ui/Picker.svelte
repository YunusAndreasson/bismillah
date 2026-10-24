<script lang="ts">
  import { Command, Dialog } from "bits-ui";
  import { tick, untrack } from "svelte";
  import {
    COMMANDS,
    type Command as AppCommand,
    type CommandContext,
    type CommandId,
  } from "../core/commands.ts";
  import { copy } from "../core/copy.ts";
  import {
    colourThemeName,
    firstValue,
    lists,
    SCOPES,
    TREE_MIN_WIDTH,
    WORDS,
    type Scope,
  } from "../core/findAnything.ts";
  import { shortcuts } from "../core/keybindings.svelte.ts";
  import { keyOf, normalise } from "../core/keys.ts";
  import type { LibraryStore } from "../core/library.svelte.ts";
  import {
    settingEntries,
    type SettingEntry,
    type SettingsTarget,
  } from "../core/settingEntries.ts";
  import type { Settings } from "../core/settings.svelte.ts";
  import { colourThemes } from "../core/themes.svelte.ts";
  import { parentOf } from "../core/tree.ts";
  import type { Picker } from "../core/workspace.svelte.ts";
  import LibraryPanel from "./LibraryPanel.svelte";

  /**
   * Find anything (Shift Shift), quick open (Mod-P) and the command palette (Mod-Shift-P)
   * are one panel in four scopes, DESIGN.md §6. Files show their folders beside their
   * names, so files with the same name can be told apart; commands show their
   * shortcuts and whether a switch is on; settings change in place or open Settings at
   * their control. In wide windows the library tree sits beside the list. Bits UI
   * provides the focus trap, Esc and the listbox keyboard; our own ranking orders the
   * items (fuzzy.ts).
   */
  interface Props {
    kind: Picker | null;
    library: LibraryStore;
    context: CommandContext;
    values: Settings;
    stick: boolean;
    close: () => void;
    setScope: (kind: Picker) => void;
    openFile: (path: string) => void;
    runCommand: (id: CommandId) => void;
    change: (patch: Partial<Settings>) => void;
    openSettingsAt: (target: SettingsTarget) => void;
    /** The tree's own actions, as in the docked library. */
    newHere: (kind: "file" | "folder", folder: string) => void;
    retry: () => void;
  }
  let {
    kind,
    library,
    context,
    values,
    stick,
    close,
    setScope,
    openFile,
    runCommand,
    change,
    openSettingsAt,
    newHere,
    retry,
  }: Props = $props();

  const t = copy.picker;
  /** The separator before a switch's state or a setting's value, outside its isolate. */
  const SEP = " · ";

  let query = $state("");
  /** The highlighted item's value, which Enter runs. */
  let selected = $state("");
  let width = $state(window.innerWidth);
  /** What to do once the dialog has closed and focus is back where it was. */
  let pending: { run: () => void; ownFocus: boolean } | null = null;

  const scope = $derived<Scope>(kind ?? "everything");
  const all = $derived(scope === "everything");
  const searching = $derived(query.trim() !== "");
  const words = $derived(WORDS[scope]);
  const listed = $derived(
    kind === null
      ? { files: [], commands: [], settings: [] }
      : lists(scope, query, {
          files: library.files,
          recent: library.recent,
          commands: COMMANDS,
          context,
          settings: settingEntries(stick),
        }),
  );
  // The tree beside the list while files are in scope, in windows wide enough for both.
  const withTree = $derived(
    (scope === "everything" || scope === "quickOpen") && width >= TREE_MIN_WIDTH,
  );
  const keys = $derived(all && !withTree ? t.everythingNarrowKeys : words.keys);

  // A new scope (or a new opening) starts with a clear field and its first item.
  let shownScope: Picker | null = null;
  $effect(() => {
    const now = kind;
    if (now === shownScope) return;
    if (shownScope === null) query = "";
    shownScope = now;
    if (now !== null) selected = untrack(() => firstValue(listed));
  });

  function focusField() {
    void tick().then(() => document.querySelector<HTMLInputElement>(".picker-input")?.focus());
  }

  function switchTo(next: Picker) {
    setScope(next);
    focusField();
  }

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
    const key = shortcuts.label(c.id) || (c.gesture ?? "");
    return c.keyScope === "library" && key ? `${key} ${t.libraryOnly}` : key;
  }

  const colourName = (id: string) => colourThemeName(id, colourThemes.list);

  function chooseSetting(entry: SettingEntry) {
    const key = entry.key;
    if (key) change({ [key]: !values[key] });
    else choose(() => openSettingsAt({ section: entry.section, control: entry.control }), false);
  }

  const bound = (id: CommandId, event: KeyboardEvent) => {
    const key = shortcuts.keyFor(id);
    return key !== undefined && key !== "" && normalise(key) === keyOf(event);
  };

  /** Mod-P, Mod-Shift-P (or the writer's own keys) change the scope while it's open;
   * Find anything's own key goes to Everything, or from it closes the panel, as Shift
   * Shift does. True when the key was one of them. */
  function scopeKey(event: KeyboardEvent): boolean {
    let next: Picker | null | undefined;
    if (bound("file.quickOpen", event)) next = library.ready ? "quickOpen" : undefined;
    else if (bound("app.commandPalette", event)) next = "palette";
    else if (bound("app.findAnything", event)) next = all ? null : "everything";
    else return false;
    event.preventDefault();
    event.stopPropagation();
    if (next === null) close();
    else if (next !== undefined) switchTo(next);
    return true;
  }

  // The tree's own actions. Rename… acts on its focused row with the panel open; Move
  // to trash closes it once the row is taken, so its Undo can be reached. Anything else
  // that leaves the panel closes it first.
  const tree = {
    open: (path: string) => choose(() => openFile(path), true),
    run: (id: CommandId) => {
      if (id === "file.rename") runCommand(id);
      else if (id === "file.trash") {
        runCommand(id);
        close();
      } else choose(() => runCommand(id), false);
    },
    newHere: (k: "file" | "folder", folder: string) => choose(() => newHere(k, folder), false),
    escape: () => close(),
    retry: () => retry(),
  };

  /** Keys in the tree stay there: the list's own keys (Enter, the arrows) must not act
   * on its highlighted item too. The tree's commands are run here, since the window's
   * shortcuts don't act inside a dialog. */
  function treeKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (scopeKey(event)) return;
    for (const id of ["file.rename", "file.new", "library.newFolder"] as const) {
      if (bound(id, event)) {
        event.preventDefault();
        tree.run(id);
        return;
      }
    }
  }
</script>

<svelte:window bind:innerWidth={width} />

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
      onkeydown={scopeKey}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".picker-input")?.focus();
      }}
      onCloseAutoFocus={(event) => {
        const next = pending;
        pending = null;
        if (!next) return;
        // Opening a file puts the caret in it; a command runs where focus was.
        if (next.ownFocus) event.preventDefault();
        setTimeout(next.run, 0);
      }}
    >
      <header class="picker-header">
        <Dialog.Title class="picker-title">{words.title}</Dialog.Title>
        <Dialog.Close class="picker-close">{t.close}</Dialog.Close>
      </header>
      <Command.Root
        class="picker-command"
        shouldFilter={false}
        vimBindings={false}
        loop
        label={words.title}
        bind:value={selected}
      >
        <Command.Input
          class="picker-input"
          bind:value={query}
          placeholder={words.placeholder}
          dir="auto"
          spellcheck="false"
          autocomplete="off"
        />
        <div class="picker-body" class:with-tree={withTree}>
          {#if withTree}
            <!-- Keys are kept in the tree (treeKeydown); the tree itself handles them. -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <nav class="picker-library" aria-label={copy.library.region} onkeydown={treeKeydown}>
              <LibraryPanel {library} {...tree} embedded />
            </nav>
          {/if}
          <Command.List class="picker-list">
            <Command.Viewport>
              <Command.Empty class="picker-empty">
                {#if scope !== "quickOpen"}
                  {words.empty}
                {:else if !library.ready}
                  <p>{t.unavailableLibrary}</p>
                  <button
                    type="button"
                    class="picker-action"
                    onclick={() => choose(() => runCommand("library.openFolder"), false)}
                    >{copy.library.chooseFolder}</button
                  >
                {:else if library.files.length === 0}
                  <p>{t.emptyLibrary}</p>
                  <button
                    type="button"
                    class="picker-action"
                    onclick={() => choose(() => runCommand("file.new"), false)}
                    >{copy.library.newFile}</button
                  >
                {:else}
                  {words.empty}
                {/if}
              </Command.Empty>
              {#if listed.files.length > 0}
                <Command.Group value="files">
                  {#if all}
                    <Command.GroupHeading class="picker-group"
                      >{searching ? t.groups.files : t.groups.recent}</Command.GroupHeading
                    >
                  {/if}
                  <Command.GroupItems>
                    {#each listed.files as file (file.path)}
                      {@const [stem, ext] = split(file.name)}
                      <Command.Item
                        class="picker-item"
                        value={`file:${file.path}`}
                        onSelect={() => choose(() => openFile(file.path), true)}
                      >
                        <span class="primary" title={file.name}
                          ><bdi>{stem}</bdi>{#if ext}<span class="ext">{ext}</span>{/if}</span
                        >
                        <span class="secondary" title={file.path}>
                          {#each segments(file.path) as segment, i (i)}
                            {#if i > 0}<span class="slash">/</span>{/if}<bdi>{segment}</bdi>
                          {/each}
                        </span>
                      </Command.Item>
                    {/each}
                  </Command.GroupItems>
                </Command.Group>
              {/if}
              {#if listed.commands.length > 0}
                <Command.Group value="commands">
                  {#if all}
                    <Command.GroupHeading class="picker-group"
                      >{t.groups.commands}</Command.GroupHeading
                    >
                  {/if}
                  <Command.GroupItems>
                    {#each listed.commands as command (command.id)}
                      {@const on = command.toggle?.(context)}
                      <Command.Item
                        class="picker-item"
                        value={`command:${command.id}`}
                        onSelect={() => choose(() => runCommand(command.id), false)}
                      >
                        <span class="primary" title={command.label}>
                          {command.label}{#if on !== undefined}<span class="on"
                              >{SEP}{on ? t.on : t.off}</span
                            >{/if}
                        </span>
                        {#if command.description && !all}<span
                            class="secondary"
                            title={command.description}>{command.description}</span
                          >{/if}
                        <kbd>{shortcut(command)}</kbd>
                      </Command.Item>
                    {/each}
                  </Command.GroupItems>
                </Command.Group>
              {/if}
              {#if listed.settings.length > 0}
                <Command.Group value="settings">
                  {#if all}
                    <Command.GroupHeading class="picker-group"
                      >{t.groups.settings}</Command.GroupHeading
                    >
                  {/if}
                  <Command.GroupItems>
                    {#each listed.settings as entry (entry.id)}
                      {@const shown = entry.key
                        ? values[entry.key]
                          ? t.on
                          : t.off
                        : entry.value?.(values, colourName)}
                      <Command.Item
                        class="picker-item"
                        value={`setting:${entry.id}`}
                        onSelect={() => chooseSetting(entry)}
                      >
                        <span class="primary" title={entry.label}>
                          {entry.label}{#if shown}<span class="on">{SEP}<bdi>{shown}</bdi></span
                            >{/if}
                        </span>
                        {#if !entry.key}<span class="where">{t.inSettings}</span>{/if}
                      </Command.Item>
                    {/each}
                  </Command.GroupItems>
                </Command.Group>
              {/if}
            </Command.Viewport>
          </Command.List>
        </div>
      </Command.Root>
      <footer class="picker-footer">
        <div class="picker-scopes" role="group" aria-label={t.scopes}>
          {#each SCOPES as each (each)}
            <button
              type="button"
              class="picker-scope"
              aria-pressed={kind === each}
              disabled={each === "quickOpen" && !library.ready}
              onclick={() => switchTo(each)}>{t.scope[each]}</button
            >
          {/each}
        </div>
        <p class="picker-keys">{keys}</p>
      </footer>
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
    inset-block-start: max(var(--space-4), 8vh);
    inset-inline-start: 50%;
    transform: translateX(-50%);
    width: min(60rem, calc(100vw - 2 * var(--space-4)));
    height: min(44rem, calc(100vh - 2 * max(var(--space-4), 8vh)));
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
    flex: 1;
    min-height: 0;
  }
  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
  }
  :global(.picker-title) {
    margin: 0;
    font: inherit;
    font-weight: 600;
  }
  :global(.picker-close),
  .picker-action {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  :global(.picker-close:hover),
  .picker-action:hover {
    background: var(--surface-panel);
  }
  :global(.picker-close:focus-visible),
  .picker-action:focus-visible,
  .picker-scope:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .picker-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1) var(--space-4);
    padding: var(--space-2) var(--space-4);
    border-block-start: 1px solid var(--border-control);
  }
  .picker-scopes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .picker-scope {
    font: inherit;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0 var(--space-2);
    cursor: pointer;
  }
  .picker-scope:hover:not(:disabled) {
    color: var(--text-primary);
  }
  .picker-scope[aria-pressed="true"] {
    color: var(--text-primary);
    border-color: var(--border-control);
    background: var(--surface-panel);
    font-weight: 600;
  }
  .picker-scope:disabled {
    cursor: default;
  }
  .picker-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .picker-body.with-tree {
    grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr);
  }
  .picker-library {
    min-height: 0;
    overflow: auto;
    border-inline-end: 1px solid var(--border-control);
    background: var(--surface-panel);
  }
  .picker-keys {
    margin: 0;
    color: var(--text-secondary);
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
  :global(.picker-group) {
    padding: var(--space-3) var(--space-3) var(--space-1);
    color: var(--text-secondary);
    font-size: 0.85em;
    font-weight: 600;
  }
  :global(.picker-empty) {
    padding: var(--space-3) var(--space-4);
    color: var(--text-secondary);
  }
  :global(.picker-empty) p {
    margin: 0 0 var(--space-2);
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
  .on,
  .where {
    color: var(--text-secondary);
  }
  .slash {
    padding-inline: var(--space-1);
  }
  kbd,
  .where {
    grid-column: 2;
    grid-row: 1;
    align-self: baseline;
    font: inherit;
    color: var(--text-secondary);
  }
</style>
