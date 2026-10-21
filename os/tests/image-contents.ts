/**
 * What the stick's images contain (os/PLAN.md, OS-1): no shell (release), no package
 * manager, nothing to log in with, no network drivers or firmware, no fallback boot
 * loader, a boot menu nobody can edit, and in release no serial console, no debug
 * command line and no boot marks. Reads the images built by os/scripts/build.sh
 * without mounting them: the root with fsck.erofs, the ESP with mtools from mkosi's
 * tools tree.
 *
 *   node os/tests/image-contents.ts [release|debug...]   (default: both that exist)
 */
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { images, root } from "../scripts/vm.ts";

type Profile = "release" | "debug";

const ESP = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
const ROOT = "4f68bce3-e8cd-4db1-96e7-fbcaf984b709"; // root, x86-64
const HOME = "933ac7e1-2eb4-4f13-b844-0e14e2aef915";
const MIB = 1024 * 1024;

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

function guid(b: Buffer): string {
  const h = b.toString("hex");
  const swap = (s: string) => s.match(/../g)?.reverse().join("") ?? "";
  return `${swap(h.slice(0, 8))}-${swap(h.slice(8, 12))}-${swap(h.slice(12, 16))}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface Part {
  /** Byte offset and size on the image. */
  offset: number;
  bytes: number;
  /** The GPT attribute flags (bit 63: no-auto). */
  flags: bigint;
}

/** Each partition type on the image (GPT, 512-byte sectors). */
function partitions(image: string): Map<string, Part> {
  const fd = openSync(image, "r");
  try {
    const header = Buffer.alloc(92);
    readSync(fd, header, 0, 92, 512);
    if (header.toString("latin1", 0, 8) !== "EFI PART") throw new Error(`${image}: no GPT`);
    const start = Number(header.readBigUInt64LE(72)) * 512;
    const count = header.readUInt32LE(80);
    const size = header.readUInt32LE(84);
    const table = Buffer.alloc(count * size);
    readSync(fd, table, 0, table.length, start);
    const found = new Map<string, Part>();
    for (let i = 0; i < count; i++) {
      const entry = table.subarray(i * size, (i + 1) * size);
      const type = guid(entry.subarray(0, 16));
      if (type !== "00000000-0000-0000-0000-000000000000")
        found.set(type, {
          offset: Number(entry.readBigUInt64LE(32)) * 512,
          bytes: Number(entry.readBigUInt64LE(40) - entry.readBigUInt64LE(32) + 1n) * 512,
          flags: entry.readBigUInt64LE(48),
        });
    }
    return found;
  } finally {
    closeSync(fd);
  }
}

/** Whether `length` bytes of the image from `offset` are all zero. */
function zeros(image: string, offset: number, length: number): boolean {
  const fd = openSync(image, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, offset);
    return buffer.every((b) => b === 0);
  } finally {
    closeSync(fd);
  }
}

/** Every path in a tree, relative and with a leading slash. */
function walk(dir: string, base = dir, paths: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    paths.push("/" + relative(base, path));
    if (lstatSync(path).isDirectory()) walk(path, base, paths);
  }
  return paths;
}

function esp(image: string, offset: number, args: string[]): string {
  return execFileSync(
    "mkosi",
    [
      "-C",
      join(root, "os/mkosi"),
      "sandbox",
      "--",
      ...args.map((a) => a.replace("@IMG", `${image}@@${offset}`)),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function checkImage(profile: Profile): void {
  const image = join(images, `bismillah-${profile}.raw`);
  const parts = partitions(image);
  const rootAt = parts.get(ROOT)?.offset;
  const espAt = parts.get(ESP)?.offset;
  check(rootAt !== undefined && espAt !== undefined, `${profile}: has an ESP and an x86-64 root`);
  if (rootAt === undefined || espAt === undefined) return;
  // Home: flashed as zeros, which the helper reads as Blank, and never auto-mounted.
  const home = parts.get(HOME);
  check(home !== undefined && home.flags >> 63n === 1n, `${profile}: home is marked no-auto`);
  if (home)
    check(
      zeros(image, home.offset, 8 * MIB) && zeros(image, home.offset + home.bytes - MIB, MIB),
      `${profile}: home is blank (zeros) as flashed`,
    );

  // The root, extracted without owners (we aren't root), into os/out/contents/.
  const tree = join(root, "os/out/contents", profile);
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(dirname(tree), { recursive: true });
  execFileSync("fsck.erofs", [
    `--offset=${rootAt}`,
    `--extract=${tree}`,
    "--no-preserve",
    "-d0",
    image,
  ]);
  const paths = walk(tree);
  const has = (p: string) => existsSync(join(tree, p)) || isLink(join(tree, p));
  const matching = (re: RegExp) => paths.filter((p) => re.test(p));
  // Links in the image point into the image, so they dangle here: read files only.
  const text = (p: string) => {
    const path = join(tree, p);
    return existsSync(path) && !isLink(path) ? readFileSync(path, "utf8") : "";
  };
  const masked = (unit: string) => {
    const p = join(tree, "etc/systemd/system", unit);
    return isLink(p) && readlinkSync(p) === "/dev/null";
  };

  // Nothing to log in with, no package manager.
  for (const bin of ["apt", "apt-get", "dpkg", "agetty", "login", "su", "sudo", "sulogin"])
    check(!has(`/usr/bin/${bin}`) && !has(`/usr/sbin/${bin}`), `${profile}: no ${bin}`);
  check(!has("/var/lib/dpkg") && !has("/var/lib/apt"), `${profile}: no package database`);
  if (profile === "release")
    for (const shell of ["sh", "bash", "dash", "rbash", "perl"])
      check(!has(`/usr/bin/${shell}`), `${profile}: no ${shell}`);

  // No network drivers, network stacks for radios, or network firmware.
  const modules = matching(/\.ko(\.[a-z]+)?$/);
  const netModules = modules.filter((p) =>
    /\/kernel\/(drivers\/(net|bluetooth|nfc|infiniband|isdn|atm)\/|net\/(bluetooth|wireless|mac80211|nfc|can)\/)/.test(
      p,
    ),
  );
  check(
    netModules.length === 0,
    `${profile}: no network modules (${netModules.slice(0, 5).join(" ") || "none"})`,
  );
  for (const name of [
    "iwlwifi",
    "bluetooth",
    "e1000e",
    "r8169",
    "virtio_net",
    "usbnet",
    "cfg80211",
  ])
    check(
      !modules.some((p) => new RegExp(`/${name}\\.ko`).test(p)),
      `${profile}: no ${name} module`,
    );
  check(modules.length > 100, `${profile}: ${modules.length} modules in all`);
  const firmware = readdirSync(join(tree, "usr/lib/firmware")).sort();
  const gpu = /^(i915|xe|amdgpu|radeon|nvidia|amd|intel|regulatory\.db.*|.*\.(txt|md))$/;
  const other = firmware.filter((f) => !gpu.test(f));
  check(other.length === 0, `${profile}: only GPU firmware (${firmware.join(" ")})`);
  const radios = matching(
    /\/usr\/lib\/firmware\/.*(iwlwifi|rtl_nic|rtlwifi|ath[0-9]|brcm|mt76|bnx2|tigon|e100)/,
  );
  check(
    radios.length === 0,
    `${profile}: no network firmware files (${radios.slice(0, 3).join(" ") || "none"})`,
  );

  // The units: no getty anywhere; release logs nothing and has no debug pieces.
  for (const unit of [
    "getty@.service",
    "serial-getty@.service",
    "autovt@.service",
    "systemd-networkd.service",
    "systemd-resolved.service",
    "systemd-timesyncd.service",
  ])
    check(masked(unit), `${profile}: ${unit} masked`);
  // The laptop's TPM and firmware are the host's: nothing measures into, stores keys in,
  // or deletes crash records from them. And GRUB's suspend hook never runs.
  for (const unit of [
    "systemd-tpm2-setup.service",
    "systemd-tpm2-setup-early.service",
    "systemd-pcrlock-make-policy.service",
    "systemd-pcrphase.service",
    "systemd-pcrextend.socket",
    "systemd-pstore.service",
    "grub-common.service",
  ])
    check(masked(unit), `${profile}: ${unit} masked`);
  check(
    /NAutoVTs=0/.test(text("/etc/systemd/logind.conf.d/bismillah.conf")),
    `${profile}: NAutoVTs=0`,
  );
  check(/efivarfs .* ro,/.test(text("/etc/fstab")), `${profile}: efivarfs read-only`);
  check(/kernel\.sysrq = 0/.test(text("/etc/sysctl.d/50-bismillah.conf")), `${profile}: no SysRq`);
  const session = text("/etc/systemd/system/bismillah-session.service");
  check(
    /ExecStart=\/usr\/bin\/cage -d -- \/usr\/bin\/bismillah --appliance/.test(session),
    `${profile}: the session runs bismillah --appliance under cage`,
  );
  check(
    has("/usr/bin/bismillah") && has("/usr/share/bismillah/commit"),
    `${profile}: the app and its commit`,
  );
  // The helper (OS-2): socket-activated, only for the writer, and its tools.
  check(has("/usr/libexec/bismillah-helper"), `${profile}: the helper`);
  const socket = text("/etc/systemd/system/bismillah-helper.socket");
  check(
    /SocketUser=writer/.test(socket) && /SocketMode=0600/.test(socket),
    `${profile}: the helper's socket is the writer's alone`,
  );
  check(
    isLink(join(tree, "etc/systemd/system/sockets.target.wants/bismillah-helper.socket")),
    `${profile}: the helper's socket is enabled`,
  );
  for (const tool of [
    "/usr/sbin/cryptsetup",
    "/usr/sbin/mkfs.ext4",
    "/usr/sbin/e2fsck",
    "/usr/sbin/blkid",
    "/usr/bin/lsblk",
  ])
    check(has(tool), `${profile}: ${tool}`);
  check(
    /ExecStartPre=\+\/usr\/libexec\/bismillah-helper keyboard-env/.test(session) &&
      /XDG_DATA_HOME=\/run\//.test(session),
    `${profile}: cage's layouts come from the helper, and XDG data stays in RAM`,
  );
  check(
    /^tmpfs \/home tmpfs/m.test(text("/etc/fstab")),
    `${profile}: /home is RAM until the helper mounts the writer's home`,
  );
  const units = matching(/^\/(etc|usr\/lib)\/systemd\/system\/.*\.(service|conf)$/)
    .map((p) => text(p))
    .join("\n");
  check(!/WEBKIT_INSPECTOR/.test(units), `${profile}: nothing opens WebKit's inspector`);
  if (profile === "release") {
    check(!/BISMILLAH_MARKS/.test(units), `${profile}: no boot marks`);
    check(!has("/usr/libexec/bismillah-debug-console"), `${profile}: no debug command line`);
    for (const unit of [
      "systemd-journald.service",
      "systemd-journald.socket",
      "emergency.service",
      "rescue.service",
      "debug-shell.service",
    ])
      check(masked(unit), `${profile}: ${unit} masked`);
    check(
      /LogTarget=null/.test(text("/etc/systemd/system.conf.d/50-release.conf")),
      `${profile}: systemd logs nowhere`,
    );
  }

  // The ESP: shim, systemd-boot, the kernel; no fallback loader; no menu to edit.
  const listing = esp(image, espAt, ["mdir", "-/", "-b", "-i", "@IMG", "::"]);
  check(/BOOTX64\.EFI/i.test(listing), `${profile}: ESP has shim as EFI/BOOT/BOOTX64.EFI`);
  check(
    !/fbx64\.efi/i.test(listing),
    `${profile}: ESP has no fbx64.efi (shim's fallback would write boot entries)`,
  );
  const loader = esp(image, espAt, ["mtype", "-i", "@IMG", "::/loader/loader.conf"]);
  check(
    /^timeout 0$/m.test(loader) && /^editor no$/m.test(loader),
    `${profile}: loader.conf timeout 0, editor no`,
  );
  const entries = listing.split("\n").filter((l) => /\/loader\/entries\/.*\.conf$/i.test(l.trim()));
  const options = entries
    .map((e) => esp(image, espAt, ["mtype", "-i", "@IMG", e.trim()]))
    .join("\n");
  check(entries.length === 1, `${profile}: one boot entry`);
  check(
    /roothash=/.test(options) && /noresume/.test(options),
    `${profile}: the entry has roothash= and noresume`,
  );
  if (profile === "release")
    check(
      !/console=ttyS/.test(options) && /quiet/.test(options),
      `${profile}: no serial console, quiet`,
    );
  else check(/console=ttyS0/.test(options), `${profile}: serial console on ttyS0`);
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

const asked = process.argv.slice(2) as Profile[];
const profiles = asked.length
  ? asked
  : (["release", "debug"] as const).filter((p) => existsSync(join(images, `bismillah-${p}.raw`)));
if (profiles.length === 0) throw new Error("no images: run pnpm os:build first");
for (const profile of profiles) checkImage(profile);
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
