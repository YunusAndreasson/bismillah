#!/usr/bin/env bash
# Writes the stick's image to a USB stick (os/PLAN.md, OS-1 and OS-5). Run by the
# author, never by an agent; it asks for sudo itself. It writes only to a disk that is
# USB, removable or hot-pluggable, not part of this machine's root, and unmounted, and
# only after its model name is typed back.
#
# The first flash erases the whole stick. It writes a copy of the image with the
# stick's own disk, ESP and home GUIDs and records them in os/sticks.toml
# (os/scripts/stick.ts).
#
# --update rewrites only the system (ESP, root, root verity) and keeps the texts. It
# refuses a stick whose GUIDs and stick-id aren't the ones os/sticks.toml recorded, or
# a system bigger than the stick's slots, then reads what it wrote back.
#
# Usage: os/scripts/flash.sh [--update] [release|debug|image.raw]
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
source "$root/os/scripts/flash-safety.sh"
stick_ts=$root/os/scripts/stick.ts
node=$(command -v node)

update=
[[ "${1:-}" == --update ]] && { update=1; shift; }
image=${1:-release}
case $image in
  release | debug) image=$root/os/out/image/bismillah-$image.raw ;;
esac
[[ -f "$image" ]] || { echo "No image at $image. Build it first: pnpm os:build"; exit 1; }
system="$(basename "$image" .raw | sed 's/^bismillah-//') $(git -C "$root" rev-parse --short HEAD)"

echo "USB disks:"
lsblk -d -o NAME,TRAN,RM,HOTPLUG,MODEL,SIZE | awk 'NR==1 || $2=="usb"'
echo
if [[ -n "$update" ]]; then
  read -rp "Device name of the stick to update (e.g. sdb): " name
else
  read -rp "Device name to erase (e.g. sdb): " name
fi
dev="/dev/${name#/dev/}"

[[ -b "$dev" && "$(lsblk -dno TYPE "$dev")" == disk ]] || { echo "$dev is not a disk."; exit 1; }
[[ "$(lsblk -dno TRAN "$dev")" == usb ]] || { echo "$dev is not a USB disk. Refusing."; exit 1; }
[[ "$(lsblk -dno RM "$dev" | xargs)" == 1 || "$(lsblk -dno HOTPLUG "$dev" | xargs)" == 1 ]] ||
  { echo "$dev is neither removable nor hot-pluggable. Refusing."; exit 1; }
root_source=$(findmnt -no SOURCE / | sed 's/\[.*//')
flash_check_root "$dev" "$root_source"
if flash_unmounted "$dev"; then
  : # Inspection succeeded and nothing is mounted.
else
  inspected=$?
  [[ "$inspected" == 1 ]] || exit 1
  echo "$dev has mounted partitions (the desktop mounts sticks when they're plugged in):"
  lsblk -o NAME,MOUNTPOINTS "$dev"
  read -rp "Unmount them? [y/N] " answer
  [[ "$answer" == [yY]* ]] || { echo "Nothing written."; exit 1; }
  for part in $(lsblk -lno PATH,MOUNTPOINTS "$dev" | awk 'NF>1{print $1}'); do
    udisksctl unmount -b "$part" >/dev/null 2>&1 || sudo umount "$part"
  done
  if ! flash_unmounted "$dev"; then
    echo "Still mounted or couldn't inspect the stick. Refusing."
    exit 1
  fi
fi

model="$(lsblk -dno MODEL "$dev" | xargs)"
size="$(lsblk -dno SIZE "$dev" | xargs)"

if [[ -n "$update" ]]; then
  # Reading the disk needs root; nothing is written until the model name is typed.
  sudo "$node" "$stick_ts" identify "$dev" >/dev/null || exit 1
  echo
  echo "This is a bismillah stick this machine flashed: $model ($size)."
  echo "It rewrites the stick's system with $(basename "$image") ($system). The texts stay."
  read -rp "Type the model name to confirm ($model): " typed
  [[ "$typed" == "$model" ]] || { echo "Did not match. Nothing written."; exit 1; }
  sudo "$node" "$stick_ts" update "$image" "$dev" --system "$system"
  sync
  echo
  echo "Done. Boot the laptop from the stick and unlock it as before."
  exit 0
fi

echo
echo "This ERASES everything on $dev: $model ($size), and writes $(basename "$image")."
read -rp "Type the model name to confirm ($model): " typed
[[ "$typed" == "$model" ]] || { echo "Did not match. Nothing written."; exit 1; }

# The stick's own copy: new disk, ESP and home GUIDs, and its stick-id on the ESP.
prepared=$root/os/out/flash/stick.raw
mkdir -p "$(dirname "$prepared")"
"$node" "$stick_ts" prepare "$image" "$prepared" >/dev/null
sudo dd if="$prepared" of="$dev" bs=4M conv=fsync oflag=direct status=progress
sync
# The image's GPT describes a disk the size of the image: its backup header and
# protective MBR end there, not at the end of the stick. Linux accepts that, but some
# firmware (the Dell's) drops such a disk from its boot list. Move the backup header
# to the stick's last sector, which also rewrites the protective MBR.
sudo sfdisk --relocate gpt-bak-std "$dev"
sync
"$node" "$stick_ts" record "$prepared" "$image" --system "$system" >/dev/null
rm -f "$prepared"
echo
echo "Done. Recorded in os/sticks.toml, which --update needs to find this stick again."
echo "Boot the laptop from the stick (on the Dell: F12), with Secure Boot on."
