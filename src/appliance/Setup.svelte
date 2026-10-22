<script lang="ts">
  import { copy } from "../core/copy.ts";
  import * as ipc from "../core/ipc.ts";
  import KeyboardIndicator from "./KeyboardIndicator.svelte";
  import Screen from "./Screen.svelte";
  import { describe, focus } from "./gate.ts";

  /**
   * First-boot setup (os/PLAN.md, OS-2), on the stick itself:
   * 1. the keyboard layouts. cage reads them only when it starts, so choosing them
   *    restarts the session, and setup continues at step 2 after the reload.
   * 2. the passphrase, twice, rated as it is typed. Setup refuses one below zxcvbn's
   *    score 3, can suggest six random words, and says there is no recovery.
   * 3. the time zone. Then the helper formats the stick and the app opens.
   */
  let {
    keyboardChosen,
    current,
    layouts,
    opened,
    power,
    changed,
  }: {
    keyboardChosen: boolean;
    /** The layouts the session runs with now, e.g. "se,ara". */
    current: string;
    layouts: ipc.KeyboardLayout[];
    opened: (timeZone: string) => void;
    power: (action: "off" | "reboot") => void;
    /** Home's state may have changed: the gate asks the helper again. */
    changed: () => void;
  } = $props();

  const text = copy.appliance;
  const SWITCH = "grp:alt_shift_toggle";
  const initial = (() => current.split(","))();
  let step = $state<1 | 2 | 3>((() => (keyboardChosen ? 2 : 1))());
  let first = $state((() => initial[0] || "us")());
  let second = $state((() => initial[1] ?? "")());
  let passphrase = $state("");
  let again = $state("");
  let shown = $state(false);
  let suggested = $state(false);
  let strength = $state<ipc.Strength | null>(null);
  let busy = $state(false);
  let problem = $state<string | null>(null);
  // Continue was pressed before the passphrase was ready: the note says what's missing
  // until the writer changes a field.
  let tried = $state(false);
  let passphraseField = $state<HTMLInputElement>();
  let againField = $state<HTMLInputElement>();

  const zones = Intl.supportedValuesOf("timeZone");
  let timeZone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const names = $derived(new Map(layouts.map((l) => [l.id, l.name])));
  const matches = $derived(passphrase === again);
  const ready = $derived(strength?.enough === true && passphrase !== "" && matches);

  // Rates the passphrase as it changes; a later answer never overwrites a newer one.
  let asked = 0;
  $effect(() => {
    const value = passphrase;
    const ticket = ++asked;
    if (value === "") {
      strength = null;
      return;
    }
    void ipc.applianceStrength(value).then((s) => {
      if (ticket === asked) strength = s;
    });
  });

  async function chooseKeyboard(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    const chosen = second && second !== first ? `${first},${second}` : first;
    if (keyboardChosen && chosen === current) {
      step = 2;
      return;
    }
    busy = true;
    problem = null;
    try {
      // On success the session restarts and this page reloads at step 2.
      const answer = await ipc.applianceSetKeyboard(chosen, chosen.includes(",") ? SWITCH : "");
      problem = describe(answer);
      if (answer.answer === "refused") changed();
    } catch {
      problem = text.helperDown;
      changed();
    }
    busy = false;
  }

  async function suggest() {
    try {
      const words = await ipc.applianceGenerate();
      passphrase = words;
      again = words;
      shown = true;
      suggested = true;
      tried = false;
    } catch {
      problem = text.failed;
    }
  }

  // Continue stays enabled, so the keyboard reaches it; pressed too early, it says why
  // and puts the caret where the passphrase needs changing.
  function choosePassphrase(event: SubmitEvent) {
    event.preventDefault();
    if (ready) {
      tried = false;
      step = 3;
      return;
    }
    tried = true;
    if (passphrase === "" || strength?.enough !== true) passphraseField?.focus();
    else againField?.focus();
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    busy = true;
    problem = null;
    try {
      const answer = await ipc.applianceOpen("setup", passphrase);
      if (answer.answer === "ok") {
        passphrase = "";
        again = "";
        opened(timeZone);
        return;
      }
      problem = describe(answer);
      if (answer.answer === "refused") changed();
      if (answer.answer === "too_weak") step = 2;
    } catch {
      problem = text.helperDown;
      changed();
    }
    busy = false;
  }
</script>

{#if step === 1}
  <Screen title={text.setup.keyboardTitle}>
    <form class="column" onsubmit={chooseKeyboard}>
      <p class="hint">{text.setup.step(1)}</p>
      <p class="hint">{text.setup.keyboardHint}</p>
      <div class="field">
        <label for="first-layout">{text.setup.firstLayout}</label>
        <select id="first-layout" use:focus bind:value={first} disabled={busy}>
          {#each layouts as layout (layout.id)}
            <option value={layout.id}>{layout.name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="second-layout">{text.setup.secondLayout}</label>
        <select id="second-layout" bind:value={second} disabled={busy}>
          <option value="">{text.setup.noSecond}</option>
          {#each layouts as layout (layout.id)}
            <option value={layout.id}>{layout.name}</option>
          {/each}
        </select>
      </div>
      <div class="actions">
        <button class="primary" type="submit" disabled={busy}>{text.setup.continue}</button>
      </div>
      <p class={problem ? "problem" : "note"} role={problem ? "alert" : "status"}>
        {busy ? text.setup.applying : (problem ?? "")}
      </p>
    </form>
    <button class="quiet power" type="button" onclick={() => power("off")}>{text.powerOff}</button>
  </Screen>
{:else if step === 2}
  <Screen title={text.setup.passphraseTitle}>
    <form class="column" onsubmit={choosePassphrase}>
      <p class="hint">{text.setup.step(2)}</p>
      <p class="hint">{text.setup.passphraseHint}</p>
      <div class="field">
        <label for="passphrase">{text.passphrase}</label>
        <input
          id="passphrase"
          type={shown ? "text" : "password"}
          autocomplete="off"
          spellcheck="false"
          aria-describedby="strength"
          use:focus
          bind:this={passphraseField}
          bind:value={passphrase}
          oninput={() => {
            suggested = false;
            tried = false;
          }}
        />
      </div>
      <div class="field">
        <label for="again">{text.setup.again}</label>
        <input
          id="again"
          type={shown ? "text" : "password"}
          autocomplete="off"
          spellcheck="false"
          aria-describedby="strength"
          bind:this={againField}
          bind:value={again}
          oninput={() => (tried = false)}
        />
      </div>
      <div class="row">
        <label class="check"
          ><input type="checkbox" bind:checked={shown} />{text.showPassphrase}</label
        >
        <button type="button" onclick={suggest}>{text.setup.suggest}</button>
      </div>
      <KeyboardIndicator {names} />
      <p id="strength" class="note" role="status">
        {#if tried && passphrase === ""}
          {text.setup.empty}
        {:else if passphrase !== "" && strength && !strength.enough}
          {text.setup.weak}
        {:else if again !== "" && !matches}
          {text.setup.mismatch}
        {:else if tried && again === ""}
          {text.setup.againEmpty}
        {:else if strength?.enough}
          {text.setup.enough}
        {/if}
      </p>
      {#if suggested}<p class="hint">{text.setup.suggested}</p>{/if}
      <p class="statement">{text.setup.noRecovery}</p>
      <div class="actions">
        <button class="start" type="button" onclick={() => (step = 1)}
          >{text.setup.changeKeyboard}</button
        >
        <button class="primary" type="submit">{text.setup.continue}</button>
      </div>
      {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    </form>
    <button class="quiet power" type="button" onclick={() => power("off")}>{text.powerOff}</button>
  </Screen>
{:else}
  <Screen title={text.setup.timeTitle}>
    <form class="column" onsubmit={create}>
      <p class="hint">{text.setup.step(3)}</p>
      <p class="hint">{text.setup.timeHint}</p>
      <div class="field">
        <label for="time-zone">{text.setup.timeZone}</label>
        <select id="time-zone" use:focus bind:value={timeZone} disabled={busy}>
          {#each zones as zone (zone)}
            <option value={zone}>{zone.replaceAll("_", " ")}</option>
          {/each}
        </select>
      </div>
      <div class="actions">
        <button class="start" type="button" onclick={() => (step = 2)} disabled={busy}
          >{text.setup.back}</button
        >
        <button class="primary" type="submit" disabled={busy}>{text.setup.create}</button>
      </div>
      <p class={problem ? "problem" : "note"} role={problem ? "alert" : "status"}>
        {busy ? text.setup.working : (problem ?? "")}
      </p>
    </form>
  </Screen>
{/if}

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .statement {
    margin: 0;
    font-weight: 600;
  }
</style>
