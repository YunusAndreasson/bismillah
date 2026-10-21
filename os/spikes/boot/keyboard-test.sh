#!/usr/bin/env bash
# OS-0 "Keyboard": two boots of one persistent copy of the stick (unlock profile) in the
# Secure Boot VM, typing through QMP.
#   1. Setup: choose "se,ara" (stored in /run, applied by a session restart), set a
#      passphrase typed partly in Swedish and partly in Arabic (Alt+Shift switches),
#      then lock with Ctrl+Alt+L and pass the lock with the same keys.
#   Between boots, the host checks the LUKS2 header: the token, and that the typed
#   bytes are exactly the expected UTF-8 passphrase.
#   2. Unlock: the layouts come from the token before unlock; Caps Lock shows; unlock.
# Usage: keyboard-test.sh <vars.fd> <out-dir> [image.raw]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
vars=$1
out=$(realpath -m "$2")
image=${3:-$here/bismillah-spike-boot.raw}
mkdir -p "$out"
# Unix socket paths must stay under 108 bytes, so QMP's lives in the runtime dir.
sock=$(mktemp -u "${XDG_RUNTIME_DIR:?}/bismillah-qmp.XXXXXX")
qemu=
# A failed step must not leave its VM running: strays starve the next boots.
trap '{ [ -z "$qemu" ] || kill "$qemu" 2>/dev/null || true; }; rm -f "$sock"; true' EXIT
cp --sparse=always "$image" "$out/stick.raw"
cp "$vars" "$out/vars.fd"
sync # the host disk is encrypted: an unflushed 2 GB copy stalls the VM's first reads

# The passphrase as keys on the physical keyboard, and what se,ara must make of them:
# å ä ö (se), Alt+Shift, ب ل ا (ara), Alt+Shift, 7 (se).
expected='åäöبلا7'
type_passphrase() {
  qmp key bracket_left; qmp key apostrophe; qmp key semicolon
  qmp key alt shift
  qmp key f; qmp key g; qmp key h
  qmp key alt shift
  qmp key 7
}

qmp() { python3 "$here/qmp.py" "$sock" "$@"; }

wait_for() { # log, pattern, seconds, [count]
  local i n
  for ((i = 0; i < $3 * 10; i++)); do
    n=$(grep -a -c -- "$2" "$1" 2>/dev/null) || true
    [ "${n:-0}" -ge "${4:-1}" ] && return 0
    sleep 0.1
  done
  echo "timeout: $2 in $1" >&2
  return 1
}

boot() { # name; retries once when the firmware stalls before starting the stick
  start_vm "$1"
  if ! wait_for "$out/$1.log" "BdsDxe: starting" 40; then
    echo "firmware stalled; retrying $1" >&2
    kill "$qemu"; wait "$qemu" 2>/dev/null || true
    mv "$out/$1.log" "$out/$1.stalled.log"
    start_vm "$1"
  fi
  wait_for "$out/$1.log" "page-gate-shown" 120
  sleep 2
}

start_vm() { # name
  rm -f "$sock"
  qemu-system-x86_64 \
    -machine q35,smm=on,accel=kvm -cpu host -smp 2 -m 2G \
    -global driver=cfi.pflash01,property=secure,value=on \
    -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.secboot.4m.fd \
    -drive if=pflash,format=raw,unit=1,file="$out/vars.fd" \
    -device qemu-xhci,id=xhci \
    -drive if=none,id=stick,format=raw,file="$out/stick.raw" \
    -device usb-storage,bus=xhci.0,drive=stick,bootindex=0 \
    -nic none -display none -no-reboot -device virtio-vga \
    -qmp unix:"$sock",server=on,wait=off \
    -serial file:"$out/$1.log" &
  qemu=$!
}

shutdown() {
  qmp cmd system_powerdown
  timeout 60 tail --pid="$qemu" -f /dev/null || kill "$qemu"
  qemu=
}

# 1. Setup.
boot setup
qmp screendump "$out/k1-choose-layouts.ppm"
qmp key ret # the field is prefilled with "se,ara"
wait_for "$out/setup.log" "page-gate-shown" 60 2
sleep 2
qmp screendump "$out/k2-setup-se.ppm"
qmp key bracket_left # one key, so the indicator has seen a key event
qmp key backspace
qmp key alt shift
qmp key f
sleep 1
qmp screendump "$out/k3-setup-ara.ppm"
qmp key backspace
qmp key alt shift
type_passphrase
qmp key ret
wait_for "$out/setup.log" "page-editable" 60
sleep 2
qmp key ctrl alt l
wait_for "$out/setup.log" "page-locked" 10
sleep 1
qmp screendump "$out/k4-locked.ppm"
type_passphrase
qmp key ret
wait_for "$out/setup.log" "page-lock-passed" 30
shutdown

# Between boots: the token and the exact bytes, from the stick's home header.
start=$(sfdisk -d "$out/stick.raw" | sed -n 's/.*start= *\([0-9]*\),.*name="bismillah-home".*/\1/p')
dd if="$out/stick.raw" of="$out/home-header.img" bs=512 skip="$start" count=32768 status=none
cryptsetup luksDump "$out/home-header.img" | sed -n '/^Tokens:/,/^Digests:/p' >"$out/tokens.txt"
if printf %s "$expected" | cryptsetup open --test-passphrase --key-file=- "$out/home-header.img"; then
  echo "HOST passphrase bytes: match $(printf %s "$expected" | od -An -tx1 | tr -s ' ')" | tee "$out/host-check.txt"
else
  echo "HOST passphrase bytes: NO MATCH" | tee "$out/host-check.txt"
fi

# 2. Unlock, with the layouts from the token.
boot unlock
qmp key caps_lock
sleep 1
qmp screendump "$out/k5-unlock-caps.ppm"
qmp key caps_lock
type_passphrase
qmp key ret
wait_for "$out/unlock.log" "page-editable" 60
shutdown

for f in "$out"/*.ppm; do magick "$f" "${f%.ppm}.png" && rm "$f"; done
grep -a -h -E 'BISMILLAH_MARK|SPIKE keyboard' "$out"/{setup,unlock}.log | sed 's/\r//'
cat "$out/tokens.txt" "$out/host-check.txt"
