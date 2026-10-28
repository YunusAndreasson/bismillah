import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { frames } from "../scripts/vm.ts";

const dir = mkdtempSync(join(tmpdir(), "bismillah-capture-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const header = Buffer.from("d4c3b2a10200040000000000000000000000010001000000", "hex");
function capture(name: string, data: Buffer): string {
  const file = join(dir, name);
  writeFileSync(file, data);
  return file;
}

void test("a complete empty capture proves zero frames", () => {
  assert.equal(frames(capture("empty.pcap", header)), 0);
});

void test("missing or invalid capture evidence cannot prove zero frames", () => {
  assert.throws(() => frames(join(dir, "missing.pcap")));
  for (const data of [Buffer.alloc(0), header.subarray(0, 23), Buffer.alloc(24)])
    assert.throws(() => frames(capture("invalid.pcap", data)), /pcap/i);
});

void test("counts complete packet records and rejects truncated records", () => {
  const record = Buffer.alloc(16);
  record.writeUInt32LE(4, 8);
  record.writeUInt32LE(4, 12);
  const packet = Buffer.concat([record, Buffer.from([1, 2, 3, 4])]);
  assert.equal(frames(capture("packets.pcap", Buffer.concat([header, packet, packet]))), 2);
  for (const tail of [record.subarray(0, 15), record, packet.subarray(0, 19)])
    assert.throws(() => frames(capture("truncated.pcap", Buffer.concat([header, tail]))), /pcap/i);
  const inconsistent = Buffer.from(packet);
  inconsistent.writeUInt32LE(3, 12); // Captured length cannot exceed the original packet.
  assert.throws(
    () => frames(capture("inconsistent.pcap", Buffer.concat([header, inconsistent]))),
    /pcap/i,
  );
});
