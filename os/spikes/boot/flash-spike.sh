#!/usr/bin/env bash
# Writes the spike image to a USB stick, for the Dell boot test (OS-0).
# Lists USB disks, asks which one, refuses anything that isn't USB or is mounted,
# and asks you to type the model name back before erasing it.
# Usage: os/spikes/boot/flash-spike.sh [image.raw]   (asks for sudo itself)
set -euo pipefail

image="${1:-$(dirname "$(realpath "$0")")/bismillah-spike-boot.raw}"
[[ -f "$image" ]] || { echo "No image at $image. Build it first: mkosi --profile=app -f build"; exit 1; }

echo "USB disks:"
lsblk -d -o NAME,TRAN,MODEL,SIZE | awk 'NR==1 || $2=="usb"'
echo
read -rp "Device name to erase (e.g. sdb): " name
dev="/dev/${name#/dev/}"

[[ -b "$dev" ]] || { echo "$dev is not a block device."; exit 1; }
[[ "$(lsblk -dno TRAN "$dev")" == "usb" ]] || { echo "$dev is not a USB disk. Refusing."; exit 1; }
if lsblk -no MOUNTPOINTS "$dev" | grep -q .; then
  echo "$dev has mounted partitions (the desktop mounts sticks when they're plugged in):"
  lsblk -o NAME,MOUNTPOINTS "$dev"
  read -rp "Unmount them? [y/N] " answer
  [[ "$answer" == [yY]* ]] || { echo "Nothing written."; exit 1; }
  for part in $(lsblk -lno PATH,MOUNTPOINTS "$dev" | awk 'NF>1{print $1}'); do
    udisksctl unmount -b "$part" >/dev/null 2>&1 || sudo umount "$part"
  done
  if lsblk -no MOUNTPOINTS "$dev" | grep -q .; then
    echo "Still mounted. Refusing."; exit 1
  fi
fi

model="$(lsblk -dno MODEL "$dev" | xargs)"
size="$(lsblk -dno SIZE "$dev" | xargs)"
echo
echo "This ERASES everything on $dev: $model ($size)."
read -rp "Type the model name to confirm ($model): " typed
[[ "$typed" == "$model" ]] || { echo "Did not match. Nothing written."; exit 1; }

sudo dd if="$image" of="$dev" bs=4M conv=fsync oflag=direct status=progress
sync
# The image's GPT describes a disk the size of the image: its backup header and
# protective MBR end there, not at the end of the stick. Linux accepts that, but
# some firmware (the Dell's) drops such a disk from its boot list. Move the backup
# header to the stick's last sector, which also rewrites the protective MBR.
sudo sfdisk --relocate gpt-bak-std "$dev"
sync
echo
echo "Done. Remove the stick, turn Secure Boot on in the Dell's firmware, and boot from it (F12)."
