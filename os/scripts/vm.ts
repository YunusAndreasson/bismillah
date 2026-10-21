/**
 * The stick's VM harness (os/PLAN.md, *Development environment*): boots an image
 * headless in OVMF with Secure Boot on and Microsoft keys, the stick as USB storage on
 * xHCI, and drives it over QMP (screendumps, typing, hot-plugging network cards). The
 * debug image also has its serial console on a log and a root command line on the
 * second serial port. Nothing opens on the author's desktop unless `--window` is given.
 *
 * As a command (pnpm os:vm):
 *   node os/scripts/vm.ts [--debug] [--window] [--vars both|ca2011|ca2023] [--stick ssd|good|cheap]
 * boots os/out/image/bismillah-<profile>.raw and stays until the VM powers off.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const images = join(root, "os/out/image");

/** Firmware variable sets: Microsoft KEK 2011 + 2023, and this db (docs/spikes/os-signed-boot.md). */
export type Vars = "both" | "ca2011" | "ca2023";
/**
 * Stick speeds. Each request costs one operation whatever its size, so small random
 * reads meet the request limit and long sequential ones the bandwidth limit.
 */
export type Stick = "ssd" | "good" | "cheap";
const throttle: Record<Stick, string> = {
  ssd: "",
  good: ",throttling.bps-read=157286400,throttling.iops-read=2500",
  cheap: ",throttling.bps-read=26214400,throttling.iops-read=400",
};

export interface BootOptions {
  /** The image to boot; a throwaway copy is booted, never the image itself. */
  image: string;
  /**
   * A stick that lasts across boots (made by `stickFrom`), booted as it is instead of a
   * copy of `image`, so its home survives power-offs and power cuts.
   */
  disk?: string;
  /** More USB disks attached, not booted: a second stick, or a decoy. */
  others?: string[];
  /** Where the logs, captures and the copy go. Emptied first. */
  out: string;
  vars?: Vars;
  stick?: Stick;
  /** The debug image: a root command line on the second serial port. */
  debug?: boolean;
  /** A virtio NIC, its frames captured outside the guest; plus a slot to hot-plug a PCIe NIC. */
  nics?: boolean;
  /** Show the VM in a window (the author only). */
  window?: boolean;
}

const code = "/usr/share/edk2/x64/OVMF_CODE.secboot.4m.fd";
const blankVars = "/usr/share/edk2/x64/OVMF_VARS.4m.fd";
const certs = "/usr/lib/python3.14/site-packages/virt/firmware/certs/microsoft.com";
const microsoft = "77fa9abd-0359-4d32-bd60-28f4e78f784b";

/** Builds a firmware variable set once, into os/out/vars/. */
export function varsFile(vars: Vars): string {
  const file = join(root, "os/out/vars", `${vars}.fd`);
  if (existsSync(file)) return file;
  mkdirSync(dirname(file), { recursive: true });
  const db =
    vars === "both"
      ? ["--microsoft-db", "uefi11"]
      : vars === "ca2023"
        ? ["--microsoft-db", "uefi23"]
        : // virt-fw-vars' uefi11 profile also adds the 2023 CA, so 2011-only is by hand.
          [
            "--microsoft-db",
            "none",
            "--add-db",
            microsoft,
            join(certs, "ms-uefi-2011.pem"),
            "--add-db",
            microsoft,
            join(certs, "windows-2011.pem"),
          ];
  execFileSync("virt-fw-vars", [
    "-i",
    blankVars,
    "-o",
    file,
    "--enroll-microsoft",
    "--microsoft-kek",
    "all",
    ...db,
    "--sb",
  ]);
  return file;
}

/** An RGB screendump. */
export interface Screen {
  width: number;
  height: number;
  rgb: Buffer;
}

function readPpm(file: string): Screen {
  const data = readFileSync(file);
  // "P6\n<width> <height>\n255\n" then the pixels.
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(data.subarray(0, 64).toString("latin1"));
  if (!header?.[1] || !header[2]) throw new Error(`not a PPM screendump: ${file}`);
  return {
    width: Number(header[1]),
    height: Number(header[2]),
    rgb: data.subarray(header[0].length),
  };
}

/** The fraction of pixels that differ between two screens of the same size. */
export function changed(a: Screen, b: Screen): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let differ = 0;
  for (let i = 0; i < a.rgb.length; i += 3)
    if (a.rgb[i] !== b.rgb[i] || a.rgb[i + 1] !== b.rgb[i + 1] || a.rgb[i + 2] !== b.rgb[i + 2])
      differ++;
  return differ / (a.width * a.height);
}

/** The fraction of pixels that aren't black. */
export function lit(s: Screen): number {
  let n = 0;
  for (let i = 0; i < s.rgb.length; i += 3)
    if ((s.rgb[i] ?? 0) + (s.rgb[i + 1] ?? 0) + (s.rgb[i + 2] ?? 0) > 24) n++;
  return n / (s.width * s.height);
}

/** Frames in a pcap file (QEMU's filter-dump). */
export function frames(file: string): number {
  if (!existsSync(file)) return 0;
  const d = readFileSync(file);
  let n = 0;
  for (let i = 24; i + 16 <= d.length; i += 16 + d.readUInt32LE(i + 8)) n++;
  return n;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const SHIFTED: Record<string, string> = { "!": "1", "?": "slash", ":": "semicolon" };
const PLAIN: Record<string, string> = {
  " ": "spc",
  ".": "dot",
  ",": "comma",
  "\n": "ret",
  "-": "minus",
  "/": "slash",
  "'": "apostrophe",
};

export class Vm {
  readonly out: string;
  readonly serialLog: string;
  readonly started = Date.now();
  private readonly qemu: ChildProcess;
  private readonly qmpPath: string;
  private readonly cmdPath: string | null;
  private readonly throwaway: string | null;
  private qmpSocket: Socket | null = null;
  private qmpBuffer = "";
  private readonly waiting: ((reply: Record<string, unknown>) => void)[] = [];
  private exited = false;
  private commands = 0;

  private constructor(options: BootOptions) {
    const out = resolve(options.out);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    this.out = out;
    this.serialLog = join(out, "serial.log");
    writeFileSync(this.serialLog, "");
    const stick = options.disk ?? join(out, "stick.raw");
    this.throwaway = options.disk ? null : stick;
    if (!options.disk) execFileSync("cp", ["--sparse=always", options.image, stick]);
    copyFileSync(varsFile(options.vars ?? "both"), join(out, "vars.fd"));
    // An unflushed copy on the encrypted host disk stalls the firmware's reads.
    execFileSync("sync");
    // Unix socket paths are limited to 108 bytes, so they live in the runtime directory.
    const run = process.env["XDG_RUNTIME_DIR"] ?? tmpdir();
    const id = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this.qmpPath = join(run, `bismillah-qmp-${id}`);
    this.cmdPath = options.debug ? join(run, `bismillah-cmd-${id}`) : null;

    const args = [
      ...["-machine", "q35,smm=on,accel=kvm", "-cpu", "host", "-smp", "2", "-m", "2G"],
      ...["-global", "driver=cfi.pflash01,property=secure,value=on"],
      ...["-drive", `if=pflash,format=raw,unit=0,readonly=on,file=${code}`],
      ...["-drive", `if=pflash,format=raw,unit=1,file=${join(out, "vars.fd")}`],
      ...["-device", "qemu-xhci,id=xhci"],
      ...[
        "-drive",
        `if=none,id=stick,format=raw,cache=none,aio=native,file=${stick}${throttle[options.stick ?? "ssd"]}`,
      ],
      ...["-device", "usb-storage,bus=xhci.0,drive=stick,bootindex=0,id=stickdev"],
      ...(options.others ?? []).flatMap((disk, i) => [
        ...["-drive", `if=none,id=other${i},format=raw,cache=none,aio=native,file=${disk}`],
        ...["-device", `usb-storage,bus=xhci.0,drive=other${i}`],
      ]),
      ...["-device", "virtio-vga"],
      ...(options.window ? [] : ["-display", "none"]),
      "-no-reboot",
      ...["-qmp", `unix:${this.qmpPath},server=on,wait=off`],
      ...["-serial", `file:${this.serialLog}`],
      ...(this.cmdPath ? ["-serial", `unix:${this.cmdPath},server=on,wait=off`] : []),
      ...(options.nics
        ? [
            ...["-device", "pcie-root-port,id=rp1,chassis=1,slot=1"],
            // User-mode and restricted: nothing reaches the host's network, whatever is sent.
            ...["-netdev", "user,id=n0,restrict=on", "-device", "virtio-net-pci,netdev=n0"],
            ...["-object", `filter-dump,id=d0,netdev=n0,file=${join(out, "virtio.pcap")}`],
          ]
        : ["-nic", "none"]),
    ];
    this.qemu = spawn("qemu-system-x86_64", args, { stdio: ["ignore", "inherit", "inherit"] });
    this.qemu.on("exit", () => (this.exited = true));
  }

  /**
   * Boots, up to three times if the firmware doesn't find the stick: OVMF sometimes
   * reports "No bootable option" for a stick it boots the next time (seen since OS-0).
   */
  static async boot(options: BootOptions): Promise<Vm> {
    for (let attempt = 1; ; attempt++) {
      const vm = await Vm.start(options);
      if (attempt === 3 || (await vm.firmwareOutcome()) !== "missed") return vm;
      vm.kill();
      for (let i = 0; vm.running && i < 50; i++) await sleep(100);
      await sleep(5000);
      console.log(`the firmware didn't find the stick (attempt ${attempt}); booting again`);
    }
  }

  private static async start(options: BootOptions): Promise<Vm> {
    const vm = new Vm(options);
    for (let i = 0; !vm.qmpSocket; i++) {
      if (vm.exited || i > 100) throw new Error("QEMU didn't start");
      await sleep(100);
      if (existsSync(vm.qmpPath)) await vm.connect().catch(() => undefined);
    }
    await vm.qmp("qmp_capabilities");
    return vm;
  }

  /**
   * What OVMF did with the stick, from its messages on the serial port. On a miss it
   * says so, or fails to load the stick's entry and waits; after its timeout it resets,
   * which ends QEMU (-no-reboot). An exit before any boot is a miss too.
   */
  private async firmwareOutcome(): Promise<"started" | "missed" | "unknown"> {
    const missed = /No bootable option|failed to load Boot/;
    // A miss can take minutes: the firmware waits on the USB stick before giving up. A
    // good boot says "starting" within seconds, so the long watch costs nothing.
    for (const end = Date.now() + 240_000; Date.now() < end; await sleep(100)) {
      const log = this.serial();
      if (missed.test(log)) return "missed";
      if (/BdsDxe: starting Boot/.test(log)) return "started";
      if (this.exited) return "missed";
    }
    return "unknown";
  }

  get running(): boolean {
    return !this.exited;
  }

  /** Seconds since QEMU was started. */
  elapsed(): number {
    return (Date.now() - this.started) / 1000;
  }

  private connect(): Promise<void> {
    return new Promise((done, fail) => {
      const socket = createConnection(this.qmpPath);
      socket.setEncoding("utf8");
      socket.once("error", fail);
      socket.on("data", (chunk: string) => {
        this.qmpBuffer += chunk;
        for (let nl = this.qmpBuffer.indexOf("\n"); nl >= 0; nl = this.qmpBuffer.indexOf("\n")) {
          const line = this.qmpBuffer.slice(0, nl);
          this.qmpBuffer = this.qmpBuffer.slice(nl + 1);
          const reply = JSON.parse(line) as Record<string, unknown>;
          if ("return" in reply || "error" in reply) this.waiting.shift()?.(reply);
        }
      });
      socket.once("connect", () => {
        this.qmpSocket = socket;
        done();
      });
    });
  }

  /** Runs one QMP command and returns its result. */
  async qmp(execute: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const socket = this.qmpSocket;
    if (!socket) throw new Error("no QMP connection");
    const reply = await new Promise<Record<string, unknown>>((done) => {
      this.waiting.push(done);
      socket.write(JSON.stringify({ execute, arguments: args }) + "\n");
    });
    if ("error" in reply) throw new Error(`qmp ${execute}: ${JSON.stringify(reply["error"])}`);
    return reply["return"];
  }

  async screen(name?: string): Promise<Screen> {
    const file = join(this.out, `${name ?? "screen"}.ppm`);
    await this.qmp("screendump", { filename: file });
    return readPpm(file);
  }

  /**
   * Waits until the screen is lit and has stopped changing for `still` seconds. A
   * blinking text caret (well under 0.02% of the screen) doesn't count as a change.
   */
  async settled(seconds: number, still = 2): Promise<Screen> {
    let last: Screen | null = null;
    let since = Date.now();
    for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(250)) {
      const now = await this.screen("settling");
      if (!last || lit(now) < 0.05 || changed(last, now) > 0.0002) since = Date.now();
      else if (Date.now() - since >= still * 1000) return now;
      last = now;
    }
    throw new Error(`the screen didn't settle within ${seconds} s`);
  }

  async key(...names: string[]): Promise<void> {
    const ev = (name: string, down: boolean) => ({
      type: "key",
      data: { down, key: { type: "qcode", data: name } },
    });
    await this.qmp("input-send-event", { events: names.map((n) => ev(n, true)) });
    await sleep(30);
    await this.qmp("input-send-event", { events: names.reverse().map((n) => ev(n, false)) });
    await sleep(30);
  }

  /** Types ASCII text on a US layout. */
  async type(text: string): Promise<void> {
    for (const ch of text) {
      if (ch >= "A" && ch <= "Z") await this.key("shift", ch.toLowerCase());
      else if (SHIFTED[ch]) await this.key("shift", SHIFTED[ch]);
      else await this.key(PLAIN[ch] ?? ch);
    }
  }

  serial(): string {
    return readFileSync(this.serialLog, "latin1");
  }

  /** Waits for a pattern on the serial console (debug image), after offset `from`. */
  async waitSerial(pattern: RegExp, seconds: number, from = 0): Promise<RegExpExecArray> {
    for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(100)) {
      const match = pattern.exec(this.serial().slice(from));
      if (match) return match;
      if (this.exited) break;
    }
    throw new Error(`timeout: ${pattern} on the serial console`);
  }

  /**
   * Runs a command as root on the debug image and returns its output. Each end marker
   * is computed in the guest, so the echoed command line can't satisfy the wait.
   */
  async run(command: string, seconds = 30): Promise<string> {
    if (!this.cmdPath) throw new Error("no command line: not the debug image");
    const n = ++this.commands;
    const startMark = `VMRUN ${n} 0start`;
    const before = this.serial().length;
    await new Promise<void>((done, fail) => {
      const socket = createConnection(this.cmdPath ?? "");
      socket.once("error", fail);
      socket.once("connect", () => {
        socket.end(
          `echo "VMRUN ${n} $((0 + 0))start"; ${command}; echo "VMRUN ${n} $((${n} + 0))end"\n`,
          () => done(),
        );
      });
    });
    const endMark = new RegExp(`VMRUN ${n} ${n}end`);
    for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(100)) {
      const log = this.serial().slice(before);
      const stop = endMark.exec(log);
      if (stop) {
        const from = log.indexOf(startMark);
        return log
          .slice(from + startMark.length, stop.index)
          .replace(/\r/g, "")
          .trim();
      }
    }
    throw new Error(`timeout running: ${command}`);
  }

  /** Hot-plugs a NIC while the system runs, its frames captured like the first one. */
  async plugNic(kind: "e1000e" | "usb-net"): Promise<void> {
    const id = kind === "e1000e" ? "n1" : "n2";
    await this.qmp("netdev_add", { type: "user", id, restrict: true });
    await this.qmp("object-add", {
      "qom-type": "filter-dump",
      id: `d-${id}`,
      netdev: id,
      file: join(this.out, `${kind}.pcap`),
    });
    await this.qmp("device_add", {
      driver: kind,
      id: `nic-${id}`,
      netdev: id,
      bus: kind === "e1000e" ? "rp1" : "xhci.0",
    });
  }

  /** ACPI power button, then waits for QEMU to exit. */
  async powerdown(seconds = 60): Promise<void> {
    if (this.exited) return;
    await this.qmp("system_powerdown").catch(() => undefined);
    for (const end = Date.now() + seconds * 1000; Date.now() < end && !this.exited;)
      await sleep(200);
    this.kill();
  }

  /** Cuts the power: QEMU stops at once, and nothing the guest hadn't written is kept. */
  async powercut(): Promise<void> {
    if (!this.exited) this.qemu.kill("SIGKILL");
    for (let i = 0; !this.exited && i < 100; i++) await sleep(50);
  }

  /** Pulls the stick out while the system runs. */
  async unplug(): Promise<void> {
    await this.qmp("device_del", { id: "stickdev" });
  }

  kill(): void {
    if (!this.exited) this.qemu.kill("SIGKILL");
    // The throwaway copy of the stick is 1.5 GB; the logs and screens stay.
    if (this.throwaway) rmSync(this.throwaway, { force: true });
    this.qmpSocket?.destroy();
    rmSync(this.qmpPath, { force: true });
    if (this.cmdPath) rmSync(this.cmdPath, { force: true });
  }

  /** Converts the out directory's screendumps to PNG for reading. */
  pngs(): void {
    execFileSync("sh", [
      "-c",
      'for f in "$1"/*.ppm; do [ -e "$f" ] && magick "$f" "${f%.ppm}.png" && rm "$f"; done; true',
      "sh",
      this.out,
    ]);
  }
}

/** A stick that lasts across boots: a sparse copy of `image` at `path`. */
export function stickFrom(image: string, path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("cp", ["--sparse=always", image, path]);
  execFileSync("sync");
  return path;
}

/** The image a profile builds (os/scripts/build.sh). */
export function imageFor(profile: "release" | "debug"): string {
  const image = join(images, `bismillah-${profile}.raw`);
  if (!existsSync(image))
    throw new Error(`no ${image}: run pnpm os:build${profile === "debug" ? " debug" : ""}`);
  return image;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const debug = args.includes("--debug");
  const vm = await Vm.boot({
    image: imageFor(debug ? "debug" : "release"),
    out: join(root, "os/out/vm"),
    vars: (value("--vars") ?? "both") as Vars,
    stick: (value("--stick") ?? "ssd") as Stick,
    debug,
    window: args.includes("--window"),
  });
  console.log(`booting; serial log ${vm.serialLog}; Ctrl+C powers off`);
  process.on("SIGINT", () => void vm.powerdown().then(() => process.exit(0)));
  while (vm.running) await sleep(500);
  vm.kill();
}
