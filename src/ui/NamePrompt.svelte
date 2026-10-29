<script lang="ts">
  import { Dialog } from "bits-ui";
  import { tick } from "svelte";
  import { copy } from "../core/copy.ts";
  import type { NamePrompt } from "../core/workspace.svelte.ts";

  /**
   * Asks for a name: Rename… and New folder… (DESIGN.md §13–14). A rename starts with
   * the name selected up to its ending, as file managers do. A name that can't be used
   * is explained under the field and the dialog stays open; Esc or Cancel leaves
   * everything as it was. Bits UI provides the focus trap, Esc and focus return.
   */
  interface Props {
    prompt: NamePrompt | null;
    closed: (prompt: NamePrompt) => void;
  }
  let { prompt, closed }: Props = $props();

  const t = copy.prompt;
  let current = $state<NamePrompt | null>(null);
  let open = $state(false);
  let value = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (prompt && prompt !== current) {
      current = prompt;
      value = prompt.value;
      error = null;
      busy = false;
      open = true;
    }
  });

  /** The field takes focus as it enters the page, with its first part selected, so
   * the first key typed after F2 already lands in it. */
  async function focusName() {
    await tick();
    input?.focus();
    input?.setSelectionRange(0, current?.select ?? 0);
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!current || busy) return;
    busy = true;
    error = await current.submit(value);
    busy = false;
    if (error === null) open = false;
    else {
      await tick();
      input?.focus();
      document.getElementById("prompt-error")?.scrollIntoView({ block: "nearest" });
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="prompt-overlay" />
    <Dialog.Content
      class="prompt"
      aria-describedby={undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        void focusName();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        const done = current;
        current = null;
        if (done) closed(done);
      }}
    >
      {#if current}
        <Dialog.Title class="prompt-title" title={current.title}
          ><bdi>{current.title}</bdi></Dialog.Title
        >
        <form onsubmit={submit}>
          <label for="prompt-name">{t.name}</label>
          <input
            id="prompt-name"
            bind:this={input}
            bind:value
            dir="auto"
            spellcheck="false"
            autocomplete="off"
            aria-invalid={error !== null}
            aria-describedby={[current.hint ? "prompt-hint" : "", error ? "prompt-error" : ""]
              .filter(Boolean)
              .join(" ") || undefined}
          />
          {#if current.hint}<p class="hint" id="prompt-hint">{current.hint}</p>{/if}
          {#if error}<p class="error" id="prompt-error" role="alert">{error}</p>{/if}
          <div class="actions">
            <!-- type="button": otherwise Cancel is the form's default button, and Enter
                 in the field would cancel instead of submitting. -->
            <Dialog.Close type="button" class="prompt-button">{t.cancel}</Dialog.Close>
            <button type="submit" class="prompt-button primary" disabled={busy}>
              {current.action}
            </button>
          </div>
        </form>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.prompt-overlay) {
    position: fixed;
    z-index: var(--layer-popover);
    inset: 0;
    background: color-mix(in srgb, var(--surface-editor) 60%, transparent);
  }
  :global(.prompt) {
    position: fixed;
    z-index: var(--layer-popover);
    inset-block-start: 20vh;
    inset-inline-start: 50%;
    transform: translateX(-50%);
    width: min(34rem, calc(100vw - 2 * var(--space-4)));
    /* Leave room below the 20vh top offset, including when a long name or an
       inline error makes the form taller than the minimum desktop window. */
    max-block-size: calc(80vh - var(--space-4));
    overflow: auto;
    box-sizing: border-box;
    padding: var(--space-6);
    background: var(--surface-editor);
    color: var(--text-primary);
    border: 1px solid var(--border-control);
    border-radius: 8px;
    box-shadow: 0 8px 32px color-mix(in srgb, var(--text-primary) 14%, transparent);
  }
  :global(.prompt-title) {
    margin: 0 0 var(--space-4);
    font-size: 1.05rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  form {
    display: grid;
    gap: var(--space-2);
  }
  label {
    font-weight: 500;
  }
  input {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-2) var(--space-3);
  }
  input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  input[aria-invalid="true"] {
    border-color: var(--status-error);
  }
  .hint {
    margin: 0;
    color: var(--text-secondary);
  }
  .error {
    margin: 0;
    color: var(--status-error);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-block-start: var(--space-4);
  }
  :global(.prompt-button) {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-1) var(--space-4);
    cursor: pointer;
  }
  :global(.prompt-button.primary) {
    color: var(--accent);
    font-weight: 600;
  }
  :global(.prompt-button:hover:not(:disabled)) {
    background: var(--surface-panel);
  }
  :global(.prompt-button:disabled) {
    color: var(--text-secondary);
    cursor: default;
  }
  :global(.prompt-button:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  @media (max-height: 480px) {
    :global(.prompt) {
      inset-block-start: var(--space-4);
      max-block-size: calc(100vh - 2 * var(--space-4));
    }
  }
</style>
