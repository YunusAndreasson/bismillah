<script lang="ts">
  import { RadioGroup } from "bits-ui";
  import { onMount } from "svelte";
  import { copy } from "../core/copy.ts";
  import * as ipc from "../core/ipc.ts";
  import type { ColourTheme, SaveError } from "../core/ipc.ts";
  import { shortcuts } from "../core/keybindings.svelte.ts";
  import type { SettingEntry, SettingsContext } from "../core/settingEntries.ts";
  import type { Settings } from "../core/settings.svelte.ts";
  import { colourThemes } from "../core/themes.svelte.ts";

  /**
   * A setting row opened in place in the Settings panel (DESIGN.md §6, ADR-0016): every
   * choice as segments, a stepper's buttons, the custom font's name, the stick's time
   * zone and keyboard, or keybindings.toml and the colour themes' problems. Each change
   * applies at once; Enter on a choice, or Esc, closes the row (Panel).
   */
  interface Props {
    entry: SettingEntry;
    values: Settings;
    settings: SettingsContext;
    change: (patch: Partial<Settings>) => void;
    /** The custom font as checked: installed, not, or not known yet (null). */
    customFont: { name: string; installed: boolean | null };
    createKeybindings: () => Promise<SaveError | null>;
    /** On the stick: stores new layouts, which restarts the session; it resolves only
     * with why it couldn't. */
    applyKeyboard: (layouts: string, options: string) => Promise<string | null>;
    /** The row's label, which names its controls. */
    labelId: string;
    /** Closes the row, back to the search field. */
    done: () => void;
  }
  let {
    entry,
    values,
    settings: context,
    change,
    customFont,
    createKeybindings,
    applyKeyboard,
    labelId,
    done,
  }: Props = $props();

  const t = copy.settings;

  // The custom font's name: sent when the field is left or Enter is pressed.
  let fontDraft = $derived(values.custom_font);
  const fontInvalid = $derived(/["\\;{}]/.test(fontDraft));
  const fontMissing = $derived(
    customFont.name !== "" && customFont.installed === false ? customFont.name : null,
  );
  function commitFont() {
    const name = fontDraft.trim();
    if (!fontInvalid && name !== values.custom_font) change({ custom_font: name });
  }

  const troubled = $derived(
    colourThemes.list.filter((theme): theme is ColourTheme & { file: string } =>
      Boolean(theme.file && theme.problems.length > 0),
    ),
  );

  let createError = $state<string | null>(null);
  async function create() {
    const error = await createKeybindings();
    createError = error ? copy.shortcuts.createFailed(error) : null;
  }

  // The stick's keyboard: up to four layouts and the key that switches between them.
  // They apply when the session restarts, so they are chosen first and then applied.
  const SWITCHES = [
    "grp:alt_shift_toggle",
    "grp:ctrl_shift_toggle",
    "grp:win_space_toggle",
    "grp:caps_toggle",
  ] as const;
  let layoutList = $state<ipc.KeyboardLayout[]>([]);
  let chosen = $state<string[]>(["us", "", "", ""]);
  let switchKey = $state<string>(SWITCHES[0]);
  let current = $state({ layouts: "", options: "" });
  let applying = $state(false);
  let keyboardProblem = $state<string | null>(null);
  const picked = $derived(chosen.filter((l, i) => l !== "" && chosen.indexOf(l) === i).slice(0, 4));
  const nextLayouts = $derived(picked.join(","));
  const nextOptions = $derived(picked.length > 1 ? switchKey : "");
  const keyboardChanged = $derived(
    nextLayouts !== current.layouts || nextOptions !== current.options,
  );
  onMount(() => {
    if (entry.kind !== "keyboard") return;
    void ipc.applianceLayouts().then((l) => (layoutList = l));
    void ipc.applianceKeyboard().then((k) => {
      const layouts = k.layouts.length > 0 ? k.layouts : ["us"];
      chosen = [0, 1, 2, 3].map((i) => layouts[i] ?? "");
      const key = k.options.split(",").find((o) => o.startsWith("grp:"));
      switchKey = key ?? SWITCHES[0];
      current = { layouts: layouts.join(","), options: k.options };
    });
  });
  async function apply() {
    if (applying || !keyboardChanged) return;
    applying = true;
    keyboardProblem = null;
    // On success the session restarts; this only returns with a problem.
    keyboardProblem = await applyKeyboard(nextLayouts, nextOptions);
    applying = false;
  }

  const zones = Intl.supportedValuesOf("timeZone");

  /** A stepper: ← and → step, Backspace resets. */
  function stepperKeys(event: KeyboardEvent) {
    if (entry.kind !== "stepper") return;
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (direction !== 0) {
      event.preventDefault();
      const patch = entry.step(values, direction);
      if (patch) change(patch);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      change(entry.reset);
    }
  }
</script>

{#if entry.kind === "choice"}
  <RadioGroup.Root
    class="segments"
    orientation="horizontal"
    aria-labelledby={labelId}
    value={entry.get(values)}
    onValueChange={(v) => change(entry.set(v))}
    onkeydown={(event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        done();
      }
    }}
  >
    {#each entry.options(context) as option (option.value)}
      <RadioGroup.Item class="segment" value={option.value}
        ><bdi>{option.label}</bdi></RadioGroup.Item
      >
    {/each}
  </RadioGroup.Root>
  {#if entry.id === "colours"}
    <!-- On the stick no other program can write a theme file. -->
    {#if !context.stick}<p class="hint">{copy.themes.hint(context.folders.config)}</p>{/if}
    {#if colourThemes.truncated}<p class="hint">{copy.themes.truncated}</p>{/if}
    {#if troubled.length > 0}
      <ul class="problems">
        {#each troubled as theme (theme.file)}
          <li>
            <span class="problem-file">“<bdi>{theme.file}</bdi>” {copy.themes.inFolder}</span>
            {#each copy.themes.problems(theme.problems) as line, i (i)}
              <span>{line}</span>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
{:else if entry.kind === "stepper"}
  <!-- ← → step and Backspace resets, as the panel's hint says. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="stepper" role="group" aria-labelledby={labelId} tabindex="-1" onkeydown={stepperKeys}>
    <button
      type="button"
      aria-label="{t.smaller} ({entry.label})"
      disabled={!entry.step(values, -1)}
      onclick={() => {
        const patch = entry.step(values, -1);
        if (patch) change(patch);
      }}>−</button
    >
    <output aria-live="polite">{entry.show(values)}</output>
    <button
      type="button"
      aria-label="{t.bigger} ({entry.label})"
      disabled={!entry.step(values, 1)}
      onclick={() => {
        const patch = entry.step(values, 1);
        if (patch) change(patch);
      }}>+</button
    >
    <button
      type="button"
      class="reset"
      disabled={entry.atDefault(values)}
      onclick={() => change(entry.reset)}>{t.reset}</button
    >
  </div>
{:else if entry.kind === "fontName"}
  <input
    id="set-font-name"
    type="text"
    spellcheck="false"
    autocomplete="off"
    maxlength="100"
    aria-labelledby={labelId}
    bind:value={fontDraft}
    aria-invalid={fontInvalid}
    aria-describedby="set-font-name-hint"
    onchange={commitFont}
    onkeydown={(e) => {
      // Enter uses the name and stays, so the hint can say whether it's installed.
      if (e.key !== "Enter") return;
      e.preventDefault();
      commitFont();
    }}
  />
  <p class="hint" class:error={fontInvalid} id="set-font-name-hint">
    {#if fontInvalid}
      {t.customFontInvalid}
    {:else if fontMissing}
      {t.customFontMissing(fontMissing)}
    {:else if values.custom_font === ""}
      {t.customFontEmpty}
    {:else}
      {t.customFontHint}
    {/if}
  </p>
{:else if entry.kind === "zone"}
  <select
    id="set-zone"
    aria-labelledby={labelId}
    value={values.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone}
    onchange={(e) => change({ time_zone: e.currentTarget.value })}
  >
    {#each zones as zone (zone)}
      <option value={zone}>{zone.replaceAll("_", " ")}</option>
    {/each}
  </select>
{:else if entry.kind === "keyboard"}
  <div class="fields" id="set-keyboard">
    {#each [0, 1, 2, 3] as i (i)}
      <div class="field">
        <label for="set-layout-{i}">{t.stick.layout(i + 1)}</label>
        <select
          id="set-layout-{i}"
          bind:value={chosen[i]}
          disabled={applying || (i > 0 && !chosen[i - 1])}
        >
          {#if i > 0}<option value="">{t.stick.noLayout}</option>{/if}
          {#each layoutList as layout (layout.id)}
            <option value={layout.id}>{layout.name}</option>
          {/each}
        </select>
      </div>
    {/each}
    {#if picked.length > 1}
      <div class="field">
        <label for="set-switch">{t.stick.switchKey}</label>
        <select id="set-switch" bind:value={switchKey} disabled={applying}>
          {#each SWITCHES as key (key)}
            <option value={key}>{t.stick.switches[key]}</option>
          {/each}
        </select>
      </div>
    {/if}
  </div>
  <div class="actions">
    <button
      type="button"
      class="action"
      disabled={applying || !keyboardChanged}
      onclick={() => void apply()}>{t.stick.apply}</button
    >
  </div>
  <p class="hint" class:error={keyboardProblem} role={keyboardProblem ? "alert" : "status"}>
    {applying ? t.stick.applying : (keyboardProblem ?? "")}
  </p>
{:else if entry.kind === "shortcuts"}
  <div id="settings-shortcuts">
    {#if shortcuts.file.unreadable}
      <p class="hint error">{copy.shortcuts.unreadable(shortcuts.file.unreadable)}</p>
    {:else if shortcuts.file.exists}
      <p class="hint">
        {copy.shortcuts.changed(shortcuts.changed)}
        {copy.shortcuts.editHint(context.folders.config)}
      </p>
    {:else}
      <p class="hint">{copy.shortcuts.none}</p>
      <div class="actions">
        <button type="button" class="action" onclick={create}>{copy.shortcuts.create}</button>
      </div>
    {/if}
    {#if createError}<p class="hint error" role="alert">{createError}</p>{/if}
    {#if shortcuts.problems.length > 0}
      <ul class="problems">
        {#each shortcuts.problems as problem, i (i)}
          <li>{copy.shortcuts.problem(problem)}</li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .hint {
    margin: 0;
    max-width: 38rem;
    color: var(--text-secondary);
  }
  .hint.error {
    color: var(--status-error);
  }
  .hint:empty {
    display: none;
  }
  input,
  select {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-1) var(--space-2);
    max-width: 20rem;
  }
  input[aria-invalid="true"] {
    border-color: var(--status-error);
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .field label {
    color: var(--text-secondary);
  }
  .problems {
    margin: 0;
    padding-inline-start: var(--space-4);
    display: grid;
    gap: var(--space-1);
    color: var(--text-secondary);
  }
  .problems li {
    display: grid;
  }
  .problem-file {
    color: var(--text-primary);
  }
  :global(.segments) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  :global(.segment),
  .stepper button,
  .action {
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
  .action:hover:not(:disabled) {
    background: var(--surface-panel);
  }
  :global(.segment[data-state="checked"]:hover) {
    background: var(--selection-background);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .action:disabled,
  .stepper button:disabled {
    color: var(--text-secondary);
    cursor: default;
  }
  .stepper {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .stepper:focus {
    outline: none;
  }
  .stepper button {
    min-width: 2.25rem;
  }
  output {
    min-width: 3.5rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  :global(.segment:focus-visible),
  .stepper button:focus-visible,
  .action:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
