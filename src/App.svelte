<script lang="ts">
  import { Dialog } from "bits-ui";
  import { onMount } from "svelte";
  import { loadFonts } from "./core/appearance.ts";
  import { runCommand, type CommandId } from "./core/commands.ts";
  import { copy } from "./core/copy.ts";
  import * as ipc from "./core/ipc.ts";
  import { installMenu } from "./core/menu.ts";
  import { settings } from "./core/settings.svelte.ts";
  import { installTestHooks } from "./core/testHooks.ts";
  import { workspace } from "./core/workspace.svelte.ts";
  import { remeasure } from "./editor/typography.ts";
  import LibraryPanel from "./ui/LibraryPanel.svelte";
  import NamePrompt from "./ui/NamePrompt.svelte";
  import Notices from "./ui/Notices.svelte";
  import Picker from "./ui/Picker.svelte";
  import SettingsDialog from "./ui/SettingsDialog.svelte";
  import StatusLine from "./ui/StatusLine.svelte";
  import Welcome from "./ui/Welcome.svelte";

  let host: HTMLElement;
  let failure = $state<string | null>(null);
  let started = $state(false);

  const session = $derived(workspace.session);
  const library = workspace.library;
  const docked = $derived(library.visible && library.layout.mode === "docked");
  const run = (id: CommandId) => runCommand(id, "ui", workspace.context);

  // Settings apply to the page and the editor whenever they change.
  $effect(() => {
    const values = settings.values;
    if (started) workspace.applySettings(values);
  });

  // The writing column moves clear of a docked library (DESIGN.md §7).
  $effect(() => {
    void library.visible;
    void library.layout;
    if (started) workspace.applyLibraryOffset();
  });

  const panel = {
    open: (path: string) => void workspace.openFromLibrary(path),
    run,
    newHere: (kind: "file" | "folder", folder: string) => {
      if (kind === "file") void workspace.newFile(folder);
      else workspace.newFolder(folder);
    },
    escape: () => workspace.focusEditor(),
    retry: () => void ipc.libraryGet(true).then((p) => library.apply(p.view)),
  };

  onMount(() => {
    const onFonts = () => {
      if (workspace.editor) remeasure(workspace.editor.view);
      workspace.measureLayout();
    };
    (async () => {
      try {
        await loadFonts();
        await workspace.start(host, installMenu);
        document.fonts.addEventListener("loadingdone", onFonts);
        started = true;
        if (workspace.testMode && workspace.editor) installTestHooks(workspace.editor, workspace);
      } catch (error) {
        console.error("bismillah: couldn't start", error);
        failure = "bismillah couldn't start. Please restart it.";
      }
    })();
    return () => {
      document.fonts.removeEventListener("loadingdone", onFonts);
      workspace.editor?.view.destroy();
    };
  });
</script>

<div class="window">
  <div class="notices-row"><Notices notices={workspace.notices} /></div>
  <div class="middle">
    {#if docked}
      <nav class="library-dock" aria-label={copy.library.region}>
        <LibraryPanel {library} {...panel} />
      </nav>
    {/if}
    <main class="writing" class:hidden={workspace.welcome} bind:this={host}>
      {#if failure}
        <p class="failure" role="alert">{failure}</p>
      {/if}
    </main>
    {#if workspace.welcome}
      <div class="first-screen"><Welcome {run} /></div>
    {/if}
  </div>
  {#if session || library.view.kind !== "none"}
    <div class="status-row">
      <StatusLine
        name={session?.name ?? null}
        state={session?.state ?? null}
        words={workspace.words}
        transliteration={workspace.transliteration}
        faded={settings.values.fade_chrome && workspace.typing}
        libraryShown={library.visible}
        toggleLibrary={() => workspace.toggleLibrary()}
      />
    </div>
  {/if}
</div>

<!-- Narrow windows: the library opens over the text, and closes once a file is chosen. -->
<Dialog.Root
  open={library.overlay && library.layout.mode === "overlay"}
  onOpenChange={(open) => {
    if (!open) library.overlay = false;
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="library-scrim" />
    <Dialog.Content
      class="library-overlay"
      aria-label={copy.library.region}
      aria-describedby={undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        library.requestFocus();
      }}
    >
      <LibraryPanel {library} {...panel} />
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<SettingsDialog
  bind:open={workspace.settingsOpen}
  values={settings.values}
  change={(patch) => void settings.set(patch)}
/>

<Picker
  kind={workspace.picker}
  {library}
  context={workspace.context}
  close={() => (workspace.picker = null)}
  openFile={(path) => void workspace.openFromLibrary(path)}
  runCommand={run}
/>

<NamePrompt prompt={workspace.prompt} closed={(p) => workspace.promptClosed(p)} />

<style>
  .window {
    height: 100%;
    display: grid;
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
  }
  .status-row {
    grid-row: 3;
  }
  .writing,
  .first-screen {
    grid-area: 1 / 1;
    min-height: 0;
    /* Clears a docked library; 0 otherwise (workspace.applyLibraryOffset). */
    padding-inline-start: var(--library-offset, 0px);
  }
  .writing.hidden {
    display: none;
  }
  /* The docked library (DESIGN.md §7): edge padding and 240px of list in the margin.
     Opening it never changes the writing column's width. */
  .library-dock {
    position: absolute;
    z-index: var(--layer-dock);
    inset-block: 0;
    inset-inline-start: 0;
    box-sizing: border-box;
    inline-size: calc(var(--space-6) + 240px);
    padding-block: var(--space-4);
    padding-inline: var(--space-6) 0;
    background: var(--surface-panel);
  }
  :global(.library-scrim) {
    position: fixed;
    z-index: var(--layer-popover);
    inset: 0;
  }
  :global(.library-overlay) {
    position: fixed;
    z-index: var(--layer-popover);
    inset-block: 0;
    inset-inline-start: 0;
    box-sizing: border-box;
    inline-size: min(calc(var(--space-6) + 240px + var(--space-4)), 90vw);
    padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);
    background: var(--surface-editor);
    color: var(--text-primary);
    border-inline-end: 1px solid var(--border-control);
    box-shadow: 0 8px 32px color-mix(in srgb, var(--text-primary) 14%, transparent);
    outline: none;
  }
  .failure {
    margin: var(--space-12) auto;
    max-width: 40em;
    color: var(--status-error);
  }
</style>
