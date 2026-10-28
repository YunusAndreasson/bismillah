<script lang="ts">
  import { onMount, tick } from "svelte";
  import { copy } from "../core/copy.ts";
  import * as ipc from "../core/ipc.ts";
  import Finish from "./Finish.svelte";
  import Screen from "./Screen.svelte";
  import Setup from "./Setup.svelte";
  import Stop from "./Stop.svelte";
  import Unlock from "./Unlock.svelte";
  import { farewellThen } from "./farewell.svelte.ts";
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
  let ready = $state(false);
  const view = $derived(viewFor(gate));
  const names = $derived(new Map(layouts.map((l) => [l.id, l.name])));

  // After a keyboard change the session restarted on purpose: the helper lets this
  // app reopen home once without the passphrase, so the writer goes straight back.
  let resuming = $state((() => initial.resume)());

  onMount(() => {
    void (async () => {
      try {
        layouts = await ipc.applianceLayouts();
      } catch {
        down = true;
      }
      await tick();
      await document.fonts.ready;
      // The native window is mapped behind this invisible view. Wait for layout
      // at its final viewport, including GTK focus, before showing any controls.
      await new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      });
      ready = true;
      await tick();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => void ipc.applianceMark("gate-shown")),
      );
    })();
    if (resuming)
      void ipc
        .applianceOpen("resume", "")
        .then((answer) => {
          if (answer.answer === "ok") opened(null);
          else resuming = false;
        })
        .catch(() => (resuming = false));
  });

  async function power(action: "off" | "reboot") {
    await farewellThen(action, Promise.resolve(), () => ipc.appliancePower(action));
    down = true;
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

<div class:preparing={!ready} inert={!ready} aria-busy={!ready}>
  {#if resuming}
    <Screen title={copy.appliance.wordmark}>
      <p class="note" role="status">{copy.stick.resuming}</p>
    </Screen>
  {:else if down}
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
</div>

<style>
  .preparing {
    opacity: 0;
    pointer-events: none;
  }
</style>
