#!/usr/bin/env bash
# Read-only guards shared by the interactive flashing wrapper and its tests.

flash_check_root() {
  local dev=$1 source=$2 target parents parent
  if ! target=$(lsblk -dno KNAME "$dev"); then
    echo "Couldn't identify the kernel disk for $dev. Refusing." >&2
    return 1
  fi
  if [[ -z "$target" || "$target" == *[[:space:]]* ]]; then
    echo "No single kernel disk was reported for $dev. Refusing." >&2
    return 1
  fi
  if ! parents=$(lsblk -lsno KNAME "$source"); then
    echo "Couldn't inspect this machine's root disks. Refusing." >&2
    return 1
  fi
  if [[ -z "${parents//[[:space:]]/}" ]]; then
    echo "No disks were reported for this machine's root. Refusing." >&2
    return 1
  fi
  # KNAME resolves /dev/disk/by-id and other aliases to the same kernel name.
  while IFS= read -r parent; do
    if [[ "$parent" == "$target" ]]; then
      echo "$dev holds this machine's root. Refusing." >&2
      return 1
    fi
  done <<<"$parents"
  return 0
}

# 0: unmounted, 1: mounted, 2: inspection failed (never offer to proceed).
flash_unmounted() {
  local mounts
  if ! mounts=$(lsblk -no MOUNTPOINTS "$1"); then
    echo "Couldn't inspect mounted partitions on $1. Refusing." >&2
    return 2
  fi
  [[ -z "${mounts//[[:space:]]/}" ]]
}
