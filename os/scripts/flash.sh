#!/usr/bin/env bash
# Writes the stick's image to a USB stick: the first write, which erases the whole
# stick (os/PLAN.md, OS-1). Run by the author, never by an agent; it asks for sudo itself.
# It writes only to a disk that is USB, removable or hot-pluggable, not part of this
# machine's root, and unmounted, and only after its model name is typed back.
# Usage: os/scripts/flash.sh [release|debug|image.raw]
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)

image=${1:-release}
case $image in
  release | debug) image=$root/os/out/image/bismillah-$image.raw ;;
esac
[[ -f "$image" ]] || { echo "No image at $image. Build it first: pnpm os:build"; exit 1; }

echo "USB disks:"
lsblk -d -o NAME,TRAN,RM,HOTPLUG,MODEL,SIZE | awk 'NR==1 || $2=="usb"'
echo
read -rp "Device name to erase (e.g. sdb): " name
dev="/dev/${name#/dev/}"

[[ -b "$dev" && "$(lsblk -dno TYPE "$dev")" == disk ]] || { echo "$dev is not a disk."; exit 1; }
[[ "$(lsblk -dno TRAN "$dev")" == usb ]] || { echo "$dev is not a USB disk. Refusing."; exit 1; }
[[ "$(lsblk -dno RM "$dev" | xargs)" == 1 || "$(lsblk -dno HOTPLUG "$dev" | xargs)" == 1 ]] ||
  { echo "$dev is neither removable nor hot-pluggable. Refusing."; exit 1; }
root_source=$(findmnt -no SOURCE / | sed 's/\[.*//')
if lsblk -lsno NAME "$root_source" | grep -qx "${dev#/dev/}"; then
  echo "$dev holds this machine's root. Refusing."
  exit 1
fi
if lsblk -no MOUNTPOINTS "$dev" | grep -q .; then
  echo "$dev has mounted partitions (the desktop mounts sticks when they're plugged in):"
  lsblk -o NAME,MOUNTPOINTS "$dev"
  read -rp "Unmount them? [y/N] " answer
  [[ "$answer" == [yY]* ]] || { echo "Nothing written."; exit 1; }
  for part in $(lsblk -lno PATH,MOUNTPOINTS "$dev" | awk 'NF>1{print $1}'); do
    udisksctl unmount -b "$part" >/dev/null 2>&1 || sudo umount "$part"
  done
  if lsblk -no MOUNTPOINTS "$dev" | grep -q .; then
    echo "Still mounted. Refusing."
    exit 1
  fi
fi

model="$(lsblk -dno MODEL "$dev" | xargs)"
size="$(lsblk -dno SIZE "$dev" | xargs)"
echo
echo "This ERASES everything on $dev: $model ($size), and writes $(basename "$image")."
read -rp "Type the model name to confirm ($model): " typed
[[ "$typed" == "$model" ]] || { echo "Did not match. Nothing written."; exit 1; }

sudo dd if="$image" of="$dev" bs=4M conv=fsync oflag=direct status=progress
sync
# The image's GPT describes a disk the size of the image: its backup header and
# protective MBR end there, not at the end of the stick. Linux accepts that, but some
# firmware (the Dell's) drops such a disk from its boot list. Move the backup header
# to the stick's last sector, which also rewrites the protective MBR.
sudo sfdisk --relocate gpt-bak-std "$dev"
sync
echo
echo "Done. Boot the laptop from the stick (on the Dell: F12), with Secure Boot on."
