<script lang="ts">
  import { Dialog } from "bits-ui";
  import { copy } from "../core/copy.ts";
  import type { PrintRun } from "../core/printer.svelte.ts";

  /**
   * Print to Phone (ADR-0021): a code as large as the window allows, what it holds, and
   * what to do. No options: a selection prints, otherwise the whole document. The phone
   * alone reports success, because nothing comes back to the computer.
   */
  let { run, closed }: { run: PrintRun | null; closed: () => void } = $props();

  const t = copy.print;
  let plate = $state<HTMLElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let toggleButton = $state<HTMLButtonElement | null>(null);
  let done = $state<HTMLButtonElement | null>(null);
  /** The room for the code, in device pixels. */
  let room = $state(0);

  const status = $derived(run?.status);
  /** It stays through a restart at a new size, so focus doesn't jump. */
  const moving = $derived(
    run?.job != null &&
      !run.job.still &&
      status !== "too-small" &&
      status !== "failed" &&
      status !== "nothing",
  );
  const library = $derived(run?.subject.library ?? null);
  const place = $derived(run?.frame?.place ?? null);
  const toggleLabel = $derived(
    status === "playing" ? t.pause : status === "ready" ? t.start : t.resume,
  );

  /** The number the writer types, which the frames then catch up with. */
  function goTo(event: Event): void {
    const field = event.currentTarget as HTMLInputElement;
    const wanted = Number.parseInt(field.value, 10);
    if (Number.isInteger(wanted)) void run?.goTo(wanted - 1);
  }

  // The room for the code decides its size; a resize that changes the QR size starts it
  // afresh, so it waits until the resizing is over.
  $effect(() => {
    const element = plate;
    const current = run;
    if (!element || !current) return;
    let waiting: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const side = Math.min(element.clientWidth, element.clientHeight);
      room = Math.floor(side * window.devicePixelRatio);
      void current.fit(room);
    };
    const observer = new ResizeObserver(() => {
      clearTimeout(waiting);
      waiting = setTimeout(measure, 150);
    });
    measure();
    observer.observe(element);
    return () => {
      clearTimeout(waiting);
      observer.disconnect();
    };
  });

  // Space and Enter then pause, with no special keys: the toggle is simply focused while
  // there is something to pause. Without it, Done is the dialog's one control.
  $effect(() => {
    if (moving) toggleButton?.focus();
    else done?.focus();
  });

  // Whole device pixels per module, on the tokens' black and white in every theme.
  $effect(() => {
    const frame = run?.frame;
    if (!frame || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio;
    const side = frame.size + 2 * frame.quiet;
    const module = Math.max(1, Math.floor(room / side));
    const pixels = side * module;
    if (canvas.width !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
      canvas.style.inlineSize = `${pixels / ratio}px`;
      canvas.style.blockSize = `${pixels / ratio}px`;
    }
    const tokens = getComputedStyle(document.documentElement);
    context.fillStyle = tokens.getPropertyValue("--print-paper");
    context.fillRect(0, 0, pixels, pixels);
    context.fillStyle = tokens.getPropertyValue("--print-ink");
    for (let y = 0; y < frame.size; y++) {
      for (let x = 0; x < frame.size; x++) {
        if (frame.modules[y * frame.size + x] === "1") {
          context.fillRect((x + frame.quiet) * module, (y + frame.quiet) * module, module, module);
        }
      }
    }
  });
</script>

<Dialog.Root
  open={run !== null}
  onOpenChange={(open) => {
    if (!open) closed();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="print-overlay" />
    <Dialog.Content
      class="print-dialog"
      aria-describedby="print-instruction"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        done?.focus();
      }}
    >
      {#if run}
        <div class="plate" bind:this={plate}>
          {#if status === "too-small" || status === "failed" || status === "nothing"}
            <p class="problem">
              {status === "failed" ? t.failed : status === "nothing" ? t.nothing : t.tooSmall}
            </p>
          {:else}
            <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
            <canvas
              bind:this={canvas}
              role="img"
              aria-label={t.code(run.subject.name)}
              hidden={run.frame === null}
            ></canvas>
          {/if}
        </div>
        <div class="words">
          <Dialog.Title class="print-title">{t.title}</Dialog.Title>
          <!-- Outside the part that scrolls: a writer must see this before filming, in the
               smallest window too. -->
          {#if run.job?.sealed_words}
            <p class="quiet">{t.sealed(run.job.sealed_words)}</p>
          {:else if run.job}
            <p class="warning">{t.unsealed}</p>
          {/if}
          <div class="details">
            <p class="subject">
              <bdi class="name">{run.subject.name}</bdi>
              <span class="quiet">
                {#if library}
                  {t.library}{#if run.job}&nbsp;· {t.texts(run.job.texts)}{/if}
                {:else}
                  {run.subject.selection ? t.selection : t.whole} · {t.words(run.subject.words)}
                {/if}
              </span>
            </p>
            <p id="print-instruction">
              {t.instruction}
              {#if run.job && !run.job.still}{t.time(run.job.seconds)}{/if}
              {#if library}{t.round} {t.untilLibrary}{:else}{t.until}{/if}
            </p>
            {#if library && place}
              <div class="place">
                <label>
                  {t.showing}
                  <input
                    type="number"
                    min="1"
                    max={place.count}
                    value={place.index + 1}
                    aria-label={t.goTo}
                    onchange={goTo}
                  />
                </label>
                {t.of(place.count)}
                <bdi class="name">{place.name}</bdi>
              </div>
            {/if}
            {#if library?.unsaved}<p class="warning">{t.unsaved}</p>{/if}
            {#if run.job?.truncated}<p class="warning">{t.truncated}</p>{/if}
            {#if run.job?.left_out.length}
              <div>
                <p class="warning">{t.leftOutTitle}</p>
                <ul>
                  {#each run.job.left_out as item (item.name)}
                    <li><bdi>{item.name}</bdi> <span class="quiet">{t.leftOut[item.why]}</span></li>
                  {/each}
                </ul>
              </div>
            {/if}
            <p class="quiet" role="status">
              {#if status === "rested"}{library
                  ? t.restedLibrary
                  : t.rested}{:else if status === "paused"}{t.paused}{/if}
            </p>
          </div>
          <div class="actions">
            {#if moving}
              <button
                type="button"
                class="print-button"
                bind:this={toggleButton}
                onclick={() => run?.toggle()}>{toggleLabel}</button
              >
            {/if}
            <Dialog.Close class="print-button" bind:ref={done}>{t.done}</Dialog.Close>
          </div>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.print-overlay) {
    position: fixed;
    z-index: var(--layer-popover);
    inset: 0;
    background: var(--scrim);
  }
  /* The code gets all the room the words don't need: it's what the camera has to read. */
  :global(.print-dialog) {
    position: fixed;
    z-index: var(--layer-popover);
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);
    inline-size: min(72rem, calc(100vw - 2 * var(--space-4)));
    block-size: min(44rem, calc(100vh - 2 * var(--space-4)));
    box-sizing: border-box;
    padding: var(--space-4);
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(10rem, 30%, 20rem);
    gap: var(--space-4);
    background: var(--surface-editor);
    color: var(--text-primary);
    border: 1px solid var(--border-control);
    border-radius: 8px;
    box-shadow: var(--shadow-overlay);
  }
  @media (max-aspect-ratio: 1 / 1) {
    :global(.print-dialog) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }
  }
  .plate {
    min-inline-size: 0;
    min-block-size: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  canvas {
    display: block;
    flex: none;
  }
  canvas[hidden] {
    display: none;
  }
  .problem {
    margin: 0;
    text-align: center;
  }
  /* The title and the buttons stay in view, in the smallest window too; the rest scrolls. */
  .words {
    min-block-size: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .details {
    flex: 1;
    min-block-size: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .place input {
    inline-size: 5ch;
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding-inline: var(--space-1);
  }
  .place input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .place .name {
    display: block;
    margin-block-start: var(--space-1);
  }
  .warning {
    color: var(--text-primary);
    font-weight: 500;
  }
  ul {
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
    overflow-wrap: anywhere;
  }
  :global(.print-title) {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
  }
  p {
    margin: 0;
  }
  .subject {
    display: grid;
    gap: var(--space-1);
  }
  .name {
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .quiet {
    color: var(--text-secondary);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-block-start: auto;
    padding-block-start: var(--space-2);
  }
  :global(.print-button) {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  :global(.print-button:hover) {
    background: var(--surface-panel);
  }
  :global(.print-button:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
