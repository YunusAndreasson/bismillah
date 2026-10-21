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
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changed, frames, imageFor, root, Vm, type Stick, type Vars } from "./vm.ts";

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
    // An empty library opens on the welcome screen, which has no editor; the guide is a
    // sample document (never saved) to type into. Under software rendering the welcome
    // screen's first frame isn't painted (os/PLAN.md, OS-1 result), so this also gives
    // the screen something to show.
    await vm.key("f1");
    const before = await vm.settled(30);
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

const scenarios: Record<string, () => Promise<void>> = {
  "release-both": () => releaseBoots("release-both", "both"),
  "release-ca2011": () => releaseBoots("release-ca2011", "ca2011"),
  "release-ca2023": () => releaseBoots("release-ca2023", "ca2023"),
  "release-cheap": () => releaseBoots("release-cheap", "both", "cheap"),
  "no-network": releaseSendsNothing,
  "debug-ssd": () => debugInside("ssd"),
  "debug-good": () => debugInside("good"),
  "debug-cheap": () => debugInside("cheap"),
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
