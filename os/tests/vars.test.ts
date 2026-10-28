import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { varsFile } from "../scripts/vm.ts";

void test("failed firmware generation cannot become a cached variable store", (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "bismillah-vars-"));
  const bin = join(scratch, "bin");
  const output = join(scratch, "vars");
  mkdirSync(bin);
  const failing = join(bin, "fail");
  writeFileSync(failing, "fail");
  writeFileSync(
    join(bin, "virt-fw-vars"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const output = process.argv[process.argv.indexOf("-o") + 1];
fs.writeFileSync(output, "partial firmware");
if (fs.existsSync(path.join(__dirname, "fail"))) process.exit(1);
fs.writeFileSync(output, "completed firmware");
fs.appendFileSync(path.join(__dirname, "completed"), "1");
`,
    { mode: 0o755 },
  );
  const previous = process.env["PATH"];
  process.env["PATH"] = `${bin}:${previous ?? ""}`;
  t.after(() => {
    if (previous === undefined) delete process.env["PATH"];
    else process.env["PATH"] = previous;
    rmSync(scratch, { recursive: true, force: true });
  });
  assert.throws(() => varsFile("both", output));
  assert.equal(existsSync(join(output, "both.fd")), false, "partial output must not be cached");
  assert.deepEqual(readdirSync(output), [], "failed generation cleans its temporary files");
  rmSync(failing);
  const file = varsFile("both", output);
  assert.equal(readFileSync(file, "utf8"), "completed firmware");
  assert.equal(varsFile("both", output), file);
  assert.equal(readFileSync(join(bin, "completed"), "utf8"), "1", "completed stores are reused");
  assert.deepEqual(readdirSync(output), ["both.fd"]);
});
