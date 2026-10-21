<script lang="ts">
  import { copy } from "../core/copy.ts";
  import * as ipc from "../core/ipc.ts";
  import KeyboardIndicator from "./KeyboardIndicator.svelte";
  import Screen from "./Screen.svelte";
  import { describe, focus } from "./gate.ts";

  /**
   * Unlock: the passphrase is the login (os/PLAN.md). A wrong one only says so; the
   * KDF itself limits how fast guesses go, so there is no lockout. `verify` is the same
   * screen for a session restarted while home is open: it checks, and reopens nothing.
   */
  let {
    verb,
    keyboardDamaged,
    names,
    opened,
    power,
  }: {
    verb: "unlock" | "verify";
    keyboardDamaged: boolean;
    names: Map<string, string>;
    opened: () => void;
    power: (action: "off" | "reboot") => void;
  } = $props();

  const text = copy.appliance;
  let passphrase = $state("");
  let shown = $state(false);
  let busy = $state(false);
  let problem = $state<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || passphrase === "") return;
    busy = true;
    problem = null;
    void ipc.applianceMark("unlock-pressed");
    try {
      const answer = await ipc.applianceOpen(verb, passphrase);
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
</script>

<Screen title={verb === "verify" ? text.unlock.lockedTitle : text.passphrase}>
  <form class="column" onsubmit={submit}>
    {#if verb === "verify"}<p class="hint">{text.unlock.lockedHint}</p>{/if}
    <div class="field">
      {#if verb === "verify"}<label for="passphrase">{text.passphrase}</label>{/if}
      <input
        id="passphrase"
        type={shown ? "text" : "password"}
        autocomplete="off"
        spellcheck="false"
        aria-labelledby={verb === "unlock" ? "screen-title" : undefined}
        aria-describedby="unlock-problem"
        use:focus
        bind:value={passphrase}
        disabled={busy}
      />
    </div>
    <label class="check"><input type="checkbox" bind:checked={shown} />{text.showPassphrase}</label>
    <KeyboardIndicator {names} />
    {#if keyboardDamaged}<p class="hint">{text.keyboardDamaged}</p>{/if}
    <div class="actions">
      <button class="primary" type="submit" disabled={busy || passphrase === ""}
        >{text.unlock.submit}</button
      >
    </div>
    <p id="unlock-problem" class={problem ? "problem" : "note"} role={problem ? "alert" : "status"}>
      {busy ? text.unlock.working : (problem ?? "")}
    </p>
  </form>
  <button class="quiet power" type="button" onclick={() => power("off")}>{text.powerOff}</button>
</Screen>
