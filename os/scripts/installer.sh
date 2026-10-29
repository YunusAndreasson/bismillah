#!/usr/bin/env bash
# Builds bismillah-install (crates/bismillah-install) for each OS the install scripts
# serve, into os/out/installer/, for os/scripts/publish.ts to put in the bundle
# (ADR-0017). Static binaries, so they run on any Linux, macOS 11+ and Windows 10+:
#
#   linux-x86_64, linux-aarch64   musl
#   macos-x86_64, macos-aarch64   ad-hoc signed, as Apple silicon requires
#   windows-x86_64                mingw (Windows on Arm runs it emulated)
#
# Needs rustup with those five targets, zig and cargo-zigbuild, which link the macOS
# and musl builds without Apple's SDK, and rcodesign when zig's linker leaves a macOS
# binary unsigned. --native builds only this machine's linux-x86_64, with the system
# Rust, for the tests.
#
# Usage: os/scripts/installer.sh [--native]
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
out=$root/os/out/installer
mkdir -p "$out"
cd "$root"

if [ "${1:-}" = --native ]; then
  cargo build --release --locked -p bismillah-install
  install -m 755 target/release/bismillah-install "$out/bismillah-install-linux-x86_64"
  echo "built $out/bismillah-install-linux-x86_64 (glibc, this machine only)"
  exit 0
fi

targets=(
  "linux-x86_64 x86_64-unknown-linux-musl"
  "linux-aarch64 aarch64-unknown-linux-musl"
  "macos-x86_64 x86_64-apple-darwin"
  "macos-aarch64 aarch64-apple-darwin"
  "windows-x86_64 x86_64-pc-windows-gnu"
)

missing=()
for tool in rustup zig cargo-zigbuild; do
  command -v "$tool" >/dev/null || missing+=("$tool")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "installer.sh needs ${missing[*]} (rustup, then: rustup target add" \
    "x86_64-unknown-linux-musl aarch64-unknown-linux-musl x86_64-apple-darwin" \
    "aarch64-apple-darwin x86_64-pc-windows-gnu; zig; cargo install --locked cargo-zigbuild)." >&2
  exit 1
fi
installed=$(rustup target list --installed)
for entry in "${targets[@]}"; do
  target=${entry#* }
  grep -qx "$target" <<<"$installed" || {
    echo "rustup has no $target: rustup target add $target" >&2
    exit 1
  }
done

for entry in "${targets[@]}"; do
  platform=${entry%% *} target=${entry#* }
  echo "building $platform ($target)"
  cargo zigbuild --release --locked -p bismillah-install --target "$target"
  case $platform in
    windows-*) install -m 755 "target/$target/release/bismillah-install.exe" "$out/bismillah-install-$platform.exe" ;;
    *) install -m 755 "target/$target/release/bismillah-install" "$out/bismillah-install-$platform" ;;
  esac
done

# Apple silicon runs no unsigned code; an ad-hoc signature is enough for a binary that
# curl downloaded (no quarantine). zig's linker signs aarch64 output itself; rcodesign
# signs whatever it didn't.
signed() { # does the Mach-O have an LC_CODE_SIGNATURE load command?
  node -e '
    const b = require("fs").readFileSync(process.argv[1]);
    if (b.readUInt32LE(0) !== 0xfeedfacf) process.exit(2);
    let at = 32;
    for (let i = 0; i < b.readUInt32LE(16); i++, at += b.readUInt32LE(at + 4))
      if (b.readUInt32LE(at) === 0x1d) process.exit(0);
    process.exit(1);' "$1"
}
for platform in macos-x86_64 macos-aarch64; do
  bin=$out/bismillah-install-$platform
  if command -v rcodesign >/dev/null; then
    rcodesign sign "$bin"
  elif ! signed "$bin"; then
    echo "$bin has no code signature, and rcodesign isn't installed to add one." >&2
    exit 1
  fi
done
ls -l "$out"
