/**
 * Which stick is ours, and reflashing its system without touching its texts (os/PLAN.md,
 * OS-5). flash.sh runs it; the VM scenarios and os/tests/stick.test.ts run it on stick
 * files. It works the same on an image file and on a disk (as root).
 *
 *   node os/scripts/stick.ts prepare <image> <out.raw>
 *       A copy of the image to flash, with its own disk and ESP and home GUIDs, written
 *       into its GPT and into the ESP's bismillah/stick-id. Unprivileged.
 *   node os/scripts/stick.ts record <out.raw> <image> [--registry <file>] [--system <name>]
 *       After a first flash: adds the copy's identity to the registry.
 *   node os/scripts/stick.ts identify <stick> [--registry <file>]
 *       Prints the stick's identity and whether it is ours. Changes nothing.
 *   node os/scripts/stick.ts update <image> <stick> [--registry <file>] [--system <name>]
 *       Rewrites the stick's ESP, root and root verity from the image, then reads them
 *       back. Home, its partition and the disk's own GUIDs stay as they are.
 *
 * A stick is ours only when its disk GUID and its ESP's and home's partition GUIDs are
 * all in the registry (os/sticks.toml, never committed) and the ESP's stick-id names
 * the same three. Labels are never used: any disk can carry any label. root and
 * verity get the image's GUIDs on every update, because the boot finds them by the
 * root hash they are derived from.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESP, gpt, HOME, ROOT, ROOT_VERITY, type Entry } from "./image.ts";
import { root } from "./vm.ts";

export const REGISTRY = join(root, "os/sticks.toml");
/** The first line of the ESP's bismillah/stick-id, and its fixed length. */
const ID_HEAD = "bismillah stick id 1\n";
const ID_BYTES = 512;
const CHUNK = 4 * 1024 * 1024;

export interface Identity {
  disk: string;
  esp: string;
  home: string;
}

export interface Registered extends Identity {
  flashed: string;
  system: string;
  /** Set while an update writes, so an interrupted one can be run again. */
  updating: boolean;
}

/** The stick-id file: the head, the three GUIDs, padded with '#' to 512 bytes. */
export function idFile(id: Identity): Buffer {
  const text = `${ID_HEAD}disk ${id.disk}\nesp ${id.esp}\nhome ${id.home}\n`;
  return Buffer.from(text.padEnd(ID_BYTES - 1, "#") + "\n", "latin1");
}

function parseId(block: Buffer): Identity | "unflashed" | null {
  const text = block.toString("latin1");
  if (!text.startsWith(ID_HEAD)) return null;
  if (text.startsWith(`${ID_HEAD}unflashed\n`)) return "unflashed";
  const field = (name: string) => new RegExp(`^${name} ([0-9a-f-]{36})$`, "m").exec(text)?.[1];
  const disk = field("disk");
  const esp = field("esp");
  const home = field("home");
  return disk && esp && home ? { disk, esp, home } : null;
}

/** Every 512-byte block in `part` that starts with the stick-id head: its offset and content. */
function idBlocks(path: string, part: Entry): { offset: number; block: Buffer }[] {
  const found: { offset: number; block: Buffer }[] = [];
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(CHUNK);
    for (let at = 0; at < part.bytes; at += CHUNK) {
      const n = readSync(fd, buffer, 0, Math.min(CHUNK, part.bytes - at), part.offset + at);
      for (let b = 0; b + ID_BYTES <= n; b += 512)
        if (buffer.toString("latin1", b, b + ID_HEAD.length) === ID_HEAD)
          found.push({
            offset: part.offset + at + b,
            block: Buffer.from(buffer.subarray(b, b + ID_BYTES)),
          });
    }
  } finally {
    closeSync(fd);
  }
  return found;
}

/** The one partition of each type the stick has; throws on a missing or repeated type. */
function layout(path: string): {
  disk: string;
  esp: Entry;
  root: Entry;
  verity: Entry;
  home?: Entry;
} {
  const { disk, entries } = gpt(path);
  const one = (type: string, name: string): Entry => {
    const all = entries.filter((e) => e.type === type);
    if (all.length !== 1)
      throw new Refusal(`${path} has ${all.length} ${name} partitions, not one`);
    return all[0] as Entry;
  };
  const known = [ESP, ROOT, ROOT_VERITY, HOME];
  const other = entries.find((e) => !known.includes(e.type));
  if (other) throw new Refusal(`${path} has a partition of another type (${other.type})`);
  const home = entries.some((e) => e.type === HOME) ? one(HOME, "home") : undefined;
  return {
    disk,
    esp: one(ESP, "ESP"),
    root: one(ROOT, "root"),
    verity: one(ROOT_VERITY, "root verity"),
    ...(home ? { home } : {}),
  };
}

/** A reason not to touch a stick, said plainly. */
export class Refusal extends Error {}

/** Check source images before copying them or replacing any part of a stick. */
function completeImage(path: string): ReturnType<typeof layout> {
  const parts = layout(path);
  const st = statSync(path);
  for (const part of [parts.esp, parts.root, parts.verity, parts.home])
    if (part && st.isFile() && part.offset + part.bytes > st.size)
      throw new Refusal(`${path}: partition ${part.number} is truncated`);
  return parts;
}

export function readRegistry(file: string): Registered[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/^\[\[stick\]\]$/m)
    .slice(1)
    .map((block) => {
      const value = (key: string) => new RegExp(`^${key} = "([^"]*)"$`, "m").exec(block)?.[1] ?? "";
      return {
        disk: value("disk"),
        esp: value("esp"),
        home: value("home"),
        flashed: value("flashed"),
        system: value("system"),
        updating: /^updating = true$/m.test(block),
      };
    });
}

function writeRegistry(file: string, sticks: Registered[]): void {
  const previous = existsSync(file) ? statSync(file) : undefined;
  const blocks = sticks.map(
    (s) =>
      `[[stick]]\ndisk = "${s.disk}"\nesp = "${s.esp}"\nhome = "${s.home}"\nflashed = "${s.flashed}"\nsystem = "${s.system}"\nupdating = ${s.updating}\n`,
  );
  // Keep the old identities if a write fails, and make the interrupted-update
  // checkpoint durable before the first byte of the stick is overwritten.
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      // Updates run under sudo, while the next first-flash record runs as the
      // author. Keep their registry readable after replacing it as root.
      const created = fstatSync(fd);
      if (previous && (previous.uid !== created.uid || previous.gid !== created.gid))
        fchownSync(fd, previous.uid, previous.gid);
      writeFileSync(
        fd,
        `# The bismillah sticks this machine flashed (os/scripts/stick.ts). Not committed:\n# reflashing a stick needs its entry here.\n\n${blocks.join("\n")}`,
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
    const parent = openSync(dirname(file), "r");
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** What the image was built from, as About shows it. */
function systemOf(image: string): string {
  const name = /bismillah-(release|debug)/.exec(image)?.[1] ?? "image";
  const commit = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
  return `${name} ${commit}`;
}

const sfdisk = (...args: string[]) =>
  execFileSync("sfdisk", ["--quiet", ...args], { stdio: ["ignore", "ignore", "pipe"] });

/** A copy of `image` at `out` with new GUIDs for the disk, the ESP and home, and its stick-id. */
export function prepare(image: string, out: string): Identity {
  const parts = completeImage(image);
  if (!parts.home) throw new Refusal(`${image} has no home partition`);
  execFileSync("cp", ["--sparse=always", image, out]);
  const id: Identity = { disk: randomUUID(), esp: randomUUID(), home: randomUUID() };
  sfdisk("--disk-id", out, id.disk);
  sfdisk("--part-uuid", out, String(parts.esp.number), id.esp);
  sfdisk("--part-uuid", out, String(parts.home.number), id.home);
  const blocks = idBlocks(out, parts.esp);
  if (blocks.length !== 1 || parseId(blocks[0]?.block ?? Buffer.alloc(0)) !== "unflashed")
    throw new Refusal(`${image}: its ESP has no single stick-id placeholder`);
  const fd = openSync(out, "r+");
  try {
    writeSync(fd, idFile(id), 0, ID_BYTES, blocks[0]?.offset);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return id;
}

/** The stick's identity: its GPT GUIDs, and what its ESP's stick-id says. */
export function identify(stick: string): {
  gpt: Identity | null;
  file: Identity | "unflashed" | "missing" | "several";
} {
  const parts = layout(stick);
  const ids = idBlocks(stick, parts.esp);
  const file =
    ids.length === 0
      ? "missing"
      : ids.length > 1
        ? "several"
        : (parseId(ids[0]?.block ?? Buffer.alloc(0)) ?? "missing");
  return {
    gpt: parts.home ? { disk: parts.disk, esp: parts.esp.uuid, home: parts.home.uuid } : null,
    file,
  };
}

const same = (a: Identity, b: Identity) =>
  a.disk === b.disk && a.esp === b.esp && a.home === b.home;

/** The registry's entry for this stick, or a Refusal saying why it isn't ours. */
export function ours(stick: string, registry: string): Registered {
  const { gpt: id, file } = identify(stick);
  if (!id) throw new Refusal(`${stick} has no home partition: not a bismillah stick`);
  const entry = readRegistry(registry).find((s) => same(s, id));
  if (!entry)
    throw new Refusal(
      `${stick} isn't a stick this machine flashed: its GUIDs aren't in ${registry}`,
    );
  if (file === "missing" && entry.updating) return entry; // an interrupted update
  if (file === "unflashed" || file === "missing" || file === "several")
    throw new Refusal(`${stick}: its ESP's stick-id is ${file}`);
  if (!same(file, id))
    throw new Refusal(`${stick}: its ESP's stick-id names other GUIDs than its partitions`);
  return entry;
}

export function record(prepared: string, registry: string, system: string): Registered {
  const { gpt: id, file } = identify(prepared);
  if (!id || typeof file === "string" || !same(id, file))
    throw new Refusal(`${prepared} isn't a prepared stick`);
  const sticks = readRegistry(registry).filter((s) => !same(s, id));
  const entry: Registered = { ...id, flashed: new Date().toISOString(), system, updating: false };
  writeRegistry(registry, [...sticks, entry]);
  return entry;
}

function setUpdating(registry: string, id: Identity, updating: boolean, system?: string): void {
  writeRegistry(
    registry,
    readRegistry(registry).map((s) =>
      same(s, id) ? { ...s, updating, ...(system ? { system } : {}) } : s,
    ),
  );
}

/** Copies `bytes` from `from` at `source` to `to` at `target`, patching one block; returns their sha256. */
function copy(
  from: number,
  to: number,
  source: number,
  target: number,
  bytes: number,
  patch?: { offset: number; data: Buffer },
): string {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(CHUNK);
  for (let at = 0; at < bytes; at += CHUNK) {
    const n = Math.min(CHUNK, bytes - at);
    if (readSync(from, buffer, 0, n, source + at) !== n)
      throw new Error("short read from the image");
    if (patch && patch.offset >= at && patch.offset < at + n)
      patch.data.copy(buffer, patch.offset - at);
    hash.update(buffer.subarray(0, n));
    if (writeSync(to, buffer, 0, n, target + at) !== n) throw new Error("short write to the stick");
  }
  return hash.digest("hex");
}

function hashOf(path: string, offset: number, bytes: number): string {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(CHUNK);
  const fd = openSync(path, "r");
  try {
    for (let at = 0; at < bytes; at += CHUNK) {
      const n = readSync(fd, buffer, 0, Math.min(CHUNK, bytes - at), offset + at);
      hash.update(buffer.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function isDisk(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    return fstatSync(fd).isBlockDevice();
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes the image's ESP, root and verity into the stick's slots and gives root and
 * verity the image's GUIDs, then reads all three back. Home is never opened.
 */
export function update(
  image: string,
  stick: string,
  registry: string,
  log = console.log,
  system = systemOf(image),
): void {
  const entry = ours(stick, registry);
  const target = layout(stick);
  const source = completeImage(image);
  for (const [name, s, t] of [
    ["ESP", source.esp, target.esp],
    ["root", source.root, target.root],
    ["root verity", source.verity, target.verity],
  ] as const)
    if (s.bytes > t.bytes)
      throw new Refusal(
        `the new ${name} (${s.bytes} bytes) is bigger than the stick's slot (${t.bytes}); flash the stick afresh`,
      );
  const placeholders = idBlocks(image, source.esp);
  if (
    placeholders.length !== 1 ||
    parseId(placeholders[0]?.block ?? Buffer.alloc(0)) !== "unflashed"
  )
    throw new Refusal(`${image}: its ESP has no single stick-id placeholder`);
  const id: Identity = { disk: entry.disk, esp: entry.esp, home: entry.home };
  const homeHead = (home: Entry | undefined) => (home ? hashOf(stick, home.offset, 1048576) : "");
  const before = homeHead(target.home);

  setUpdating(registry, id, true);
  const from = openSync(image, "r");
  const to = openSync(stick, "r+");
  const written: [string, Entry, string][] = [];
  try {
    // root and verity first: until the ESP is written the old system's entry still
    // names the old root hash, so an interrupted update leaves a stick that a rerun
    // can finish (the registry says it was updating).
    for (const [name, s, t] of [
      ["root", source.root, target.root],
      ["root verity", source.verity, target.verity],
    ] as const) {
      log(`writing ${name} (${(s.bytes / 1048576).toFixed(0)} MiB)`);
      written.push([name, { ...t, bytes: s.bytes }, copy(from, to, s.offset, t.offset, s.bytes)]);
    }
    log(`writing the ESP (${(source.esp.bytes / 1048576).toFixed(0)} MiB)`);
    const patch = { offset: (placeholders[0]?.offset ?? 0) - source.esp.offset, data: idFile(id) };
    written.push([
      "ESP",
      { ...target.esp, bytes: source.esp.bytes },
      copy(from, to, source.esp.offset, target.esp.offset, source.esp.bytes, patch),
    ]);
    fsyncSync(to);
  } finally {
    closeSync(from);
    closeSync(to);
  }
  sfdisk("--part-uuid", stick, String(target.root.number), source.root.uuid);
  sfdisk("--part-uuid", stick, String(target.verity.number), source.verity.uuid);
  // Read back from the stick itself, not from this machine's cache of it.
  if (isDisk(stick)) execFileSync("blockdev", ["--flushbufs", stick]);
  for (const [name, part, hash] of written)
    if (hashOf(stick, part.offset, part.bytes) !== hash)
      throw new Error(
        `${name} reads back differently from what was written: the stick may be failing`,
      );
  const after = layout(stick);
  if (after.root.uuid !== source.root.uuid || after.verity.uuid !== source.verity.uuid)
    throw new Error("the stick's partition table didn't take the new root's GUIDs");
  if (homeHead(target.home) !== before) throw new Error("home changed during the update");
  setUpdating(registry, id, false, system);
  log("read back: the ESP, root and verity match the image; home untouched");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args.splice(at, 2)[1] : undefined;
  };
  const registry = option("--registry") ?? REGISTRY;
  const system = option("--system");
  const [command, a, b] = args;
  try {
    if (command === "prepare" && a && b) console.log(JSON.stringify(prepare(a, b)));
    else if (command === "record" && a && b)
      console.log(JSON.stringify(record(a, registry, system ?? systemOf(b))));
    else if (command === "identify" && a) {
      console.log(JSON.stringify(identify(a)));
      console.log(`ours: ${JSON.stringify(ours(a, registry))}`);
    } else if (command === "update" && a && b)
      update(a, b, registry, console.log, system ?? systemOf(a));
    else {
      console.error(
        "usage: stick.ts prepare <image> <out> | record <out> <image> | identify <stick> | update <image> <stick> [--registry <file>] [--system <name>]",
      );
      process.exit(2);
    }
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`Refused: ${error.message}. Nothing was written.`);
    process.exit(3);
  }
}
