/**
 * Reading the stick's built images without mounting them: the GPT, the root (with
 * fsck.erofs) and the ESP (with mtools from mkosi's tools tree). Shared by the
 * contents check (os/tests/image-contents.ts) and the measurements (perf.ts).
 */
import { execFileSync } from "node:child_process";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
  rmSync,
} from "node:fs";
import { dirname, join, normalize } from "node:path";
import { crc32 } from "node:zlib";
import { root } from "./vm.ts";

export const ESP = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
export const ROOT = "4f68bce3-e8cd-4db1-96e7-fbcaf984b709"; // root, x86-64
export const ROOT_VERITY = "2c7357ed-ebd2-46d9-aec1-23d437ec2bf5"; // root verity, x86-64
export const HOME = "933ac7e1-2eb4-4f13-b844-0e14e2aef915";
export const MIB = 1024 * 1024;

function guid(b: Buffer): string {
  const h = b.toString("hex");
  const swap = (s: string) => s.match(/../g)?.reverse().join("") ?? "";
  return `${swap(h.slice(0, 8))}-${swap(h.slice(8, 12))}-${swap(h.slice(12, 16))}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface Part {
  /** Byte offset and size on the image. */
  offset: number;
  bytes: number;
  /** The GPT attribute flags (bit 63: no-auto). */
  flags: bigint;
}

/** A GPT entry: its partition number (from 1), type and own GUID, and its place. */
export interface Entry extends Part {
  number: number;
  type: string;
  uuid: string;
}

/** The disk's GUID and used GPT entries (512-byte sectors), checked against their CRCs. */
export function gpt(path: string): { disk: string; entries: Entry[] } {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(512);
    if (readSync(fd, header, 0, header.length, 512) !== header.length)
      throw new Error(`${path}: incomplete GPT header`);
    if (header.toString("latin1", 0, 8) !== "EFI PART") throw new Error(`${path}: no GPT`);
    const headerSize = header.readUInt32LE(12);
    if (headerSize < 92 || headerSize > header.length)
      throw new Error(`${path}: invalid GPT header size`);
    const checksum = header.readUInt32LE(16);
    header.writeUInt32LE(0, 16);
    if (crc32(header.subarray(0, headerSize)) !== checksum)
      throw new Error(`${path}: invalid GPT header checksum`);
    const start = Number(header.readBigUInt64LE(72)) * 512;
    const count = header.readUInt32LE(80);
    const size = header.readUInt32LE(84);
    // Bound allocation before reading a damaged or malformed table. The images
    // have 128 entries; even a 16 MiB table leaves ample room for other disks.
    if (
      !Number.isSafeInteger(start) ||
      start < 1024 ||
      count === 0 ||
      size < 128 ||
      size % 128 !== 0 ||
      count * size > 16 * MIB
    )
      throw new Error(`${path}: invalid GPT table size or offset`);
    const table = Buffer.alloc(count * size);
    if (readSync(fd, table, 0, table.length, start) !== table.length)
      throw new Error(`${path}: incomplete GPT partition table`);
    if (crc32(table) !== header.readUInt32LE(88))
      throw new Error(`${path}: invalid GPT partition table checksum`);
    const entries: Entry[] = [];
    for (let i = 0; i < count; i++) {
      const entry = table.subarray(i * size, (i + 1) * size);
      const type = guid(entry.subarray(0, 16));
      if (type !== "00000000-0000-0000-0000-000000000000")
        entries.push({
          number: i + 1,
          type,
          uuid: guid(entry.subarray(16, 32)),
          offset: Number(entry.readBigUInt64LE(32)) * 512,
          bytes: Number(entry.readBigUInt64LE(40) - entry.readBigUInt64LE(32) + 1n) * 512,
          flags: entry.readBigUInt64LE(48),
        });
    }
    return { disk: guid(header.subarray(56, 72)), entries };
  } finally {
    closeSync(fd);
  }
}

/** Each partition type on the image. */
export function partitions(image: string): Map<string, Part> {
  return new Map(gpt(image).entries.map((e) => [e.type, e]));
}

export function esp(image: string, offset: number, args: string[]): string {
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

/**
 * Extracts the root partition, without owners, into `tree` (emptied first). With
 * `modes`, the files keep their permission bits (setuid included) and the caller gets
 * each path's mode; the tree is then made writable again so it can be removed.
 */
export function extractRoot(image: string, offset: number, tree: string): void;
export function extractRoot(
  image: string,
  offset: number,
  tree: string,
  modes: true,
): Map<string, number>;
export function extractRoot(
  image: string,
  offset: number,
  tree: string,
  modes = false,
): Map<string, number> | void {
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(dirname(tree), { recursive: true });
  execFileSync("fsck.erofs", [
    `--offset=${offset}`,
    `--extract=${tree}`,
    ...(modes ? ["--preserve-perms", "--no-preserve-owner"] : ["--no-preserve"]),
    "-d0",
    image,
  ]);
  if (!modes) return;
  const found = new Map<string, number>();
  const walk = (rel: string) => {
    for (const name of readdirSync(join(tree, rel))) {
      const p = `${rel}/${name}`;
      const st = lstatSync(join(tree, p));
      found.set(p, st.mode);
      if (st.isDirectory()) walk(p);
    }
  };
  walk("");
  execFileSync("chmod", ["-R", "u+rwX,go-w,ug-s", tree]);
  return found;
}

/** A path inside an extracted tree, following its links (absolute ones from the tree's root). */
export function inTree(tree: string, path: string, depth = 0): string | null {
  const parts = path.split("/").filter(Boolean);
  let at = "";
  for (let i = 0; i < parts.length; i++) {
    const next = `${at}/${parts[i]}`;
    const full = join(tree, next);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      return null;
    }
    if (st.isSymbolicLink()) {
      if (depth > 40) return null;
      const target = readlinkSync(full);
      const base = target.startsWith("/") ? target : `${at}/${target}`;
      const resolved = inTree(tree, normalize(base), depth + 1);
      if (resolved === null) return null;
      at = resolved;
    } else at = next;
  }
  return at || "/";
}

/** An ELF file's DT_NEEDED and DT_RUNPATH/DT_RPATH entries, or null if it isn't ELF64. */
export function dynamic(file: string): { needed: string[]; runpath: string[] } | null {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return null; // unreadable without root (gshadow): not a program
  }
  try {
    const head = Buffer.alloc(64);
    if (readSync(fd, head, 0, 64, 0) < 64 || head.readUInt32BE(0) !== 0x7f454c46 || head[4] !== 2)
      return null;
    const phoff = Number(head.readBigUInt64LE(32));
    const phentsize = head.readUInt16LE(54);
    const phnum = head.readUInt16LE(56);
    const ph = Buffer.alloc(phentsize * phnum);
    readSync(fd, ph, 0, ph.length, phoff);
    const loads: { vaddr: number; offset: number; size: number }[] = [];
    let dyn: { offset: number; size: number } | null = null;
    for (let i = 0; i < phnum; i++) {
      const e = ph.subarray(i * phentsize);
      const type = e.readUInt32LE(0);
      const offset = Number(e.readBigUInt64LE(8));
      const vaddr = Number(e.readBigUInt64LE(16));
      const filesz = Number(e.readBigUInt64LE(32));
      if (type === 1) loads.push({ vaddr, offset, size: filesz });
      if (type === 2) dyn = { offset, size: filesz };
    }
    if (!dyn) return { needed: [], runpath: [] };
    const table = Buffer.alloc(dyn.size);
    readSync(fd, table, 0, dyn.size, dyn.offset);
    const entries: [number, number][] = [];
    let strtab = 0;
    for (let at = 0; at + 16 <= table.length; at += 16) {
      const tag = Number(table.readBigInt64LE(at));
      const value = Number(table.readBigUInt64LE(at + 8));
      if (tag === 0) break;
      if (tag === 5) strtab = value;
      if (tag === 1 || tag === 15 || tag === 29) entries.push([tag, value]);
    }
    const load = loads.find((l) => strtab >= l.vaddr && strtab < l.vaddr + l.size);
    if (!load) return { needed: [], runpath: [] };
    const str = (off: number) => {
      const b = Buffer.alloc(512);
      readSync(fd, b, 0, 512, load.offset + strtab - load.vaddr + off);
      return b.toString("latin1", 0, b.indexOf(0) < 0 ? 512 : b.indexOf(0));
    };
    return {
      needed: entries.filter(([t]) => t === 1).map(([, v]) => str(v)),
      runpath: entries.filter(([t]) => t !== 1).flatMap(([, v]) => str(v).split(":")),
    };
  } finally {
    closeSync(fd);
  }
}

const LIBRARY_DIRS = ["/usr/lib/x86_64-linux-gnu", "/usr/lib", "/lib/x86_64-linux-gnu", "/lib"];

/**
 * Every ELF file's needed libraries that the tree doesn't have, as "file: library".
 * What a program loads with dlopen() isn't seen here; the VM scenarios find those.
 */
export function missingLibraries(tree: string): string[] {
  const missing: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(tree, rel))) {
      const p = `${rel}/${name}`;
      const st = lstatSync(join(tree, p));
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && st.size > 64) {
        const d = dynamic(join(tree, p));
        if (!d) continue;
        const dirs = [
          ...d.runpath.map((r) =>
            r.replace("$ORIGIN", dirname(p)).replace("${ORIGIN}", dirname(p)),
          ),
          ...LIBRARY_DIRS,
          // A private library found by soname once its program's RUNPATH loaded it.
          dirname(p),
        ];
        for (const lib of d.needed)
          if (!dirs.some((dir) => inTree(tree, `${dir}/${lib}`) !== null))
            missing.push(`${p}: ${lib}`);
      }
    }
  };
  walk("");
  return missing;
}
