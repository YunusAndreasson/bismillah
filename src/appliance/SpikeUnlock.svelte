<script lang="ts">
  // OS-0 spikes "Unlock in the app" and "Keyboard" (os/PLAN.md): the smallest screen
  // that hands a passphrase to the helper, with a layout and Caps Lock indicator.
  // In setup it also takes the keyboard layouts. The real views are OS-2 work.
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import * as ipc from "../core/ipc.ts";

  let { helper, done }: { helper: ipc.SpikeHelperState; done: () => void } = $props();

  let passphrase = $state("");
  let layouts = $state("se,ara");
  let busy = $state(false);
  let problem = $state<string | null>(null);
  let keyboard = $state<ipc.SpikeKeyboard | null>(null);
  const setup = $derived(helper === "setup");
  const lock = $derived(helper === "lock");
  // Choose layouts first on a stick that has none yet.
  const chooseLayouts = $derived(setup && keyboard !== null && keyboard.layouts.length === 0);
  const layout = $derived(keyboard?.layouts[keyboard.group] ?? keyboard?.layouts[0] ?? "default");

  // autofocus works only at page load; this view also appears later (the lock).
  const focus = (node: HTMLInputElement) => {
    node.focus();
  };

  onMount(() => {
    // OS-0 suspend spike: the lock view is up; the sleep daemon may let the machine sleep.
    if (lock) requestAnimationFrame(() => requestAnimationFrame(() => void ipc.spikeLockPainted()));
    void ipc.spikeKeyboard().then((k) => (keyboard = k));
    const unlisten = listen<ipc.SpikeKeyboard>("spike-keyboard", (e) => (keyboard = e.payload));
    return () => void unlisten.then((stop) => stop());
  });

  async function applyLayouts(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    // On "ok" the session restarts with the new layouts; this page goes with it.
    const answer = await ipc.spikeSetKeyboard(layouts.trim(), "grp:alt_shift_toggle");
    problem = `The helper said: ${answer}`;
    busy = false;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || passphrase === "") return;
    busy = true;
    problem = null;
    try {
      const answer = lock
        ? await ipc.spikeVerify(passphrase)
        : await ipc.spikeUnlock(setup ? "setup" : "unlock", passphrase);
      if (answer === "ok") {
        passphrase = "";
        done();
        return;
      }
      problem =
        answer === "wrong-passphrase"
          ? "That passphrase didn't unlock your texts."
          : `The helper said: ${answer}`;
    } catch (error) {
      problem = `Couldn't reach the helper: ${String(error)}`;
    }
    busy = false;
  }
</script>

<div class="unlock">
  <p class="wordmark" lang="ar" dir="rtl">﷽</p>
  {#if chooseLayouts}
    <form onsubmit={applyLayouts}>
      <label for="layouts">Keyboard layouts</label>
      <input id="layouts" autocomplete="off" use:focus bind:value={layouts} disabled={busy} />
    </form>
  {:else}
    <form onsubmit={submit}>
      <label for="passphrase"
        >{setup ? "Choose a passphrase" : lock ? "Locked" : "Passphrase"}</label
      >
      <input
        id="passphrase"
        type="password"
        autocomplete="off"
        use:focus
        oninput={() => void ipc.spikeMark(`input-length-${String(passphrase.length)}`)}
        bind:value={passphrase}
        disabled={busy}
      />
    </form>
  {/if}
  <p class="indicator">
    {layout} · {keyboard?.rtl ? "right to left" : "left to right"}{keyboard?.caps
      ? " · Caps Lock is on"
      : ""}
  </p>
  <p class="note" role="status">
    {busy ? (setup ? "Setting up…" : lock ? "Checking…" : "Unlocking…") : (problem ?? "")}
  </p>
</div>

<style>
  .unlock {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    height: 100vh;
    color: var(--text-primary);
    background: var(--surface-editor);
  }
  form {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }
  .wordmark {
    font-size: 2.5rem;
    margin: 0 0 1rem;
  }
  label,
  .note,
  .indicator {
    color: var(--text-secondary);
  }
  .note,
  .indicator {
    min-height: 1.5em;
    margin: 0;
  }
  input {
    width: min(22rem, 80vw);
    padding: 0.5rem 0.75rem;
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-panel);
    border: 1px solid var(--border-control);
    border-radius: 4px;
  }
  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
