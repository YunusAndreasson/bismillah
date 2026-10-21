<script lang="ts">
  import { onMount } from "svelte";
  import { copy } from "../core/copy.ts";
  import * as ipc from "../core/ipc.ts";
  import Finish from "./Finish.svelte";
  import Screen from "./Screen.svelte";
  import Setup from "./Setup.svelte";
  import Stop from "./Stop.svelte";
  import Unlock from "./Unlock.svelte";
  import { viewFor } from "./gate.ts";

  /**
   * The stick's first screen, chosen by home's state (os/PLAN.md, OS-2). `opened` runs
   * once home is open and the app's startup has run; setup passes its time zone.
   */
  let {
    initial,
    opened,
  }: { initial: ipc.GateState; opened: (setup: { timeZone: string } | null) => void } = $props();

  let gate = $state((() => initial)());
  let layouts = $state<ipc.KeyboardLayout[]>([]);
  let down = $state(false);
  const view = $derived(viewFor(gate));
  const names = $derived(new Map(layouts.map((l) => [l.id, l.name])));

  onMount(() => {
    void ipc.applianceMark("gate-shown");
    void ipc.applianceLayouts().then((l) => (layouts = l));
  });

  async function power(action: "off" | "reboot") {
    try {
      await ipc.appliancePower(action);
    } catch {
      down = true;
    }
  }

  async function reload() {
    try {
      const next = await ipc.applianceGate();
      if (next) gate = next;
    } catch {
      down = true;
    }
  }
</script>

{#if down}
  <Screen title={copy.appliance.wordmark}>
    <p class="problem" role="alert">{copy.appliance.helperDown}</p>
  </Screen>
{:else if view.view === "setup"}
  <Setup
    keyboardChosen={view.keyboardChosen}
    current={gate.keyboard.layouts}
    {layouts}
    opened={(timeZone: string) => opened({ timeZone })}
    {power}
    changed={reload}
  />
{:else if view.view === "finish"}
  <Finish {names} opened={() => opened(null)} restarted={reload} {power} changed={reload} />
{:else if view.view === "unlock"}
  <Unlock
    verb={view.verb}
    keyboardDamaged={gate.keyboard.source === "damaged"}
    {names}
    opened={() => opened(null)}
    {power}
    changed={reload}
  />
{:else}
  <Stop title={view.title} body={view.body} restart={view.restart} {power} />
{/if}
