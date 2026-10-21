/**
 * The stick's VM scenarios (pnpm os:test), on images built by os/scripts/build.sh.
 * The release image is observed only from outside: Secure Boot boots, the screen,
 * typing through QMP, and every frame its network cards send, captured by QEMU. The
 * debug image is inspected from inside, through its root command line.
 *
 *   node os/scripts/test.ts [scenario...]     (default: all)
 *
 * Results go to os/out/test/<scenario>/ and the summary to os/out/test/report.txt.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  changed,
  frames,
  imageFor,
  root,
  stickFrom,
  Vm,
  type BootOptions,
  type Screen,
  type Stick,
  type Vars,
} from "./vm.ts";

const out = join(root, "os/out/test");
const report = join(out, "report.txt");
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function note(line: string): void {
  console.log(line);
  appendFileSync(report, line + "\n");
}

function check(ok: boolean, what: string): void {
  note(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

let failures = 0;

/**
 * The release image boots with Secure Boot on to a settled screen, and the editor
 * answers typing. Returns the seconds from QEMU's start to the settled screen.
 */
async function releaseBoots(name: string, vars: Vars, stick: Stick = "ssd"): Promise<void> {
  const vm = await Vm.boot({ image: imageFor("release"), out: join(out, name), vars, stick });
  try {
    await vm.settled(240);
    const seconds = vm.elapsed() - 2; // settled() waits 2 s of stillness
    await vm.screen("booted");
    // A blank stick opens on setup. Its first step chooses the keyboard (US is chosen)
    // and restarts the session; the second takes the passphrase, typed here.
    await vm.key("tab");
    await vm.key("tab");
    await vm.key("ret");
    await sleep(3000);
    const before = await vm.settled(60);
    await vm.type("Bismillah, the stick boots.");
    await sleep(1500);
    const after = await vm.screen("typed");
    const typed = changed(before, after);
    check(
      typed > 0.0005 && typed < 0.2,
      `${name}: boots (${vars} keys, ${stick} stick) and answers typing (${(typed * 100).toFixed(2)}% of the screen changed)`,
    );
    note(`     ${name}: QEMU start → settled screen ${seconds.toFixed(1)} s`);
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
}

/** The release image sends nothing, on a virtio NIC or on PCIe and USB NICs plugged in while it runs. */
async function releaseSendsNothing(): Promise<void> {
  const vm = await Vm.boot({
    image: imageFor("release"),
    out: join(out, "no-network"),
    nics: true,
  });
  try {
    await vm.settled(240);
    await vm.plugNic("e1000e");
    await sleep(20_000);
    await vm.plugNic("usb-net");
    await sleep(40_000);
    await vm.type("Nothing leaves the stick.");
    await sleep(5_000);
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
  for (const nic of ["virtio", "e1000e", "usb-net"]) {
    const n = frames(join(vm.out, `${nic}.pcap`));
    check(n === 0, `no-network: ${n} frames sent on ${nic}`);
  }
}

/** Inside the debug image: the boot chain, the read-only system, no network, and the boot stages. */
async function debugInside(stick: Stick = "ssd"): Promise<void> {
  const name = `debug-${stick}`;
  const vm = await Vm.boot({ image: imageFor("debug"), out: join(out, name), debug: true, stick });
  try {
    await setUpQuickly(vm);
    await vm.waitSerial(/BISMILLAH_MARK page-editable/, 240);
    await sleep(2000);
    await vm.screen("editor");
    const sb = await vm.run(
      "od -An -tu1 -j4 -N1 /sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c",
    );
    check(sb.trim() === "1", `${name}: Secure Boot on (${sb.trim()})`);
    const lockdown = await vm.run("cat /sys/kernel/security/lockdown");
    check(
      /\[(integrity|confidentiality)\]/.test(lockdown),
      `${name}: kernel lockdown ${lockdown.trim()}`,
    );
    const rootfs = await vm.run("findmnt -no SOURCE,FSTYPE,OPTIONS /");
    check(/^\/dev\/mapper\/root erofs ro/.test(rootfs), `${name}: root ${rootfs.trim()}`);
    const verity = await vm.run(
      "veritysetup status root | grep -E '^ +(status|mode):' | tr -s ' '",
    );
    check(
      /status: verified/.test(verity),
      `${name}: dm-verity ${verity.replace(/\s+/g, " ").trim()}`,
    );
    const efivars = await vm.run("findmnt -no OPTIONS /sys/firmware/efi/efivars");
    check(/^ro,/.test(efivars.trim()), `${name}: efivarfs ${efivars.trim()}`);
    const nets = await vm.run("ls /sys/class/net");
    check(nets.trim() === "lo", `${name}: network interfaces: ${nets.replace(/\s+/g, " ").trim()}`);
    const gettys = await vm.run(
      "systemctl list-units --no-legend --plain '*getty*.service' | wc -l",
    );
    check(gettys.trim() === "0", `${name}: ${gettys.trim()} getty units`);
    const session = await vm.run("systemctl is-active bismillah-session.service");
    check(session.trim() === "active", `${name}: session ${session.trim()}`);
    const app = await vm.run("ps -o user=,args= -C bismillah | head -1");
    check(
      /^writer +\/usr\/bin\/bismillah --appliance/.test(app.trim()),
      `${name}: app ${app.trim()}`,
    );
    const library = await vm.run("ls -ld /home/writer/Texts | cut -d' ' -f1,3");
    check(library.trim() === "drwx------ writer", `${name}: library ${library.trim()}`);
    const commit = await vm.run("cat /usr/share/bismillah/commit");
    note(`     ${name}: app built from ${commit.trim()}`);

    const analyze = await vm.run("systemd-analyze | head -1");
    note(`     ${name}: ${analyze.replace(/\s+/g, " ").trim()}`);
    const marks = [
      ...vm.serial().matchAll(/BISMILLAH_MARK (app-process-start|page-editable) ([\d.]+)/g),
    ];
    for (const m of marks) note(`     ${name}: kernel start → ${m[1]} ${m[2]} s`);
    writeFileSync(
      join(vm.out, "blame.txt"),
      await vm.run("systemd-analyze blame --no-pager | head -20"),
    );
    writeFileSync(
      join(vm.out, "chain.txt"),
      await vm.run("systemd-analyze critical-chain bismillah-session.service --no-pager"),
    );
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
}

// ---- OS-2: the encrypted home, setup and unlock -------------------------------

/** The writer's passphrase in the VMs: Swedish and Arabic letters, then words. */
const PASSPHRASE = "åäö بلا lantern orbit velvet";
/** For the sticks set up on the US layout. */
const PLAIN = "lantern orbit velvet canyon";
const HOME_DEV = "/dev/disk/by-partlabel/bismillah-home";

/**
 * Types PASSPHRASE on the se,ara layouts: å ä ö are Swedish keys ([ ' ;), Alt+Shift
 * switches to Arabic, where f g h are ب ل ا (docs/spikes/os-keyboard.md).
 */
async function typePassphrase(vm: Vm): Promise<void> {
  for (const key of ["bracket_left", "apostrophe", "semicolon"]) await vm.key(key);
  await vm.type(" ");
  await vm.key("alt", "shift");
  for (const key of ["f", "g", "h"]) await vm.key(key);
  await vm.key("alt", "shift");
  await vm.type(" lantern orbit velvet");
}

/** The serial log's length now: wait for marks after this point. */
const here = (vm: Vm) => vm.serial().length;

async function mark(vm: Vm, name: string, seconds: number, from = 0): Promise<number> {
  const m = await vm.waitSerial(new RegExp(`BISMILLAH_MARK ${name} ([\\d.]+)`), seconds, from);
  return Number(m[1]);
}

/** Home's state from the helper itself (debug image). */
async function status(vm: Vm): Promise<{
  home: { state: string; reason?: string };
  keyboard: { layouts: string; source: string };
}> {
  const line = (await vm.run("/usr/libexec/bismillah-helper status"))
    .split("\n")
    .find((l) => l.startsWith("{"));
  return JSON.parse(line ?? "{}") as Awaited<ReturnType<typeof status>>;
}

/**
 * Setup's steps 2 and 3 by keyboard: the passphrase twice, then the time zone and
 * *Set up the stick*. `typed` types the passphrase into the focused field.
 */
async function passphraseAndCreate(vm: Vm, typed: (vm: Vm) => Promise<void>): Promise<void> {
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
async function setUpQuickly(vm: Vm): Promise<void> {
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

/** A file with known text in the library, opened in the editor with Ctrl+P. */
async function openNote(vm: Vm, text: string): Promise<void> {
  await vm.run(
    `printf '%s\\n' '${text}' > /home/writer/Texts/note.md && chown writer:writer /home/writer/Texts/note.md`,
  );
  await sleep(1500);
  await vm.key("ctrl", "p");
  await sleep(800);
  await vm.type("note");
  await sleep(800);
  await vm.key("ret");
  await sleep(1500);
  await vm.key("ctrl", "end");
}

const noteText = (vm: Vm) => vm.run("cat /home/writer/Texts/note.md");

/** Waits until the note on the stick contains `text` (a durable save). */
async function saved(vm: Vm, text: string, seconds = 20): Promise<boolean> {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(1000))
    if ((await noteText(vm)).includes(text)) return true;
  return false;
}

async function boot(name: string, part: string, options: Partial<BootOptions>): Promise<Vm> {
  return Vm.boot({ image: imageFor("debug"), out: join(out, name, part), debug: true, ...options });
}

/**
 * The round trip: setup with se,ara and a Swedish and Arabic passphrase → write and
 * save → power off → a wrong passphrase, then the right one → the text is intact.
 */
async function roundTrip(): Promise<void> {
  const name = "home-round-trip";
  const disk = stickFrom(imageFor("debug"), join(out, name, "stick.raw"));
  let vm = await boot(name, "1-setup", { disk });
  try {
    await mark(vm, "page-gate-shown", 240);
    check((await status(vm)).home.state === "blank", `${name}: a flashed stick is blank`);
    await vm.screen("keyboard");
    // Step 1 by keyboard: type-ahead in each list, then Continue.
    let from = here(vm);
    await vm.type("swedish");
    await vm.key("tab");
    await vm.type("arabic");
    await vm.key("tab");
    await vm.key("ret");
    await mark(vm, "page-gate-shown", 60, from);
    const chosen = await status(vm);
    check(
      chosen.keyboard.layouts === "se,ara" && chosen.keyboard.source === "pending",
      `${name}: layouts chosen before setup wait in RAM (${chosen.keyboard.layouts}, ${chosen.keyboard.source})`,
    );
    const env = await vm.run("cat /run/bismillah/keyboard.env");
    check(/XKB_DEFAULT_LAYOUT=se,ara/.test(env), `${name}: cage restarted with se,ara`);
    await sleep(1000);
    from = here(vm);
    await passphraseAndCreate(vm, typePassphrase);
    const setupStart = await mark(vm, "helper-setup-start", 60, from);
    const ready = await mark(vm, "helper-ready", 120, from);
    await mark(vm, "page-editable", 60, from);
    note(`     ${name}: setup (format, KDF, mkfs, ready) ${(ready - setupStart).toFixed(2)} s`);
    const after = await status(vm);
    check(after.home.state === "unlocked", `${name}: unlocked after setup (${after.home.state})`);
    const header = await vm.run(
      `cryptsetup luksDump ${HOME_DEV} | grep -E '^(Version|Label|\\s+PBKDF|\\s+Memory|\\s+Threads)' | tr -s ' \\t' ' '`,
    );
    note(`     ${name}: header ${header.replace(/\s+/g, " ").trim()}`);
    check(/PBKDF: argon2id/.test(header), `${name}: LUKS2 with Argon2id`);
    const exact = await vm.run(
      `printf '%s' '${PASSPHRASE}' | cryptsetup open --test-passphrase --key-file=- ${HOME_DEV} && echo EXACT`,
    );
    check(
      /EXACT/.test(exact),
      `${name}: the passphrase typed in Swedish and Arabic is exactly ${PASSPHRASE}`,
    );
    const tokens = await vm.run(
      `cryptsetup luksDump --dump-json-metadata ${HOME_DEV} | tr -d ' \\n'`,
    );
    check(
      /"state":"ready"/.test(tokens) && /"layouts":"se,ara"/.test(tokens),
      `${name}: the header holds the state (ready) and the layouts, nothing else readable`,
    );
    const mount = await vm.run("findmnt -no SOURCE,FSTYPE,OPTIONS /home/writer");
    check(
      /bismillah-home ext4 .*nosuid,nodev,noatime/.test(mount),
      `${name}: home mounted ${mount.trim()}`,
    );
    const perms = await vm.run("stat -c '%a %U' /home/writer /home/writer/Texts");
    check(
      perms
        .trim()
        .split("\n")
        .every((l) => l.trim() === "700 writer"),
      `${name}: home and Texts are 0700 writer (${perms.replace(/\s*\n\s*/g, ", ").trim()})`,
    );
    const settings = await vm.run("cat /home/writer/.config/bismillah/settings.toml");
    check(/time_zone = "/.test(settings), `${name}: the time zone is in the encrypted settings`);
    await openNote(vm, "Saved before power off.");
    await vm.type(" Typed on the stick.");
    await vm.key("ctrl", "s");
    check(await saved(vm, "Typed on the stick."), `${name}: the text is saved on the stick`);
    await vm.screen("writing");
  } finally {
    await vm.powerdown();
    vm.pngs();
  }

  vm = await boot(name, "2-unlock", { disk });
  try {
    await mark(vm, "page-gate-shown", 240);
    await sleep(1500);
    await vm.screen("unlock");
    const env = await vm.run("cat /run/bismillah/keyboard.env");
    check(
      /XKB_DEFAULT_LAYOUT=se,ara/.test(env),
      `${name}: the layouts come from the header before unlock`,
    );
    let from = here(vm);
    await vm.type("wrong words");
    await vm.key("ret");
    await sleep(5000);
    await vm.screen("wrong");
    check(
      !/helper-unlocked/.test(vm.serial().slice(from)) && (await status(vm)).home.state === "ready",
      `${name}: a wrong passphrase only fails; home stays ready`,
    );
    from = here(vm);
    await typePassphrase(vm);
    await vm.key("ret");
    const pressed = await mark(vm, "page-unlock-pressed", 30, from);
    const unlocked = await mark(vm, "helper-unlocked", 60, from);
    const editable = await mark(vm, "page-editable", 60, from);
    note(
      `     ${name}: Unlock pressed → home mounted ${(unlocked - pressed).toFixed(2)} s → editor ready ${(editable - pressed).toFixed(2)} s`,
    );
    const text = await noteText(vm);
    check(
      text.includes("Saved before power off.") && text.includes("Typed on the stick."),
      `${name}: the text is intact after power off and unlock`,
    );
    await sleep(2000);
    await vm.screen("unlocked");
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
}

/**
 * Setup stopped after each step, by a power cut or by killing the helper: the next
 * boot finds Initialising (finish or start over) or Ready, never Blank.
 */
async function setupInterrupted(): Promise<void> {
  const cases = [
    { step: "formatted", how: "kill", then: "finish" },
    { step: "filesystem", how: "cut", then: "finish" },
    { step: "marker", how: "cut", then: "start-over" },
    { step: "ready", how: "cut", then: "unlock" },
  ] as const;
  for (const c of cases) {
    const name = `home-halt-${c.step}`;
    const disk = stickFrom(imageFor("debug"), join(out, name, "stick.raw"));
    let vm = await boot(name, "1-setup", { disk });
    try {
      await mark(vm, "page-gate-shown", 240);
      const from = here(vm);
      await vm.run(
        `echo ${c.step} > /run/bismillah/test-halt && echo '{"layouts":"us","options":""}' > /run/bismillah/keyboard.pending && systemctl restart bismillah-session`,
      );
      await mark(vm, "page-gate-shown", 60, from);
      await sleep(1000);
      await passphraseAndCreate(vm, (v) => v.type(PLAIN));
      await mark(vm, `helper-halted-${c.step}`, 120, from);
      if (c.how === "kill") {
        const reload = here(vm);
        await vm.run("rm /run/bismillah/test-halt; kill -9 $(pidof bismillah-helper)");
        await sleep(3000);
        const state = (await status(vm)).home.state;
        check(state === "initialising", `${name}: helper killed after ${c.step} → ${state}`);
        await vm.screen("after-kill");
        // The app asked again, and shows Finish setup; finish it in the same boot.
        await vm.type(PLAIN);
        await vm.key("ret");
        await mark(vm, "helper-ready", 120, reload);
        await mark(vm, "page-editable", 60, reload);
        const done = (await status(vm)).home.state;
        check(done === "unlocked", `${name}: finished with the same passphrase → ${done}`);
        continue;
      }
      await vm.powercut();
    } finally {
      if (c.how === "kill") await vm.powerdown();
      else vm.kill();
      vm.pngs();
    }

    vm = await boot(name, "2-after-cut", { disk });
    try {
      await mark(vm, "page-gate-shown", 240);
      await sleep(1500);
      await vm.screen("after-cut");
      const state = (await status(vm)).home.state;
      const expected = c.step === "ready" ? "ready" : "initialising";
      check(state === expected, `${name}: power cut after ${c.step} → ${state}`);
      const from = here(vm);
      if (c.then === "finish") {
        await vm.type(PLAIN);
        await vm.key("ret");
        await mark(vm, "helper-ready", 120, from);
      } else if (c.then === "unlock") {
        await vm.type(PLAIN);
        await vm.key("ret");
        await mark(vm, "helper-unlocked", 120, from);
      } else {
        // Start over… then the typed confirmation.
        await vm.key("tab"); // Show passphrase
        await vm.key("tab"); // Start over…
        await vm.key("ret");
        await sleep(800);
        await vm.type("start over");
        await vm.key("ret");
        await mark(vm, "page-gate-shown", 30, from).catch(() => 0);
        await sleep(3000);
      }
      const final = (await status(vm)).home.state;
      const want = c.then === "start-over" ? "blank" : "unlocked";
      check(final === want, `${name}: then ${c.then} → ${final}`);
      await vm.screen("after");
    } finally {
      await vm.powerdown();
      vm.pngs();
    }
  }
}

/** sha256 of a block device in the guest. */
const hashOf = async (vm: Vm, dev: string) =>
  (await vm.run(`sha256sum ${dev} | cut -c1-16`)).trim();

/**
 * Damaged or foreign metadata is Unreadable, never Setup, and nothing is written to
 * it; a damaged keyboard token falls back to US and says so.
 */
async function damaged(): Promise<void> {
  const name = "home-damaged";
  const disk = stickFrom(imageFor("debug"), join(out, name, "stick.raw"));
  let vm = await boot(name, "1-setup", { disk });
  try {
    await setUpQuickly(vm);
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
  vm = await boot(name, "2-damage", { disk });
  try {
    await mark(vm, "page-gate-shown", 240);
    const dev = HOME_DEV;
    // The keyboard token: unusable layouts.
    let from = here(vm);
    await vm.run(
      `printf '%s' '{"type":"bismillah-keyboard","keyslots":[],"layouts":"zz;x","options":""}' | cryptsetup token import --token-id 1 --token-replace --json-file - ${dev}; systemctl restart bismillah-session`,
    );
    await mark(vm, "page-gate-shown", 60, from);
    await sleep(1500);
    await vm.screen("keyboard-damaged");
    const kb = await status(vm);
    const env = await vm.run("cat /run/bismillah/keyboard.env | wc -c");
    check(
      kb.keyboard.source === "damaged" && kb.home.state === "ready" && env.trim() === "0",
      `${name}: a damaged keyboard token → ${kb.keyboard.source}, cage on its default (US), home still ${kb.home.state}`,
    );
    // A file system that won't check: the passphrase opens it, and nothing is mounted.
    await vm.run(
      `printf '%s' '${PLAIN}' | cryptsetup open --key-file=- ${dev} probe && dd if=/dev/zero of=/dev/mapper/probe bs=1M count=1 conv=fsync status=none; cryptsetup close probe`,
    );
    from = here(vm);
    await vm.type(PLAIN);
    await vm.key("ret");
    await sleep(8000);
    await vm.screen("file-system-damaged");
    const fs = await status(vm);
    check(
      !/helper-unlocked/.test(vm.serial().slice(from)) && fs.home.state === "ready",
      `${name}: a damaged file system isn't mounted, and home stays ${fs.home.state} (never formatted)`,
    );
    // Header damage, from mild to foreign: each Unreadable.
    const variants: [string, string][] = [
      [
        "an unknown state",
        `printf '%s' '{"type":"bismillah-state","keyslots":[],"state":"formatting"}' | cryptsetup token import --token-id 0 --token-replace --json-file - ${dev}`,
      ],
      ["no state token (someone else's LUKS)", `cryptsetup token remove --token-id 0 ${dev}`],
      ["a garbled header", `dd if=/dev/urandom of=${dev} bs=4k count=8 conv=fsync status=none`],
      ["another file system", `mkfs.ext4 -q -F ${dev}`],
    ];
    for (const [what, command] of variants) {
      await vm.run(command);
      const s = await status(vm);
      check(
        s.home.state === "unreadable",
        `${name}: ${what} → ${s.home.state} (${s.home.reason ?? ""})`,
      );
    }
    const before = await hashOf(vm, dev);
    from = here(vm);
    await vm.run("systemctl restart bismillah-session");
    await mark(vm, "page-gate-shown", 60, from);
    await sleep(1500);
    await vm.screen("unreadable");
    await vm.key("tab");
    await vm.type("anything");
    await vm.key("ret");
    await sleep(3000);
    check(
      (await hashOf(vm, dev)) === before,
      `${name}: nothing was written to the unreadable home`,
    );
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
}

const hostHash = (file: string) =>
  execFileSync("sha256sum", [file], { encoding: "utf8" }).slice(0, 16);

/**
 * Two sticks: a twin of the same build makes the helper refuse; a stick of another
 * build (other partition UUIDs) and its home are never touched.
 */
async function twoSticks(): Promise<void> {
  const name = "home-two-sticks";
  const disk = stickFrom(imageFor("debug"), join(out, name, "stick.raw"));
  const twin = stickFrom(imageFor("debug"), join(out, name, "twin.raw"));
  const twinBefore = hostHash(twin);
  let vm = await boot(name, "1-twin", { disk, others: [twin] });
  try {
    await mark(vm, "page-gate-shown", 240);
    await sleep(1500);
    await vm.screen("twin");
    const s = await status(vm);
    check(
      s.home.state === "not_found" && s.home.reason === "two_sticks",
      `${name}: a twin stick attached → ${s.home.state} (${s.home.reason ?? ""})`,
    );
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
  check(hostHash(twin) === twinBefore, `${name}: the twin's bytes are unchanged`);

  // Another build: every partition and the disk get new UUIDs (sfdisk on the file).
  const other = stickFrom(imageFor("debug"), join(out, name, "other.raw"));
  for (let n = 1; n <= 4; n++)
    execFileSync("sfdisk", ["--quiet", "--part-uuid", other, String(n), randomUUID()]);
  execFileSync("sfdisk", ["--quiet", "--disk-id", other, randomUUID()]);
  const otherBefore = hostHash(other);
  vm = await boot(name, "2-other-build", { disk, others: [other] });
  try {
    await setUpQuickly(vm);
    const s = await status(vm);
    check(
      s.home.state === "unlocked",
      `${name}: with another build's stick attached, its own home is set up (${s.home.state})`,
    );
    const where = await vm.run("cryptsetup status bismillah-home | sed -n 's/ *device: *//p'");
    note(`     ${name}: home opened on ${where.trim()}`);
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
  check(hostHash(other) === otherBefore, `${name}: the other build's stick is unchanged`);
}

/**
 * Saved means saved: after an app crash, a power cut and a pulled stick, every save
 * confirmed before is intact. And a full home fails the save visibly, then recovers.
 */
async function savedMeansSaved(): Promise<void> {
  const name = "home-saved";
  const disk = stickFrom(imageFor("debug"), join(out, name, "stick.raw"));
  let vm = await boot(name, "1-crash", { disk });
  try {
    await setUpQuickly(vm);
    await mark(vm, "page-editable", 60);
    await openNote(vm, "First line.");
    await vm.type(" Saved before the crash.");
    await vm.key("ctrl", "s");
    check(await saved(vm, "Saved before the crash."), `${name}: saved before the crash`);
    await vm.type(" Unsaved at the crash.");
    const from = here(vm);
    await vm.run("pkill -9 -x bismillah");
    // The session starts again, on the lock screen: home is still open.
    await mark(vm, "page-gate-shown", 60, from);
    await sleep(1500);
    await vm.screen("after-crash");
    await vm.type(PLAIN);
    await vm.key("ret");
    await mark(vm, "page-editable", 60, from);
    check(
      (await noteText(vm)).includes("Saved before the crash."),
      `${name}: app killed → the saved text is intact`,
    );

    // A full home: the save fails, and succeeds once there is room again.
    await vm.run(
      "fallocate -l $(df --output=avail -B1 /home/writer | tail -1) /home/writer/filler; sync",
    );
    await vm.key("ctrl", "end");
    await vm.type(" Written while full.");
    await vm.key("ctrl", "s");
    await sleep(4000);
    await vm.screen("full");
    const alive = await vm.run("pidof -s bismillah >/dev/null && echo alive");
    check(
      !(await noteText(vm)).includes("Written while full.") && /alive/.test(alive),
      `${name}: a full home fails the save and the app carries on`,
    );
    await vm.run("rm /home/writer/filler; sync");
    await vm.type("!");
    await vm.key("ctrl", "s");
    check(
      await saved(vm, "Written while full.!"),
      `${name}: with room again, the next save keeps everything`,
    );
    await vm.type(" Saved before the power cut.");
    await vm.key("ctrl", "s");
    check(await saved(vm, "Saved before the power cut."), `${name}: saved before the power cut`);
    await vm.type(" Unsaved at the power cut.");
    await vm.powercut();
  } finally {
    vm.kill();
    vm.pngs();
  }

  vm = await boot(name, "2-power-cut", { disk });
  try {
    await mark(vm, "page-gate-shown", 240);
    const from = here(vm);
    await vm.type(PLAIN);
    await vm.key("ret");
    await mark(vm, "helper-unlocked", 120, from);
    await mark(vm, "page-editable", 60, from);
    check(
      (await noteText(vm)).includes("Saved before the power cut."),
      `${name}: power cut → unlocks (journal replayed) and the saved text is intact`,
    );
    await vm.key("ctrl", "p");
    await sleep(800);
    await vm.type("note");
    await sleep(800);
    await vm.key("ret");
    await sleep(1500);
    await vm.key("ctrl", "end");
    await vm.type(" Saved before the stick was pulled.");
    await vm.key("ctrl", "s");
    check(
      await saved(vm, "Saved before the stick was pulled."),
      `${name}: saved before the stick was pulled`,
    );
    await vm.type(" Unsaved when pulled.");
    await vm.unplug();
    await sleep(5000);
    await vm.powercut();
  } finally {
    vm.kill();
    vm.pngs();
  }

  vm = await boot(name, "3-pulled", { disk });
  try {
    await mark(vm, "page-gate-shown", 240);
    const from = here(vm);
    await vm.type(PLAIN);
    await vm.key("ret");
    await mark(vm, "helper-unlocked", 120, from);
    await mark(vm, "page-editable", 60, from);
    check(
      (await noteText(vm)).includes("Saved before the stick was pulled."),
      `${name}: stick pulled → unlocks and the saved text is intact`,
    );
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
}

/** The release image: setup on a blank stick, then the next boot unlocks it. */
async function releaseSetup(): Promise<void> {
  const name = "release-setup";
  const disk = stickFrom(imageFor("release"), join(out, name, "stick.raw"));
  let vm = await Vm.boot({ image: imageFor("release"), out: join(out, name, "1-setup"), disk });
  try {
    await vm.settled(240);
    await vm.key("tab");
    await vm.key("tab");
    await vm.key("ret");
    await sleep(3000);
    await vm.settled(60);
    await vm.screen("passphrase");
    await passphraseAndCreate(vm, (v) => v.type(PLAIN));
    await sleep(8000);
    const opened = await vm.settled(60);
    await vm.screen("opened");
    await vm.key("f1");
    await vm.type("Typed after setup.");
    await sleep(1500);
    check(
      changed(opened, await vm.screen("typed")) > 0.0005,
      `${name}: set up, and the editor answers typing`,
    );
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
  vm = await Vm.boot({ image: imageFor("release"), out: join(out, name, "2-unlock"), disk });
  try {
    const locked = await vm.settled(240);
    await vm.screen("unlock");
    await vm.type(PLAIN);
    await vm.key("ret");
    await sleep(6000);
    const after = await vm.settled(60);
    await vm.screen("unlocked");
    check(
      changed(locked, after) > 0.005,
      `${name}: the next boot unlocks with the passphrase (${(changed(locked, after) * 100).toFixed(1)}% changed)`,
    );
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
}

// ---- OS-3: lock, suspend and power --------------------------------------------

/** Every process of the app: bismillah and its WebKit processes. */
const APP = "bismillah WebKitWebProcess WebKitNetworkProcess";
const signalApp = (vm: Vm, signal: string) =>
  vm.run(`for p in ${APP}; do pkill -${signal} -x "$p"; done; true`);

const bright = (s: Screen, i: number) =>
  (s.rgb[i] ?? 0) + (s.rgb[i + 1] ?? 0) + (s.rgb[i + 2] ?? 0) > 360;

/**
 * The document's own ink: pixels bright in its screenshot and not in the lock view's
 * (the Basmallah, which both show, drops out). The whole screen is too blunt a
 * measure: a black frame differs from a dark document by only a few percent.
 */
function documentInk(doc: Screen, lock: Screen): number[] {
  const ink: number[] = [];
  for (let i = 0; i < doc.rgb.length; i += 3) if (bright(doc, i) && !bright(lock, i)) ink.push(i);
  return ink;
}

/** A frame that shows the document: most of its ink is there. */
function showsDocument(frame: Screen, doc: Screen, ink: number[]): boolean {
  if (frame.width !== doc.width || frame.height !== doc.height || ink.length === 0) return false;
  return ink.filter((i) => bright(frame, i)).length / ink.length > 0.5;
}

/**
 * Takes frames until `stop` says so (or `seconds` pass), every 0.2 s. Returns how many
 * showed the document; those are kept as `<label>-shown-<n>`.
 */
async function watchFrames(
  vm: Vm,
  label: string,
  doc: Screen,
  ink: number[],
  seconds: number,
  stop: () => Promise<boolean> = () => Promise.resolve(false),
): Promise<{ frames: number; shown: number }> {
  let count = 0;
  let shown = 0;
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(200)) {
    if (await stop()) break;
    const frame = await vm.screen("frame");
    count++;
    if (showsDocument(frame, doc, ink)) {
      shown++;
      await vm.screen(`${label}-shown-${String(shown)}`);
    }
  }
  return { frames: count, shown };
}

/** Types the passphrase at the lock (or a restarted session's Unlock) and waits for
 * the document to come back. */
async function unlockAt(vm: Vm, label: string, doc: Screen): Promise<boolean> {
  await sleep(1000);
  await vm.type(PLAIN);
  await vm.key("ret");
  await sleep(3000);
  const back = await vm.settled(60);
  await vm.screen(`${label}-back`);
  return changed(back, doc) < 0.01;
}

interface SleepCase {
  name: string;
  /** Run as root just before `systemctl suspend`, in the same command. */
  before?: string;
  /** Run once the system has resumed (before the frames after wake are taken). */
  afterWake?: string;
  /** The helper's mark that shows which way it went. */
  expect: string;
}

/**
 * One suspend. While the helper waits for the app (up to 1.5 s) the document may still
 * show; what is on screen once the guest sleeps, and every frame for 8 s after
 * `system_wakeup`, may not. Then the passphrase brings the document back.
 */
async function sleepCase(
  vm: Vm,
  scenario: string,
  c: SleepCase,
  doc: Screen,
  ink: number[],
): Promise<void> {
  const from = here(vm);
  await vm.run(`${c.before ? `${c.before}; ` : ""}systemctl --no-block suspend`);
  const waiting = await watchFrames(vm, `${c.name}-waiting`, doc, ink, 15, () => vm.asleep());
  check(await vm.asleep(), `${scenario} ${c.name}: the system went to sleep`);
  const asleep = await vm.screen(`${c.name}-asleep`);
  await sleep(1000);
  await vm.wakeup();
  // The kernel's own line too: the journal's lines interleave on the serial console,
  // and one can be lost.
  await vm.waitSerial(/BISMILLAH_MARK helper-resumed|PM: suspend exit/, 30, from);
  if (c.afterWake) await vm.run(c.afterWake);
  const after = await watchFrames(vm, `${c.name}-after`, doc, ink, 8);
  const log = vm.serial().slice(from);
  check(
    new RegExp(`BISMILLAH_MARK helper-${c.expect} `).test(log),
    `${scenario} ${c.name}: the helper went the expected way (${c.expect})`,
  );
  const prepared = /BISMILLAH_MARK helper-prepare-sleep ([\d.]+)/.exec(log);
  const released = /BISMILLAH_MARK helper-inhibitor-released ([\d.]+)/.exec(log);
  const decided = prepared && released ? Number(released[1]) - Number(prepared[1]) : NaN;
  check(
    decided < 2.5 && !/inhibitor timeout/i.test(log),
    `${scenario} ${c.name}: decided within logind's delay (${decided.toFixed(2)} s of 5 s)`,
  );
  check(
    !showsDocument(asleep, doc, ink) && after.shown === 0,
    `${scenario} ${c.name}: nothing of the document on screen asleep or in ${String(after.frames)} frames after wake (it showed in ${String(waiting.shown)} of ${String(waiting.frames)} while the helper waited)`,
  );
  check(
    await unlockAt(vm, c.name, doc),
    `${scenario} ${c.name}: the passphrase brings the document back`,
  );
}

/**
 * The lock (os/PLAN.md, OS-3): the Lock command, the app reconnecting to a restarted
 * helper, and suspend with the app normal, frozen, continued late, crashed or
 * disconnected. S3 in QEMU, with `system_wakeup`.
 */
async function suspendLock(): Promise<void> {
  const name = "suspend-lock";
  const vm = await boot(name, "run", { s3: true });
  try {
    await setUpQuickly(vm);
    await mark(vm, "page-editable", 60);
    await openNote(vm, "The text that must never show while the stick is locked.");
    await vm.type(" More words.");
    await sleep(3000);
    const doc = await vm.settled(30);
    await vm.screen("document");

    // Lock, from the command palette.
    let from = here(vm);
    await vm.key("ctrl", "shift", "p");
    await sleep(800);
    await vm.type("lock");
    await sleep(800);
    await vm.key("ret");
    await mark(vm, "page-lock-painted", 15, from);
    const lock = await vm.settled(20);
    await vm.screen("lock-view");
    const ink = documentInk(doc, lock);
    check(
      ink.length > 500 && !showsDocument(lock, doc, ink),
      `${name}: Lock covers the document (${String(ink.length)} pixels of its text gone)`,
    );
    await vm.key("ctrl", "n");
    await sleep(1000);
    check(
      changed(await vm.screen("lock-shortcut"), lock) < 0.01,
      `${name}: shortcuts don't act behind the lock`,
    );
    check(await unlockAt(vm, "lock", doc), `${name}: the passphrase unlocks it`);

    // The connection drops (the helper restarts): the lock goes up at once.
    from = here(vm);
    await vm.run("systemctl restart bismillah-helper.service");
    await mark(vm, "page-lock-painted", 10, from);
    check(true, `${name}: a dropped connection locks the app`);
    check(await unlockAt(vm, "dropped", doc), `${name}: and the passphrase unlocks it`);

    const cases: SleepCase[] = [
      { name: "normal", expect: "locked-before-sleep" },
      {
        name: "frozen",
        before: `for p in ${APP}; do pkill -STOP -x "$p"; done`,
        expect: "restart-session",
      },
      {
        name: "late",
        before: `for p in ${APP}; do pkill -STOP -x "$p"; done`,
        afterWake: `for p in ${APP}; do pkill -CONT -x "$p"; done`,
        expect: "late-lock-painted",
      },
      { name: "crashed", before: "pkill -9 -x bismillah; sleep 0.3", expect: "inhibitor-released" },
      // The connection drops (the helper is killed): the app locks itself, reconnects
      // to the helper systemd starts again, and the next sleep still waits for it.
      {
        name: "disconnected",
        before: "systemctl kill -s KILL bismillah-helper.service; sleep 3",
        expect: "locked-before-sleep",
      },
    ];
    for (const c of cases) {
      try {
        await sleepCase(vm, name, c, doc, ink);
      } catch (error) {
        check(false, `${name} ${c.name}: ${String(error)}`);
        await signalApp(vm, "CONT").catch(() => undefined);
      }
    }
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
}

/**
 * Power: low battery warns at 10% and at 3% saves and powers off (a fake battery
 * the debug session reads); Power off (Ctrl+Q) saves and powers off cleanly. Each next boot finds
 * the text and a clean file system.
 */
async function power(): Promise<void> {
  const name = "power";
  const disk = stickFrom(imageFor("debug"), join(out, name, "stick.raw"));
  let vm = await boot(name, "1-battery", { disk });
  // The debug session reads its battery here (QEMU has none, Debian no test_power).
  const battery = "/run/bismillah-power/BAT0";
  try {
    await setUpQuickly(vm);
    await mark(vm, "page-editable", 60);
    await openNote(vm, "First line.");
    let from = here(vm);
    await vm.run(
      `mkdir -p ${battery} && echo Battery > ${battery}/type && echo Discharging > ${battery}/status && echo 9 > ${battery}/capacity`,
    );
    await mark(vm, "page-battery-low", 60, from);
    await sleep(1000);
    await vm.screen("battery-low");
    check(true, `${name}: a notice at 9%`);
    await vm.type(" Unsaved when the battery ran down.");
    from = here(vm);
    await vm.run(`echo 3 > ${battery}/capacity`);
    await mark(vm, "page-battery-critical", 60, from);
    await mark(vm, "helper-power-poweroff", 30, from);
    for (let i = 0; vm.running && i < 600; i++) await sleep(100);
    check(!vm.running, `${name}: at 3% it powers off`);
  } finally {
    vm.kill();
    vm.pngs();
  }

  vm = await boot(name, "2-power-off", { disk });
  try {
    await mark(vm, "page-gate-shown", 240);
    const from = here(vm);
    await vm.type(PLAIN);
    await vm.key("ret");
    await mark(vm, "page-editable", 60, from);
    check(
      (await noteText(vm)).includes("Unsaved when the battery ran down."),
      `${name}: it saved before powering off`,
    );
    check(/helper\[\d+\]: texts: clean,/.test(vm.serial().slice(from)), `${name}: home was left clean`);
    await vm.key("ctrl", "p");
    await sleep(800);
    await vm.type("note");
    await sleep(800);
    await vm.key("ret");
    await sleep(1500);
    await vm.key("ctrl", "end");
    await vm.type(" Typed before Power off.");
    await vm.key("ctrl", "q");
    for (let i = 0; vm.running && i < 600; i++) await sleep(100);
    check(!vm.running, `${name}: Ctrl+Q powers off`);
  } finally {
    vm.kill();
    vm.pngs();
  }

  vm = await boot(name, "3-after", { disk });
  try {
    await mark(vm, "page-gate-shown", 240);
    const from = here(vm);
    await vm.type(PLAIN);
    await vm.key("ret");
    await mark(vm, "page-editable", 60, from);
    check(
      (await noteText(vm)).includes("Typed before Power off."),
      `${name}: Power off saved first`,
    );
    check(/helper\[\d+\]: texts: clean,/.test(vm.serial().slice(from)), `${name}: home was left clean`);
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
}

const scenarios: Record<string, () => Promise<void>> = {
  "release-both": () => releaseBoots("release-both", "both"),
  "release-ca2011": () => releaseBoots("release-ca2011", "ca2011"),
  "release-ca2023": () => releaseBoots("release-ca2023", "ca2023"),
  "release-cheap": () => releaseBoots("release-cheap", "both", "cheap"),
  "no-network": releaseSendsNothing,
  "debug-ssd": () => debugInside("ssd"),
  "debug-good": () => debugInside("good"),
  "debug-cheap": () => debugInside("cheap"),
  "release-setup": releaseSetup,
  "home-round-trip": roundTrip,
  "home-interrupted": setupInterrupted,
  "home-damaged": damaged,
  "home-two-sticks": twoSticks,
  "home-saved": savedMeansSaved,
  "suspend-lock": suspendLock,
  power,
};

const chosen = process.argv.slice(2);
mkdirSync(out, { recursive: true });
writeFileSync(report, `# bismillah OS VM scenarios, ${new Date().toISOString()}\n`);
// One VM at a time: parallel runs stall OVMF.
for (const name of chosen.length ? chosen : Object.keys(scenarios)) {
  const run = scenarios[name];
  if (!run)
    throw new Error(`unknown scenario ${name}; known: ${Object.keys(scenarios).join(", ")}`);
  try {
    await run();
  } catch (error) {
    check(false, `${name}: ${String(error)}`);
  }
}
note(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
