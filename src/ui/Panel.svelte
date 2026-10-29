<script lang="ts">
  import { Dialog } from "bits-ui";
  import { tick, untrack } from "svelte";
  import { COMMANDS, type Command, type CommandContext, type CommandId } from "../core/commands.ts";
  import { copy } from "../core/copy.ts";
  import type { SaveError } from "../core/ipc.ts";
  import { shortcuts } from "../core/keybindings.svelte.ts";
  import { keyOf, normalise } from "../core/keys.ts";
  import type { LibraryStore } from "../core/library.svelte.ts";
  import {
    adjacent,
    ALL_FILES,
    counts,
    groups,
    itemsOf,
    move,
    PANELS,
    splitQuery,
    type Item,
    type Panel,
  } from "../core/panels.ts";
  import {
    adjust,
    adjustable,
    opensInPlace,
    settingEntries,
    shownValue,
    type SettingEntry,
    type SettingsContext,
  } from "../core/settingEntries.ts";
  import type { Settings } from "../core/settings.svelte.ts";
  import { parentOf } from "../core/tree.ts";
  import SettingControls from "./SettingControls.svelte";

  /**
   * Files, Commands and Settings (DESIGN.md §6, ADR-0016): one panel that rises from
   * the status line's start, where its three tabs sit over the status line's own. Focus
   * stays in the search field: ↑ ↓ move the highlight, Enter acts on it, Tab moves to
   * the next panel with the query kept, and ← → change a highlighted choice. Bits UI
   * provides the dialog's focus trap, Esc and focus return.
   */
  interface Props {
    kind: Panel | null;
    query: string;
    /** A row to highlight, and open, once it is listed; `focused` takes it. */
    focus: { value: string; open: boolean } | null;
    focused: () => void;
    library: LibraryStore;
    context: CommandContext;
    values: Settings;
    settings: SettingsContext;
    customFont: { name: string; installed: boolean | null };
    saveError: SaveError | null;
    actions: {
      close: () => void;
      /** Puts the caret back in the text. */
      focusText: () => void;
      setPanel: (kind: Panel) => void;
      openFile: (path: string) => void;
      runCommand: (id: CommandId) => void;
      change: (patch: Partial<Settings>) => void;
      rename: (path: string) => void;
      trash: (path: string) => void;
      newFile: (folder: string) => void;
      newFolder: (folder: string) => void;
      retry: () => void;
      openAbout: () => void;
      createKeybindings: () => Promise<SaveError | null>;
      /** The stick's keyboard layouts (Settings › This stick). */
      applyKeyboard: (layouts: string, options: string) => Promise<string | null>;
    };
  }
  let {
    kind,
    query = $bindable(),
    focus,
    focused,
    library,
    context,
    values,
    settings: settingsContext,
    customFont,
    saveError,
    actions,
  }: Props = $props();

  const t = copy.panels;
  /** The separator before a switch's state or a count, outside any isolate. */
  const SEP = " · ";
  /** How far PgUp and PgDn move. */
  const PAGE = 8;
  /** Commands that move between panels, which stay open to do it. */
  const PANEL_COMMANDS = new Set<CommandId>(["file.quickOpen", "app.settings"]);

  /** The highlighted row's value, which Enter acts on. */
  let selected = $state("");
  /** A setting row opened in place, by its value. */
  let opened = $state<string | null>(null);
  let field = $state<HTMLInputElement | null>(null);
  /** What to do once the dialog has closed and focus is back where it was. */
  let pending: { run: () => void; ownFocus: boolean } | null = null;
  /** Opened from the status line: closing goes back to the text, not to its button. */
  let fromStatus = false;

  const entries = $derived(settingEntries(values, settingsContext));
  const input = $derived({
    files: library.files,
    nodes: library.nodes,
    recent: library.recent,
    commands: COMMANDS,
    context,
    settings: entries,
  });
  const listed = $derived(kind === null ? [] : groups(kind, query, input));
  const searching = $derived(query.trim() !== "");
  const tally = $derived(kind !== null && searching ? counts(query, input) : null);
  const prefix = $derived(splitQuery(query).folder);

  // What the Files panel offers when the library has nothing to list.
  const offers = $derived.by((): Item[] => {
    if (kind !== "files" || searching) return [];
    const action = (id: string, label: string, run: () => void): Item => ({
      kind: "action",
      value: `action:${id}`,
      label,
      run,
    });
    const view = library.view;
    const openFolder = () => choose(() => actions.runCommand("library.openFolder"), false);
    if (view.kind === "none") return [action("open", copy.library.openFolder, openFolder)];
    if (view.kind === "unavailable")
      return [
        action("retry", copy.library.tryAgain, actions.retry),
        action("choose", copy.library.chooseFolder, openFolder),
      ];
    if (library.files.length === 0)
      return [action("new", copy.library.newFile, () => choose(() => actions.newFile(""), false))];
    return [];
  });
  const items = $derived([...itemsOf(listed), ...offers]);
  const current = $derived(items.find((i) => i.value === selected) ?? null);
  const currentIndex = $derived(current ? items.indexOf(current) : -1);
  const fileCount = $derived(
    listed.reduce((n, g) => n + g.items.filter((i) => i.kind === "file").length, 0),
  );

  // A new panel or query starts on its first row; a row that is gone moves the
  // highlight there too. A row asked for (Show in Settings, a renamed file) wins.
  let lastKind: Panel | null = null;
  let lastQuery = "";
  $effect(() => {
    const now = kind;
    const q = query;
    const list = items;
    const wanted = focus;
    untrack(() => {
      if (now === null) {
        lastKind = null;
        opened = null;
        if (wanted) focused();
        return;
      }
      const fresh = now !== lastKind || q !== lastQuery;
      lastKind = now;
      lastQuery = q;
      const asked = wanted ? list.find((i) => i.value === wanted.value) : undefined;
      if (wanted && asked) {
        selected = wanted.value;
        // Only a row with something under it opens.
        const opens = asked.kind === "setting" && opensInPlace(asked.entry);
        opened = wanted.open && opens ? wanted.value : null;
        focused();
        if (opened) void focusOpened();
        return;
      }
      if (fresh || !list.some((i) => i.value === selected)) {
        selected = list[0]?.value ?? "";
        opened = null;
      }
    });
  });

  // The highlighted row stays in view.
  $effect(() => {
    const index = currentIndex;
    if (index < 0) return;
    void tick().then(() =>
      document.getElementById(`panel-row-${String(index)}`)?.scrollIntoView({ block: "nearest" }),
    );
  });

  function focusField() {
    void tick().then(() => field?.focus());
  }

  function choose(run: () => void, ownFocus: boolean) {
    pending = { run, ownFocus };
    actions.close();
  }

  function select(value: string) {
    if (value === selected) return;
    selected = value;
    opened = null;
  }

  function switchTo(next: Panel) {
    actions.setPanel(next);
    focusField();
  }

  const bound = (id: CommandId, event: KeyboardEvent) => {
    const key = shortcuts.keyFor(id);
    return key !== undefined && key !== "" && normalise(key) === keyOf(event);
  };

  /** Each panel's own shortcut opens it, or closes it when it's the one open; Shift
   * Shift's shortcut closes the panel. True when the key was one of them. */
  function panelKey(event: KeyboardEvent): boolean {
    let next: Panel | null | undefined;
    if (bound("file.quickOpen", event)) next = "files";
    else if (bound("app.commandPalette", event)) next = "commands";
    else if (bound("app.settings", event)) next = "settings";
    else if (bound("app.findAnything", event)) next = null;
    else return false;
    event.preventDefault();
    event.stopPropagation();
    if (next === null || next === kind) actions.close();
    else switchTo(next);
    return true;
  }

  const caretAtEnd = () =>
    field !== null &&
    field.selectionStart === field.value.length &&
    field.selectionEnd === field.value.length;

  /** The file or folder a Files key acts on. */
  const entry = (item: Item | null) =>
    item && (item.kind === "file" || item.kind === "folder") ? item : null;

  function fieldKeys(event: KeyboardEvent) {
    if (event.isComposing) return;
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    const steps: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: PAGE,
      PageUp: -PAGE,
    };
    const step = steps[event.key];
    if (step !== undefined && plain && !event.shiftKey) {
      event.preventDefault();
      select(move(items, selected, step));
      return;
    }
    if (event.key === "Enter" && plain && !event.shiftKey) {
      event.preventDefault();
      if (current) activate(current);
      return;
    }
    // WebKitGTK names Shift+Tab (ISO_Left_Tab) "Unidentified"; its code is still Tab.
    const tab = event.key === "Tab" || (event.key === "Unidentified" && event.code === "Tab");
    if (tab && plain && kind !== null) {
      event.preventDefault();
      switchTo(adjacent(kind, event.shiftKey ? -1 : 1));
      return;
    }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && plain && !event.shiftKey) {
      if (current?.kind !== "setting" || !adjustable(current.entry) || !caretAtEnd()) return;
      event.preventDefault();
      const patch = adjust(
        current.entry,
        values,
        settingsContext,
        event.key === "ArrowRight" ? 1 : -1,
      );
      if (patch) actions.change(patch);
      return;
    }
    const target = entry(current);
    if (kind !== "files" || library.view.kind !== "ready") return;
    const folder = target ? (target.kind === "folder" ? target.path : parentOf(target.path)) : "";
    if (bound("file.rename", event)) {
      if (!target) return;
      event.preventDefault();
      actions.rename(target.path);
    } else if (bound("file.trash", event)) {
      // Delete in the field deletes text, until there is none after the caret.
      if (!target || (event.key === "Delete" && !caretAtEnd())) return;
      event.preventDefault();
      choose(() => actions.trash(target.path), false);
    } else if (bound("file.new", event)) {
      event.preventDefault();
      choose(() => actions.newFile(folder), false);
    } else if (bound("library.newFolder", event)) {
      event.preventDefault();
      actions.newFolder(folder);
    }
  }

  function activate(item: Item) {
    switch (item.kind) {
      case "file":
        choose(() => actions.openFile(item.path), true);
        return;
      case "folder":
        // Its own files and folders.
        query = `${item.path}/`;
        return;
      case "command":
        runListed(item.command);
        return;
      case "setting":
        activateSetting(item.entry, item.value);
        return;
      case "action":
        item.run();
        return;
    }
  }

  /** Switches change in place, and a command that moves to a panel moves there;
   * anything else closes the panel first and runs where focus was. */
  function runListed(command: Command) {
    if (command.toggle || PANEL_COMMANDS.has(command.id)) actions.runCommand(command.id);
    else choose(() => actions.runCommand(command.id), false);
  }

  function activateSetting(e: SettingEntry, value: string) {
    switch (e.kind) {
      case "switch":
        actions.change({ [e.key]: !values[e.key] });
        return;
      case "library":
        if (!settingsContext.stick) choose(() => actions.runCommand("library.openFolder"), false);
        return;
      case "about":
        choose(actions.openAbout, false);
        return;
      case "note":
        return;
      default:
        if (opened === value) closeRow();
        else {
          opened = value;
          void focusOpened();
        }
    }
  }

  /** An opened row takes focus: its chosen option, its first control, or its group. */
  async function focusOpened() {
    await tick();
    const box = document.querySelector<HTMLElement>(".panel-opened");
    const control =
      box?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      box?.querySelector<HTMLElement>(
        ".stepper, input, select:not(:disabled), button:not(:disabled)",
      );
    control?.focus();
  }

  function closeRow() {
    opened = null;
    focusField();
  }

  /** ↑ and ↓ leave an opened row for the next one (a list keeps its own). */
  function openedKeys(event: KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (event.target instanceof HTMLSelectElement) return;
    event.preventDefault();
    event.stopPropagation();
    opened = null;
    select(move(items, selected, event.key === "ArrowDown" ? 1 : -1));
    focusField();
  }

  /** The row closes once focus leaves it, by Tab or the pointer. */
  function openedFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    const box = event.currentTarget;
    if (box instanceof HTMLElement && next instanceof Node && !box.contains(next)) opened = null;
  }

  function shortcut(c: Command): string {
    return shortcuts.label(c.id) || (c.gesture ?? "");
  }

  /** Its complete text on hover, only while it is cut short (DESIGN.md §6). */
  function fullText(node: HTMLElement, text: string) {
    let full = text;
    const show = () => {
      if (node.scrollWidth > node.clientWidth) node.title = full;
      else node.removeAttribute("title");
    };
    node.addEventListener("mouseenter", show);
    return {
      update(next: string) {
        full = next;
      },
      destroy() {
        node.removeEventListener("mouseenter", show);
      },
    };
  }

  function split(name: string): [string, string] {
    const match = /\.(md|markdown)$/i.exec(name);
    return match ? [name.slice(0, match.index), match[0]] : [name, ""];
  }

  /** What the highlighted row is: a command's description, a setting's hint or a
   * note's text. */
  function describe(item: Item): string | null {
    if (item.kind === "command") return item.command.description ?? null;
    if (item.kind !== "setting") return null;
    const e = item.entry;
    if (e.kind === "note") return e.text(settingsContext);
    if (e.kind === "library" && library.view.kind === "unavailable")
      return copy.settings.libraryUnavailable(library.view.name);
    return e.hint?.(values, settingsContext) ?? null;
  }

  /** What the keys do now, for the line above the tabs. */
  const keys = $derived.by((): string => {
    const k = t.keys;
    const item = current;
    if (!item) return "";
    if (opened !== null) {
      const open = items.find((i) => i.value === opened);
      if (open?.kind !== "setting") return k.openedOther;
      switch (open.entry.kind) {
        case "choice":
          return k.openedChoice;
        case "stepper":
          return k.openedStep;
        case "fontName":
          return k.openedName;
        default:
          return k.openedOther;
      }
    }
    switch (item.kind) {
      case "file":
      case "folder": {
        const rename = shortcuts.label("file.rename");
        const trash = shortcuts.label("file.trash");
        return [
          item.kind === "file" ? k.open : k.show,
          rename ? k.rename(rename) : "",
          trash ? k.trash(trash) : "",
        ]
          .filter(Boolean)
          .join(SEP);
      }
      case "command":
        return item.command.toggle ? k.toggle : k.run;
      case "action":
        return k.run;
      case "setting":
        switch (item.entry.kind) {
          case "switch":
            return k.toggle;
          case "choice":
            return k.choose;
          case "stepper":
            return k.step;
          case "fontName":
            return k.type;
          case "library":
            return settingsContext.stick ? "" : k.library;
          case "about":
            return k.about;
          case "note":
            return "";
          default:
            return k.read;
        }
    }
  });

  /** The highlighted row's description, in its own line above the keys, so no row
   * changes height as the highlight moves. */
  const about = $derived(current ? describe(current) : null);
</script>

<Dialog.Root
  open={kind !== null}
  onOpenChange={(open) => {
    if (!open) actions.close();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="panel-overlay" />
    <Dialog.Content
      class="panel"
      aria-labelledby={kind ? `panel-tab-${kind}` : undefined}
      aria-describedby={undefined}
      onkeydown={panelKey}
      onEscapeKeydown={(event) => {
        // Esc closes an opened row first, then the panel.
        if (opened === null) return;
        event.preventDefault();
        closeRow();
      }}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        fromStatus = document.activeElement?.closest(".status") != null;
        field?.focus();
      }}
      onCloseAutoFocus={(event) => {
        const next = pending;
        pending = null;
        if (!next) {
          if (fromStatus) {
            event.preventDefault();
            setTimeout(actions.focusText, 0);
          }
          return;
        }
        // Opening a file puts the caret in it; a command runs where focus was.
        if (next.ownFocus) event.preventDefault();
        setTimeout(next.run, 0);
      }}
    >
      {#if kind === "settings" && saveError}
        <div class="panel-save-error" role="alert">
          <p>{copy.settingsNotSaved(saveError)}</p>
          <button
            type="button"
            class="panel-action"
            onclick={() => {
              actions.change({ ...values });
              focusField();
            }}>{copy.actions.tryAgain}</button
          >
        </div>
      {/if}
      <input
        bind:this={field}
        bind:value={query}
        class="panel-input"
        role="combobox"
        aria-expanded="true"
        aria-controls="panel-list"
        aria-autocomplete="list"
        aria-activedescendant={currentIndex >= 0 ? `panel-row-${String(currentIndex)}` : undefined}
        aria-label={kind ? t.tabs[kind] : undefined}
        placeholder={kind ? t.placeholders[kind] : ""}
        dir="auto"
        spellcheck="false"
        autocomplete="off"
        onkeydown={fieldKeys}
      />
      <div
        id="panel-list"
        class="panel-list"
        role="listbox"
        aria-label={kind ? t.tabs[kind] : undefined}
      >
        {#each listed as group (group.id)}
          <div role="group" aria-labelledby={group.label ? `panel-group-${group.id}` : undefined}>
            {#if group.label}
              <div class="panel-group" id="panel-group-{group.id}" role="presentation">
                {group.label}
              </div>
            {/if}
            {#each group.items as item (item.value)}
              {@const index = items.indexOf(item)}
              {@const isCurrent = item.value === selected}
              {@const isOpen = opened === item.value}
              <div
                id="panel-row-{index}"
                class="panel-row"
                class:current={isCurrent}
                class:open={isOpen}
                class:sub={!searching && item.kind === "setting" && item.entry.under !== undefined}
                data-value={item.value}
                role="option"
                tabindex="-1"
                aria-selected={isCurrent}
                aria-describedby={isCurrent && about ? "panel-about" : undefined}
                onmousemove={() => select(item.value)}
                onmousedown={(event) => event.preventDefault()}
                onclick={() => {
                  select(item.value);
                  activate(item);
                  if (opened === null) field?.focus();
                }}
                onkeydown={() => {}}
              >
                {#if item.kind === "file"}
                  {@const [stem, ext] = split(item.name)}
                  <span
                    class="primary"
                    class:active={item.path === library.active}
                    use:fullText={item.name}
                    ><bdi>{stem}</bdi>{#if ext}<span class="quiet">{ext}</span>{/if}</span
                  >
                  <span class="value" use:fullText={parentOf(item.path)}
                    ><bdi>{parentOf(item.path)}</bdi></span
                  >
                {:else if item.kind === "folder"}
                  <span class="primary" use:fullText={item.path}
                    ><bdi>{item.name}</bdi><span class="quiet">/</span></span
                  >
                  <span class="value"><bdi>{parentOf(item.path)}</bdi></span>
                {:else if item.kind === "command"}
                  {@const on = item.command.toggle?.(context)}
                  <span class="primary" use:fullText={item.command.label}>{item.command.label}</span
                  >
                  <span class="value"
                    >{#if on !== undefined}<span class="state">{on ? t.on : t.off}</span>{/if}<kbd
                      >{shortcut(item.command)}</kbd
                    ></span
                  >
                {:else if item.kind === "setting"}
                  <span
                    class="primary"
                    id="panel-label-{item.entry.id}"
                    use:fullText={item.entry.label}>{item.entry.label}</span
                  >
                  <!-- An opened choice or size shows its value in its control. -->
                  <span class="value" class:repeated={isOpen && adjustable(item.entry)}
                    ><bdi>{shownValue(item.entry, values, settingsContext)}</bdi></span
                  >
                {:else}
                  <span class="primary">{item.label}</span>
                {/if}
              </div>
              {#if item.kind === "setting" && opened === item.value}
                <div
                  class="panel-opened"
                  class:sub={!searching && item.entry.under !== undefined}
                  data-value={item.value}
                  onkeydowncapture={openedKeys}
                  onfocusout={openedFocusOut}
                >
                  <SettingControls
                    entry={item.entry}
                    {values}
                    settings={settingsContext}
                    change={actions.change}
                    {customFont}
                    createKeybindings={actions.createKeybindings}
                    applyKeyboard={actions.applyKeyboard}
                    labelId="panel-label-{item.entry.id}"
                    done={closeRow}
                  />
                </div>
              {/if}
            {/each}
          </div>
        {/each}
        {#if offers.length > 0}
          <div role="group">
            <p class="panel-note" role="presentation">
              {#if library.view.kind === "none"}
                {copy.library.none}
              {:else if library.view.kind === "unavailable"}
                {copy.library.unavailable(library.view.name)}
              {:else}
                {copy.library.empty(library.view.name)}
              {/if}
            </p>
            {#each offers as item (item.value)}
              {@const index = items.indexOf(item)}
              <div
                id="panel-row-{index}"
                class="panel-row"
                class:current={item.value === selected}
                data-value={item.value}
                role="option"
                tabindex="-1"
                aria-selected={item.value === selected}
                onmousemove={() => select(item.value)}
                onmousedown={(event) => event.preventDefault()}
                onclick={() => activate(item)}
                onkeydown={() => {}}
              >
                {#if item.kind === "action"}<span class="primary">{item.label}</span>{/if}
              </div>
            {/each}
          </div>
        {:else if items.length === 0}
          <p class="panel-note" role="presentation">{kind ? t.empty[kind] : ""}</p>
        {/if}
        {#if kind === "files" && prefix && fileCount === 0 && items.length > 0}
          <p class="panel-note" role="presentation">{t.emptyFolder(prefix)}</p>
        {/if}
        {#if kind === "files" && !searching && library.files.length > ALL_FILES}
          <p class="panel-note" role="presentation">{t.allFiles(ALL_FILES)}</p>
        {/if}
        {#if kind === "files" && library.view.kind === "ready" && library.view.truncated}
          <p class="panel-note" role="presentation">{copy.library.truncated}</p>
        {/if}
      </div>
      {#if kind === "commands" || kind === "settings"}
        <p class="panel-about" id="panel-about">{about ?? ""}</p>
      {/if}
      <p class="panel-keys">
        <span class="now">{keys}</span>
        <span class="always">{t.keys.next}</span>
      </p>
      <div class="panel-tabs" role="tablist" aria-label={t.tabsLabel}>
        {#each PANELS as each (each)}
          {@const id =
            each === "files"
              ? "file.quickOpen"
              : each === "commands"
                ? "app.commandPalette"
                : "app.settings"}
          {@const key = shortcuts.label(id)}
          <button
            type="button"
            role="tab"
            id="panel-tab-{each}"
            class="panel-tab"
            tabindex="-1"
            aria-selected={kind === each}
            aria-controls="panel-list"
            title={key ? `${t.tabs[each]} (${key})` : undefined}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => (kind === each ? actions.close() : switchTo(each))}
            >{t.tabs[each]}{#if tally}<span class="count">{SEP}{tally[each]}</span>{/if}</button
          >
        {/each}
        <!-- A visible way out, beside Esc. -->
        <button
          type="button"
          class="panel-close"
          tabindex="-1"
          onmousedown={(event) => event.preventDefault()}
          onclick={actions.close}>{t.close}</button
        >
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.panel-overlay) {
    position: fixed;
    z-index: var(--layer-popover);
    inset: 0;
  }
  /* It rises from the window's bottom-start corner; its tabs sit exactly where the
     status line's are (StatusLine), so the status line seems to lift it. */
  :global(.panel) {
    position: fixed;
    z-index: var(--layer-popover);
    inset-block-end: 0;
    inset-inline-start: 0;
    width: min(46rem, 100vw);
    /* As tall as the window allows, so long lists show many rows at once. */
    height: min(60rem, calc(100vh - var(--space-12)));
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    background: var(--surface-editor);
    color: var(--text-primary);
    border-block-start: 1px solid var(--border-control);
    border-inline-end: 1px solid var(--border-control);
    border-start-end-radius: 8px;
    box-shadow: 0 8px 32px color-mix(in srgb, var(--text-primary) 14%, transparent);
    overflow: hidden;
    outline: none;
  }
  .panel-input {
    flex-shrink: 0;
    font: inherit;
    font-size: 1.1em;
    color: var(--text-primary);
    background: transparent;
    border: none;
    border-block-end: 1px solid var(--border-control);
    padding: var(--space-4) var(--space-6);
    outline: none;
  }
  .panel-input:focus-visible {
    box-shadow: inset 0 -2px 0 var(--focus-ring);
  }
  .panel-input::placeholder {
    color: var(--text-secondary);
    opacity: 1;
  }
  .panel-save-error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: var(--space-3) var(--space-6) 0;
    padding-inline-start: var(--space-3);
    border-inline-start: 3px solid var(--status-error);
    color: var(--status-error);
  }
  .panel-save-error p {
    flex: 1 1 16rem;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .panel-action {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  .panel-action:hover {
    background: var(--surface-panel);
  }
  .panel-action:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .panel-list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
  }
  .panel-group {
    padding: var(--space-4) var(--space-3) var(--space-1);
    color: var(--text-secondary);
    font-size: 0.85em;
    font-weight: 600;
  }
  [role="group"]:first-child .panel-group {
    padding-block-start: var(--space-2);
  }
  .panel-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-6);
    align-items: baseline;
    /* Less the edge, so the text shares the field's and the headings' start. */
    padding: var(--space-2) var(--space-3);
    padding-inline-start: calc(var(--space-3) - 3px);
    border-inline-start: 3px solid transparent;
    border-radius: 4px;
    cursor: default;
    outline: none;
  }
  /* A row that depends on the one above it (Zuhd mode's, Another font's). */
  .panel-row.sub .primary {
    padding-inline-start: var(--space-4);
  }
  .panel-opened.sub {
    padding-inline-start: calc(var(--space-3) - 3px + var(--space-4));
  }
  .panel-row.current {
    background: var(--surface-panel);
    border-inline-start-color: var(--accent);
  }
  .primary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The open document, as the tree marked it. */
  .primary.active {
    font-weight: 600;
  }
  .value.repeated {
    visibility: hidden;
  }
  .value {
    display: flex;
    gap: var(--space-4);
    justify-content: flex-end;
    min-width: 0;
    max-width: 24rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }
  .quiet,
  .state,
  kbd {
    color: var(--text-secondary);
  }
  kbd {
    font: inherit;
  }
  /* An opened row continues the highlighted one, under the same edge. */
  .panel-row.open {
    border-end-start-radius: 0;
    border-end-end-radius: 0;
  }
  .panel-opened {
    display: grid;
    gap: var(--space-3);
    margin-block-end: var(--space-2);
    padding: var(--space-1) var(--space-3) var(--space-4);
    padding-inline-start: calc(var(--space-3) - 3px);
    background: var(--surface-panel);
    border-inline-start: 3px solid var(--accent);
    border-end-start-radius: 4px;
    border-end-end-radius: 4px;
  }
  .panel-note {
    margin: var(--space-2) var(--space-3);
    color: var(--text-secondary);
  }
  /* Room for two lines, so a short hint and none leave the list where it is. */
  .panel-about {
    flex-shrink: 0;
    box-sizing: border-box;
    min-block-size: calc(2 * 1.4em + 2 * var(--space-3));
    margin: 0;
    padding: var(--space-3) var(--space-6);
    border-block-start: 1px solid var(--border-control);
    line-height: 1.4;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .panel-about + .panel-keys {
    border-block-start: none;
    padding-block-start: 0;
  }
  .panel-keys {
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
    gap: var(--space-1) var(--space-4);
    margin: 0;
    padding: var(--space-2) var(--space-6);
    border-block-start: 1px solid var(--border-control);
    color: var(--text-secondary);
    font-size: 0.9em;
  }
  .panel-keys .now {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel-keys .always {
    margin-inline-start: auto;
    white-space: nowrap;
  }
  /* As the status line's own items: the same padding, gap and type, so they stay put. */
  .panel-tabs {
    flex-shrink: 0;
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--surface-editor);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .panel-tab {
    font: inherit;
    color: var(--text-secondary);
    background: none;
    border: none;
    border-radius: 4px;
    margin-inline-start: calc(-1 * var(--space-2));
    padding: 0 var(--space-2);
    cursor: pointer;
    box-shadow: inset 0 -2px 0 transparent;
  }
  .panel-tab + .panel-tab {
    margin-inline-start: 0;
  }
  .panel-tab:hover {
    color: var(--text-primary);
  }
  /* Colour and an underline, not weight, so no tab changes width. */
  .panel-tab[aria-selected="true"] {
    color: var(--text-primary);
    box-shadow: inset 0 -2px 0 var(--accent);
    border-end-start-radius: 0;
    border-end-end-radius: 0;
  }
  .panel-close {
    margin-inline-start: auto;
    font: inherit;
    color: var(--text-secondary);
    background: none;
    border: none;
    border-radius: 4px;
    padding: 0 var(--space-2);
    cursor: pointer;
  }
  .panel-close:hover {
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px var(--border-control);
  }
  .count {
    color: var(--text-secondary);
  }
</style>
