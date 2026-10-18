<script lang="ts">
  import { onMount } from "svelte";
  import { loadFonts } from "./core/appearance.ts";
  import { runCommand, type CommandId } from "./core/commands.ts";
  import { installMenu } from "./core/menu.ts";
  import { settings } from "./core/settings.svelte.ts";
  import { installTestHooks } from "./core/testHooks.ts";
  import { workspace } from "./core/workspace.svelte.ts";
  import { remeasure } from "./editor/typography.ts";
  import Notices from "./ui/Notices.svelte";
  import SettingsDialog from "./ui/SettingsDialog.svelte";
  import StatusLine from "./ui/StatusLine.svelte";
  import Welcome from "./ui/Welcome.svelte";

  let host: HTMLElement;
  let failure = $state<string | null>(null);
  let started = $state(false);

  const session = $derived(workspace.session);
  const run = (id: CommandId) => runCommand(id, "ui", workspace.context);

  // Settings apply to the page and the editor whenever they change.
  $effect(() => {
    const values = settings.values;
    if (started) workspace.applySettings(values);
  });

  onMount(() => {
    const onFonts = () => workspace.editor && remeasure(workspace.editor.view);
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
  <main class="writing" class:hidden={workspace.welcome} bind:this={host}>
    {#if failure}
      <p class="failure" role="alert">{failure}</p>
    {/if}
  </main>
  {#if workspace.welcome}
    <div class="first-screen"><Welcome {run} /></div>
  {/if}
  {#if session}
    <div class="status-row">
      <StatusLine
        name={session.name}
        state={session.state}
        words={workspace.words}
        transliteration={workspace.transliteration}
        faded={settings.values.fade_chrome && workspace.typing}
      />
    </div>
  {/if}
</div>

<SettingsDialog
  bind:open={workspace.settingsOpen}
  values={settings.values}
  change={(patch) => void settings.set(patch)}
/>

<style>
  .window {
    height: 100%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .notices-row {
    grid-row: 1;
  }
  .status-row {
    grid-row: 3;
  }
  .writing {
    grid-row: 2;
    min-height: 0;
  }
  .writing.hidden {
    display: none;
  }
  .first-screen {
    grid-row: 2;
    min-height: 0;
  }
  .failure {
    margin: var(--space-12) auto;
    max-width: 40em;
    color: var(--status-error);
  }
</style>
