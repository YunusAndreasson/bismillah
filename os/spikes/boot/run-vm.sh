#!/usr/bin/env bash
# Boots the spike image headless in OVMF with Secure Boot on and a chosen
# Microsoft variable set, the stick attached as USB storage, no network.
# Usage: run-vm.sh <vars.fd> <serial.log> [image.raw] [timeout-seconds]
# QMP=<socket> adds a QMP socket (screendump, typing); GPU=1 adds a virtio GPU.
set -euo pipefail

vars="$1"
log="$2"
image="${3:-$(dirname "$0")/bismillah-spike-boot.raw}"
timeout_s="${4:-120}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$vars" "$work/vars.fd"

timeout "$timeout_s" qemu-system-x86_64 \
  -machine q35,smm=on,accel=kvm -cpu host -smp 2 -m 2G \
  -global driver=cfi.pflash01,property=secure,value=on \
  -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.secboot.4m.fd \
  -drive if=pflash,format=raw,unit=1,file="$work/vars.fd" \
  -device qemu-xhci,id=xhci \
  -drive if=none,id=stick,format=raw,snapshot=on,file="$image" \
  -device usb-storage,bus=xhci.0,drive=stick,bootindex=0 \
  -nic none -display none -no-reboot \
  ${GPU:+-device virtio-vga} ${QMP:+-qmp unix:$QMP,server=on,wait=off} \
  -serial file:"$log" || echo "qemu exit $?" >>"$log"

# Keep the variable store after the run, so the NVRAM diff can be taken.
cp "$work/vars.fd" "$log.vars.fd"
