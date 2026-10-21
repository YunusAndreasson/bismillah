#!/usr/bin/env bash
# OS-0 "Unlock in the app": three boots of one persistent copy of the stick in the
# Secure Boot VM (unlock profile): first-boot setup; unlock with a wrong and then the
# right passphrase; and the restart alternative (systemd.setenv=BISMILLAH_SPIKE_RESTART=1).
# Serial logs with BISMILLAH_MARK lines and screenshots go to <out>.
# Usage: unlock-test.sh <vars.fd> <out-dir> [image.raw]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
vars=$1
out=$(realpath -m "$2")
image=${3:-$here/bismillah-spike-boot.raw}
mtools=$here/mkosi.tools/usr/bin
esp="$out/stick.raw@@1048576"
pass='Ward of the night 7'
mkdir -p "$out"
# Unix socket paths must stay under 108 bytes, so QMP's lives in the runtime dir.
sock=$(mktemp -u "${XDG_RUNTIME_DIR:?}/bismillah-qmp.XXXXXX")
qemu=
# A failed step must not leave its VM running: strays starve the next boots.
trap '{ [ -z "$qemu" ] || kill "$qemu" 2>/dev/null || true; }; rm -f "$sock"; true' EXIT
cp --sparse=always "$image" "$out/stick.raw"
cp "$vars" "$out/vars.fd"

qmp() { python3 "$here/qmp.py" "$sock" "$@"; }

wait_for() { # log, pattern, seconds
  local i
  for ((i = 0; i < $3 * 10; i++)); do
    grep -q -- "$2" "$1" 2>/dev/null && return 0
    sleep 0.1
  done
  echo "timeout: $2 in $1" >&2
  return 1
}

boot() { # name
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
  wait_for "$out/$1.log" "page-gate-shown" 120
  sleep 2 # let the frame settle before the screenshot
}

shutdown() {
  qmp cmd system_powerdown
  timeout 60 tail --pid="$qemu" -f /dev/null || kill "$qemu"
}

# 1. First boot: setup.
boot setup
qmp screendump "$out/1-setup.ppm"
qmp type "$pass"
qmp key ret
wait_for "$out/setup.log" "page-editable" 60
sleep 2
qmp screendump "$out/2-after-setup.ppm"
shutdown

# 2. Unlock: a wrong passphrase, then the right one.
boot unlock
qmp screendump "$out/3-locked.ppm"
qmp type "not it"
qmp key ret
wait_for "$out/unlock.log" "app-unlock-answered" 30
sleep 3
qmp screendump "$out/4-wrong.ppm"
for _ in $(seq 6); do qmp key backspace; done
qmp type "$pass"
qmp key ret
wait_for "$out/unlock.log" "page-editable" 60
sleep 2
qmp screendump "$out/5-unlocked.ppm"
shutdown

# 3. The restart alternative: same stick, the app exits after unlock.
entry=$("$mtools/mdir" -b -i "$esp" ::/loader/entries/ | head -1)
"$mtools/mtype" -i "$esp" "$entry" | sed '/^options/ s/$/ systemd.setenv=BISMILLAH_SPIKE_RESTART=1/' >"$out/entry.conf"
"$mtools/mcopy" -o -i "$esp" "$out/entry.conf" "$entry"
boot restart
qmp type "$pass"
qmp key ret
wait_for "$out/restart.log" "page-editable" 60
sleep 2
qmp screendump "$out/6-restarted.ppm"
shutdown

for f in "$out"/*.ppm; do magick "$f" "${f%.ppm}.png" && rm "$f"; done
grep -h -E 'BISMILLAH_MARK|SPIKE pre-mount|secureboot' "$out"/{setup,unlock,restart}.log
