import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const guards = fileURLToPath(new URL("../scripts/flash-safety.sh", import.meta.url));

/** Stub only the read-only inspection command. No device is opened or written. */
function inspect(
  guard: string,
  output: string,
  status = 0,
  options: { target?: string; targetStatus?: number; device?: string } = {},
) {
  return spawnSync(
    "bash",
    [
      "-euo",
      "pipefail",
      "-c",
      `source "$1"
query_output=$3
query_status=$4
target_output=$5
target_status=$6
lsblk() {
  if [[ "$1" == -dno ]]; then
    printf '%s' "$target_output"; return "$target_status"
  fi
  printf '%s' "$query_output"; return "$query_status"
}
if "$2" "$7" /dev/root; then exit 0; else exit "$?"; fi`,
      "flash-safety-test",
      guards,
      guard,
      output,
      String(status),
      options.target ?? "sdb",
      String(options.targetStatus ?? 0),
      options.device ?? "/dev/sdb",
    ],
    { encoding: "utf8" },
  );
}

void test("failed or empty root inspection cannot authorize a flash", () => {
  for (const output of ["", "sda\n"]) {
    const result = inspect("flash_check_root", output, 1);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Couldn't inspect.*Refusing/);
  }
  const empty = inspect("flash_check_root", "\n  \n");
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /No disks.*Refusing/);
  assert.equal(inspect("flash_check_root", "sda\n", 0, { targetStatus: 1 }).status, 1);
  for (const target of ["", "sdb\nsdc", " "])
    assert.equal(inspect("flash_check_root", "sda\n", 0, { target }).status, 1);
});

void test("root inspection refuses the target anywhere in the root ancestry", () => {
  for (const output of ["sdb\n", "cryptroot\nsdb2\nsdb\n", "sda\nsdb\n"])
    assert.equal(inspect("flash_check_root", output).status, 1);
  assert.equal(inspect("flash_check_root", "cryptroot\nsda2\nsda\n").status, 0);
  assert.equal(
    inspect("flash_check_root", "sdb\n", 0, { device: "/dev/disk/by-id/usb-root-alias" }).status,
    1,
  );
});

void test("mount inspection distinguishes failure from mounted and unmounted", () => {
  for (const output of ["", "/media/stick\n"]) {
    const result = inspect("flash_unmounted", output, 1);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Couldn't inspect.*Refusing/);
  }
  assert.equal(inspect("flash_unmounted", "/media/stick\n").status, 1);
  assert.equal(inspect("flash_unmounted", "\n/media/stick folder\n").status, 1);
  assert.equal(inspect("flash_unmounted", "\n \n").status, 0);
});
