#!/usr/bin/env bash
# OS-0 "No network": boots an image built with the netcheck profile in the Secure Boot
# VM with a virtio NIC attached, then hot-plugs a PCIe NIC (e1000e) and a USB NIC
# (usb-net) while it runs. QEMU records every frame each NIC sends (filter-dump),
# outside the guest. The NICs are user-mode and restricted: nothing reaches the host's
# network even if the guest sends.
# Usage: nonet-test.sh <vars.fd> <out-dir> <image.raw>
#        nonet-test.sh --pxe <vars.fd> <out-dir>   (capture check: firmware PXE sends DHCP)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
pxe=
[ "$1" = --pxe ] && { pxe=1; shift; }
vars=$1
out=$(realpath -m "$2")
image=${3:-}
mkdir -p "$out"
sock=$(mktemp -u "${XDG_RUNTIME_DIR:?}/bismillah-qmp.XXXXXX")
qemu=
trap '{ [ -z "$qemu" ] || kill "$qemu" 2>/dev/null || true; }; rm -f "$sock"; true' EXIT
cp "$vars" "$out/vars.fd"
rm -f "$out"/*.pcap

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

frames() { # pcap file → frame count
  python3 -c '
import struct, sys
d = open(sys.argv[1], "rb").read()
n, i = 0, 24
while i + 16 <= len(d):
    n += 1
    i += 16 + struct.unpack_from("<I", d, i + 8)[0]
print(n)' "$1"
}

firmware=(
  -machine q35,smm=on,accel=kvm -cpu host -smp 2 -m 2G
  -global driver=cfi.pflash01,property=secure,value=on
  -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.secboot.4m.fd
  -drive if=pflash,format=raw,unit=1,file="$out/vars.fd"
  -display none -no-reboot -qmp unix:"$sock",server=on,wait=off
  -serial file:"$out/serial.log"
)

if [ -n "$pxe" ]; then
  # No disk: the firmware's network boot sends DHCP, so the capture must see frames.
  qemu-system-x86_64 "${firmware[@]}" \
    -netdev user,id=n0,restrict=on -device virtio-net-pci,netdev=n0,bootindex=0 \
    -object filter-dump,id=d0,netdev=n0,file="$out/pxe.pcap" &
  qemu=$!
  sleep 30
  kill "$qemu"; wait "$qemu" 2>/dev/null || true; qemu=
  echo "PXE frames captured: $(frames "$out/pxe.pcap")"
  exit 0
fi

qemu-system-x86_64 "${firmware[@]}" \
  -device qemu-xhci,id=xhci \
  -drive if=none,id=stick,format=raw,snapshot=on,file="$image" \
  -device usb-storage,bus=xhci.0,drive=stick,bootindex=0 \
  -device virtio-vga \
  -device pcie-root-port,id=rp1,chassis=1,slot=1 \
  -netdev user,id=n0,restrict=on -device virtio-net-pci,netdev=n0 \
  -object filter-dump,id=d0,netdev=n0,file="$out/virtio.pcap" &
qemu=$!

wait_for "$out/serial.log" "SPIKE net 2:" 180
# Hot-plug while the system runs: a PCIe NIC, then a USB NIC.
qmp cmd netdev_add '{"type":"user","id":"n1","restrict":true}' >/dev/null
qmp cmd object-add "{\"qom-type\":\"filter-dump\",\"id\":\"d1\",\"netdev\":\"n1\",\"file\":\"$out/e1000e.pcap\"}" >/dev/null
qmp cmd device_add '{"driver":"e1000e","id":"nic1","netdev":"n1","bus":"rp1"}' >/dev/null
echo "hot-plugged e1000e" >>"$out/host.log"
wait_for "$out/serial.log" "SPIKE net 6:" 60
qmp cmd netdev_add '{"type":"user","id":"n2","restrict":true}' >/dev/null
qmp cmd object-add "{\"qom-type\":\"filter-dump\",\"id\":\"d2\",\"netdev\":\"n2\",\"file\":\"$out/usb-net.pcap\"}" >/dev/null
qmp cmd device_add '{"driver":"usb-net","id":"nic2","netdev":"n2","bus":"xhci.0"}' >/dev/null
echo "hot-plugged usb-net" >>"$out/host.log"
wait_for "$out/serial.log" "SPIKE net done" 240
qmp cmd system_powerdown >/dev/null
timeout 60 tail --pid="$qemu" -f /dev/null || kill "$qemu"
qemu=

grep -a -E 'SPIKE (net|dmesg|firmware|kernel|secureboot)' "$out/serial.log" | sed 's/\r//' |
  awk '!/SPIKE net [0-9]+:/ || /SPIKE net (0|1|2|3|7|8|59):/'
for p in "$out"/*.pcap; do echo "frames sent on $(basename "$p" .pcap): $(frames "$p")"; done
