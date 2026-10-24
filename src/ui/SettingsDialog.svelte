<script lang="ts">
  import { Dialog, RadioGroup, Switch } from "bits-ui";
  import { tick } from "svelte";
  import { commandById } from "../core/commands.ts";
  import { copy } from "../core/copy.ts";
  import { colourThemeName } from "../core/findAnything.ts";
  import * as ipc from "../core/ipc.ts";
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
  import type { SettingsSection, SettingsTarget } from "../core/settingEntries.ts";
  import { colourThemes, DEFAULT_THEME } from "../core/themes.svelte.ts";

  /**
   * Settings (DESIGN.md §6): one screen in four labelled sections, Appearance, Writing,
   * Language & checking, and Files & privacy, with a row of links to each. Every change
   * applies at once and is saved by Rust; there is no Apply. Bits UI provides the modal
   * focus trap, Esc and focus return.
   */
  type Section = SettingsSection;
  interface Props {
    open: boolean;
    values: Settings;
    change: (patch: Partial<Settings>) => void;
    saveError: SaveError | null;
    library: LibraryStore;
    /** Where bismillah keeps its files, as the writer reads them. */
    folders: { config: string; data: string };
    /** The custom font as checked: installed, not, or not known yet (null). */
    customFont: { name: string; installed: boolean | null };
    /** A section, or a control in it, to show on opening (Find anything); `shown` is
     * called once it has been. */
    section: SettingsTarget | null;
    shown: () => void;
    openFolder: () => void;
    createKeybindings: () => Promise<SaveError | null>;
    openAbout: () => void;
    /** On the bismillah stick: its own section (keyboard, time). `apply` stores new
     * layouts, which restarts the session; it resolves only with why it couldn't. */
    stick?: { apply: (layouts: string, options: string) => Promise<string | null> } | null;
  }
  let {
    open = $bindable(),
    values,
    change,
    saveError,
    library,
    folders,
    customFont,
    section,
    shown,
    openFolder,
    createKeybindings,
    openAbout,
    stick = null,
  }: Props = $props();

  const t = copy.settings;
  const lineHeight = $derived(values.line_height ?? PROFILE_LINE_HEIGHT[values.writing_profile]);
  const percent = $derived(`${Math.round(values.text_scale * 100)}%`);
  let headerHeight = $state(0);
  let footerHeight = $state(0);

  const SECTIONS = $derived<{ id: Section; label: string }[]>([
    { id: "appearance", label: t.appearance },
    { id: "writing", label: t.writing },
    { id: "checking", label: t.checking },
    { id: "files", label: t.files },
    ...(stick ? [{ id: "stick" as const, label: t.stick.title }] : []),
  ]);

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
  const zones = Intl.supportedValuesOf("timeZone");
  const picked = $derived(chosen.filter((l, i) => l !== "" && chosen.indexOf(l) === i).slice(0, 4));
  const nextLayouts = $derived(picked.join(","));
  const nextOptions = $derived(picked.length > 1 ? switchKey : "");
  const keyboardChanged = $derived(
    nextLayouts !== current.layouts || nextOptions !== current.options,
  );
  $effect(() => {
    if (!open || !stick) return;
    void ipc.applianceLayouts().then((l) => (layoutList = l));
    void ipc.applianceKeyboard().then((k) => {
      const layouts = k.layouts.length > 0 ? k.layouts : ["us"];
      chosen = [0, 1, 2, 3].map((i) => layouts[i] ?? "");
      const key = k.options.split(",").find((o) => o.startsWith("grp:"));
      switchKey = key ?? SWITCHES[0];
      current = { layouts: layouts.join(","), options: k.options };
    });
  });
  async function applyKeyboard() {
    if (!stick || applying || !keyboardChanged) return;
    applying = true;
    keyboardProblem = null;
    // On success the session restarts; this only returns with a problem.
    keyboardProblem = await stick.apply(nextLayouts, nextOptions);
    applying = false;
  }

  function showSection(id: Section) {
    const heading = document.getElementById(`settings-${id}`);
    const panel = heading?.closest<HTMLElement>(".settings-dialog");
    const header = panel?.querySelector("header");
    if (panel && header) {
      // Use the same rounded measurement as the size binding. A later footer
      // measurement must not replace a fractional navigation offset with an integer.
      headerHeight = header.offsetHeight;
      panel.style.setProperty(
        "--settings-header-offset",
        `calc(${headerHeight}px + var(--space-4))`,
      );
    }
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }

  /** Focus on one setting's control: the chosen option of a choice, a switch, a
   * stepper's first button, or the setting's action. */
  function showControl(id: string) {
    const setting = document.getElementById(id)?.closest<HTMLElement>(".setting");
    const control =
      setting?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      setting?.querySelector<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
      );
    setting?.scrollIntoView({ block: "center" });
    control?.focus({ preventScroll: true });
  }

  $effect(() => {
    if (!open || !section) return;
    const { section: id, control } = section;
    void tick().then(() => {
      showSection(id);
      if (control) showControl(control);
      shown();
    });
  });

  // Colours: bismillah's own, then every theme that can be chosen.
  const themeNames = $derived.by(() => {
    const names: Record<string, string> = { [DEFAULT_THEME]: copy.themes.builtin };
    for (const theme of colourThemes.list) {
      if (!theme.usable || theme.id in names) continue;
      names[theme.id] = colourThemeName(theme.id, colourThemes.list);
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
  canDecrease: boolean,
  canIncrease: boolean,
)}
  <div class="setting">
    <span class="label" {id}>{label}</span>
    <div class="stepper" role="group" aria-labelledby={id}>
      <button
        type="button"
        aria-label="{t.smaller} ({label})"
        disabled={!canDecrease}
        onclick={minus}>−</button
      >
      <output aria-live="polite">{shownValue}</output>
      <button type="button" aria-label="{t.bigger} ({label})" disabled={!canIncrease} onclick={plus}
        >+</button
      >
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
    <Dialog.Content
      class="settings-dialog"
      style={`--settings-header-offset: calc(${headerHeight}px + var(--space-4)); --settings-footer-offset: calc(${footerHeight}px + var(--space-4))`}
    >
      <header bind:offsetHeight={headerHeight}>
        <Dialog.Title class="settings-title">{t.title}</Dialog.Title>
        <Dialog.Description class="settings-description">{t.immediate}</Dialog.Description>
        <nav aria-label={t.sections}>
          {#each SECTIONS as s (s.id)}
            <button type="button" onclick={() => showSection(s.id)}>{s.label}</button>
          {/each}
        </nav>
        {#if saveError}
          <div class="settings-save-error" role="alert">
            <p>{copy.settingsNotSaved(saveError)}</p>
            <button type="button" class="action" onclick={() => change({ ...values })}>
              {copy.actions.tryAgain}
            </button>
          </div>
        {/if}
      </header>

      <section aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" tabindex="-1" aria-label={t.appearance}>{t.appearance}</h2>
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
          <!-- On the stick no other program can write a theme file. -->
          {#if !stick}<p class="hint">{copy.themes.hint(folders.config)}</p>{/if}
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
            stick ? ["duo", "serif", "amiri"] : ["duo", "serif", "amiri", "custom"],
            t.fonts,
            (writing_profile) => change({ writing_profile }),
          )}
          {#if values.writing_profile === "custom" && !stick}
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
          values.text_scale > TEXT_SCALE.min,
          values.text_scale < TEXT_SCALE.max,
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
          `${lineHeight.toFixed(1)}${values.line_height === null ? ` (${t.fontDefault})` : ""}`,
          () => change({ line_height: clampLineHeight(lineHeight - LINE_HEIGHT.step) }),
          () => change({ line_height: clampLineHeight(lineHeight + LINE_HEIGHT.step) }),
          () => change({ line_height: null }),
          values.line_height === null,
          lineHeight > LINE_HEIGHT.min,
          lineHeight < LINE_HEIGHT.max,
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
        <h2 id="settings-writing" tabindex="-1" aria-label={t.writing}>{t.writing}</h2>
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
        <h2 id="settings-checking" tabindex="-1" aria-label={t.checking}>{t.checking}</h2>
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
        <h2 id="settings-files" tabindex="-1" aria-label={t.files}>{t.files}</h2>
        <div class="setting">
          <h3 class="label" id="settings-library">{t.library}</h3>
          <p class="hint">
            {#if library.view.kind === "none"}
              {t.libraryNone}
            {:else if library.view.kind === "unavailable"}
              {t.libraryUnavailable(library.view.name)}
            {:else}
              {library.view.name}
            {/if}
          </p>
          {#if !stick}
            <div class="actions">
              <button type="button" class="action" onclick={openFolder}>
                {commandById("library.openFolder")?.label}
              </button>
            </div>
          {/if}
        </div>
        <!-- On the stick there is no other editor for keybindings.toml or settings.toml. -->
        {#if !stick}
          <div class="setting">
            <h3 class="label" id="settings-shortcuts">{copy.shortcuts.title}</h3>
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
        {/if}
        {@render note(t.recovery, t.recoveryText(folders.data))}
        {@render note(t.privacy, stick ? t.stick.privacyText : t.privacyText)}
      </section>

      {#if stick}
        <section aria-labelledby="settings-stick">
          <h2 id="settings-stick" tabindex="-1" aria-label={t.stick.title}>{t.stick.title}</h2>
          <div class="setting">
            <h3 class="label" id="set-keyboard">{t.stick.keyboard}</h3>
            <p class="hint" id="set-keyboard-hint">{t.stick.keyboardHint}</p>
            {#each [0, 1, 2, 3] as i (i)}
              <div class="field">
                <label class="label" for="set-layout-{i}">{t.stick.layout(i + 1)}</label>
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
                <label class="label" for="set-switch">{t.stick.switchKey}</label>
                <select id="set-switch" bind:value={switchKey} disabled={applying}>
                  {#each SWITCHES as key (key)}
                    <option value={key}>{t.stick.switches[key]}</option>
                  {/each}
                </select>
              </div>
            {/if}
            <div class="actions field">
              <button
                type="button"
                class="action"
                aria-describedby="set-keyboard-hint"
                disabled={applying || !keyboardChanged}
                onclick={() => void applyKeyboard()}>{t.stick.apply}</button
              >
            </div>
            <p
              class="hint"
              class:error={keyboardProblem}
              role={keyboardProblem ? "alert" : "status"}
            >
              {applying ? t.stick.applying : (keyboardProblem ?? "")}
            </p>
          </div>
          <div class="setting">
            <label class="label" for="set-zone">{t.stick.timeZone}</label>
            <select
              id="set-zone"
              value={values.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone}
              onchange={(e) => change({ time_zone: e.currentTarget.value })}
            >
              {#each zones as zone (zone)}
                <option value={zone}>{zone.replaceAll("_", " ")}</option>
              {/each}
            </select>
          </div>
          {@render toggle(
            "set-local-clock",
            t.stick.localClock,
            t.stick.localClockHint,
            values.clock_keeps_local_time,
            (clock_keeps_local_time) => change({ clock_keeps_local_time }),
          )}
        </section>
      {/if}

      <footer bind:offsetHeight={footerHeight}>
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
    width: min(46rem, calc(100vw - 2 * var(--space-4)));
    max-height: calc(100vh - 2 * var(--space-6));
    overflow: auto;
    /* Section links and focused controls must clear the actual sticky header,
       whose navigation can wrap in a small desktop window. */
    scroll-padding-block-start: var(--settings-header-offset, 6.5rem);
    scroll-padding-block-end: var(--settings-footer-offset, 5rem);
    box-sizing: border-box;
    padding: 0 var(--space-8);
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
    padding-block: var(--space-8) var(--space-4);
    border-block-end: 1px solid var(--border-control);
  }
  :global(.settings-title) {
    margin: 0 0 var(--space-2);
    font-size: 1.15rem;
    font-weight: 600;
  }
  :global(.settings-description) {
    margin: 0 0 var(--space-3);
    color: var(--text-secondary);
  }
  .settings-save-error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-block-start: var(--space-3);
    padding-inline-start: var(--space-3);
    border-inline-start: 3px solid var(--status-error);
    color: var(--status-error);
  }
  .settings-save-error p {
    flex: 1 1 16rem;
    margin: 0;
    overflow-wrap: anywhere;
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
    gap: var(--space-8);
    padding-block: var(--space-6) var(--space-8);
  }
  section + section {
    border-block-start: 1px solid var(--border-control);
  }
  /* Shown in capitals; each heading's aria-label keeps its name as written, since
     WebKit hands the transformed text to screen readers. */
  h2 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
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
    gap: var(--space-3);
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
    max-width: 38rem;
    color: var(--text-secondary);
  }
  .hint.error {
    color: var(--status-error);
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
  select:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  .action:disabled {
    color: var(--text-secondary);
    cursor: default;
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
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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
    flex-wrap: wrap;
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
    padding-block: var(--space-4) var(--space-8);
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
  @media (max-height: 480px) {
    header {
      padding-block: var(--space-4) var(--space-2);
    }
    footer {
      padding-block: var(--space-2);
    }
    :global(.settings-description) {
      margin-block-end: var(--space-2);
    }
  }
</style>
