/**
 * The stick's boot stages and sizes (pnpm os:perf, os/PLAN.md OS-4), compared with
 * the committed baseline os/perf-baseline.json: a stage or a size that grows past
 * its tolerance fails. The budgets are reported beside it; meeting them is the
 * phase's goal, not this script's exit code.
 *
 *   node os/scripts/perf.ts [--sizes] [--boots N] [--update]
 *
 * Sizes come from the release image. The stages come from the debug image, the only
 * one that prints marks: a stick set up once, then booted cold N times (median) on
 * the "good" and the "cheap" stick, unlocked each time, and RAM measured with a 1 MB
 * document open. `--sizes` skips the boots; `--update` writes the baseline.
 * Results go to os/out/perf/ (report.md, and the VMs' logs).
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
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { esp, ESP, extractRoot, MIB, partitions, ROOT, ROOT_VERITY } from "./image.ts";
import { here, mark, PLAIN, setUpQuickly, sleep } from "./steps.ts";
import { imageFor, root, stickFrom, Vm, type Stick } from "./vm.ts";

const out = join(root, "os/out/perf");
const baselineFile = join(root, "os/perf-baseline.json");

type Numbers = Record<string, number>;
interface Result {
  measured: string;
  commit: string;
  sizes: Numbers;
  components: Numbers;
  boots?: Partial<Record<Stick, Numbers>>;
  ram?: Numbers;
}

// ---- Sizes -----------------------------------------------------------------------

/** What the root's unpacked bytes are spent on, first match wins. */
const COMPONENTS: [string, RegExp][] = [
  ["kernel modules", /^\/usr\/lib\/modules\//],
  ["firmware", /^\/usr\/lib\/firmware\//],
  ["bismillah", /^\/usr\/(bin|libexec|share|share\/licenses)\/bismillah/],
  ["WebKitGTK", /libwebkit2gtk|libjavascriptcoregtk|\/webkit2gtk-4\.1\//],
  ["ICU", /libicu/],
  [
    "Mesa and LLVM",
    /libgallium|libLLVM|\/dri\/|libvulkan|mesa|libglapi|libgbm|libdrm|libEGL|libGLES|libGLX|libGL\.so/,
  ],
  ["GStreamer", /gstreamer|libgst/],
  [
    "GTK and GLib",
    /libgtk|libgdk|libgail|libatk|libglib|libgio|libgobject|libgmodule|libpango|libcairo|libharfbuzz|libfreetype|libfontconfig|gdk-pixbuf|\/glib-2\.0\/|\/gtk-3\.0\/|\/icons\//,
  ],
  ["fonts", /^\/usr\/share\/fonts\//],
  ["XKB", /^\/usr\/share\/X11\/xkb\//],
  ["time zones", /^\/usr\/share\/zoneinfo\//],
  ["systemd and udev", /systemd|udev/],
  ["other libraries", /^\/usr\/lib\/x86_64-linux-gnu\//],
  ["programs", /^\/usr\/(s?bin|libexec)\//],
];

/** Unpacked bytes per component (regular files, hard links once). */
function components(tree: string): Numbers {
  const sums: Numbers = { "the rest": 0 };
  for (const [name] of COMPONENTS) sums[name] = 0;
  const seen = new Set<number>();
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const p = `${rel}/${name}`;
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path, p);
      else if (st.isFile() && !seen.has(st.ino)) {
        seen.add(st.ino);
        const hit = COMPONENTS.find(([, re]) => re.test(p));
        const name = hit ? hit[0] : "the rest";
        sums[name] = (sums[name] ?? 0) + st.size;
      }
    }
  };
  walk(tree, "");
  return sums;
}

function fileBytes(dir: string): Numbers {
  const sizes: Numbers = {};
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path, `${rel}/${name}`);
      else sizes[`${rel}/${name}`] = st.size;
    }
  };
  walk(dir, "");
  return sizes;
}

/** Read `length` bytes of `file` at `offset`. */
function bytesAt(file: string, offset: number, length: number): Buffer {
  const fd = openSync(file, "r");
  try {
    const b = Buffer.alloc(length);
    readSync(fd, b, 0, length, offset);
    return b;
  } finally {
    closeSync(fd);
  }
}

/** The erofs file system's size, from its superblock (1 KiB in: block size bits, blocks). */
function erofsBytes(image: string, offset: number): number {
  const sb = bytesAt(image, offset + 1024, 64);
  if (sb.readUInt32LE(0) !== 0xe0f5e1e2) throw new Error(`${image}: no erofs root`);
  return sb.readUInt32LE(36) * 2 ** (sb[12] ?? 12);
}

/** The verity superblock and hash tree the root's data blocks need (sha256, 4 KiB blocks). */
function verityBytes(image: string, offset: number): number {
  const sb = bytesAt(image, offset, 128);
  if (sb.toString("latin1", 0, 6) !== "verity") throw new Error(`${image}: no verity superblock`);
  const block = sb.readUInt32LE(68);
  let blocks = 1;
  for (let n = Number(sb.readBigUInt64LE(72)); n > 1;) {
    n = Math.ceil(n / (block / 32));
    blocks += n;
  }
  return blocks * block;
}

function measureSizes(): Pick<Result, "sizes" | "components"> {
  const image = imageFor("release");
  const parts = partitions(image);
  const rootPart = parts.get(ROOT);
  const espPart = parts.get(ESP);
  if (!rootPart || !espPart) throw new Error(`${image}: no root or ESP`);
  const espTree = join(out, "esp");
  rmSync(espTree, { recursive: true, force: true });
  mkdirSync(espTree, { recursive: true });
  esp(image, espPart.offset, ["mcopy", "-s", "-n", "-i", "@IMG", "::/*", espTree]);
  const files = fileBytes(espTree);
  const sum = (re: RegExp) =>
    Object.entries(files)
      .filter(([p]) => re.test(p))
      .reduce((a, [, b]) => a + b, 0);
  const tree = join(root, "os/out/contents/release");
  extractRoot(image, rootPart.offset, tree);
  return {
    sizes: {
      "ESP payload": sum(/./),
      // The base initrd and the kernel modules' one, which the kernel reads together.
      initrd: sum(/initrd$/),
      kernel: sum(/\/linux$|vmlinuz/),
      // The file systems themselves: their slots are fixed and larger (stick.ts).
      "erofs root": erofsBytes(image, rootPart.offset),
      "root verity": verityBytes(image, parts.get(ROOT_VERITY)?.offset ?? 0),
    },
    components: components(tree),
  };
}

// ---- Boots -----------------------------------------------------------------------

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const at = (i: number) => s[i] ?? NaN;
  return s.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
};

/** systemd-analyze's first line, in seconds per stage. */
function analyzed(line: string): Numbers {
  const stages: Numbers = {};
  for (const m of line.matchAll(/([\d.]+)(min|s|ms) \((\w+)\)/g)) {
    const scale = m[2] === "ms" ? 0.001 : m[2] === "min" ? 60 : 1;
    stages[m[3] ?? ""] = Number(m[1]) * scale;
  }
  return stages;
}

/** A stick set up once on the US layout, with a short note as the last document. */
async function preparedStick(): Promise<string> {
  const disk = stickFrom(imageFor("debug"), join(out, "stick.raw"));
  const vm = await Vm.boot({
    image: imageFor("debug"),
    disk,
    out: join(out, "setup"),
    debug: true,
  });
  try {
    await setUpQuickly(vm);
    await mark(vm, "page-editable", 60);
    await vm.run(
      `printf '%s\\n' '# Note' '' 'Bismillah. بسم الله' > /home/writer/Texts/note.md && chown writer:writer /home/writer/Texts/note.md`,
    );
    await sleep(1500);
    await vm.key("ctrl", "p");
    await sleep(800);
    await vm.type("note");
    await sleep(800);
    await vm.key("ret");
    await sleep(3000);
  } finally {
    await vm.powerdown();
  }
  return disk;
}

/** One cold boot to the unlock screen, then *Unlock* to the caret. */
async function coldBoot(disk: string, stick: Stick, n: number, ram: boolean): Promise<Numbers> {
  const vm = await Vm.boot({
    image: imageFor("debug"),
    disk,
    out: join(out, `${stick}-${n}`),
    debug: true,
    stick,
  });
  try {
    const gate = await mark(vm, "page-gate-shown", 240);
    // The host's clock at the mark, less the guest's uptime: firmware and loader.
    const firmware = vm.elapsed() - gate;
    const appStart = await mark(vm, "app-process-start", 5);
    let line = "";
    for (let i = 0; i < 30 && !/Startup finished/.test(line); i++, await sleep(1000))
      line = await vm.run("systemd-analyze 2>&1 | head -1");
    const a = analyzed(line);
    const switchRoot = (a["kernel"] ?? 0) + (a["initrd"] ?? 0);
    await sleep(1500);
    const from = here(vm);
    await vm.type(PLAIN);
    await vm.key("ret");
    const pressed = await mark(vm, "page-unlock-pressed", 30, from);
    const start = await mark(vm, "helper-unlock-start", 30, from);
    const opened = await mark(vm, "helper-opened", 60, from);
    const unlocked = await mark(vm, "helper-unlocked", 60, from);
    const editable = await mark(vm, "page-editable", 60, from);
    const stages: Numbers = {
      "QEMU start → kernel (firmware, loader)": firmware,
      "kernel → switch-root": switchRoot,
      "switch-root → app process": appStart - switchRoot,
      "switch-root → unlock painted": gate - switchRoot,
      "kernel → unlock painted": gate,
      "Unlock → KDF done": opened - pressed,
      KDF: opened - start,
      "Unlock → home mounted": unlocked - pressed,
      "Unlock → caret": editable - pressed,
    };
    if (ram) Object.assign(stages, await measureRam(vm));
    return stages;
  } finally {
    await vm.powerdown();
    vm.pngs();
  }
}

/** Opens a 1 MB document (English and Arabic paragraphs) and reads memory in use. */
async function measureRam(vm: Vm): Promise<Numbers> {
  const para =
    "In the name of God, the Merciful. بسم الله الرحمن الرحيم. The writer types a long paragraph of mixed text, with *emphasis*, a [link](https://example.org) and vocalised Arabic: الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ.";
  // One line for the serial command line: sed adds the blank line between paragraphs.
  await vm.run(
    `yes '${para}' | sed G | head -c 1048576 > /home/writer/Texts/big.md && chown writer:writer /home/writer/Texts/big.md`,
  );
  await sleep(1500);
  await vm.key("ctrl", "p");
  await sleep(800);
  await vm.type("big");
  await sleep(800);
  await vm.key("ret");
  await vm.settled(120);
  await sleep(10_000); // spelling and grammar run over it
  const kib = (s: string) => Number(s.trim()) * 1024;
  const available = kib(await vm.run("awk '/MemAvailable/ {print $2}' /proc/meminfo"));
  const total = kib(await vm.run("awk '/MemTotal/ {print $2}' /proc/meminfo"));
  const pss = kib(
    await vm.run(
      "for p in $(pgrep -u writer); do awk '/^Pss:/ {print $2}' /proc/$p/smaps_rollup; done | awk '{s+=$1} END {print s}'",
    ),
  );
  return { "RAM: writer's processes (PSS)": pss, "RAM: system in use": total - available };
}

async function measureBoots(boots: number): Promise<Pick<Result, "boots" | "ram">> {
  const disk = await preparedStick();
  const result: Partial<Record<Stick, Numbers>> = {};
  const ram: Numbers = {};
  for (const stick of ["cheap", "good"] as const) {
    const runs: Numbers[] = [];
    for (let n = 1; n <= boots; n++) {
      const last = stick === "good" && n === boots;
      const measured = await coldBoot(disk, stick, n, last);
      const stages: Numbers = {};
      for (const [key, v] of Object.entries(measured))
        (key.startsWith("RAM:") ? ram : stages)[key] = v;
      console.log(`${stick} boot ${n}: ${JSON.stringify(stages)}`);
      runs.push(stages);
    }
    result[stick] = Object.fromEntries(
      Object.keys(runs[0] ?? {}).map((k) => [k, median(runs.map((r) => r[k] ?? NaN))]),
    );
  }
  rmSync(disk, { force: true });
  return { boots: result, ram };
}

// ---- Budgets, regressions, the report ---------------------------------------------

/** OS-4's targets (docs/spikes/os-size-boot.md): [where, measure, at most]. */
const BUDGETS: [string, string, number][] = [
  ["good", "kernel → switch-root", 2.5],
  ["good", "switch-root → unlock painted", 3.0],
  ["good", "Unlock → caret", 2.0],
  ["sizes", "ESP payload", 40 * MIB],
  ["sizes", "initrd", 15 * MIB],
  ["sizes", "erofs root", 450 * MIB],
  ["ram", "RAM: writer's processes (PSS)", 1024 * MIB],
];

/** How far a measure may grow past the baseline before it fails. */
function allowed(group: string, base: number): number {
  if (group === "sizes" || group === "components") return base * 1.02 + 256 * 1024;
  if (group === "ram") return base * 1.1 + 32 * MIB;
  return base * 1.15 + 0.3;
}

const shown = (group: string, key: string, v: number) =>
  group === "sizes" || group === "components" || key.startsWith("RAM")
    ? `${(v / MIB).toFixed(1)} MiB`
    : `${v.toFixed(2)} s`;

function groups(r: Result): [string, Numbers][] {
  return [
    ["sizes", r.sizes],
    ["components", r.components],
    ...Object.entries(r.boots ?? {}).map(([k, v]): [string, Numbers] => [k, v]),
    ...(r.ram ? [["ram", r.ram] as [string, Numbers]] : []),
  ];
}

function compare(now: Result, base: Result | null): { lines: string[]; regressions: string[] } {
  const lines: string[] = [];
  const regressions: string[] = [];
  const baseGroups = new Map(base ? groups(base) : []);
  for (const [group, values] of groups(now)) {
    lines.push(
      "",
      `### ${group}`,
      "",
      "| Measure | Now | Baseline | Budget |",
      "|---|---|---|---|",
    );
    for (const [key, v] of Object.entries(values)) {
      const b = baseGroups.get(group)?.[key];
      const budget = BUDGETS.find(([g, k]) => g === group && k === key)?.[2];
      // Firmware is the machine's (recorded only); components explain, sizes decide.
      const judged = !key.includes("QEMU") && group !== "components";
      const regressed = judged && b !== undefined && v > allowed(group, b);
      if (regressed)
        regressions.push(
          `${group}: ${key} ${shown(group, key, v)} (baseline ${shown(group, key, b)})`,
        );
      const over = budget !== undefined && v > budget;
      lines.push(
        `| ${key} | ${shown(group, key, v)}${regressed ? " **regressed**" : ""} | ${b === undefined ? "—" : shown(group, key, b)} | ${budget === undefined ? "" : `${shown(group, key, budget)} ${over ? "over" : "met"}`} |`,
      );
    }
  }
  return { lines, regressions };
}

const args = process.argv.slice(2);
const sizesOnly = args.includes("--sizes");
const boots = Number(args[args.indexOf("--boots") + 1] ?? 0) || 3;
mkdirSync(out, { recursive: true });
const commit = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
  encoding: "utf8",
}).trim();
const now: Result = {
  measured: new Date().toISOString().slice(0, 10),
  commit,
  ...measureSizes(),
  ...(sizesOnly ? {} : await measureBoots(boots)),
};
const base = existsSync(baselineFile)
  ? (JSON.parse(readFileSync(baselineFile, "utf8")) as Result)
  : null;
const { lines, regressions } = compare(now, base);
const report = [
  `# bismillah stick: boot stages and sizes (${now.measured}, ${commit})`,
  "",
  `Baseline: ${base ? `${base.measured}, ${base.commit}` : "none"}. Stages: the debug image, median of ${boots} cold boots per stick.`,
  ...lines,
  "",
  regressions.length ? `**${regressions.length} regressed**` : "No regressions.",
].join("\n");
writeFileSync(join(out, "report.md"), report + "\n");
writeFileSync(join(out, "result.json"), JSON.stringify(now, null, 2) + "\n");
console.log(report);
if (args.includes("--update")) {
  // A sizes-only run keeps the baseline's stages.
  const kept = sizesOnly && base ? { boots: base.boots, ram: base.ram } : {};
  writeFileSync(baselineFile, JSON.stringify({ ...now, ...kept }, null, 2) + "\n");
  console.log(`wrote ${baselineFile}`);
} else if (regressions.length) {
  for (const r of regressions) console.log(`REGRESSED ${r}`);
  process.exit(1);
}
