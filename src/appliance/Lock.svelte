<script lang="ts">
  import { onMount } from "svelte";
  import * as ipc from "../core/ipc.ts";
  import Unlock from "./Unlock.svelte";

  /**
   * The stick's lock view over the open document (os/PLAN.md, OS-3): the lid closed,
   * the system is about to sleep, or the writer chose Lock. The same screen as Unlock,
   * checking the passphrase without reopening anything.
   */
  let { unlocked, power }: { unlocked: () => void; power: (action: "off" | "reboot") => void } =
    $props();

  let names = $state(new Map<string, string>());

  onMount(() => {
    void ipc
      .applianceLayouts()
      .then((layouts) => (names = new Map(layouts.map((l) => [l.id, l.name]))))
      .catch(() => {});
  });
</script>

<Unlock
  verb="verify"
  keyboardDamaged={false}
  {names}
  opened={unlocked}
  {power}
  changed={() => {}}
/>
