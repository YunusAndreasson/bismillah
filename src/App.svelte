<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { colourThemes } from "./core/themes.svelte.ts";
  import { runCommand, type CommandId } from "./core/commands.ts";
  import * as ipc from "./core/ipc.ts";
  import { installMenu } from "./core/menu.ts";
  import { settings, type Settings } from "./core/settings.svelte.ts";
  import { installTestHooks } from "./core/testHooks.ts";
  import type { Scope } from "./core/panels.ts";
  import type { SettingsContext } from "./core/settingEntries.ts";
  import { shortcuts } from "./core/keybindings.svelte.ts";
  import { workspace, type NamePrompt as Prompt } from "./core/workspace.svelte.ts";
  import { remeasure } from "./editor/typography.ts";
  import AboutDialog from "./ui/AboutDialog.svelte";
  import NamePrompt from "./ui/NamePrompt.svelte";
  import Notices from "./ui/Notices.svelte";
  import Panel from "./ui/Panel.svelte";
  import StatusLine from "./ui/StatusLine.svelte";
  import Suggestions from "./ui/Suggestions.svelte";
  import Welcome from "./ui/Welcome.svelte";
  import Farewell from "./appliance/Farewell.svelte";
  import { farewell } from "./appliance/farewell.svelte.ts";
  import Gate from "./appliance/Gate.svelte";
  import Lock from "./appliance/Lock.svelte";

  let host: HTMLElement;
  let failure = $state<string | null>(null);
  let started = $state(false);
  // On the bismillah stick: home's state while the first screen waits for it to open
  // (src/appliance/, os/PLAN.md). Null on the desktop.
  let gate = $state<{
    initial: ipc.GateState;
    opened: (setup: { timeZone: string } | null) => void;
  } | null>(null);

  /** Waits until the stick's home is open; returns setup's choices, if it ran. */
  async function unlocked(): Promise<{ timeZone: string } | null> {
    const initial = await ipc.applianceGate();
    if (initial === null) {
      // On the stick the first page load always meets the gate. A page loaded again
      // after the app started (a reload, a restarted web process) can't know whether
      // the stick was locked, so it opens behind the lock view (os/PLAN.md, OS-5).
      if ((await ipc.appInfo()).stick) workspace.locked = true;
      return null;
    }
    const setup = await new Promise<{ timeZone: string } | null>(
      (opened) => (gate = { initial, opened }),
    );
    gate = null;
    return setup;
  }

  // On the stick cage's pointer would sit over the text: it hides while the writer
  // types and comes back when the mouse moves.
  const onStick = $derived(gate !== null || workspace.stick !== null);
  let pointerHidden = $state(true);
  $effect(() => {
    document.documentElement.classList.toggle("pointer-hidden", onStick && pointerHidden);
  });

  const session = $derived(workspace.session);
  const library = workspace.library;
  const run = (id: CommandId) => runCommand(id, "ui", workspace.context);

  // Settings apply to the page and the editor whenever they change.
  $effect(() => {
    const values = { ...settings.values };
    void colourThemes.list;
    if (started) untrack(() => workspace.applySettings(values));
  });

  $effect(() => workspace.syncMenu());

  // What the Settings panel's rows read beyond the settings themselves.
  const settingsContext = $derived<SettingsContext>({
    colours: colourThemes.list,
    stick: workspace.stick !== null,
    library: { kind: library.view.kind, name: library.name },
    shortcuts: {
      exists: shortcuts.file.exists,
      changed: shortcuts.changed,
      unreadable: shortcuts.file.unreadable !== null,
      problems: shortcuts.problems.length,
    },
    folders: workspace.info.folders,
  });

  const panelActions = {
    close: () => (workspace.panel = null),
    focusText: () => workspace.focusEditor(),
    setPanel: (kind: Scope) => workspace.openPanel(kind),
    openFile: (path: string) => void workspace.openFromLibrary(path),
    runCommand: run,
    change: (patch: Partial<Settings>) => void settings.set(patch),
    rename: (path: string) => void workspace.rename(path),
    trash: (path: string) => void workspace.trash(path),
    newFile: (folder: string) => void workspace.newFile(folder),
    newFolder: (folder: string) => workspace.newFolder(folder),
    retry: () => void ipc.libraryGet(true).then((view) => library.apply(view)),
    openAbout: () => (workspace.aboutOpen = true),
    createKeybindings: () => workspace.createKeybindings(),
    applyKeyboard: (layouts: string, options: string) => workspace.applyKeyboard(layouts, options),
  };

  onMount(() => {
    const onFonts = () => {
      if (workspace.editor) remeasure(workspace.editor.view);
    };
    const hidePointer = (event: KeyboardEvent) => {
      if (!event.repeat) pointerHidden = true;
    };
    const showPointer = () => (pointerHidden = false);
    // On the stick WebKit's own context menu (Back, Reload, …) has nothing to offer and
    // would reload the page. Fields and the editor keep theirs (Cut, Copy, Paste), and
    // the editor its own spelling menu.
    const noPageMenu = (event: MouseEvent) => {
      const field =
        event.target instanceof Element &&
        event.target.closest("input, textarea, [contenteditable]");
      if (onStick && !field) event.preventDefault();
    };
    window.addEventListener("keydown", hidePointer, true);
    window.addEventListener("mousemove", showPointer, true);
    window.addEventListener("contextmenu", noPageMenu);
    void (async () => {
      try {
        const setup = await unlocked();
        await workspace.start(host, installMenu);
        if (setup) await settings.set({ time_zone: setup.timeZone });
        if (workspace.stick) await workspace.restoreCaret();
        document.fonts.addEventListener("loadingdone", onFonts);
        started = true;
        // The launch budget's end: the document is in the editor, which has focus
        // (ARCHITECTURE.md §14, measured by scripts/perf.ts).
        performance.mark("bismillah:editable");
        void ipc.applianceMark("editable");
        if (workspace.testMode && workspace.editor) installTestHooks(workspace.editor, workspace);
      } catch (error) {
        console.error("bismillah: couldn't start", error);
        failure = "bismillah couldn't start. Please restart it.";
      }
    })();
    return () => {
      window.removeEventListener("keydown", hidePointer, true);
      window.removeEventListener("mousemove", showPointer, true);
      window.removeEventListener("contextmenu", noPageMenu);
      document.fonts.removeEventListener("loadingdone", onFonts);
      workspace.editor?.view.destroy();
    };
  });
</script>

{#if gate}
  <div class="appliance-gate" inert={farewell.action !== null}>
    <Gate initial={gate.initial} opened={gate.opened} />
  </div>
{/if}
{#if workspace.locked}
  <div class="appliance-gate" inert={farewell.action !== null}>
    <Lock
      unlocked={() => workspace.unlocked()}
      power={(action: ipc.PowerAction) => void workspace.power(action)}
    />
  </div>
{/if}
{#if farewell.action}
  <div class="appliance-gate farewell"><Farewell action={farewell.action} /></div>
{/if}
<div class="window" inert={workspace.shut}>
  <div class="notices-row"><Notices notices={workspace.notices} /></div>
  <div class="middle">
    <main class="writing" class:hidden={workspace.welcome} bind:this={host}>
      {#if failure}
        <p class="failure" role="alert">{failure}</p>
      {/if}
    </main>
    {#if workspace.welcome}
      <div class="first-screen"><Welcome {run} stick={workspace.stick !== null} /></div>
    {/if}
  </div>
  {#if session || library.view.kind !== "none"}
    <div class="status-row">
      <StatusLine
        name={session?.name ?? null}
        state={session?.state ?? null}
        words={workspace.words}
        transliteration={workspace.transliteration}
        note={workspace.checking.note}
        faded={settings.values.fade_chrome && workspace.typing}
        panel={workspace.panel}
        openSearch={() =>
          workspace.panel !== null ? (workspace.panel = null) : workspace.openPanel("all")}
        clock={workspace.clock}
        battery={workspace.battery}
      />
    </div>
  {/if}
</div>

<AboutDialog
  bind:open={workspace.aboutOpen}
  version={workspace.info.version}
  stick={workspace.stick}
/>

<Panel
  kind={workspace.panel}
  bind:query={workspace.panelQuery}
  focus={workspace.panelFocus}
  focused={() => (workspace.panelFocus = null)}
  {library}
  context={workspace.context}
  values={settings.values}
  settings={settingsContext}
  customFont={workspace.customFont}
  saveError={settings.notSaved}
  actions={panelActions}
/>

<NamePrompt prompt={workspace.prompt} closed={(p: Prompt) => workspace.promptClosed(p)} />

<Suggestions checking={workspace.checking} />

<style>
  :global(html.pointer-hidden),
  :global(html.pointer-hidden *) {
    cursor: none !important;
  }
  .appliance-gate {
    position: fixed;
    inset: 0;
    z-index: 100;
    overflow: auto;
  }
  .farewell {
    z-index: 101;
  }
  .window {
    height: 100%;
    display: grid;
    /* The writing surface and status must fit the window even at enlarged sizes. */
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .notices-row {
    grid-row: 1;
  }
  .middle {
    grid-row: 2;
    position: relative;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .status-row {
    grid-row: 3;
  }
  .writing,
  .first-screen {
    grid-area: 1 / 1;
    min-height: 0;
  }
  .writing.hidden {
    display: none;
  }
  .failure {
    margin: var(--space-12) auto;
    max-width: 40em;
    color: var(--status-error);
  }
</style>
