<script lang="ts">
  import { copy } from "../core/copy.ts";
  import * as ipc from "../core/ipc.ts";
  import KeyboardIndicator from "./KeyboardIndicator.svelte";
  import Screen from "./Screen.svelte";
  import { describe, focus } from "./gate.ts";

  /**
   * A setup that was interrupted (os/PLAN.md, *Initialising*): finish it with the same
   * passphrase, or, after a typed confirmation, erase it and start over. The stick
   * holds no texts in this state, which the confirmation says.
   */
  let {
    names,
    opened,
    restarted,
    power,
  }: {
    names: Map<string, string>;
    opened: () => void;
    /** Home is blank again: back to setup. */
    restarted: () => void;
    power: (action: "off" | "reboot") => void;
  } = $props();

  const text = copy.appliance;
  let passphrase = $state("");
  let shown = $state(false);
  let busy = $state(false);
  let problem = $state<string | null>(null);
  let confirming = $state(false);
  let typed = $state("");

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || passphrase === "") return;
    busy = true;
    problem = null;
    try {
      const answer = await ipc.applianceOpen("finish", passphrase);
      if (answer.answer === "ok") {
        passphrase = "";
        opened();
        return;
      }
      problem = answer.answer === "wrong_passphrase" ? text.unlock.wrong : describe(answer);
    } catch {
      problem = text.helperDown;
    }
    passphrase = "";
    busy = false;
  }

  async function startOver(event: SubmitEvent) {
    event.preventDefault();
    if (busy || typed.trim().toLowerCase() !== text.finish.confirmWord) return;
    busy = true;
    problem = null;
    try {
      const answer = await ipc.applianceStartOver();
      if (answer.answer === "ok") {
        restarted();
        return;
      }
      problem = describe(answer);
    } catch {
      problem = text.helperDown;
    }
    busy = false;
  }
</script>

<Screen title={text.finish.title}>
  {#if confirming}
    <form class="column" onsubmit={startOver}>
      <p class="hint">{text.finish.confirmHint}</p>
      <div class="field">
        <label for="confirm">{text.finish.confirmLabel(text.finish.confirmWord)}</label>
        <input
          id="confirm"
          type="text"
          autocomplete="off"
          spellcheck="false"
          use:focus
          bind:value={typed}
        />
      </div>
      <div class="actions">
        <button class="start" type="button" onclick={() => ((confirming = false), (typed = ""))}
          >{text.finish.cancel}</button
        >
        <button
          class="destructive"
          type="submit"
          disabled={busy || typed.trim().toLowerCase() !== text.finish.confirmWord}
          >{text.finish.confirm}</button
        >
      </div>
      <p class={problem ? "problem" : "note"} role={problem ? "alert" : "status"}>
        {problem ?? ""}
      </p>
    </form>
  {:else}
    <form class="column" onsubmit={submit}>
      <p class="hint">{text.finish.hint}</p>
      <div class="field">
        <label for="passphrase">{text.passphrase}</label>
        <input
          id="passphrase"
          type={shown ? "text" : "password"}
          autocomplete="off"
          spellcheck="false"
          aria-describedby="finish-problem"
          use:focus
          bind:value={passphrase}
          disabled={busy}
        />
      </div>
      <label class="check"
        ><input type="checkbox" bind:checked={shown} />{text.showPassphrase}</label
      >
      <KeyboardIndicator {names} />
      <div class="actions">
        <button class="start" type="button" onclick={() => (confirming = true)} disabled={busy}
          >{text.finish.startOver}</button
        >
        <button class="primary" type="submit" disabled={busy || passphrase === ""}
          >{text.finish.submit}</button
        >
      </div>
      <p
        id="finish-problem"
        class={problem ? "problem" : "note"}
        role={problem ? "alert" : "status"}
      >
        {busy ? text.finish.working : (problem ?? "")}
      </p>
    </form>
  {/if}
  <button class="quiet power" type="button" onclick={() => power("off")}>{text.powerOff}</button>
</Screen>
