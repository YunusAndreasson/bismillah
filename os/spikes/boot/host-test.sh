#!/usr/bin/env bash
# OS-0 "Host untouched" and "Boot-device binding": boots a stick image in the Secure Boot
# VM next to other disks, and records what changed outside the stick.
#   host        a fake laptop disk (NVMe: ESP, root, swap, a decoy "bismillah-home" of
#               the home type) behind a qcow2 overlay: any write allocates a cluster,
#               and QEMU counts write requests per disk.
#   twin        a second, identical stick (the same image flashed twice).
#   twin-unique a second stick whose partitions have their own UUIDs.
# The firmware variable store is dumped before and after, and diffed.
# Usage: host-test.sh <vars.fd> <out-dir> <image.raw> <bind|app> [host] [twin|twin-unique]
#   bind: the bindcheck image reports and powers off.
#   app:  the app image runs, a few words are typed, then the VM is powered down.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
vars=$1
out=$(realpath -m "$2")
image=$(realpath "$3")
mode=$4
shift 4
mkdir -p "$out"
sock=$(mktemp -u "${XDG_RUNTIME_DIR:?}/bismillah-qmp.XXXXXX")
qemu=
trap '{ [ -z "$qemu" ] || kill "$qemu" 2>/dev/null || true; }; rm -f "$sock"; true' EXIT
cp "$vars" "$out/vars.fd"
virt-fw-vars -i "$out/vars.fd" --output-json "$out/vars-before.json" 2>/dev/null
: >"$out/serial.log"

qmp() { python3 "$here/qmp.py" "$sock" "$@"; }

wait_for() { # log, pattern, seconds
  local i
  for ((i = 0; i < $3 * 10; i++)); do
    grep -a -q -- "$2" "$1" 2>/dev/null && return 0
    sleep 0.1
  done
  echo "timeout: $2 in $1" >&2
  return 1
}

disks=(
  -device qemu-xhci,id=xhci
  -drive if=none,id=stick,format=raw,snapshot=on,file="$image"
  -device usb-storage,bus=xhci.0,drive=stick,serial=STICK-A,bootindex=0
)
for extra in "$@"; do
  case $extra in
    host)
      qemu-img create -q -f qcow2 -F raw -b "$here/work/hostdisk.raw" "$out/host.qcow2"
      disks+=(-drive if=none,id=host,format=qcow2,file="$out/host.qcow2"
        -device nvme,serial=HOST-NVME,drive=host)
      ;;
    twin)
      disks+=(-drive if=none,id=twin,format=raw,snapshot=on,file="$image"
        -device usb-storage,bus=xhci.0,drive=twin,serial=STICK-B)
      ;;
    twin-unique)
      # A copy with fresh partition UUIDs (as a flash script could give each stick).
      cp --sparse=always "$image" "$out/twin.raw"
      sfdisk -q --disk-id "$out/twin.raw" "$(cat /proc/sys/kernel/random/uuid)"
      for n in $(sfdisk -d "$out/twin.raw" | sed -n 's/^[^ ]*raw\([0-9]*\) :.*/\1/p'); do
        sfdisk -q --part-uuid "$out/twin.raw" "$n" "$(cat /proc/sys/kernel/random/uuid)"
      done
      disks+=(-drive if=none,id=twin,format=raw,file="$out/twin.raw"
        -device usb-storage,bus=xhci.0,drive=twin,serial=STICK-B)
      ;;
  esac
done

# -no-shutdown keeps QEMU up after the guest powers off, so the write counters can be read.
start_vm() {
  cp "$vars" "$out/vars.fd"
  [ ! -e "$out/host.qcow2" ] || qemu-img create -q -f qcow2 -F raw -b "$here/work/hostdisk.raw" "$out/host.qcow2"
  : >"$out/serial.log"
  qemu-system-x86_64 \
    -machine q35,smm=on,accel=kvm -cpu host -smp 2 -m 2G \
    -global driver=cfi.pflash01,property=secure,value=on \
    -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.secboot.4m.fd \
    -drive if=pflash,format=raw,unit=1,file="$out/vars.fd" \
    "${disks[@]}" \
    -nic none -display none -no-shutdown -device virtio-vga \
    -qmp unix:"$sock",server=on,wait=off \
    -serial file:"$out/serial.log" &
  qemu=$!
}
start_vm
# The firmware sometimes stalls before starting the stick (keyboard-test.sh); retry once.
if ! wait_for "$out/serial.log" "BdsDxe: starting" 40; then
  echo "firmware stalled; retrying" >&2
  kill "$qemu"; wait "$qemu" 2>/dev/null || true
  start_vm
fi

guest_off() { # seconds
  local i
  for ((i = 0; i < $1; i++)); do
    qmp cmd query-status 2>/dev/null | grep -q '"shutdown"' && return 0
    sleep 1
  done
  return 1
}

if [ "$mode" = bind ]; then
  wait_for "$out/serial.log" "SPIKE bind done" 180
else
  wait_for "$out/serial.log" "SPIKE net 2:" 180
  sleep 3
  qmp type "Written on the stick."
  sleep 5 # the app's save
  qmp cmd system_powerdown >/dev/null
fi
guest_off 90 || echo "guest did not power off" >&2
qmp cmd query-blockstats | python3 -c '
import json, sys
for d in json.load(sys.stdin):
    name, s = d.get("qdev") or d.get("device"), d["stats"]
    if name:
        print("WRITES %s: %d requests, %d bytes; %d reads" % (name, s["wr_operations"], s["wr_bytes"], s["rd_operations"]))'
qmp cmd quit >/dev/null 2>&1 || true
wait "$qemu" 2>/dev/null || true
qemu=

if [ -e "$out/host.qcow2" ]; then
  echo "HOST overlay clusters allocated: $(qemu-img map --output=json "$out/host.qcow2" |
    python3 -c 'import json,sys; print(sum(1 for e in json.load(sys.stdin) if e["depth"] == 0 and e["data"]))')"
fi
virt-fw-vars -i "$out/vars.fd" --output-json "$out/vars-after.json" 2>/dev/null
python3 - "$out/vars-before.json" "$out/vars-after.json" <<'EOF'
import json, sys
def load(p):
    return {(v["name"], v["guid"]): v.get("data") for v in json.load(open(p))["variables"]}
a, b = load(sys.argv[1]), load(sys.argv[2])
for k in sorted(set(a) | set(b)):
    if a.get(k) != b.get(k):
        what = "added" if k not in a else "removed" if k not in b else "changed"
        print(f"VAR {what}: {k[0]} {k[1]}")
EOF
grep -a -E '^SPIKE (disks|root-slaves|bind|mounts|swaps|failed|net 2)' "$out/serial.log" | sed 's/\r//'
