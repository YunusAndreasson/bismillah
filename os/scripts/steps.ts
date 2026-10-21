/**
 * Steps the VM scenarios (test.ts) and the boot measurements (perf.ts) share: waiting
 * for the debug image's boot marks, and setting up a blank debug stick.
 */
import type { Vm } from "./vm.ts";

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The passphrase for sticks set up on the US layout. */
export const PLAIN = "lantern orbit velvet canyon";

/** The serial log's length now: wait for marks after this point. */
export const here = (vm: Vm) => vm.serial().length;

/** Waits for `BISMILLAH_MARK <name> <uptime>` after `from`; returns the uptime. */
export async function mark(vm: Vm, name: string, seconds: number, from = 0): Promise<number> {
  const m = await vm.waitSerial(new RegExp(`BISMILLAH_MARK ${name} ([\\d.]+)`), seconds, from);
  return Number(m[1]);
}

/**
 * Setup's steps 2 and 3 by keyboard: the passphrase twice, then the time zone and
 * *Set up the stick*. `typed` types the passphrase into the focused field.
 */
export async function passphraseAndCreate(
  vm: Vm,
  typed: (vm: Vm) => Promise<void>,
): Promise<void> {
  await typed(vm);
  await vm.key("tab");
  await typed(vm);
  await sleep(1500); // the strength meter answers
  await vm.key("ret");
  await sleep(1000);
  await vm.key("tab"); // Back
  await vm.key("tab"); // Set up the stick
  await vm.key("ret");
}

/**
 * Sets up a blank debug stick on the US layout without the keyboard step: the choice
 * is placed where setup's first step puts it, and the session restarted.
 */
export async function setUpQuickly(vm: Vm): Promise<void> {
  await mark(vm, "page-gate-shown", 240);
  const from = here(vm);
  await vm.run(
    `echo '{"layouts":"us","options":""}' > /run/bismillah/keyboard.pending && systemctl restart bismillah-session`,
  );
  await mark(vm, "page-gate-shown", 60, from);
  await sleep(1000);
  await passphraseAndCreate(vm, (v) => v.type(PLAIN));
  await mark(vm, "helper-ready", 120, from);
}
