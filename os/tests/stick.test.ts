/**
 * The reflash tool (os/scripts/stick.ts) on small made-up sticks: GPTs written by
 * sfdisk, with filler bytes for each partition and the ESP's stick-id block. The VM
 * scenario `reflash` does the same with real images and a real home.
 *
 *   node --test os/tests/stick.test.ts
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
  closeSync,
  readSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { ESP, gpt, HOME, ROOT, ROOT_VERITY } from "../scripts/image.ts";
import {
  identify,
  ours,
  prepare,
  readRegistry,
  record,
  Refusal,
  update,
} from "../scripts/stick.ts";

const dir = mkdtempSync(join(tmpdir(), "bismillah-stick-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const PLACEHOLDER = Buffer.from(
  "bismillah stick id 1\nunflashed\n".padEnd(511, "#") + "\n",
  "latin1",
);

interface Spec {
  root?: number;
  fill?: string;
  /** Where in the ESP the stick-id placeholder goes, in 512-byte blocks. */
  idAt?: number;
  home?: boolean;
  extra?: boolean;
}

/** A made-up image: ESP 2 MiB, root, verity 1 MiB, home 2 MiB. */
function image(name: string, spec: Spec = {}): string {
  const path = join(dir, name);
  const rootMiB = spec.root ?? 4;
  writeFileSync(path, Buffer.alloc(0));
  execFileSync("truncate", ["-s", `${12 + rootMiB}M`, path]);
  const lines = [
    "label: gpt",
    `size=2MiB, type=${ESP}`,
    `size=${rootMiB}MiB, type=${ROOT}, uuid=${randomUUID()}`,
    `size=1MiB, type=${ROOT_VERITY}, uuid=${randomUUID()}`,
    ...(spec.home === false ? [] : [`size=2MiB, type=${HOME}`]),
    ...(spec.extra ? ["size=1MiB, type=0fc63daf-8483-4772-8e79-3d69d8477de4"] : []),
  ];
  execFileSync("sfdisk", ["--quiet", path], { input: lines.join("\n") + "\n" });
  const fd = openSync(path, "r+");
  const fill = spec.fill ?? "A";
  for (const e of gpt(path).entries) {
    const bytes =
      e.type === ESP
        ? randomBytes(e.bytes)
        : Buffer.alloc(
            e.bytes,
            e.type === HOME ? "H" : e.type === ROOT ? fill : fill.toLowerCase(),
          );
    if (e.type === ESP) PLACEHOLDER.copy(bytes, (spec.idAt ?? 100) * 512);
    writeSync(fd, bytes, 0, bytes.length, e.offset);
  }
  closeSync(fd);
  return path;
}

const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function region(path: string, type: string): Buffer {
  const e = gpt(path).entries.find((p) => p.type === type);
  assert.ok(e);
  const b = Buffer.alloc(e.bytes);
  const fd = openSync(path, "r");
  readSync(fd, b, 0, e.bytes, e.offset);
  closeSync(fd);
  return b;
}

/** A stick flashed from a made-up image and recorded in its own registry. */
function flashed(name: string): { stick: string; registry: string } {
  const stick = join(dir, `${name}.raw`);
  const registry = join(dir, `${name}.toml`);
  prepare(image(`${name}-image.raw`), stick);
  record(stick, registry, "release test");
  return { stick, registry };
}

void test("a prepared stick has its own GUIDs, written in its GPT and its stick-id", () => {
  const source = image("source.raw");
  const a = join(dir, "a.raw");
  const b = join(dir, "b.raw");
  const idA = prepare(source, a);
  const idB = prepare(source, b);
  assert.notEqual(idA.disk, idB.disk);
  assert.notEqual(gpt(source).disk, idA.disk);
  const seen = identify(a);
  assert.deepEqual(seen.gpt, idA);
  assert.deepEqual(seen.file, idA);
  // Root and verity keep the image's GUIDs: the boot finds them by the root hash.
  assert.equal(
    gpt(a).entries.find((e) => e.type === ROOT)?.uuid,
    gpt(source).entries.find((e) => e.type === ROOT)?.uuid,
  );
  assert.equal(identify(source).file, "unflashed");
});

void test("an update rewrites the system, takes the new root GUIDs and leaves home alone", () => {
  const { stick, registry } = flashed("update");
  const homeBefore = region(stick, HOME);
  const next = image("next.raw", { fill: "B", idAt: 300 });
  update(next, stick, registry, () => undefined);
  assert.deepEqual(region(stick, ROOT), region(next, ROOT));
  assert.deepEqual(region(stick, ROOT_VERITY), region(next, ROOT_VERITY));
  assert.deepEqual(region(stick, HOME), homeBefore);
  for (const type of [ROOT, ROOT_VERITY])
    assert.equal(
      gpt(stick).entries.find((e) => e.type === type)?.uuid,
      gpt(next).entries.find((e) => e.type === type)?.uuid,
    );
  // Still the same stick: the stick-id moved with the new ESP.
  const id = identify(stick);
  assert.deepEqual(id.file, id.gpt);
  const [entry] = readRegistry(registry);
  assert.equal(entry?.updating, false);
  assert.match(entry?.system ?? "", /^image /);
  // And it can be updated again.
  update(image("again.raw", { fill: "C" }), stick, registry, () => undefined);
});

void test("a stick this machine didn't record is refused, and nothing is written", () => {
  const { registry } = flashed("known");
  const stranger = join(dir, "stranger.raw");
  prepare(image("stranger-image.raw"), stranger);
  const before = hash(stranger);
  assert.throws(() => update(image("n1.raw", { fill: "B" }), stranger, registry), Refusal);
  assert.equal(hash(stranger), before);
  // A twin: the same GUIDs as a recorded stick in its GPT, but another stick-id.
  const { stick } = flashed("twin");
  const fd = openSync(stick, "r+");
  const esp = gpt(stick).entries.find((e) => e.type === ESP);
  const block = Buffer.from(
    `bismillah stick id 1\ndisk ${randomUUID()}\nesp ${randomUUID()}\nhome ${randomUUID()}\n`.padEnd(
      511,
      "#",
    ) + "\n",
  );
  writeSync(fd, block, 0, 512, (esp?.offset ?? 0) + 100 * 512);
  closeSync(fd);
  assert.throws(() => ours(stick, join(dir, "twin.toml")), /other GUIDs/);
});

void test("a system bigger than the stick's slot is refused before anything is written", () => {
  const { stick, registry } = flashed("small");
  const before = hash(stick);
  assert.throws(
    () => update(image("big.raw", { root: 6 }), stick, registry),
    /bigger than the stick's slot/,
  );
  assert.equal(hash(stick), before);
  assert.equal(readRegistry(registry)[0]?.updating, false);
});

void test("a disk with a missing or a foreign partition is refused", () => {
  const registry = join(dir, "none.toml");
  assert.throws(() => prepare(image("nohome.raw", { home: false }), join(dir, "x.raw")), Refusal);
  assert.throws(() => identify(image("extra.raw", { extra: true })), /another type/);
  assert.throws(() => ours(image("plain.raw"), registry), /isn't a stick this machine flashed/);
});

void test("an interrupted update, its stick-id half-written, can be run again", () => {
  const { stick, registry } = flashed("interrupted");
  // As if the ESP was being written: the old stick-id is gone, the registry says updating.
  const esp = gpt(stick).entries.find((e) => e.type === ESP);
  const fd = openSync(stick, "r+");
  writeSync(fd, Buffer.alloc(512), 0, 512, (esp?.offset ?? 0) + 100 * 512);
  closeSync(fd);
  assert.throws(() => ours(stick, registry), /stick-id is missing/);
  writeFileSync(
    registry,
    readFileSync(registry, "utf8").replace("updating = false", "updating = true"),
  );
  update(image("resume.raw", { fill: "D" }), stick, registry, () => undefined);
  const id = identify(stick);
  assert.deepEqual(id.file, id.gpt);
});
