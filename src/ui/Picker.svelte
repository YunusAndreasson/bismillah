<script lang="ts">
  import { Command, Dialog } from "bits-ui";
  import {
    COMMANDS,
    type Command as AppCommand,
    type CommandContext,
    type CommandId,
  } from "../core/commands.ts";
  import { copy } from "../core/copy.ts";
  import { rankCommands, rankFiles } from "../core/fuzzy.ts";
  import { shortcuts } from "../core/keybindings.svelte.ts";
  import { keyOf, normalise } from "../core/keys.ts";
  import type { LibraryStore } from "../core/library.svelte.ts";
  import {
    settingEntries,
    type SettingEntry,
    type SettingsTarget,
  } from "../core/settingEntries.ts";
  import type { Settings } from "../core/settings.svelte.ts";
  import { colourThemes, DEFAULT_THEME } from "../core/themes.svelte.ts";
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
  const SCOPES: readonly Picker[] = ["everything", "quickOpen", "palette", "settings"];
  /** What Find anything offers before anything is typed: the main commands. */
  const MAIN: readonly CommandId[] = [
    "file.new",
    "file.save",
    "view.toggleLibrary",
    "editor.toggleFocus",
    "editor.toggleTypewriter",
    "view.toggleMarkdown",
    "edit.find",
    "edit.goToLine",
    "view.cycleTheme",
    "app.settings",
    "app.guide",
  ];
  /** Settings offered before anything is typed: the switches, then the most used. */
  const MAIN_SETTINGS = new Set(["contrast", "fade", "basmallah", "smart", "font", "size"]);
  /** How many of each kind Find anything shows for a query. */
  const EACH = 8;
  const RECENT = 6;

  let query = $state("");
  let wasOpen = false;
  /** What to do once the dialog has closed and focus is back where it was. */
  let pending: { run: () => void; ownFocus: boolean } | null = null;

  $effect(() => {
    const open = kind !== null;
    if (open && !wasOpen) query = "";
    wasOpen = open;
  });

  const all = $derived(kind === "everything");
  const searching = $derived(query.trim() !== "");
  const showFiles = $derived(kind === "everything" || kind === "quickOpen");
  const showCommands = $derived(kind === "everything" || kind === "palette");
  const showSettings = $derived(kind === "everything" || kind === "settings");

  const files = $derived.by(() => {
    if (!showFiles) return [];
    if (!all) return rankFiles(query, library.files, library.recent);
    if (searching) return rankFiles(query, library.files, library.recent, EACH);
    const recent = new Set(library.recent);
    return rankFiles("", library.files, library.recent, RECENT)
      .filter((f) => recent.has(f.path))
      .slice(0, RECENT);
  });

  const commands = $derived.by(() => {
    if (!showCommands) return [];
    const usable = COMMANDS.filter(
      (c) =>
        c.id !== "app.commandPalette" &&
        c.id !== "app.findAnything" &&
        (!c.available || c.available(context)),
    );
    if (!all) return rankCommands(query, usable);
    if (searching) return rankCommands(query, usable).slice(0, EACH);
    return MAIN.flatMap((id) => usable.find((c) => c.id === id) ?? []);
  });

  const entries = $derived.by(() => {
    if (!showSettings) return [];
    const list = settingEntries(stick);
    if (!all) return rankCommands(query, list);
    if (searching) return rankCommands(query, list).slice(0, EACH);
    return list.filter((e) => MAIN_SETTINGS.has(e.id));
  });

  // The library tree beside the list, while files are in scope.
  const withTree = $derived(showFiles);

  const title = $derived(
    kind === "palette"
      ? t.palette
      : kind === "quickOpen"
        ? t.quickOpen
        : kind === "settings"
          ? t.settings
          : t.everything,
  );
  const placeholder = $derived(
    kind === "palette"
      ? t.palettePlaceholder
      : kind === "quickOpen"
        ? t.quickOpenPlaceholder
        : kind === "settings"
          ? t.settingsPlaceholder
          : t.everythingPlaceholder,
  );
  const keys = $derived(
    kind === "palette"
      ? t.commandKeys
      : kind === "settings"
        ? t.settingKeys
        : kind === "quickOpen"
          ? t.fileKeys
          : t.everythingKeys,
  );

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

  function colourName(id: string): string {
    if (id === DEFAULT_THEME) return copy.themes.builtin;
    return colourThemes.find(id)?.name ?? id;
  }

  function chooseSetting(entry: SettingEntry) {
    const key = entry.key;
    if (key) change({ [key]: !values[key] });
    else choose(() => openSettingsAt({ section: entry.section, control: entry.control }), false);
  }

  // Mod-P and Mod-Shift-P (or the writer's own keys) change the scope while it's open.
  function onkeydown(event: KeyboardEvent) {
    const key = keyOf(event);
    const scopeFor: [CommandId, Picker][] = [
      ["file.quickOpen", "quickOpen"],
      ["app.commandPalette", "palette"],
      ["app.findAnything", "everything"],
    ];
    for (const [id, scope] of scopeFor) {
      const bound = shortcuts.keyFor(id);
      if (bound && normalise(bound) === key) {
        event.preventDefault();
        event.stopPropagation();
        if (scope !== "quickOpen" || library.ready) setScope(scope);
        return;
      }
    }
  }

  // The tree's own actions. Rename and Move to trash act on its focused row, so they
  // run here; anything that leaves the panel closes it first.
  const tree = {
    open: (path: string) => choose(() => openFile(path), true),
    run: (id: CommandId) => {
      if (id === "file.rename" || id === "file.trash") runCommand(id);
      else choose(() => runCommand(id), false);
    },
    newHere: (k: "file" | "folder", folder: string) => choose(() => newHere(k, folder), false),
    escape: () => close(),
    retry: () => retry(),
  };
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
      {onkeydown}
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
        <Dialog.Title class="picker-title">{title}</Dialog.Title>
        <Dialog.Close class="picker-close">{t.close}</Dialog.Close>
      </header>
      <Command.Root class="picker-command" shouldFilter={false} loop label={title}>
        <Command.Input
          class="picker-input"
          bind:value={query}
          {placeholder}
          dir="auto"
          spellcheck="false"
          autocomplete="off"
        />
        <div class="picker-body" class:with-tree={withTree}>
          {#if withTree}
            <nav class="picker-library" aria-label={copy.library.region}>
              <LibraryPanel {library} {...tree} followFocusRequests={false} />
            </nav>
          {/if}
          <Command.List class="picker-list">
            <Command.Viewport>
              <Command.Empty class="picker-empty">
                {#if kind === "palette"}
                  {t.noCommand}
                {:else if kind === "settings"}
                  {t.noSetting}
                {:else if kind === "everything"}
                  {t.noMatch}
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
                  {t.noFile}
                {/if}
              </Command.Empty>
              {#if files.length > 0}
                <Command.Group value="files">
                  {#if all}
                    <Command.GroupHeading class="picker-group"
                      >{searching ? t.groups.files : t.groups.recent}</Command.GroupHeading
                    >
                  {/if}
                  <Command.GroupItems>
                    {#each files as file (file.path)}
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
              {#if commands.length > 0}
                <Command.Group value="commands">
                  {#if all}
                    <Command.GroupHeading class="picker-group"
                      >{t.groups.commands}</Command.GroupHeading
                    >
                  {/if}
                  <Command.GroupItems>
                    {#each commands as command (command.id)}
                      {@const on = command.toggle?.(context)}
                      <Command.Item
                        class="picker-item"
                        value={`command:${command.id}`}
                        onSelect={() => choose(() => runCommand(command.id), false)}
                      >
                        <span class="primary" title={command.label}>
                          {command.label}{#if on !== undefined}<span class="on"
                              >{` · ${on ? t.on : t.off}`}</span
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
              {#if entries.length > 0}
                <Command.Group value="settings">
                  {#if all}
                    <Command.GroupHeading class="picker-group"
                      >{t.groups.settings}</Command.GroupHeading
                    >
                  {/if}
                  <Command.GroupItems>
                    {#each entries as entry (entry.id)}
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
                          {entry.label}{#if shown}<span class="on"><bdi>{` · ${shown}`}</bdi></span
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
          {#each SCOPES as scope (scope)}
            <button
              type="button"
              class="picker-scope"
              aria-pressed={kind === scope}
              disabled={scope === "quickOpen" && !library.ready}
              onclick={() => {
                setScope(scope);
                document.querySelector<HTMLInputElement>(".picker-input")?.focus();
              }}>{t.scope[scope]}</button
            >
          {/each}
        </div>
        <p class="picker-keys">
          {#if keys === t.everythingKeys}<span class="keys-wide">{keys}</span><span
              class="keys-narrow">{t.everythingNarrowKeys}</span
            >{:else}{keys}{/if}
        </p>
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
    container: picker / inline-size;
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
  .keys-narrow {
    display: none;
  }
  /* Narrow windows: the list alone; the library is a key away (Mod-\). */
  @container picker (width < 760px) {
    .picker-library,
    .keys-wide {
      display: none;
    }
    .keys-narrow {
      display: inline;
    }
    .picker-body.with-tree {
      grid-template-columns: minmax(0, 1fr);
    }
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
