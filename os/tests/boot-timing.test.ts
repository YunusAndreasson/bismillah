import assert from "node:assert/strict";
import { test } from "node:test";
import { switchRootSeconds } from "../scripts/boot-timing.ts";

void test("reads seconds and milliseconds from a recorded VM startup", () => {
  const line = "Startup finished in 987ms (kernel) + 2.631s (initrd) + 2.283s (userspace) = 5.902s";
  assert.equal(switchRootSeconds(line), 3.618);
});

void test("keeps the minutes in slow kernel and initrd stages", () => {
  const line =
    "Startup finished in 1min 5s (kernel) + 2min 300ms (initrd) + 2s (userspace) = 3min 7.3s";
  assert.equal(switchRootSeconds(line), 185.3);
});

void test("refuses unfinished or incomplete boot timings instead of substituting zero", () => {
  for (const line of [
    "Bootup is not yet finished (org.freedesktop.systemd1.Manager.FinishTimestampMonotonic=0).",
    "Startup finished in 2s (kernel) + 3s (userspace) = 5s",
    "Startup finished in 2s (initrd) + 3s (userspace) = 5s",
    "",
  ])
    assert.throws(() => switchRootSeconds(line), /kernel and initrd/);
});
