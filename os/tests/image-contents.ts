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
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  esp,
  ESP,
  extractRoot,
  HOME,
  MIB,
  dynamic,
  inTree,
  missingLibraries,
  partitions,
  ROOT,
} from "../scripts/image.ts";
import { images, root } from "../scripts/vm.ts";

type Profile = "release" | "debug";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
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
  extractRoot(image, rootAt, tree);
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

  // The allowlist: nothing the VMs didn't open, the list doesn't declare, or a kept
  // program doesn't need.
  const extra = unexplained(tree, profile);
  check(
    extra.length === 0,
    `${profile}: every file is traced, declared or needed (${extra.length} aren't: ${extra.slice(0, 4).join(" ")})`,
  );
  const missing = missingLibraries(tree).filter((m) => !m.includes("/caca/"));
  check(
    missing.length === 0,
    `${profile}: every program's libraries are there (${missing.slice(0, 3).join(", ") || "none missing"})`,
  );

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
  // By hardware class (mkosi.conf): the stick has no sound. Sound's core comes only as a
  // dependency of a laptop driver (thinkpad_acpi's mute lights).
  const sound = matching(/\/kernel\/sound\/.*\.ko/).filter(
    (p) => !/\/sound\/(soundcore|core\/snd(-rawmidi|-seq-device)?)\.ko/.test(p),
  );
  check(
    sound.length === 0,
    `${profile}: no sound drivers (${sound.slice(0, 3).join(" ") || "none"})`,
  );
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
    // e2fsprogs' scrubber is a shell script, and the stick has no shell; its home is
    // checked by the helper's e2fsck at unlock.
    "e2scrub_reap.service",
    "e2scrub_all.timer",
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
    check(!/BISMILLAH_POWER_SUPPLY/.test(units), `${profile}: the real battery, not a fake`);
    check(!has("/usr/libexec/bismillah-debug-console"), `${profile}: no debug command line`);
    check(!has("/usr/libexec/bismillah-trace"), `${profile}: no file recorder`);
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

/** A glob from allowlist-declared.txt as a regex: "**" crosses folders, "*" and "?" don't. */
function globRe(glob: string): RegExp {
  const map: Record<string, string> = { "**": ".*", "*": "[^/]*", "?": "[^/]" };
  const body = glob
    .split(/(\*\*|\*|\?)/)
    .map((part) => map[part] ?? part.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
    .join("");
  return new RegExp(`^${body}$`);
}

/**
 * The allowlist (OS-4): every file outside /etc, the modules and the firmware is one the
 * system opened in the VMs (allowlist.txt), a declared one (allowlist-declared.txt), or
 * a library a kept program needs. Returns the files that are none of these.
 */
function unexplained(tree: string, profile: Profile): string[] {
  const lines = (name: string) =>
    readFileSync(join(root, "os/mkosi", name), "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*/, "").trim())
      .filter(Boolean);
  const traced = new Set(lines("allowlist.txt"));
  const globs = lines("allowlist-declared.txt")
    .filter((l) => profile === "debug" || !l.startsWith("debug:"))
    .map((l) => globRe(l.replace(/^debug:\s*/, "")));
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(tree, rel))) {
      const p = `${rel}/${name}`;
      const st = lstatSync(join(tree, p));
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && !/^\/(etc|var|boot|efi|usr\/lib\/(modules|firmware))\//.test(p))
        files.push(p);
    }
  };
  walk("");
  const needed = new Set<string>();
  for (const f of files) {
    const d = dynamic(join(tree, f));
    if (!d) continue;
    const dirs = [...d.runpath, "/usr/lib/x86_64-linux-gnu", "/usr/lib", dirname(f)];
    for (const lib of d.needed)
      for (const dir of dirs) {
        const found = inTree(tree, `${dir}/${lib}`);
        if (found) {
          needed.add(found);
          break;
        }
      }
  }
  return files.filter(
    (f) =>
      !traced.has(f) &&
      !needed.has(f) &&
      !globs.some((g) => g.test(f)) &&
      // The dynamic loader isn't a DT_NEEDED entry.
      !/\/ld-linux-x86-64\.so\.2$/.test(f),
  );
}

/**
 * mkosi's initrd, trimmed by os/mkosi/mkosi.initrd.conf (OS-4): nothing it runs lacks a
 * library, and none of what was removed came back.
 */
function checkInitrd(): void {
  const initrd = join(images, "initrd.cpio.zst");
  if (!existsSync(initrd)) return;
  const tree = join(root, "os/out/contents/initrd");
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(tree, { recursive: true });
  execFileSync("sh", ["-c", 'zstd -dc "$1" | (cd "$2" && cpio -idm --quiet)', "sh", initrd, tree]);
  const missing = missingLibraries(tree);
  check(
    missing.length === 0,
    `initrd: every program's libraries are there (${missing.slice(0, 3).join(", ") || "none missing"})`,
  );
  for (const gone of [
    "/usr/bin/perl",
    "/usr/bin/bash",
    "/usr/lib/udev/hwdb.bin",
    "/usr/bin/btrfs",
    "/usr/lib/systemd/systemd-networkd",
  ])
    check(!existsSync(join(tree, gone)), `initrd: no ${gone}`);
  check(
    existsSync(join(tree, "usr/lib/systemd/systemd-veritysetup")),
    "initrd: systemd-veritysetup",
  );
}

const asked = process.argv.slice(2) as Profile[];
const profiles = asked.length
  ? asked
  : (["release", "debug"] as const).filter((p) => existsSync(join(images, `bismillah-${p}.raw`)));
if (profiles.length === 0) throw new Error("no images: run pnpm os:build first");
for (const profile of profiles) checkImage(profile);
checkInitrd();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
