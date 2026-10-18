<script lang="ts">
  import { Dialog, RadioGroup, Switch } from "bits-ui";
  import { copy } from "../core/copy.ts";
  import {
    clampLineHeight,
    clampScale,
    DEFAULTS,
    LINE_HEIGHT,
    PROFILE_LINE_HEIGHT,
    TEXT_SCALE,
    type Settings,
  } from "../core/settings.svelte.ts";

  /**
   * Settings (DESIGN.md §6): one screen, labelled sections. Phase 1 has Appearance and
   * Writing. Every change applies at once and is saved by Rust; there is no Apply.
   * Bits UI provides the modal focus trap, Esc and focus return.
   */
  interface Props {
    open: boolean;
    values: Settings;
    change: (patch: Partial<Settings>) => void;
  }
  let { open = $bindable(), values, change }: Props = $props();

  const t = copy.settings;
  const lineHeight = $derived(values.line_height ?? PROFILE_LINE_HEIGHT[values.writing_profile]);
  const percent = $derived(`${Math.round(values.text_scale * 100)}%`);
</script>

{#snippet choice<V extends string>(
  id: string,
  label: string,
  value: V,
  options: readonly V[],
  names: Record<V, string>,
  set: (v: V) => void,
)}
  <div class="setting">
    <span class="label" {id}>{label}</span>
    <RadioGroup.Root
      class="segments"
      orientation="horizontal"
      aria-labelledby={id}
      {value}
      onValueChange={(v) => set(v as V)}
    >
      {#each options as option (option)}
        <RadioGroup.Item class="segment" value={option}>{names[option]}</RadioGroup.Item>
      {/each}
    </RadioGroup.Root>
  </div>
{/snippet}

{#snippet toggle(
  id: string,
  label: string,
  hint: string | null,
  checked: boolean,
  set: (on: boolean) => void,
)}
  <div class="setting row">
    <div class="text">
      <label class="label" for={id}>{label}</label>
      {#if hint}<p class="hint" id="{id}-hint">{hint}</p>{/if}
    </div>
    <Switch.Root
      {id}
      class="switch"
      {checked}
      onCheckedChange={set}
      aria-describedby={hint ? `${id}-hint` : undefined}
    >
      <Switch.Thumb class="thumb" />
    </Switch.Root>
  </div>
{/snippet}

{#snippet stepper(
  id: string,
  label: string,
  shown: string,
  minus: () => void,
  plus: () => void,
  reset: () => void,
  atDefault: boolean,
)}
  <div class="setting">
    <span class="label" {id}>{label}</span>
    <div class="stepper" role="group" aria-labelledby={id}>
      <button type="button" aria-label="{t.smaller} ({label})" onclick={minus}>−</button>
      <output aria-live="polite">{shown}</output>
      <button type="button" aria-label="{t.bigger} ({label})" onclick={plus}>+</button>
      <button type="button" class="reset" disabled={atDefault} onclick={reset}>{t.reset}</button>
    </div>
  </div>
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="settings-overlay" />
    <Dialog.Content class="settings-dialog" aria-describedby={undefined}>
      <Dialog.Title class="settings-title">{t.title}</Dialog.Title>

      <section aria-labelledby="settings-appearance">
        <h2 id="settings-appearance">{t.appearance}</h2>
        {@render choice(
          "set-theme",
          t.theme,
          values.theme,
          ["system", "light", "dark"],
          t.themes,
          (theme) => change({ theme }),
        )}
        <div>
          {@render choice(
            "set-font",
            t.font,
            values.writing_profile,
            ["duo", "serif", "amiri"],
            t.fonts,
            (writing_profile) => change({ writing_profile }),
          )}
          <p class="hint">{t.fontHint}</p>
        </div>
        {@render stepper(
          "set-size",
          t.textSize,
          percent,
          () => change({ text_scale: clampScale(values.text_scale - TEXT_SCALE.step) }),
          () => change({ text_scale: clampScale(values.text_scale + TEXT_SCALE.step) }),
          () => change({ text_scale: DEFAULTS.text_scale }),
          values.text_scale === DEFAULTS.text_scale,
        )}
        {@render choice(
          "set-measure",
          t.measure,
          values.measure,
          ["narrow", "standard", "wide"],
          t.measures,
          (measure) => change({ measure }),
        )}
        {@render stepper(
          "set-line",
          t.lineHeight,
          lineHeight.toFixed(1),
          () => change({ line_height: clampLineHeight(lineHeight - LINE_HEIGHT.step) }),
          () => change({ line_height: clampLineHeight(lineHeight + LINE_HEIGHT.step) }),
          () => change({ line_height: null }),
          values.line_height === null,
        )}
        {@render toggle("set-fade", t.fadeChrome, null, values.fade_chrome, (fade_chrome) =>
          change({ fade_chrome }),
        )}
        {@render toggle(
          "set-basmallah",
          t.basmallah,
          t.basmallahHint,
          values.basmallah_opening,
          (basmallah_opening) => change({ basmallah_opening }),
        )}
      </section>

      <section aria-labelledby="settings-writing">
        <h2 id="settings-writing">{t.writing}</h2>
        {@render toggle(
          "set-smart",
          t.smartPunctuation,
          t.smartPunctuationHint,
          values.smart_punctuation,
          (smart_punctuation) => change({ smart_punctuation }),
        )}
        {@render toggle(
          "set-typewriter",
          t.typewriter,
          t.typewriterHint,
          values.typewriter_scrolling,
          (typewriter_scrolling) => change({ typewriter_scrolling }),
        )}
        {@render toggle("set-zuhd", t.zuhd, t.zuhdHint, values.focus_mode, (focus_mode) =>
          change({ focus_mode }),
        )}
        {@render choice(
          "set-focus",
          t.focusOn,
          values.focus_granularity,
          ["sentence", "paragraph"],
          t.granularities,
          (focus_granularity) => change({ focus_granularity }),
        )}
      </section>

      <div class="footer">
        <Dialog.Close class="done">{t.done}</Dialog.Close>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.settings-overlay) {
    position: fixed;
    z-index: var(--layer-popover);
    inset: 0;
    background: color-mix(in srgb, var(--surface-editor) 70%, transparent);
  }
  :global(.settings-dialog) {
    position: fixed;
    z-index: var(--layer-popover);
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);
    width: min(34rem, calc(100vw - 2 * var(--space-4)));
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
  :global(.settings-title) {
    margin: 0 0 var(--space-4);
    font-size: 1.15rem;
    font-weight: 600;
  }
  section {
    display: grid;
    gap: var(--space-6);
    padding-block: var(--space-4);
    border-block-start: 1px solid var(--border-control);
  }
  h2 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
  }
  .setting {
    display: grid;
    gap: var(--space-2);
  }
  .setting.row {
    grid-template-columns: 1fr auto;
    align-items: start;
    gap: var(--space-4);
  }
  .text {
    display: grid;
    gap: var(--space-1);
  }
  .label {
    font-weight: 500;
  }
  .hint {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
  }
  :global(.segments) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  :global(.segment),
  .stepper button,
  :global(.done) {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  :global(.segment[data-state="checked"]) {
    background: var(--selection-background);
    border-color: var(--accent);
    font-weight: 600;
  }
  :global(.segment:hover),
  .stepper button:hover:not(:disabled),
  :global(.done:hover) {
    background: var(--surface-panel);
  }
  :global(.segment[data-state="checked"]:hover) {
    background: var(--selection-background);
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .stepper button {
    min-width: 2.25rem;
  }
  .stepper button:disabled {
    color: var(--text-secondary);
    cursor: default;
  }
  output {
    min-width: 3.5rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  :global(.switch) {
    position: relative;
    width: 2.5rem;
    height: 1.4rem;
    padding: 0;
    border: 1px solid var(--border-control);
    border-radius: 999px;
    background: var(--surface-panel);
    cursor: pointer;
  }
  :global(.switch[data-state="checked"]) {
    background: var(--accent);
    border-color: var(--accent);
  }
  :global(.thumb) {
    position: absolute;
    inset-block-start: 2px;
    inset-inline-start: 2px;
    width: calc(1.4rem - 6px);
    height: calc(1.4rem - 6px);
    border-radius: 50%;
    background: var(--border-control);
    transition: transform var(--motion-fast) ease-out;
  }
  :global(.thumb[data-state="checked"]) {
    background: var(--surface-editor);
    transform: translateX(1.1rem);
  }
  :global([dir="rtl"] .thumb[data-state="checked"]) {
    transform: translateX(-1.1rem);
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    padding-block-start: var(--space-4);
    border-block-start: 1px solid var(--border-control);
  }
  :global(.segment:focus-visible),
  .stepper button:focus-visible,
  :global(.switch:focus-visible),
  :global(.done:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
