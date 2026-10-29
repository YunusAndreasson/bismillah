#!/bin/sh
# Puts bismillah on a USB stick, or updates a bismillah stick and keeps its texts.
# On macOS and Linux:
#
#   curl -fsSL https://bismillah.jonas-268.workers.dev/install.sh | sh
#
# It downloads the stick's image from the same site, checks every part against its
# sha256, lists the USB disks and asks which one to use. It writes only to a disk
# that is USB, removable or ejectable, not this computer's own, and unmounted, and only
# after the stick's name is typed back. The writing is done by bismillah-install, from
# the same download (ADR-0017 in the bismillah repository). It asks for your password
# (sudo) to read and write the stick, and for nothing else.
#
# BISMILLAH_STICK_URL points it at another copy of the downloads. The tests also set
# BISMILLAH_TEST_STICK, a file standing in for the stick (no sudo), and
# BISMILLAH_TEST_TTY, a file of answers.
#
# Everything is inside main(), called on the last line, so a cut-off download of this
# script runs nothing.
set -eu

BASE=${BISMILLAH_STICK_URL:-https://bismillah.jonas-268.workers.dev/stick}

say() { printf '%s\n' "$*"; }
die() {
  printf '\n%s\n' "$*" >&2
  exit 1
}
# Answers come from the terminal (fd 3): this script's own input is the download.
ask() {
  printf '%s ' "$1" >&2
  IFS= read -r answer <&3 || die "No answer. Nothing was written."
}

# Runs bismillah-install as root, or on the test's file.
as_root() {
  if [ -n "${BISMILLAH_TEST_STICK:-}" ]; then
    "$@" --file
  else
    sudo "$@"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Downloads $1 from this version's folder to $dir, unless it is there and matches $2.
fetch() {
  # Only plain names, so a damaged manifest can't write outside this folder.
  case $1 in "" | .* | *[!A-Za-z0-9._-]*) die "The manifest names an unexpected file ($1)." ;; esac
  file=$dir/$1
  if [ -f "$file" ] && [ "$(sha256 "$file")" = "$2" ]; then
    return 0
  fi
  rm -f "$file"
  curl -fL --progress-bar --retry 3 -o "$file.part" "$BASE/$version/$1" ||
    die "Couldn't download $1. Check the connection and run the command again."
  [ "$(sha256 "$file.part")" = "$2" ] || {
    rm -f "$file.part"
    die "$1 arrived damaged. Run the command again."
  }
  mv "$file.part" "$file"
}

# Linux: the stick as flash.sh checks it (os/scripts/flash.sh).
choose_linux() {
  say "USB disks:"
  lsblk -d -o NAME,TRAN,RM,HOTPLUG,MODEL,SIZE | awk 'NR==1 || $2=="usb"'
  say ""
  ask "Which one is the stick? Its name (e.g. sdb):"
  dev=/dev/${answer#/dev/}
  [ -b "$dev" ] && [ "$(lsblk -dno TYPE "$dev")" = disk ] || die "$dev is not a disk. Nothing was written."
  [ "$(lsblk -dno TRAN "$dev")" = usb ] || die "$dev is not a USB disk. Nothing was written."
  [ "$(lsblk -dno RM "$dev" | tr -d ' ')" = 1 ] || [ "$(lsblk -dno HOTPLUG "$dev" | tr -d ' ')" = 1 ] ||
    die "$dev is neither removable nor hot-pluggable. Nothing was written."
  kname=$(lsblk -dno KNAME "$dev") || die "Couldn't identify $dev. Nothing was written."
  source=$(findmnt -no SOURCE / | sed 's/\[.*//')
  parents=$(lsblk -lsno KNAME "$source") && [ -n "$parents" ] ||
    die "Couldn't find this computer's own disk. Nothing was written."
  for parent in $parents; do
    [ "$parent" != "$kname" ] || die "$dev holds this computer's system. Nothing was written."
  done
  mounts=$(lsblk -no MOUNTPOINTS "$dev") || die "Couldn't see what is mounted on $dev. Nothing was written."
  if [ -n "$(printf '%s' "$mounts" | tr -d '[:space:]')" ]; then
    say "$dev is in use (the desktop mounts sticks when they're plugged in):"
    lsblk -o NAME,MOUNTPOINTS "$dev"
    ask "Unmount it? [y/N]"
    case $answer in [yY]*) ;; *) die "Nothing was written." ;; esac
    for part in $(lsblk -lno PATH,MOUNTPOINTS "$dev" | awk 'NF>1{print $1}'); do
      udisksctl unmount -b "$part" >/dev/null 2>&1 || sudo umount "$part"
    done
    mounts=$(lsblk -no MOUNTPOINTS "$dev") || die "Couldn't see what is mounted on $dev. Nothing was written."
    [ -z "$(printf '%s' "$mounts" | tr -d '[:space:]')" ] || die "$dev is still mounted. Nothing was written."
  fi
  model=$(lsblk -dno MODEL "$dev" | sed 's/^ *//; s/ *$//')
  shown=$(lsblk -dno SIZE "$dev" | tr -d ' ')
  size=$(lsblk -bdno SIZE "$dev" | tr -d ' ')
  sector=$(lsblk -dno LOG-SEC "$dev" | tr -d ' ')
  raw=$dev
}

# macOS: an external, ejectable USB disk that isn't the startup disk.
info() { diskutil info "$1" | awk -F: -v k="$2" '{ gsub(/^ +/, "", $1) } $1 == k { sub(/^ +/, "", $2); print $2; exit }'; }
choose_macos() {
  say "USB disks:"
  diskutil list external physical
  ask "Which one is the stick? Its name (e.g. disk4):"
  name=${answer#/dev/}
  name=${name#r}
  case $name in disk[0-9]*) ;; *) die "$answer is not a disk name like disk4. Nothing was written." ;; esac
  case $name in *s[0-9]*) die "$name is a partition; name the whole disk (e.g. ${name%s*}). Nothing was written." ;; esac
  dev=/dev/$name
  [ "$(info "$dev" 'Part of Whole')" = "$name" ] || die "$dev is not a whole disk. Nothing was written."
  [ "$(info "$dev" 'Protocol')" = USB ] || die "$dev is not a USB disk. Nothing was written."
  [ "$(info "$dev" 'Device Location')" = External ] || die "$dev is not an external disk. Nothing was written."
  [ "$(info "$dev" 'Ejectable')" = Yes ] || die "$dev is not ejectable. Nothing was written."
  # The startup disk, and the physical disk under its APFS container.
  system=$(info / 'Part of Whole')
  store=$(info "$system" 'APFS Physical Store' | sed 's/s[0-9]*$//')
  [ "$name" != "$system" ] && [ "$name" != "$store" ] || die "$dev holds this Mac's system. Nothing was written."
  diskutil unmountDisk "$dev" >/dev/null || die "Couldn't unmount $dev. Close what uses it and run the command again."
  model=$(info "$dev" 'Device / Media Name')
  shown=$(info "$dev" 'Disk Size' | sed 's/ (.*//')
  size=$(info "$dev" 'Disk Size' | sed 's/.*(\([0-9]*\) Bytes).*/\1/')
  sector=$(info "$dev" 'Device Block Size' | sed 's/ .*//')
  raw=/dev/r$name
}

# The tests: a file standing in for the stick.
choose_test() {
  dev=$BISMILLAH_TEST_STICK raw=$dev model="test stick" sector=512
  size=$(wc -c <"$dev" | tr -d ' ')
  shown="$size bytes"
}

main() {
  tty=${BISMILLAH_TEST_TTY:-/dev/tty}
  # A failed redirection on exec would end the shell before die could say why.
  (exec 3<"$tty") 2>/dev/null || die "Run this in a terminal: it asks which stick to use."
  exec 3<"$tty"
  case "$(uname -s)/$(uname -m)" in
    Linux/x86_64) platform=linux-x86_64 ;;
    Linux/aarch64 | Linux/arm64) platform=linux-aarch64 ;;
    Darwin/x86_64) platform=macos-x86_64 ;;
    Darwin/arm64) platform=macos-aarch64 ;;
    *) die "This works on macOS and Linux (x86-64 and Arm). On Windows, use the Windows command." ;;
  esac
  case $platform in
    linux-*)
      cache=${XDG_CACHE_HOME:-$HOME/.cache}/bismillah
      state=${XDG_STATE_HOME:-$HOME/.local/state}/bismillah
      ;;
    macos-*)
      cache=$HOME/Library/Caches/bismillah
      state="$HOME/Library/Application Support/bismillah"
      ;;
  esac

  say "bismillah: putting the editor on a USB stick"
  say ""
  # Not in a pipe, which would hide curl's failure.
  version=$(curl -fsSL "$BASE/current") ||
    die "Couldn't reach $BASE. Check the connection and run the command again."
  version=$(printf '%s\n' "$version" | head -n 1 | tr -d '\r')
  [ "$version" != none ] || die "No bismillah stick image is published yet."
  case $version in *[!A-Za-z0-9.-]* | "" | .*) die "The site gave an unexpected version name ($version)." ;; esac
  dir=$cache/$version
  mkdir -p "$dir" "$state"
  curl -fsSL -o "$dir/manifest" "$BASE/$version/manifest" ||
    die "Couldn't download the manifest. Run the command again."
  [ "$(head -n 1 "$dir/manifest")" = "bismillah-stick 1" ] ||
    die "This image needs a newer version of this script. Copy the command from the site again."

  bytes=0
  while read -r kind a b c d; do
    case $kind in part) bytes=$((bytes + b)) ;; esac
  done <"$dir/manifest"
  say "Downloading bismillah $version ($((bytes / 1000000)) MB) to $dir"
  while read -r kind a b c d; do
    case $kind in part) fetch "$a" "$c" ;; esac
  done <"$dir/manifest"
  tool=
  while read -r kind a b c d; do
    if [ "$kind" = tool ] && [ "$a" = "$platform" ]; then
      fetch "$b" "$d"
      tool=$dir/$b
    fi
  done <"$dir/manifest"
  [ -n "$tool" ] || die "This image has no installer for $platform yet."
  chmod +x "$tool"
  raw_size=$(awk '$1 == "raw-size" { print $2 }' "$dir/manifest")
  say ""

  if [ -n "${BISMILLAH_TEST_STICK:-}" ]; then
    choose_test
  else
    case $platform in
      linux-*) choose_linux ;;
      macos-*) choose_macos ;;
    esac
  fi
  [ "$sector" = 512 ] || die "$dev has $sector-byte sectors; bismillah needs a stick with 512-byte sectors."
  [ "$size" -ge "$raw_size" ] || die "$dev is too small ($shown). bismillah needs $((raw_size / 1000000 + 1)) MB or more."
  # A stick without a model name is confirmed by its device name.
  [ -n "$model" ] || model=${dev##*/}
  say ""
  say "Your password is needed to read and write $dev."
  kind=$(as_root "$tool" inspect "$raw" --size "$size") || die "Couldn't read $dev. Nothing was written."

  action=install
  if [ "${kind%% *}" = bismillah ]; then
    say ""
    say "$dev is a bismillah stick: $model ($shown)."
    say "  1  Update it to $version. Your texts stay."
    say "  2  Erase it and start again. Its texts are lost."
    ask "1 or 2?"
    case $answer in
      1) action=update ;;
      2) ;;
      *) die "Nothing was written." ;;
    esac
  fi
  say ""
  if [ "$action" = update ]; then
    say "This rewrites the system on $dev: $model ($shown). The texts stay."
  else
    say "This ERASES everything on $dev: $model ($shown), and puts bismillah on it."
  fi
  ask "Type the stick's name to confirm ($model):"
  [ "$answer" = "$model" ] || die "That isn't the name. Nothing was written."

  say ""
  if [ "$action" = update ]; then
    as_root "$tool" update "$dir" "$raw" --size "$size" --journal "$state" ||
      die "The update didn't finish. Run the command again to finish it; your texts are untouched."
  else
    as_root "$tool" install "$dir" "$raw" --size "$size" >/dev/null ||
      die "Writing failed, so bismillah isn't on the stick. Run the command again."
  fi
  sync
  case $platform in macos-*) diskutil eject "$dev" >/dev/null 2>&1 || true ;; esac

  # Keep this version's download for the next stick; older ones are no longer needed.
  for old in "$cache"/*; do
    [ "$old" = "$dir" ] || [ ! -d "$old" ] || rm -rf "$old"
  done
  say ""
  say "Done. Take the stick out and start your laptop from it: turn it on while tapping"
  say "its boot-menu key (F12 on a Dell; on others F9, F10, F11, F12 or Esc)."
}

main "$@"
