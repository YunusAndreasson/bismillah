<script lang="ts">
  import { Dialog } from "bits-ui";
  import { FONTS, LANGUAGE, SOFTWARE, type Credit } from "../core/about.ts";
  import { copy } from "../core/copy.ts";
  import type { StickInfo } from "../core/ipc.ts";

  /**
   * About (DESIGN.md §4): what bismillah is, its inspiration in a few sentences, and
   * what it is made with under which licence. Nothing here is decoration.
   */
  let {
    open = $bindable(),
    version,
    stick = null,
  }: { open: boolean; version: string; stick?: StickInfo | null } = $props();

  const t = copy.about;
  let close = $state<HTMLButtonElement | null>(null);
  const groups: { title: string; credits: readonly Credit[] }[] = [
    { title: t.fonts, credits: FONTS },
    { title: t.language, credits: LANGUAGE },
    { title: t.software, credits: SOFTWARE },
  ];
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="about-overlay" />
    <Dialog.Content
      class="about-dialog"
      aria-describedby="about-tagline"
      onOpenAutoFocus={(event) => {
        // Focus Close, its one control, without scrolling the text away from its start.
        event.preventDefault();
        close?.focus({ preventScroll: true });
      }}
    >
      <Dialog.Title class="about-title">bismillah</Dialog.Title>
      <p class="tagline" id="about-tagline">{t.tagline}</p>
      {#if version}<p class="quiet">{t.version(version)}</p>{/if}
      {#if stick}<p class="quiet">{t.stick(stick.snapshot, stick.commit)}</p>{/if}

      <h2 aria-label={t.inspiration}>{t.inspiration}</h2>
      {#each t.inspirationText as paragraph, i (i)}
        <p>{paragraph}</p>
      {/each}

      <h2 aria-label={t.licences}>{t.licences}</h2>
      <p>{t.licenceText}</p>
      {#each groups as group (group.title)}
        <h3>{group.title}</h3>
        <ul>
          {#each group.credits as credit (credit.name)}
            <li>
              <span class="name">{credit.name}</span>
              <span class="quiet">{credit.role} · {credit.licence}</span>
            </li>
          {/each}
        </ul>
      {/each}
      <p class="quiet">{t.installed}</p>

      <div class="footer">
        <Dialog.Close class="about-close" bind:ref={close}>{t.close}</Dialog.Close>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.about-overlay) {
    position: fixed;
    z-index: var(--layer-popover);
    inset: 0;
    background: color-mix(in srgb, var(--surface-editor) 70%, transparent);
  }
  :global(.about-dialog) {
    position: fixed;
    z-index: var(--layer-popover);
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);
    width: min(32rem, calc(100vw - 2 * var(--space-4)));
    max-height: calc(100vh - 2 * var(--space-6));
    overflow: auto;
    box-sizing: border-box;
    padding: var(--space-6);
    background: var(--surface-editor);
    color: var(--text-primary);
    border: 1px solid var(--border-control);
    border-radius: 8px;
    box-shadow: 0 8px 32px color-mix(in srgb, var(--text-primary) 14%, transparent);
  }
  :global(.about-title) {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 600;
  }
  p {
    margin: var(--space-2) 0 0;
  }
  .tagline {
    margin-block-start: var(--space-1);
  }
  /* In capitals; aria-label keeps the name as written for screen readers. */
  h2 {
    margin: var(--space-6) 0 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
  }
  h3 {
    margin: var(--space-4) 0 0;
    font-size: inherit;
    font-weight: 600;
  }
  ul {
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--space-2);
  }
  li {
    display: grid;
  }
  .name {
    font-weight: 500;
  }
  .quiet {
    color: var(--text-secondary);
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    margin-block-start: var(--space-6);
    position: sticky;
    inset-block-end: calc(-1 * var(--space-6));
    margin-inline: calc(-1 * var(--space-6));
    padding-inline: var(--space-6);
    padding-block-end: var(--space-6);
    padding-block-start: var(--space-3);
    background: var(--surface-editor);
    border-block-start: 1px solid var(--border-control);
  }
  :global(.about-close) {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  :global(.about-close:hover) {
    background: var(--surface-panel);
  }
  :global(.about-close:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
