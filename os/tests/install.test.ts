/**
 * The published install (ADR-0017), end to end on small made-up images: publish.ts
 * makes the bundle, a local server serves it with web/public/install.sh, `curl … | sh`
 * runs the script under each POSIX shell here, and bismillah-install writes a file
 * standing in for the stick. stick.ts, which flash.sh uses, must agree with what it
 * wrote, and a stick flash.sh wrote must update. The VM scenario `published`
 * (os/scripts/test.ts) boots the real image installed this way.
 *
 *   node --test os/tests/install.test.ts
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { ESP, gpt, HOME, ROOT, ROOT_VERITY } from "../scripts/image.ts";
import { publish } from "../scripts/publish.ts";
import { identify, prepare } from "../scripts/stick.ts";
import { root } from "../scripts/vm.ts";

const dir = mkdtempSync(join(root, "os/out/install-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const PLACEHOLDER = Buffer.from(
  "bismillah stick id 1\nunflashed\n".padEnd(511, "#") + "\n",
  "latin1",
);

/** A made-up image as mkosi lays it out: ESP 2 MiB, root, verity 1 MiB, home 2 MiB. */
function image(name: string, fill = "A", rootMiB = 4): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.alloc(0));
  execFileSync("truncate", ["-s", `${12 + rootMiB}M`, path]);
  const lines = [
    "label: gpt",
    `size=2MiB, type=${ESP}`,
    `size=${rootMiB}MiB, type=${ROOT}, uuid=${randomUUID()}`,
    `size=1MiB, type=${ROOT_VERITY}, uuid=${randomUUID()}`,
    `size=2MiB, type=${HOME}`,
  ];
  execFileSync("sfdisk", ["--quiet", path], { input: lines.join("\n") + "\n" });
  const fd = openSync(path, "r+");
  for (const e of gpt(path).entries) {
    const bytes =
      e.type === ESP
        ? randomBytes(e.bytes)
        : e.type === HOME
          ? Buffer.alloc(e.bytes)
          : Buffer.alloc(e.bytes, e.type === ROOT ? fill : fill.toLowerCase());
    if (e.type === ESP) PLACEHOLDER.copy(bytes, 100 * 512);
    writeSync(fd, bytes, 0, bytes.length, e.offset);
  }
  closeSync(fd);
  return path;
}

function region(path: string, type: string): Buffer {
  const e = gpt(path).entries.find((p) => p.type === type);
  assert.ok(e);
  const b = Buffer.alloc(e.bytes);
  const fd = openSync(path, "r");
  readSync(fd, b, 0, e.bytes, e.offset);
  closeSync(fd);
  return b;
}

const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A file of `mib` MiB standing in for a stick, full of an old stick's bytes. */
function stick(name: string, mib = 64): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.alloc(mib * 1024 * 1024, 0x5a));
  return path;
}

/** Publishes `img` into its own folder, served under /<name>/stick/. */
const sites = new Map<string, string>();
async function site(name: string, img: string): Promise<string> {
  const out = join(dir, `site-${name}`);
  await publish(img, out, true);
  sites.set(name, out);
  return `${base}/${name}/stick`;
}

let server: Server;
let base = "";
before(async () => {
  // The installer for this machine, as installer.sh --native builds it.
  execFileSync("os/scripts/installer.sh", ["--native"], { cwd: root, stdio: "ignore" });
  server = createServer((req, res) => {
    const path = decodeURIComponent(req.url ?? "/");
    let file: string | undefined;
    if (path === "/install.sh") file = join(root, "web/public/install.sh");
    const m = /^\/([a-z0-9-]+)\/stick\/(.+)$/.exec(path);
    const out = m && sites.get(m[1] ?? "");
    if (m && out && !m[2]?.includes("..")) file = join(out, m[2] ?? "");
    if (!file || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

/** The shells install.sh must run under: macOS's sh is bash, Debian's is dash. */
const shells = [["bash", "--posix"], ["dash"], ["busybox", "sh"]].filter(
  ([shell]) => spawnSync("sh", ["-c", `command -v ${shell}`]).status === 0,
);

/** `curl -fsSL …/install.sh | sh`, answering its questions with `answers`. Async: the
 * server answering curl runs in this process. */
function run(
  url: string,
  target: string,
  answers: string[],
  shell = shells[0] ?? ["sh"],
): Promise<{ status: number; out: string }> {
  const tty = join(dir, `answers-${randomUUID()}`);
  writeFileSync(tty, answers.map((a) => `${a}\n`).join(""));
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const child = spawn("sh", ["-c", `curl -fsSL ${base}/install.sh | ${shell.join(" ")}`], {
    env: {
      PATH: process.env.PATH,
      HOME: home,
      BISMILLAH_STICK_URL: url,
      BISMILLAH_TEST_STICK: target,
      BISMILLAH_TEST_TTY: tty,
    },
  });
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr.on("data", (d: Buffer) => (out += d.toString()));
  return new Promise((resolve) =>
    child.on("close", (status) => resolve({ status: status ?? -1, out })),
  );
}

void test("the command installs a published image, and stick.ts knows the stick", async () => {
  const img = image("a.raw");
  const url = await site("install", img);
  for (const shell of shells) {
    const target = stick(`installed-${shell[0]}.raw`);
    const { status, out } = await run(url, target, ["test stick"], shell);
    assert.equal(status, 0, out);
    assert.match(out, /Done\. Take the stick out/);
    const seen = identify(target);
    assert.ok(seen.gpt && typeof seen.file === "object", JSON.stringify(seen));
    assert.deepEqual(seen.file, seen.gpt);
    assert.notEqual(seen.gpt.disk, gpt(img).disk);
    const verify = spawnSync("sfdisk", ["--verify", target], { encoding: "utf8" });
    assert.match(verify.stdout, /No errors detected/);
    assert.doesNotMatch(`${verify.stdout}${verify.stderr}`, /mismatch/);
    assert.equal(hash(region(target, ROOT)), hash(region(img, ROOT)));
    assert.ok(
      region(target, HOME).every((b) => b === 0),
      "home is empty",
    );
  }
});

void test("a stick flash.sh wrote updates through the command and keeps its texts", async () => {
  const target = join(dir, "flashed.raw");
  prepare(image("old.raw", "A"), target);
  const homeEntry = gpt(target).entries.find((e) => e.type === HOME);
  assert.ok(homeEntry);
  const texts = randomBytes(homeEntry.bytes);
  const fd = openSync(target, "r+");
  writeSync(fd, texts, 0, texts.length, homeEntry.offset);
  closeSync(fd);
  const before = identify(target).gpt;

  const img = image("new.raw", "B");
  const url = await site("update", img);
  const { status, out } = await run(url, target, ["1", "test stick"]);
  assert.equal(status, 0, out);
  assert.match(out, /is a bismillah stick/);
  const after = identify(target);
  assert.deepEqual(after.gpt, before);
  assert.deepEqual(after.file, before);
  assert.equal(hash(region(target, ROOT)), hash(region(img, ROOT)));
  assert.equal(
    gpt(target).entries.find((e) => e.type === ROOT)?.uuid,
    gpt(img).entries.find((e) => e.type === ROOT)?.uuid,
  );
  assert.ok(region(target, HOME).equals(texts), "home is untouched");
});

void test("a damaged download, a wrong name or no image yet writes nothing", async () => {
  const url = await site("damaged", image("c.raw"));
  const target = stick("untouched.raw");
  const before = hash(readFileSync(target));

  // The name typed back is wrong.
  let r = await run(url, target, ["another stick"]);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /Nothing was written/);
  assert.equal(hash(readFileSync(target)), before);

  // A part changed after it was published: the script refuses it, and so would the
  // installer.
  const out = sites.get("damaged") ?? "";
  const version = readFileSync(join(out, "current"), "utf8").trim();
  const part = join(out, version, "image-000.gz");
  const bytes = readFileSync(part);
  bytes[200] = (bytes[200] ?? 0) ^ 1;
  writeFileSync(part, bytes);
  rmSync(join(dir, "home"), { recursive: true, force: true });
  r = await run(url, target, ["test stick"]);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /arrived damaged/);
  assert.equal(hash(readFileSync(target)), before);

  // The site before any image is published.
  writeFileSync(join(out, "current"), "none\n");
  r = await run(url, target, ["test stick"]);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /No bismillah stick image is published yet/);
});

void test("a cut-off download of the script runs nothing", () => {
  const script = readFileSync(join(root, "web/public/install.sh"), "utf8");
  const cut = script.slice(0, script.lastIndexOf("main "));
  const r = spawnSync("sh", ["-c", cut], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0);
  assert.equal(`${r.stdout}${r.stderr}`, "");
});

void test("without a terminal to ask in, the script says so and writes nothing", () => {
  const r = spawnSync("sh", [join(root, "web/public/install.sh")], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, BISMILLAH_TEST_TTY: join(dir, "no-such-terminal") },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Run this in a terminal/);
});
