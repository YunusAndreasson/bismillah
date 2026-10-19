<script lang="ts">
  import { Dialog, RadioGroup, Switch } from "bits-ui";
  import { tick } from "svelte";
  import { commandById } from "../core/commands.ts";
  import { copy } from "../core/copy.ts";
  import type { ColourTheme, SaveError } from "../core/ipc.ts";
  import { shortcuts } from "../core/keybindings.svelte.ts";
  import type { LibraryStore } from "../core/library.svelte.ts";
  import {
    clampLineHeight,
    clampScale,
    DEFAULTS,
    LINE_HEIGHT,
    PROFILE_LINE_HEIGHT,
    TEXT_SCALE,
    type Settings,
  } from "../core/settings.svelte.ts";
  import { colourThemes, DEFAULT_THEME } from "../core/themes.svelte.ts";

  /**
   * Settings (DESIGN.md §6): one screen in four labelled sections, Appearance, Writing,
   * Language & checking, and Files & privacy, with a row of links to each. Every change
   * applies at once and is saved by Rust; there is no Apply. Bits UI provides the modal
   * focus trap, Esc and focus return.
   */
  type Section = "appearance" | "writing" | "checking" | "files";
  interface Props {
    open: boolean;
    values: Settings;
    change: (patch: Partial<Settings>) => void;
    library: LibraryStore;
    /** Where bismillah keeps its files, as the writer reads them. */
    folders: { config: string; data: string };
    /** The custom font as checked: installed, not, or not known yet (null). */
    customFont: { name: string; installed: boolean | null };
    /** A section to show on opening; `shown` is called once it has been. */
    section: "files" | "appearance" | null;
    shown: () => void;
    openFolder: () => void;
    createKeybindings: () => Promise<SaveError | null>;
    openAbout: () => void;
  }
  let {
    open = $bindable(),
    values,
    change,
    library,
    folders,
    customFont,
    section,
    shown,
    openFolder,
    createKeybindings,
    openAbout,
  }: Props = $props();

  const t = copy.settings;
  const lineHeight = $derived(values.line_height ?? PROFILE_LINE_HEIGHT[values.writing_profile]);
  const percent = $derived(`${Math.round(values.text_scale * 100)}%`);

  const SECTIONS: { id: Section; label: string }[] = [
    { id: "appearance", label: t.appearance },
    { id: "writing", label: t.writing },
    { id: "checking", label: t.checking },
    { id: "files", label: t.files },
  ];

  function showSection(id: Section) {
    const heading = document.getElementById(`settings-${id}`);
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }

  $effect(() => {
    if (!open || !section) return;
    const id = section;
    void tick().then(() => {
      showSection(id);
      shown();
    });
  });

  // Colours: bismillah's own, then every theme that can be chosen.
  const themeNames = $derived.by(() => {
    const names: Record<string, string> = { [DEFAULT_THEME]: copy.themes.builtin };
    for (const theme of colourThemes.list) {
      if (!theme.usable || theme.id in names) continue;
      const only = !theme.dark ? copy.themes.lightOnly : !theme.light ? copy.themes.darkOnly : null;
      names[theme.id] = only ? `${theme.name} (${only})` : theme.name;
    }
    return names;
  });
  const themeIds = $derived(Object.keys(themeNames));
  const troubled = $derived(
    colourThemes.list.filter((theme): theme is ColourTheme & { file: string } =>
      Boolean(theme.file && theme.problems.length > 0),
    ),
  );

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

  let createError = $state<string | null>(null);
  async function create() {
    const error = await createKeybindings();
    createError = error ? copy.shortcuts.createFailed(error) : null;
  }
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
        <RadioGroup.Item class="segment" value={option}><bdi>{names[option]}</bdi></RadioGroup.Item>
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
  shownValue: string,
  minus: () => void,
  plus: () => void,
  reset: () => void,
  atDefault: boolean,
)}
  <div class="setting">
    <span class="label" {id}>{label}</span>
    <div class="stepper" role="group" aria-labelledby={id}>
      <button type="button" aria-label="{t.smaller} ({label})" onclick={minus}>−</button>
      <output aria-live="polite">{shownValue}</output>
      <button type="button" aria-label="{t.bigger} ({label})" onclick={plus}>+</button>
      <button type="button" class="reset" disabled={atDefault} onclick={reset}>{t.reset}</button>
    </div>
  </div>
{/snippet}

{#snippet note(label: string, body: string)}
  <div class="setting">
    <h3 class="label">{label}</h3>
    <p class="hint">{body}</p>
  </div>
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="settings-overlay" />
    <Dialog.Content class="settings-dialog" aria-describedby={undefined}>
      <header>
        <Dialog.Title class="settings-title">{t.title}</Dialog.Title>
        <nav aria-label={t.sections}>
          {#each SECTIONS as s (s.id)}
            <button type="button" onclick={() => showSection(s.id)}>{s.label}</button>
          {/each}
        </nav>
      </header>

      <section aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" tabindex="-1">{t.appearance}</h2>
        {@render choice(
          "set-theme",
          t.theme,
          values.theme,
          ["system", "light", "dark"],
          t.themes,
          (theme) => change({ theme }),
        )}
        <div class="group">
          {@render choice(
            "set-colours",
            t.colours,
            values.colour_theme,
            themeIds,
            themeNames,
            (colour_theme) => change({ colour_theme }),
          )}
          <p class="hint">{copy.themes.hint(folders.config)}</p>
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
        </div>
        {@render toggle(
          "set-contrast",
          t.highContrast,
          t.highContrastHint,
          values.high_contrast,
          (high_contrast) => change({ high_contrast }),
        )}
        <div class="group">
          {@render choice(
            "set-font",
            t.font,
            values.writing_profile,
            ["duo", "serif", "amiri", "custom"],
            t.fonts,
            (writing_profile) => change({ writing_profile }),
          )}
          {#if values.writing_profile === "custom"}
            <div class="field">
              <label class="label" for="set-font-name">{t.customFont}</label>
              <input
                id="set-font-name"
                type="text"
                spellcheck="false"
                autocomplete="off"
                maxlength="100"
                bind:value={fontDraft}
                aria-invalid={fontInvalid}
                aria-describedby="set-font-name-hint"
                onchange={commitFont}
                onkeydown={(e) => {
                  if (e.key === "Enter") commitFont();
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
            </div>
          {:else}
            <p class="hint">{t.fontHint}</p>
          {/if}
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
        <h2 id="settings-writing" tabindex="-1">{t.writing}</h2>
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
        {@render toggle(
          "set-markdown",
          t.alwaysShowMarkdown,
          t.alwaysShowMarkdownHint,
          values.always_show_markdown,
          (always_show_markdown) => change({ always_show_markdown }),
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
        <div class="group">
          {@render choice(
            "set-dimming",
            t.focusDimming,
            values.focus_dimming,
            ["quiet", "faint"],
            t.dimmings,
            (focus_dimming) => change({ focus_dimming }),
          )}
          <p class="hint">{t.focusDimmingHint}</p>
        </div>
      </section>

      <section aria-labelledby="settings-checking">
        <h2 id="settings-checking" tabindex="-1">{t.checking}</h2>
        {@render toggle(
          "set-spelling",
          t.spelling,
          t.spellingHint,
          values.check_spelling,
          (check_spelling) => change({ check_spelling }),
        )}
        {@render toggle(
          "set-grammar",
          t.grammar,
          t.grammarHint,
          values.check_grammar,
          (check_grammar) => change({ check_grammar }),
        )}
        <div class="group">
          {@render choice(
            "set-dialect",
            t.dialect,
            values.english_dialect,
            ["british", "american", "canadian", "australian", "indian"],
            t.dialects,
            (english_dialect) => change({ english_dialect }),
          )}
          <p class="hint">{t.dialectHint}</p>
        </div>
      </section>

      <section aria-labelledby="settings-files">
        <h2 id="settings-files" tabindex="-1">{t.files}</h2>
        <div class="setting row">
          <div class="text">
            <h3 class="label">{t.library}</h3>
            <p class="hint">
              {#if library.view.kind === "none"}
                {t.libraryNone}
              {:else if library.view.kind === "unavailable"}
                {t.libraryUnavailable(library.view.name)}
              {:else}
                {library.view.name}
              {/if}
            </p>
          </div>
          <button type="button" class="action" onclick={openFolder}>
            {commandById("library.openFolder")?.label}
          </button>
        </div>
        <div class="setting">
          <h3 class="label">{copy.shortcuts.title}</h3>
          {#if shortcuts.file.unreadable}
            <p class="hint error">{copy.shortcuts.unreadable(shortcuts.file.unreadable)}</p>
          {:else if shortcuts.file.exists}
            <p class="hint">
              {copy.shortcuts.changed(shortcuts.changed)}
              {copy.shortcuts.editHint(folders.config)}
            </p>
          {:else}
            <p class="hint">{copy.shortcuts.none}</p>
            <div>
              <button type="button" class="action" onclick={create}>
                {copy.shortcuts.create}
              </button>
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
        {@render note(t.yourFiles, t.yourFilesText(folders.config))}
        {@render note(t.recovery, t.recoveryText(folders.data))}
        {@render note(t.privacy, t.privacyText)}
      </section>

      <footer>
        <button type="button" class="action" onclick={openAbout}>{t.about}</button>
        <Dialog.Close class="done">{t.done}</Dialog.Close>
      </footer>
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
    width: min(36rem, calc(100vw - 2 * var(--space-4)));
    max-height: calc(100vh - 2 * var(--space-6));
    overflow: auto;
    box-sizing: border-box;
    padding: 0 var(--space-6);
    background: var(--surface-editor);
    color: var(--text-primary);
    border: 1px solid var(--border-control);
    border-radius: 8px;
    box-shadow: 0 8px 32px color-mix(in srgb, var(--text-primary) 14%, transparent);
  }
  /* The title and the section links stay in view while the sections scroll. */
  header,
  footer {
    position: sticky;
    z-index: 1;
    background: var(--surface-editor);
  }
  header {
    inset-block-start: 0;
    padding-block: var(--space-6) var(--space-3);
    border-block-end: 1px solid var(--border-control);
  }
  :global(.settings-title) {
    margin: 0 0 var(--space-2);
    font-size: 1.15rem;
    font-weight: 600;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
  }
  nav button {
    font: inherit;
    padding: 0;
    color: var(--accent);
    background: none;
    border: 0;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  section {
    display: grid;
    gap: var(--space-6);
    padding-block: var(--space-4) var(--space-6);
  }
  section + section {
    border-block-start: 1px solid var(--border-control);
  }
  h2 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    /* Clears the sticky header when a section link scrolls to it. */
    scroll-margin-block-start: 6.5rem;
  }
  h2:focus {
    outline: none;
  }
  h2:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  h3 {
    margin: 0;
    font-size: inherit;
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
  .group,
  .text,
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .field {
    margin-block-start: var(--space-2);
  }
  .label {
    font-weight: 500;
  }
  .hint {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
  }
  .hint.error {
    color: var(--status-error);
  }
  input {
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
  .problems {
    margin: var(--space-1) 0 0;
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
  .action,
  :global(.done) {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-editor);
    border: 1px solid var(--border-control);
    border-radius: 4px;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
  }
  .action {
    justify-self: start;
    white-space: nowrap;
  }
  :global(.segment[data-state="checked"]) {
    background: var(--selection-background);
    border-color: var(--accent);
    font-weight: 600;
  }
  :global(.segment:hover),
  .stepper button:hover:not(:disabled),
  .action:hover,
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
  footer {
    inset-block-end: 0;
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    padding-block: var(--space-4) var(--space-6);
    border-block-start: 1px solid var(--border-control);
  }
  :global(.segment:focus-visible),
  .stepper button:focus-visible,
  .action:focus-visible,
  nav button:focus-visible,
  input:focus-visible,
  :global(.switch:focus-visible),
  :global(.done:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.thumb) {
      transition: none;
    }
  }
</style>
