<script lang="ts">
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { copy } from "../core/copy.ts";
  import * as ipc from "../core/ipc.ts";

  /**
   * The active layout, its direction and Caps Lock, beside a passphrase field. GTK
   * names the active layout only when a key is pressed; direction and Caps Lock are
   * live (docs/spikes/os-keyboard.md).
   */
  let { names }: { names: Map<string, string> } = $props();

  let keyboard = $state<ipc.KeyboardState | null>(null);
  const id = $derived(keyboard?.layouts[keyboard.group] ?? keyboard?.layouts[0] ?? "us");
  const name = $derived(names.get(id) ?? id);

  onMount(() => {
    void ipc.applianceKeyboard().then((k) => (keyboard = k));
    const unlisten = listen<ipc.KeyboardState>("appliance-keyboard", (e) => (keyboard = e.payload));
    return () => void unlisten.then((stop) => stop());
  });
</script>

<p class="note keyboard">
  <span>{copy.appliance.keyboard(name, keyboard?.rtl ?? false)}</span>
  {#if keyboard?.caps}<span class="caps" role="status">{copy.appliance.capsLock}</span>{/if}
</p>

<style>
  .keyboard {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
  }
  .caps {
    color: var(--text-primary);
    font-weight: 600;
  }
</style>
