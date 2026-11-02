<script lang="ts">
  import { Dialog } from "bits-ui";
  import { tick, untrack } from "svelte";
  import { COMMANDS, type Command, type CommandContext, type CommandId } from "../core/commands.ts";
  import { copy, type KeyHint } from "../core/copy.ts";
  import type { SaveError } from "../core/ipc.ts";
  import { shortcuts } from "../core/keybindings.svelte.ts";
  import { matchRanges } from "../core/fuzzy.ts";
  import { keyOf, normalise } from "../core/keys.ts";
  import type { LibraryStore } from "../core/library.svelte.ts";
  import {
    adjacent,
    ALL_FILES,
    groups,
    itemsOf,
    move,
    splitQuery,
    type Item,
    type Scope,
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
   * Search (DESIGN.md §6, ADR-0018): one palette, centred near the top and always the
   * same size, that finds files, commands and settings, or only one of them. Focus stays
   * in the search field: ↑ ↓ move the highlight, Enter acts on it, Tab narrows to the
   * next scope with the query kept, and in Settings ← → change a highlighted choice.
   * Bits UI provides the dialog's focus trap, Esc and focus return.
   */
  interface Props {
    kind: Scope | null;
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
      setPanel: (kind: Scope) => void;
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
  /** The separator between keys in the key line, outside any isolate. */
  const SEP = " · ";
  /** Right-to-left letters, which make ← and → mean the other way round in the field. */
  const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u;
  /** How far PgUp and PgDn move. */
  const PAGE = 8;
  /** Commands that narrow Search, which stays open to do it. */
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
    active: library.active,
    commands: COMMANDS,
    context,
    settings: entries,
  });
  const listed = $derived(kind === null ? [] : groups(kind, query, input));
  const searching = $derived(query.trim() !== "");
  const prefix = $derived(splitQuery(query).folder);

  /** Lists files: Files, or everything. */
  const findsFiles = $derived(kind === "files" || kind === "all");

  // What Search offers when the library has nothing to list.
  const offers = $derived.by((): Item[] => {
    const action = (id: string, label: string, run: () => void): Item => ({
      kind: "action",
      value: `action:${id}`,
      label,
      run,
    });
    // Narrowed and nothing found: the way out, with the query kept.
    if (searching && kind !== null && kind !== "all" && listed.length === 0)
      return [action("everything", t.searchEverything, () => switchTo("all"))];
    if (!findsFiles || searching) return [];
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

  // A new query starts on its first row, and so does a new scope that doesn't list the
  // highlighted row; a row that is gone moves the highlight there too. A row asked for
  // (Show in Settings, a renamed file) wins.
  let lastKind: Scope | null = null;
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
      const kept = list.some((i) => i.value === selected);
      const fresh = q !== lastQuery || (now !== lastKind && !kept);
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

  // The highlighted row stays in view, with its heading when it is the first under one.
  $effect(() => {
    const index = currentIndex;
    if (index < 0) return;
    void tick().then(() => {
      const row = document.getElementById(`panel-row-${String(index)}`);
      const before = row?.previousElementSibling;
      if (before?.classList.contains("panel-group")) before.scrollIntoView({ block: "nearest" });
      row?.scrollIntoView({ block: "nearest" });
    });
  });

  // What matched, painted over the text: splitting a name into spans could disturb
  // Arabic letters and their marks (ADR-0011, ADR-0020).
  $effect(() => {
    const word = kind === null ? "" : splitQuery(query).rest;
    void listed;
    void tick().then(() => {
      const ranges: Range[] = [];
      if (word.trim() !== "")
        for (const el of document.querySelectorAll(".panel-list [data-match]")) {
          const node = el.firstChild;
          if (!(node instanceof Text)) continue;
          for (const [start, end] of matchRanges(word, node.data)) {
            const range = new Range();
            range.setStart(node, start);
            range.setEnd(node, end);
            ranges.push(range);
          }
        }
      CSS.highlights.set("panel-match", new Highlight(...ranges));
    });
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

  function switchTo(next: Scope) {
    actions.setPanel(next);
    focusField();
  }

  const bound = (id: CommandId, event: KeyboardEvent) => {
    const key = shortcuts.keyFor(id);
    return key !== undefined && key !== "" && normalise(key) === keyOf(event);
  };

  /** Each scope's shortcut narrows (or widens) Search to it, or closes Search when it
   * is the scope open. True when the key was one of them. */
  function panelKey(event: KeyboardEvent): boolean {
    let next: Scope;
    if (bound("app.findAnything", event)) next = "all";
    else if (bound("file.quickOpen", event)) next = "files";
    else if (bound("app.commandPalette", event)) next = "commands";
    else if (bound("app.settings", event)) next = "settings";
    else return false;
    event.preventDefault();
    event.stopPropagation();
    if (next === kind) actions.close();
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
    // Backspace in an empty field widens to everything; holding it to clear the query
    // doesn't.
    if (event.key === "Backspace" && !event.repeat && query === "" && kind !== "all") {
      event.preventDefault();
      switchTo("all");
      return;
    }
    // ← → change a setting only where the writer chose Settings; elsewhere, and with
    // right-to-left text in the query, they move the caret.
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && plain && !event.shiftKey) {
      if (kind !== "settings" || RTL.test(query)) return;
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
    // File keys act on the highlighted file or folder, in any scope; without one, New
    // file… and New folder… act as they do anywhere.
    const target = library.view.kind === "ready" ? entry(current) : null;
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
      if (target) choose(() => actions.newFile(folder), false);
      else choose(() => actions.runCommand("file.new"), false);
    } else if (bound("library.newFolder", event)) {
      event.preventDefault();
      if (target) actions.newFolder(folder);
      else actions.runCommand("library.newFolder");
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

  /** Switches change in place, and a command that narrows Search narrows it; anything
   * else closes Search first and runs where focus was (the text, when Search was opened
   * from the status line). */
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
    // All of it, not only its row: the footer would cut off its controls.
    box?.scrollIntoView({ block: "nearest" });
    box?.previousElementSibling?.scrollIntoView({ block: "nearest" });
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

  /** What the highlighted row is: a command's description, a setting's hint or a note's
   * text. A file's or folder's folder is on its row already. */
  function describe(item: Item): string | null {
    if (item.kind === "command") return item.command.description ?? null;
    if (item.kind !== "setting") return null;
    const e = item.entry;
    if (e.kind === "note") return e.text(settingsContext);
    if (e.kind === "library" && library.view.kind === "unavailable")
      return copy.settings.libraryUnavailable(library.view.name);
    return e.hint?.(values, settingsContext) ?? null;
  }

  /** What the keys do now, for the key line. */
  const keys = $derived.by((): readonly KeyHint[] => {
    const k = t.keys;
    const item = current;
    if (!item) return [];
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
          ...(item.kind === "file" ? k.open : k.show),
          ...(rename ? [k.rename(rename)] : []),
          ...(trash ? [k.trash(trash)] : []),
        ];
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
            return settingsContext.stick ? [] : k.library;
          case "about":
            return k.about;
          case "note":
            return [];
          default:
            return k.read;
        }
    }
  });

  /** The highlighted row's description: in Settings, where a hint can run long and says
   * what a change does, in its own lines above the keys; elsewhere along its row. No row
   * changes height as the highlight moves. */
  const about = $derived(current ? describe(current) : null);

  /** Said to screen readers: the scope, as it changes, and that nothing matches. */
  const announced = $derived(
    kind === null ? "" : searching && items.length === 0 ? t.empty[kind] : t.names[kind],
  );
</script>

{#snippet keyHints(hints: readonly KeyHint[])}
  {#each hints as [key, action], i (i)}
    <span class="hint"><kbd>{key}</kbd> {action}</span>{i < hints.length - 1 ? " " : ""}
  {/each}
{/snippet}

{#snippet inlineAbout(isCurrent: boolean)}
  <!-- Screen readers get it as the row's description, not in its name. -->
  <span class="inline" use:fullText={isCurrent ? (about ?? "") : ""}
    >{#if isCurrent && about && kind !== "settings"}<span
        id="panel-about"
        class="panel-about-inline"
        aria-hidden="true">{about}</span
      >{/if}</span
  >
{/snippet}

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
      aria-label={kind ? t.names[kind] : undefined}
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
        // Opening a file puts the caret in it; a command runs where focus was, which is
        // the text when Search was opened from the status line.
        if (next.ownFocus) event.preventDefault();
        else if (fromStatus) {
          event.preventDefault();
          setTimeout(() => {
            actions.focusText();
            next.run();
          }, 0);
          return;
        }
        setTimeout(next.run, 0);
      }}
    >
      {#if saveError}
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
      <div class="panel-field">
        <svg class="panel-glass" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3.5 3.5" />
        </svg>
        {#if kind && kind !== "all"}
          <!-- Narrowed: the scope, which a click (or Backspace in an empty field) widens to
               everything. Focus stays in the field. -->
          <button
            type="button"
            class="panel-scope"
            tabindex="-1"
            aria-label={t.widen(t.scopes[kind])}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => switchTo("all")}
            >{t.scopes[kind]}<span class="quiet" aria-hidden="true">×</span></button
          >
        {/if}
        <input
          bind:this={field}
          bind:value={query}
          class="panel-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="panel-list"
          aria-autocomplete="list"
          aria-activedescendant={currentIndex >= 0
            ? `panel-row-${String(currentIndex)}`
            : undefined}
          aria-label={kind ? t.names[kind] : undefined}
          placeholder={kind ? t.placeholders[kind] : ""}
          dir="auto"
          spellcheck="false"
          autocomplete="off"
          onkeydown={fieldKeys}
        />
      </div>
      <div
        id="panel-list"
        class="panel-list"
        role="listbox"
        aria-label={kind ? t.names[kind] : undefined}
      >
        {#each listed as group (group.id)}
          <div role="group" aria-labelledby={group.label ? `panel-group-${group.id}` : undefined}>
            {#if group.label}
              <div class="panel-group" role="presentation">
                <span id="panel-group-{group.id}">{group.label}</span>
                {#if group.more}
                  {@const more = group.more}
                  <!-- With the pointer, the total narrows to its scope; Tab does it by
                       keyboard. -->
                  <span
                    class="panel-more"
                    role="presentation"
                    aria-hidden="true"
                    title={t.scopes[more.scope]}
                    onmousedown={(event) => event.preventDefault()}
                    onclick={() => switchTo(more.scope)}>{SEP}{more.total}</span
                  >
                {/if}
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
                    ><bdi data-match>{stem}</bdi>{#if ext}<span class="quiet">{ext}</span
                      >{/if}</span
                  >
                  <span class="inline" use:fullText={parentOf(item.path)}
                    ><bdi data-match>{parentOf(item.path)}</bdi></span
                  >
                {:else if item.kind === "folder"}
                  <span class="primary" use:fullText={item.path}
                    ><bdi data-match>{item.name}</bdi><span class="quiet">/</span></span
                  >
                  <span class="inline" use:fullText={parentOf(item.path)}
                    ><bdi data-match>{parentOf(item.path)}</bdi></span
                  >
                {:else if item.kind === "command"}
                  {@const on = item.command.toggle?.(context)}
                  <span class="primary" use:fullText={item.command.label}
                    ><span data-match>{item.command.label}</span></span
                  >
                  {@render inlineAbout(isCurrent)}
                  {@const key = shortcut(item.command)}
                  <span class="value"
                    >{#if on !== undefined}<span class="state">{on ? t.on : t.off}</span
                      >{/if}{#if key}<kbd>{key}</kbd>{/if}</span
                  >
                {:else if item.kind === "setting"}
                  <span
                    class="primary"
                    id="panel-label-{item.entry.id}"
                    use:fullText={item.entry.label}><span data-match>{item.entry.label}</span></span
                  >
                  {@render inlineAbout(isCurrent)}
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
            <p class="panel-note" class:none={searching} role="presentation">
              {#if searching}
                {kind ? t.empty[kind] : ""}
              {:else if library.view.kind === "none"}
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
                class:centred={searching}
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
          <p class="panel-note none" role="presentation">{kind ? t.empty[kind] : ""}</p>
        {/if}
        {#if findsFiles && prefix && fileCount === 0 && listed.length > 0}
          <p class="panel-note" role="presentation">{t.emptyFolder(prefix)}</p>
        {/if}
        {#if kind === "files" && !searching && library.files.length > ALL_FILES}
          <p class="panel-note" role="presentation">{t.allFiles(ALL_FILES)}</p>
        {/if}
        {#if kind === "files" && library.view.kind === "ready" && library.view.truncated}
          <p class="panel-note" role="presentation">{copy.library.truncated}</p>
        {/if}
      </div>
      {#if kind === "settings"}
        <!-- Always two lines tall, so nothing moves as the highlight does. -->
        <p class="panel-about" id="panel-about">{about ?? ""}</p>
      {/if}
      <p class="panel-keys">
        <span class="now">{@render keyHints(keys)}</span>
        {#if kind}<span class="always"
            >{@render keyHints(t.keys.next(t.scopes[adjacent(kind, 1)]))}</span
          >{/if}
      </p>
      <p class="visually-hidden" role="status">{announced}</p>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  /* The text behind steps back, as it does behind the other dialogs. */
  :global(.panel-overlay) {
    position: fixed;
    z-index: var(--layer-popover);
    inset: 0;
    background: var(--scrim);
  }
  /* Centred near the top, and always the same size whatever it lists, so neither the
     field nor the footer moves as the results change. */
  :global(.panel) {
    --panel-top: clamp(var(--space-2), 12vh, 6rem);
    /* Where text starts: the list's inset and a row's own padding. */
    --panel-edge: calc(var(--space-2) + var(--space-3));
    position: fixed;
    z-index: var(--layer-popover);
    inset-block-start: var(--panel-top);
    inset-inline: 0;
    margin-inline: auto;
    width: min(42rem, calc(100vw - 2 * var(--space-4)));
    height: min(32rem, calc(100vh - var(--panel-top) - var(--space-4)));
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    container-type: size;
    background: var(--surface-editor);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
    outline: none;
  }
  @media (max-width: 30rem) {
    :global(.panel) {
      width: calc(100vw - 2 * var(--space-2));
    }
  }
  .panel-field {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    /* The field's padding sits here: an Arabic query turns the input's own padding
       round, which would open a gap beside the scope. */
    padding-inline: var(--panel-edge);
    border-block-end: 1px solid var(--border-subtle);
  }
  /* Focus never leaves the field, and the caret shows it (ADR-0020). */
  :global([data-contrast="high"]) .panel-field:focus-within {
    box-shadow: inset 0 -2px 0 var(--focus-ring);
  }
  .panel-glass {
    flex-shrink: 0;
    inline-size: 16px;
    block-size: 16px;
    fill: none;
    stroke: var(--text-secondary);
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  /* The scope Search is narrowed to; a click widens it to everything. */
  .panel-scope {
    flex-shrink: 0;
    display: inline-flex;
    gap: var(--space-1);
    font: inherit;
    font-size: 0.9em;
    color: var(--text-primary);
    background: var(--surface-panel);
    border: none;
    border-radius: 6px;
    padding: 1px var(--space-2);
    cursor: pointer;
  }
  .panel-input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 1.1em;
    color: var(--text-primary);
    background: transparent;
    border: none;
    padding: calc(var(--space-3) + 2px) 0;
    outline: none;
    /* Arabic keeps its own order but stays beside the scope, at the interface's start. */
    text-align: left;
    text-align: match-parent;
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
    margin: var(--space-3) var(--panel-edge) 0;
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
    padding: var(--space-2);
    scrollbar-width: thin;
    scrollbar-color: var(--border-subtle) transparent;
  }
  .panel-more {
    cursor: pointer;
  }
  .panel-more:hover {
    color: var(--text-primary);
  }
  .panel-group {
    padding: var(--space-3) var(--space-3) var(--space-1);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    scroll-margin-block: var(--space-2);
  }
  [role="group"]:first-child .panel-group {
    padding-block-start: var(--space-2);
  }
  .panel-row {
    display: grid;
    /* The name first, what is beside it in what is left (cut before the name is), and
       the value at the end, at most 40%. */
    grid-template-columns: minmax(0, max-content) minmax(0, 1fr) fit-content(40%);
    column-gap: var(--space-3);
    align-items: baseline;
    /* Less the edge, so the text shares the field's and the headings' start. */
    padding: calc(var(--space-2) - 1px) var(--space-3);
    padding-inline-start: calc(var(--space-3) - 3px);
    border-inline-start: 3px solid transparent;
    border-radius: 6px;
    cursor: default;
    outline: none;
    scroll-margin-block: var(--space-2);
  }
  /* The way out of a narrowed search that found nothing, under its note. */
  .panel-row.centred {
    display: block;
    text-align: center;
  }
  /* A row that depends on the one above it (Zuhd mode's, Another font's). */
  .panel-row.sub .primary {
    padding-inline-start: var(--space-4);
  }
  .panel-opened.sub {
    padding-inline-start: calc(var(--space-3) - 3px + var(--space-4));
  }
  .panel-row.current {
    background: var(--surface-selected);
  }
  /* The fill alone falls short of 3:1 (DESIGN.md §9.4, ADR-0020); where the writer asked
     for contrast, or the system paints the fills away, an edge says it too. */
  :global([data-contrast="high"]) .panel-row.current,
  :global([data-contrast="high"]) .panel-opened {
    border-inline-start-color: var(--accent);
  }
  @media (forced-colors: active) {
    .panel-row {
      border-inline-start-color: Canvas;
    }
    .panel-row.current,
    .panel-opened {
      border-inline-start-color: Highlight;
    }
  }
  .primary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* A file's folder on every row; a description only on the highlighted one. */
  .inline {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: 13px;
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
    background: var(--surface-selected);
    border-inline-start: 3px solid transparent;
    border-end-start-radius: 6px;
    border-end-end-radius: 6px;
    scroll-margin-block: var(--space-2);
  }
  .panel-note {
    margin: var(--space-2) var(--space-3);
    color: var(--text-secondary);
  }
  /* Nothing found. */
  .panel-note.none {
    margin-block: var(--space-8) var(--space-3);
    text-align: center;
  }
  /* Two lines tall always, so nothing below the list moves. */
  .panel-about {
    flex-shrink: 0;
    box-sizing: border-box;
    block-size: calc(2 * 1.4em + 2 * var(--space-3));
    margin: 0;
    padding: var(--space-3) var(--panel-edge);
    border-block-start: 1px solid var(--border-subtle);
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-secondary);
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }
  /* A short palette keeps rows for the list: one line. */
  @container (max-height: 24rem) {
    .panel-about {
      block-size: calc(1.4em + 2 * var(--space-2));
      padding-block: var(--space-2);
      -webkit-line-clamp: 1;
      line-clamp: 1;
    }
  }
  /* A narrow one keeps the key line's own keys. */
  @container (max-width: 30rem) {
    .panel-keys .always {
      display: none;
    }
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
    padding: var(--space-2) var(--panel-edge);
    border-block-start: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-size: 12px;
  }
  .hint + .hint {
    margin-inline-start: var(--space-2);
  }
  .panel-keys kbd {
    margin-inline-end: 2px;
    color: var(--text-primary);
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
</style>
