#!/usr/bin/env bash
# OS-0 "GPU and display": boots the GPU image (app + nonet + probe + gpu profiles) in
# the Secure Boot VM with one display setup, takes a screenshot of the document and
# asks the guest which DRM device and Mesa driver cage and WebKit ended up on.
#   virtio      virtio-vga, no 3D in the guest (Mesa falls back to software)
#   virgl       virtio-vga-gl with the host's GPU behind it (egl-headless)
#   std         QEMU's standard VGA (bochs-drm), no 3D
#   std-nocomp  std, with WEBKIT_DISABLE_COMPOSITING_MODE=1
#   hybrid      standard VGA as the boot display plus a virtio GPU beside it
#   hybrid-pin  two virtio GPUs, both with render nodes; WebKit is pinned at runtime
#               to the boot GPU's render node (WEBKIT_WEB_RENDER_DEVICE_FILE)
# Usage: gpu-test.sh <vars.fd> <out-dir> <image.raw> <case>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
vars=$1
out=$(realpath -m "$2")
image=$3
case=$4
mtools=$here/mkosi.tools/usr/bin
mkdir -p "$out"
sock=$(mktemp -u "${XDG_RUNTIME_DIR:?}/bismillah-qmp.XXXXXX")
cmdsock=$(mktemp -u "${XDG_RUNTIME_DIR:?}/bismillah-cmd.XXXXXX")
log=$out/serial.log
qemu=
trap '{ [ -z "$qemu" ] || kill "$qemu" 2>/dev/null || true; }; rm -f "$sock" "$cmdsock"; true' EXIT
cp "$vars" "$out/vars.fd"
rm -f "$log" # a stale log would satisfy the waits below

display=(-display none)
case $case in
  virtio) gpu=(-device virtio-vga) ;;
  virgl) gpu=(-device virtio-vga-gl); display=(-display egl-headless) ;;
  std | std-nocomp) gpu=(-vga std) ;;
  hybrid) gpu=(-vga std -device virtio-gpu-pci) ;;
  hybrid-pin) gpu=(-device virtio-gpu-pci -device virtio-vga) ;;
  *) echo "unknown case $case" >&2; exit 2 ;;
esac

stick=$image
if [ "$case" = std-nocomp ]; then
  # The variable reaches the session through PID 1's environment.
  cp --sparse=always "$image" "$out/stick.raw"
  stick=$out/stick.raw
  esp="$stick@@1048576"
  entry=$("$mtools/mdir" -b -i "$esp" ::/loader/entries/ | head -1)
  "$mtools/mtype" -i "$esp" "$entry" |
    sed '/^options/ s/$/ systemd.setenv=WEBKIT_DISABLE_COMPOSITING_MODE=1/' >"$out/entry.conf"
  "$mtools/mcopy" -o -i "$esp" "$out/entry.conf" "$entry"
  sync # an unflushed copy on the encrypted host disk stalls the firmware's reads
fi

qmp() { python3 "$here/qmp.py" "$sock" "$@"; }
guest() { printf '%s\n' "$1" | socat - UNIX-CONNECT:"$cmdsock"; }
wait_for() { # pattern, seconds
  local i
  for ((i = 0; i < $2 * 10; i++)); do
    grep -aq -- "$1" "$log" 2>/dev/null && return 0
    sleep 0.1
  done
  echo "timeout: $1" >&2
  return 1
}

qemu-system-x86_64 \
  -machine q35,smm=on,accel=kvm -cpu host -smp 2 -m 2G \
  -global driver=cfi.pflash01,property=secure,value=on \
  -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.secboot.4m.fd \
  -drive if=pflash,format=raw,unit=1,file="$out/vars.fd" \
  -device qemu-xhci,id=xhci \
  -drive if=none,id=stick,format=raw,snapshot=on,file="$stick" \
  -device usb-storage,bus=xhci.0,drive=stick,bootindex=0 \
  -nic none "${display[@]}" -no-reboot "${gpu[@]}" \
  -qmp unix:"$sock",server=on,wait=off \
  -serial file:"$log" -serial unix:"$cmdsock",server=on,wait=off &
qemu=$!

wait_for 'Started.*bismillah-session' 150
# Then until WebKit's web process is up, and a little longer for the first paint.
for _ in $(seq 60); do
  guest 'pgrep -f WebKitWebProcess >/dev/null && echo "SPIKE webproc up $(cut -d" " -f1 /proc/uptime)"'
  wait_for 'SPIKE webproc up' 2 2>/dev/null && break
done
sleep 10
if [ "$case" = hybrid-pin ]; then
  # The rule and the variable a product image would ship, applied at runtime here.
  guest 'for p in $(pgrep -f WebKitWebProcess); do for f in /proc/$p/fd/*; do case $(readlink $f) in /dev/dri/*) echo "SPIKE before-pin $p $(readlink $f)";; esac; done; done'
  guest 'mkdir -p /run/udev/rules.d; echo "SUBSYSTEM==\"drm\", KERNEL==\"renderD*\", ATTRS{boot_vga}==\"1\", SYMLINK+=\"dri/boot-vga-render\"" >/run/udev/rules.d/70-boot-vga-render.rules; udevadm control --reload; udevadm trigger --settle --subsystem-match=drm; systemctl set-environment WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/boot-vga-render; systemctl restart bismillah-session; ls -l /dev/dri | grep boot; echo SPIKE-pinned'
  wait_for '^SPIKE-pinned' 30
  sleep 20
fi
qmp screendump "$out/$case.ppm" || echo "no screenshot" >&2
guest 'echo SPIKE gpu begin; lspci -nnk -d ::0300; lspci -nnk -d ::0302; lspci -nnk -d ::0380'
guest 'for c in /sys/class/drm/card[0-9]; do echo "SPIKE drm $c driver=$(basename $(readlink -f $c/device/driver)) boot_vga=$(cat $c/device/boot_vga 2>/dev/null)"; done; ls -l /dev/dri'
guest 'for p in $(pgrep -x cage) $(pgrep -f WebKitWebProcess) $(pgrep -x bismillah); do echo "SPIKE maps $p $(cat /proc/$p/comm): $(grep -oE "[a-z0-9_]+_dri\.so|libgallium[^ ]*|libEGL_mesa[^ ]*" /proc/$p/maps | sort -u | tr "\n" " ")"; for f in /proc/$p/fd/*; do t=$(readlink $f); case $t in /dev/dri/*) echo "SPIKE fd $p $(cat /proc/$p/comm) $t";; esac; done; done'
# DRM fdinfo names the driver behind each open GPU file, with engine time where the
# driver counts it (i915, xe, amdgpu).
guest 'for p in $(pgrep -x cage) $(pgrep -f WebKitWebProcess); do for f in /proc/$p/fd/*; do case $(readlink $f) in /dev/dri/*) echo "SPIKE fdinfo $p $(cat /proc/$p/comm) $(readlink $f): $(grep -E "^drm-(driver|engine|total|resident)" /proc/$p/fdinfo/${f##*/} | tr "\t\n" "  ")";; esac; done; done'
guest 'journalctl -b -o short-monotonic --no-pager | grep -E "drm|card[0-9]|virtio_gpu|bochs|bismillah-session|boot.vga|fbcon|efifb|Console: switching" | sed "s/^/SPIKE journal /" | head -40'
guest 'ps -u writer -o pid,stat,etime,args --no-headers | cut -c1-150 | sed "s/^/SPIKE ps /"; journalctl -b -o short-monotonic --no-pager _COMM=bismillah _COMM=cage _COMM=WebKitWebProces _COMM=systemd-coredump | tail -20 | sed "s/^/SPIKE app /"'
guest 'echo SPIKE gpu done'
wait_for 'SPIKE gpu done' 30
qmp cmd system_powerdown >/dev/null
timeout 60 tail --pid="$qemu" -f /dev/null || kill "$qemu"
[ ! -e "$out/$case.ppm" ] || { magick "$out/$case.ppm" "$out/$case.png" && rm "$out/$case.ppm"; }
{
  sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -a -E 'MESA-LOADER|libEGL|kms_swrast|virgl|Started.*bismillah-session|WEBKIT|Failed|failed' |
    grep -av drirc | sort | uniq -c | sort -rn | head -20 || true
  sed -n '/SPIKE gpu begin/,/SPIKE gpu done/p' "$log" | sed 's/\x1b\[[0-9;]*m//g' | grep -av 'drirc\|libEGL\|SPIKE cmd\|^SPIKE journal.*audit'
} >"$out/report.txt"
