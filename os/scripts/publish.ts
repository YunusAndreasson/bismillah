/**
 * Makes a built release image downloadable (pnpm os:publish, ADR-0017): the bundle
 * that web/public/install.sh and install.ps1 fetch and bismillah-install writes.
 *
 *   node os/scripts/publish.ts [<image>] [--partial]
 *
 * Writes os/out/publish/<version>/ (version: the UTC date and the image's commit):
 *   manifest          the line-based description below
 *   image-NNN.gz      the gzip of the raw image, in parts under Workers' 25 MiB limit
 *   bismillah-install-<platform>[.exe]   the installer for each OS (os/scripts/installer.sh)
 * and os/out/publish/current, the one line naming that version. Uploading the folder
 * and then `current` (last, so no one is pointed at a half-uploaded version) is left
 * for the hosting decision.
 *
 * The manifest, one fact per line, so sh and PowerShell can read it:
 *   bismillah-stick 1
 *   version <version>
 *   raw-size <bytes>
 *   raw-sha256 <hex>
 *   stickid-offset <bytes>          the ESP's stick-id placeholder in the raw image
 *   part <file> <bytes> <sha256>    in order
 *   tool <platform> <file> <bytes> <sha256>
 *
 * --partial publishes without the installers that aren't built (for the tests).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { completeImage, idBlocks, parseId } from "./stick.ts";
import { root } from "./vm.ts";

/** Each part's size: Workers static assets take files up to 25 MiB. */
const PART = 24 * 1024 * 1024;

export const PLATFORMS = [
  "linux-x86_64",
  "linux-aarch64",
  "macos-x86_64",
  "macos-aarch64",
  "windows-x86_64",
] as const;

export const toolFile = (platform: string) =>
  `bismillah-install-${platform}${platform.startsWith("windows") ? ".exe" : ""}`;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** Writes the gzip stream as parts of at most PART bytes, each with its sha256. */
class Parts extends Writable {
  parts: { file: string; bytes: number; sha256: string }[] = [];
  private fd = -1;
  private hash = createHash("sha256");
  private bytes = 0;
  private dir: string;
  constructor(dir: string) {
    super();
    this.dir = dir;
  }
  private open(): void {
    const file = `image-${String(this.parts.length).padStart(3, "0")}.gz`;
    this.fd = openSync(join(this.dir, file), "wx");
    this.parts.push({ file, bytes: 0, sha256: "" });
    this.hash = createHash("sha256");
    this.bytes = 0;
  }
  private close(): void {
    if (this.fd < 0) return;
    closeSync(this.fd);
    const part = this.parts.at(-1);
    if (part) Object.assign(part, { bytes: this.bytes, sha256: this.hash.digest("hex") });
    this.fd = -1;
  }
  override _write(chunk: Buffer, _: string, done: (e?: Error) => void): void {
    try {
      let at = 0;
      while (at < chunk.length) {
        if (this.fd < 0 || this.bytes === PART) {
          this.close();
          this.open();
        }
        const n = Math.min(PART - this.bytes, chunk.length - at);
        const piece = chunk.subarray(at, at + n);
        writeSync(this.fd, piece);
        this.hash.update(piece);
        this.bytes += n;
        at += n;
      }
      done();
    } catch (error) {
      done(error as Error);
    }
  }
  override _final(done: (e?: Error) => void): void {
    this.close();
    done();
  }
}

export async function publish(
  image: string,
  out = join(root, "os/out/publish"),
  partial = false,
): Promise<string> {
  const parts = completeImage(image);
  if (!parts.home) throw new Error(`${image} has no home partition`);
  const ids = idBlocks(image, parts.esp);
  if (ids.length !== 1 || parseId(ids[0]?.block ?? Buffer.alloc(0)) !== "unflashed")
    throw new Error(`${image}: its ESP has no single stick-id placeholder`);
  const tools = join(root, "os/out/installer");
  const missing = PLATFORMS.filter((p) => !existsSync(join(tools, toolFile(p))));
  if (missing.length > 0 && !partial)
    throw new Error(`no installer for ${missing.join(", ")}: run os/scripts/installer.sh`);

  const commit = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const version = `${date}-${commit}`;
  const dir = join(out, version);
  const building = `${dir}.partial`;
  rmSync(building, { recursive: true, force: true });
  mkdirSync(building, { recursive: true });

  const raw = createHash("sha256");
  const writer = new Parts(building);
  const reader = createReadStream(image, { highWaterMark: 4 * 1024 * 1024 });
  reader.on("data", (chunk) => raw.update(chunk));
  await pipeline(reader, createGzip({ level: 9 }), writer);

  const lines = [
    "bismillah-stick 1",
    `version ${version}`,
    `raw-size ${statSync(image).size}`,
    `raw-sha256 ${raw.digest("hex")}`,
    `stickid-offset ${ids[0]?.offset}`,
    ...writer.parts.map((p) => `part ${p.file} ${p.bytes} ${p.sha256}`),
  ];
  for (const platform of PLATFORMS) {
    if (missing.includes(platform)) continue;
    const bytes = readFileSync(join(tools, toolFile(platform)));
    writeFileSync(join(building, toolFile(platform)), bytes);
    lines.push(`tool ${platform} ${toolFile(platform)} ${bytes.length} ${sha256(bytes)}`);
  }
  writeFileSync(join(building, "manifest"), `${lines.join("\n")}\n`);
  rmSync(dir, { recursive: true, force: true });
  renameSync(building, dir);
  writeFileSync(join(out, "current"), `${version}\n`);
  return version;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const partial = args.includes("--partial");
  const image =
    args.find((a) => !a.startsWith("--")) ?? join(root, "os/out/image/bismillah-release.raw");
  const version = await publish(image, undefined, partial);
  const dir = join(root, "os/out/publish", version);
  const manifest = readFileSync(join(dir, "manifest"), "utf8");
  const gz = manifest
    .split("\n")
    .filter((l) => l.startsWith("part "))
    .reduce((sum, l) => sum + Number(l.split(" ")[2]), 0);
  console.log(`published ${version}: ${(gz / 1e6).toFixed(0)} MB to download, in ${dir}`);
}
