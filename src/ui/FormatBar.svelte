<script lang="ts">
  import type { EditorView } from "@codemirror/view";
  import { DropdownMenu } from "bits-ui";
  import {
    ariaShortcut,
    runCommand,
    shortcutLabel,
    type CommandContext,
    type CommandId,
  } from "../core/commands.ts";
  import { copy } from "../core/copy.ts";
  import { shortcuts } from "../core/keybindings.svelte.ts";
  import { fontChoices } from "../core/settingEntries.ts";
  import { settings, type Settings } from "../core/settings.svelte.ts";
  import type { Block, FormatState, Mark } from "../editor/format.ts";

  /**
   * The bar over a selection (DESIGN.md §11, ADR-0019): the marks, what the line is, and
   * the writing font. Every button runs the same command as its shortcut. Focus stays in
   * the text until F6 moves it here; the arrows move along the bar, and Esc goes back to
   * the text with the selection as it was.
   */
  interface Props {
    view: EditorView;
    format: FormatState;
    context: CommandContext;
    stick: boolean;
  }
  let { view, format, context, stick }: Props = $props();

  const t = copy.format;
  const MARKS: readonly { mark: Mark; id: CommandId; glyph: string }[] = [
    { mark: "bold", id: "format.bold", glyph: "B" },
    { mark: "italic", id: "format.italic", glyph: "I" },
    { mark: "strike", id: "format.strike", glyph: "S" },
    { mark: "code", id: "format.code", glyph: "<>" },
  ];
  const BLOCKS: readonly { block: Block; id: CommandId }[] = [
    { block: "text", id: "format.text" },
    { block: "h1", id: "format.heading1" },
    { block: "h2", id: "format.heading2" },
    { block: "h3", id: "format.heading3" },
    { block: "quote", id: "format.quote" },
    { block: "bullet", id: "format.bulletList" },
    { block: "numbered", id: "format.numberedList" },
  ];

  let bar = $state<HTMLElement | null>(null);
  /** The one stop in the tab order (a toolbar's roving tabindex). */
  let current = $state(0);
  let blocksOpen = $state(false);
  let fontsOpen = $state(false);

  const fonts = $derived(
    fontChoices(stick).filter(
      (font) => font.value !== "custom" || settings.values.custom_font !== "",
    ),
  );
  const fontLabel = $derived(
    settings.values.writing_profile === "custom"
      ? settings.values.custom_font
      : (fonts.find((font) => font.value === settings.values.writing_profile)?.label ?? ""),
  );

  const stops = () => [...(bar?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];

  const shortcut = (id: CommandId) => shortcutLabel(shortcuts.keyFor(id));
  const title = (label: string, id: CommandId) => {
    const key = shortcut(id);
    return key ? `${label} (${key})` : label;
  };

  function move(by: number, event: KeyboardEvent) {
    const all = stops();
    const at = all.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    const next = (at + by + all.length) % all.length;
    current = next;
    all[next]?.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    const all = stops();
    if (event.key === "ArrowRight") move(1, event);
    else if (event.key === "ArrowLeft") move(-1, event);
    else if (event.key === "Home" && all.length)
      move(-all.indexOf(event.target as HTMLElement), event);
    else if (event.key === "End" && all.length)
      move(all.length - 1 - all.indexOf(event.target as HTMLElement), event);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      view.focus();
    }
  }

  function choose(id: CommandId) {
    runCommand(id, "ui", context);
    view.focus();
  }

  function setFont(profile: string) {
    void settings.set({ writing_profile: profile as Settings["writing_profile"] });
    view.focus();
  }
</script>

<!-- A press on the bar keeps the selection and the focus in the text. -->
<div
  bind:this={bar}
  class="format-bar"
  role="toolbar"
  tabindex="-1"
  aria-label={t.label}
  aria-orientation="horizontal"
  onmousedown={(event) => event.preventDefault()}
  {onkeydown}
>
  {#each MARKS as { mark, id, glyph }, i (mark)}
    <button
      type="button"
      class="mark {mark}"
      tabindex={current === i ? 0 : -1}
      disabled={!format.enabled[mark]}
      aria-pressed={format.active[mark]}
      aria-label={t.marks[mark]}
      aria-keyshortcuts={shortcuts.keyFor(id) ? ariaShortcut(shortcut(id)) : undefined}
      title={title(t.marks[mark], id)}
      onclick={() => {
        runCommand(id, "ui", context);
      }}
    >
      {glyph}
    </button>
  {/each}
  <span class="rule" aria-hidden="true"></span>
  <DropdownMenu.Root bind:open={blocksOpen}>
    <DropdownMenu.Trigger
      class="choice"
      tabindex={current === MARKS.length ? 0 : -1}
      disabled={format.block === null}
      aria-label="{t.turnInto}: {format.block ? t.blocks[format.block] : ''}"
    >
      {format.block ? t.blocks[format.block] : t.turnInto}
      <span class="caret" aria-hidden="true"></span>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        class="menu format-menu"
        side="bottom"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        loop
      >
        <DropdownMenu.RadioGroup value={format.block ?? ""}>
          {#each BLOCKS as { block, id } (block)}
            <DropdownMenu.RadioItem
              class="menu-item"
              value={block}
              onSelect={() => {
                choose(id);
              }}
            >
              <span>{t.blocks[block]}</span>
              {#if shortcut(id)}<kbd>{shortcut(id)}</kbd>{/if}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
  <span class="rule" aria-hidden="true"></span>
  <DropdownMenu.Root bind:open={fontsOpen}>
    <DropdownMenu.Trigger
      class="choice"
      tabindex={current === MARKS.length + 1 ? 0 : -1}
      aria-label="{t.font}: {fontLabel}"
      title={t.fontHint}
    >
      <span class="font-name">{fontLabel}</span>
      <span class="caret" aria-hidden="true"></span>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        class="menu format-menu"
        side="bottom"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        loop
      >
        <p class="font-note">{t.fontHint}</p>
        <DropdownMenu.RadioGroup value={settings.values.writing_profile}>
          {#each fonts as font (font.value)}
            <DropdownMenu.RadioItem
              class="menu-item"
              value={font.value}
              onSelect={() => {
                setFont(font.value);
              }}
            >
              {font.value === "custom" ? settings.values.custom_font : font.label}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
</div>

<style>
  .format-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    font: var(--ui-size) / var(--ui-line) var(--ui-font);
    white-space: nowrap;
  }
  .format-bar button,
  .format-bar :global(.choice) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-block-size: 1.75rem;
    padding-inline: var(--space-2);
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text-primary);
    font: inherit;
    cursor: default;
  }
  .mark {
    min-inline-size: 1.75rem;
  }
  .mark.bold {
    font-weight: 700;
  }
  .mark.italic {
    font-style: italic;
  }
  .mark.strike {
    text-decoration: line-through;
  }
  .mark.code {
    font-family: var(--doc-font-mono, monospace);
    font-size: 0.9em;
  }
  .format-bar button:hover:not(:disabled) {
    background: var(--surface-panel);
  }
  /* The state is said in shape as well as colour (DESIGN.md §9.4). */
  .format-bar button[aria-pressed="true"] {
    background: var(--surface-panel);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .format-bar button:disabled {
    color: var(--text-secondary);
    text-decoration-color: var(--text-secondary);
  }
  .format-bar button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  /* In the menu's portal, so outside this component's own markup at run time. */
  :global(.format-menu) .font-note {
    max-inline-size: 18rem;
    margin: 0;
    padding: var(--space-1) var(--space-3) var(--space-2);
    color: var(--text-secondary);
    font-size: 0.85em;
  }
  .font-name {
    max-inline-size: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .caret {
    inline-size: 0;
    block-size: 0;
    border-inline: 3.5px solid transparent;
    border-block-start: 4px solid var(--text-secondary);
  }
  .rule {
    inline-size: 1px;
    block-size: 1rem;
    margin-inline: 2px;
    background: var(--border-control);
  }
</style>
