<script lang="ts">
  import { copy } from "../core/copy.ts";
  import Screen from "./Screen.svelte";
  import { focus } from "./gate.ts";

  /**
   * A stick the helper won't touch: unreadable, two sticks attached, or no home found.
   * It says that the texts are safe and nothing will change, and offers only power.
   */
  let {
    title,
    body,
    restart,
    power,
  }: { title: string; body: string; restart: boolean; power: (action: "off" | "reboot") => void } =
    $props();
</script>

<Screen {title}>
  <div class="column">
    <p class="hint">{body}</p>
    <div class="actions">
      {#if restart}
        <button type="button" use:focus onclick={() => power("reboot")}
          >{copy.appliance.restart}</button
        >
        <button type="button" onclick={() => power("off")}>{copy.appliance.powerOff}</button>
      {:else}
        <button type="button" use:focus onclick={() => power("off")}
          >{copy.appliance.powerOff}</button
        >
      {/if}
    </div>
  </div>
</Screen>
