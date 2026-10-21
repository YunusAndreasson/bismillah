#!/usr/bin/env bash
# OS-0 "Size and boot baseline": boots one persistent copy of a product-like image
# (app + unlock + nonet + gpu + probe + slim profiles) in the Secure Boot VM with the
# stick's reads throttled, and records each boot's stages:
#   QEMU start → unlock screen painted (wall clock, host side)
#   systemd-analyze: firmware, loader, kernel, initrd, userspace
#   kernel start → unlock screen painted (the app's mark, uptime)
#   Unlock pressed → caret in the document (the app's marks)
# The first boot sets the stick up unthrottled; then one boot per profile:
#   ssd    no limit
#   good   150 MB/s, 2500 requests/s (a fast USB 3 stick)
#   cheap  25 MB/s, 400 requests/s (a slow USB 2-class stick)
# Each request costs one operation whatever its size, so small random reads hit the
# request limit and large sequential ones the bandwidth limit, as on real flash.
# Usage: boot-test.sh <vars.fd> <out-dir> <image.raw> [profile...]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
vars=$1
out=$(realpath -m "$2")
image=$3
shift 3
profiles=("$@")
[ ${#profiles[@]} -gt 0 ] || profiles=(ssd good cheap)
pass='Ward of the night 7'
mkdir -p "$out"
sock=$(mktemp -u "${XDG_RUNTIME_DIR:?}/bismillah-qmp.XXXXXX")
cmdsock=$(mktemp -u "${XDG_RUNTIME_DIR:?}/bismillah-cmd.XXXXXX")
qemu=
trap '{ [ -z "$qemu" ] || kill "$qemu" 2>/dev/null || true; }; rm -f "$sock" "$cmdsock"; true' EXIT
cp --sparse=always "$image" "$out/stick.raw"
cp "$vars" "$out/vars.fd"
sync # an unflushed copy on the encrypted host disk stalls the firmware's reads

qmp() { python3 "$here/qmp.py" "$sock" "$@"; }
guest() { printf '%s\n' "$1" | socat - UNIX-CONNECT:"$cmdsock"; }
count() { local n; n=$(grep -ac -- "$1" "$log" 2>/dev/null); echo "${n:-0}"; }
wait_for() { # pattern, seconds, [count]
  local i
  for ((i = 0; i < $2 * 20; i++)); do
    [ "$(count "$1")" -ge "${3:-1}" ] && return 0
    sleep 0.05
  done
  echo "timeout: $1" >&2
  return 1
}

boot() { # name, throttle options
  log=$out/$1.log
  rm -f "$log" "$sock" "$cmdsock"
  start=$(date +%s.%N)
  qemu-system-x86_64 \
    -machine q35,smm=on,accel=kvm -cpu host -smp 2 -m 2G \
    -global driver=cfi.pflash01,property=secure,value=on \
    -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.secboot.4m.fd \
    -drive if=pflash,format=raw,unit=1,file="$out/vars.fd" \
    -device qemu-xhci,id=xhci \
    -drive if=none,id=stick,format=raw,cache=none,aio=native,file="$out/stick.raw$2" \
    -device usb-storage,bus=xhci.0,drive=stick,bootindex=0 \
    -nic none -display none -no-reboot -vga std \
    -qmp unix:"$sock",server=on,wait=off \
    -serial file:"$log" -serial unix:"$cmdsock",server=on,wait=off &
  qemu=$!
  wait_for page-gate-shown 300
  echo "$1 qemu-start-to-unlock-screen $(python3 -c "import sys; print(f\"{float(sys.argv[2]) - float(sys.argv[1]):.2f}\")" "$start" "$(date +%s.%N)")" | tee -a "$out/times.txt"
}

halt() {
  qmp cmd system_powerdown >/dev/null
  timeout 60 tail --pid="$qemu" -f /dev/null || kill "$qemu"
  qemu=
}

# 1. Setup, unthrottled: accept the offered layouts, then the passphrase.
boot setup ""
sleep 2
qmp key ret
wait_for page-gate-shown 60 2
sleep 2
qmp type "$pass"
qmp key ret
wait_for page-editable 120
halt

# 2. One unlock boot per profile.
for p in "${profiles[@]}"; do
  case $p in
    ssd) t="" ;;
    good) t=",throttling.bps-read=157286400,throttling.iops-read=2500" ;;
    cheap) t=",throttling.bps-read=26214400,throttling.iops-read=400" ;;
    *) echo "unknown profile $p" >&2; exit 2 ;;
  esac
  # -drive takes the throttle options after the file name's own comma.
  boot "$p" "${t:+$t}"
  sleep 3
  qmp screendump "$out/$p-locked.ppm"
  qmp type "$pass"
  qmp key ret
  wait_for page-editable 120
  sleep 2
  # Each end marker is computed, so the echoed command line can't satisfy the wait.
  guest 'echo "SPIKE analyze $(systemd-analyze 2>&1 | head -1)"; echo "SPIKE end $((1 + 1))"'
  wait_for 'SPIKE end 2' 30
  guest 'systemd-analyze critical-chain bismillah-session.service --no-pager 2>&1 | sed "s/^/SPIKE chain /"; echo "SPIKE end $((2 + 1))"'
  wait_for 'SPIKE end 3' 30
  guest 'systemd-analyze blame --no-pager 2>&1 | grep -v "tty\|serial\|fuse" | head -10 | sed "s/^/SPIKE blame /"; echo "SPIKE end $((3 + 1))"'
  wait_for 'SPIKE end 4' 30
  # The initrd's steps: the stick appearing, the verity root, the switch.
  guest 'journalctl -b -o short-monotonic --no-pager | grep -E "usb [0-9-]+: new .*speed|sd [0-9:]+: \[sda\] Attached|Starting.*veritysetup|Finished.*veritysetup|sysroot.mount|Switching root|Started bismillah-session|dev-dri-boot|Initialized (i915|bochs|virtio_gpu|nouveau|amdgpu)" | sed "s/^/SPIKE stage /"; echo "SPIKE end $((4 + 1))"'
  wait_for 'SPIKE end 5' 30
  halt
done

for f in "$out"/*.ppm; do magick "$f" "${f%.ppm}.png" && rm "$f"; done
for p in "${profiles[@]}"; do
  echo "== $p"
  grep -a "qemu-start" "$out/times.txt" | grep "^$p "
  grep -a -E 'BISMILLAH_MARK (app-process-start|page-gate-shown|app-unlock-sent|helper-kdf-open-done|helper-unlock-done|app-unlock-answered|page-editable)|SPIKE (analyze|chain|blame|stage)' "$out/$p.log" |
    sed 's/\x1b\[[0-9;]*m//g'
done >"$out/report.txt"
cat "$out/report.txt"
