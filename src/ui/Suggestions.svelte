<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { tick } from "svelte";
  import type { Checking } from "../core/checking.svelte.ts";
  import { copy } from "../core/copy.ts";

  /**
   * The suggestions for one possible mistake (DESIGN.md §11, §14), placed against the
   * marked word: what kind it is, one sentence of explanation, and explicit actions.
   * Bits UI provides the menu keyboard (arrows, Enter, Esc, type-ahead); F7 and
   * Shift-F7 move on to the next or previous issue from here too. Focus goes back to
   * the text when it closes.
   */
  interface Props {
    checking: Checking;
  }
  let { checking }: Props = $props();

  const t = copy.checking;
  const menu = $derived(checking.menu);
  let content = $state<HTMLElement | null>(null);
  // Bound both ways: when an item closes the menu, Bits UI writes here, and the next
  // issue opens it again. A one-way prop stays closed after Bits has closed it once.
  let open = $derived(menu !== null);

  /** The first action has focus whenever the menu opens or moves on to another issue
   * (F7 inside it), as in any menu opened from the keyboard. */
  async function focusFirst() {
    await tick();
    content?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }

  $effect(() => {
    if (menu && content) void focusFirst();
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== "F7" || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    void checking.next(event.shiftKey ? -1 : 1);
  }
</script>

<DropdownMenu.Root
  bind:open
  onOpenChange={(next) => {
    if (!next) checking.close();
  }}
>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      bind:ref={content}
      class="menu suggestions"
      customAnchor={menu?.anchor ?? null}
      side="bottom"
      align="start"
      sideOffset={4}
      collisionPadding={8}
      loop
      aria-labelledby="suggestions-kind"
      aria-describedby="suggestions-why"
      {onkeydown}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        void focusFirst();
      }}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      {#if menu}
        <div class="head">
          <p id="suggestions-kind" class="kind {menu.kind}">
            {menu.kind === "spelling" ? t.spelling : t.grammar}
          </p>
          <p id="suggestions-why" class="why">
            {#if menu.message.length}
              {#each menu.message as part, i (i)}
                {#if part.quoted}“<bdi>{part.text}</bdi>”{:else}{part.text}{/if}
              {/each}
            {:else}
              “<bdi lang={menu.lang}>{menu.text}</bdi>” {t.notInDictionary[menu.lang]}
            {/if}
          </p>
        </div>
        {#if menu.canReplace && menu.replacements.length}
          <DropdownMenu.Group aria-labelledby="suggestions-replace">
            <DropdownMenu.GroupHeading id="suggestions-replace" class="menu-heading">
              {t.replaceWith}
            </DropdownMenu.GroupHeading>
            {#each menu.replacements as replacement (replacement)}
              <DropdownMenu.Item
                class="menu-item replacement"
                onSelect={() => checking.replace(replacement)}
              >
                {#if replacement === ""}
                  <span>{t.remove(menu.text)}</span>
                {:else}
                  <bdi class="word" lang={menu.lang} dir="auto">{replacement}</bdi>
                {/if}
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Group>
        {:else if menu.canReplace && menu.kind === "spelling"}
          <p class="none">{t.noSuggestions}</p>
        {/if}
        <DropdownMenu.Separator class="menu-separator" />
        <DropdownMenu.Item class="menu-item" onSelect={() => checking.ignore()}>
          {t.ignore}
        </DropdownMenu.Item>
        {#if menu.canAdd}
          <DropdownMenu.Item class="menu-item" onSelect={() => void checking.addToDictionary()}>
            {t.addToDictionary}
          </DropdownMenu.Item>
        {/if}
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
  :global(.suggestions) {
    max-inline-size: min(24rem, calc(100vw - 2 * var(--space-4)));
  }
  .head {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3) var(--space-2);
  }
  .kind {
    margin: 0;
    font-weight: 600;
    /* The kind's colour, with its own pattern beneath, so colour is never the only
       signal (DESIGN.md §9.4). */
    text-decoration-line: underline;
    text-decoration-thickness: 1.5px;
    text-underline-offset: 0.25em;
    justify-self: start;
  }
  .kind.spelling {
    text-decoration-style: wavy;
    text-decoration-color: var(--diagnostic-spelling);
  }
  .kind.grammar {
    text-decoration-style: dotted;
    text-decoration-color: var(--diagnostic-grammar);
    text-decoration-thickness: 2px;
  }
  .why {
    margin: 0;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .why bdi {
    color: var(--text-primary);
  }
  :global(.menu-heading) {
    padding: var(--space-1) var(--space-3) 0;
    color: var(--text-secondary);
    font-size: 0.85em;
  }
  /* Corrections are set in the writing font, as they will read in the text. */
  .word {
    font-family: var(--doc-font), var(--doc-font-arabic);
    font-size: 1.05em;
  }
  .word:lang(ar) {
    font-family: var(--doc-font-arabic);
    font-size: 1.2em;
    letter-spacing: normal;
  }
  .none {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    color: var(--text-secondary);
  }
</style>
