<script lang="ts">
  import { copy } from "../core/copy.ts";
  import Screen from "./Screen.svelte";
  import type { FarewellAction } from "./farewell.svelte.ts";

  /** The stick's last screen while it saves and powers off or restarts (farewell.svelte.ts). */
  let { action }: { action: FarewellAction } = $props();
</script>

<Screen title={action === "off" ? copy.appliance.poweringOff : copy.appliance.restarting} />
