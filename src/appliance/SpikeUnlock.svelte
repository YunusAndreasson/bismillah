<script lang="ts">
  // OS-0 spike "Unlock in the app" (os/PLAN.md): the smallest screen that hands a
  // passphrase to the helper. The real Setup/Unlock view is OS-2 work.
  import * as ipc from "../core/ipc.ts";

  let { helper, done }: { helper: ipc.SpikeHelperState; done: () => void } = $props();

  let passphrase = $state("");
  let busy = $state(false);
  let problem = $state<string | null>(null);
  const setup = $derived(helper === "setup");

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || passphrase === "") return;
    busy = true;
    problem = null;
    try {
      const answer = await ipc.spikeUnlock(setup ? "setup" : "unlock", passphrase);
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

<form class="unlock" onsubmit={submit}>
  <p class="wordmark" lang="ar" dir="rtl">﷽</p>
  <label for="passphrase">{setup ? "Choose a passphrase" : "Passphrase"}</label>
  <!-- svelte-ignore a11y_autofocus -->
  <input
    id="passphrase"
    type="password"
    autocomplete="off"
    autofocus
    bind:value={passphrase}
    disabled={busy}
  />
  <p class="note" role="status">
    {busy ? (setup ? "Setting up…" : "Unlocking…") : (problem ?? "")}
  </p>
</form>

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
  .wordmark {
    font-size: 2.5rem;
    margin: 0 0 1rem;
  }
  label,
  .note {
    color: var(--text-secondary);
  }
  .note {
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
