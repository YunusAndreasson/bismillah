<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { appInfo, initialDocument } from "./core/ipc.ts";
  import { loadFonts, setTheme, type Theme } from "./core/appearance.ts";
  import { COMMANDS, runCommand, type CommandContext } from "./core/commands.ts";
  import { installMenu } from "./core/menu.ts";
  import { keymap } from "@codemirror/view";
  import { Prec } from "@codemirror/state";
  import { installTestHooks } from "./core/testHooks.ts";
  import { createEditor, type Editor } from "./editor/setup.ts";
  import { remeasure } from "./editor/typography.ts";

  let host: HTMLElement;

  const THEMES: Theme[] = ["system", "light", "dark"];
  let theme: Theme = "system";
  let textScale = 1;

  function commandContext(editor: Editor): CommandContext {
    return {
      view: editor.view,
      toggleTypewriter: () => editor.setTypewriter(!editor.typewriter),
      changeTextSize(step) {
        textScale = step === 0 ? 1 : Math.min(3, Math.max(0.5, textScale + step * 0.1));
        document.documentElement.style.setProperty("--doc-scale", textScale.toFixed(2));
        remeasure(editor.view);
      },
      cycleTheme() {
        theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "system";
        setTheme(theme);
      },
      quit: () => void getCurrentWindow().close(),
    };
  }
  let failure = $state<string | null>(null);

  onMount(() => {
    let editor: Editor | null = null;
    const onFonts = () => editor && remeasure(editor.view);
    (async () => {
      try {
        const [info, doc] = await Promise.all([appInfo(), initialDocument()]);
        await loadFonts();
        let context: CommandContext | null = null;
        const keys = Prec.high(
          keymap.of(
            COMMANDS.map((c) => ({
              key: c.key,
              run: () => (context ? runCommand(c.id, "keymap", context) : false),
            })),
          ),
        );
        editor = createEditor({ parent: host, doc: doc.text, steadyCaret: info.test_mode, keys });
        context = commandContext(editor);
        await installMenu(context);
        document.fonts.addEventListener("loadingdone", onFonts);
        document.title = `${doc.name} — bismillah`;
        await getCurrentWindow().setTitle(document.title);
        if (info.test_mode) installTestHooks(editor);
        editor.view.focus();
      } catch (error) {
        failure = typeof error === "string" ? error : "Couldn't open the document.";
      }
    })();
    return () => {
      document.fonts.removeEventListener("loadingdone", onFonts);
      editor?.view.destroy();
    };
  });
</script>

<main class="writing" bind:this={host}>
  {#if failure}
    <p class="failure" role="alert">{failure}</p>
  {/if}
</main>

<style>
  .writing {
    height: 100%;
  }
  .failure {
    margin: var(--space-12) auto;
    max-width: 40em;
    color: var(--status-error);
  }
</style>
