# OS-0 spike: host untouched

**Question** (os/PLAN.md, OS-0): use a fake host disk (a qcow2 overlay plus write tracing) and a diffed OVMF variable store. After boot, use and shutdown, are there zero writes to the host disk, no swap activated and no partitions mounted? Which firmware variables change, for example systemd-boot's `LoaderSystemToken`, shim's `SbatLevel` or MOK variables, and boot entries?

**Verdict: go.** In the VM (Secure Boot on, 2026-10-21):
- The laptop disk gets **0 write requests and 0 allocated clusters**, with no swap and no mount. It is only read, for partition probing.
- The boot chain writes **one** firmware variable: shim's `SbatLevel`.
- Everything else that changes is the firmware's own bookkeeping, and also happens with no operating system at all.

## Setup

- **Fake laptop disk** (`os/spikes/boot/work/hostdisk.raw`, 2 GB, attached as NVMe):
  - a FAT32 ESP
  - an ext4 root
  - a swap partition
  - a decoy ext4 partition labelled `bismillah-home`, of the GPT home type
- **Write tracking:** the disk sits behind a qcow2 overlay, so any write allocates a cluster. QEMU runs with `-no-shutdown`, so after the guest powers off the test reads each disk's write counters (`query-blockstats`), then `qemu-img map`s the overlay.
- **Variables:** `virt-fw-vars --output-json` dumps the store before and after, and the test diffs them. A baseline boots the firmware alone with a blank USB disk.
- **Runs:** `os/spikes/boot/host-test.sh <vars> <out> <image> app host`.
  - The no-network app image boots to the editor. The test types a sentence, then powers off through ACPI.
  - The binding image also reports its mounts and swaps from inside.

Evidence: `os/spikes/boot/results/host-untouched.txt`.

## Results

| Check | Result |
|---|---|
| Laptop disk writes (app image, text typed) | 0 requests, 0 bytes; 316 reads |
| Overlay clusters allocated | 0 |
| Swap | none (`/proc/swaps` empty; `swap.target` reached with nothing in it) |
| Mounts | only the stick: `/dev/mapper/root` on `/`, and its ESP on `/boot` when accessed |
| The decoy `bismillah-home` | ignored, both by systemd's gpt-auto and by the helper's lookup ([os-boot-device-binding.md](os-boot-device-binding.md)) |
| Stick writes | 0 in the app image; 2 (8 KiB) in the binding image, from `systemd-boot-random-seed` refreshing the seed on the stick's ESP |

**Firmware variables.** A boot of the stick adds these to what the firmware alone writes:

| Variable | Written by | What it is |
|---|---|---|
| `SbatLevel` (non-volatile, boot-services only) | **shim** | The SBAT revocation level: `sbat,1,2025021800`, `shim,4`, `grub,5`. It revokes older shim and GRUB builds on this machine. |
| `Boot0002` + `BootOrder` | OVMF | A boot entry for the USB disk it found. OVMF does this for any bootable removable disk; a blank one gets none. |
| `MemoryTypeInformation` | OVMF | Memory statistics after a full OS boot. |

Not written: `LoaderSystemToken`, any MOK variable (`MokList`, `MokSBState` and so on), or a shim fallback boot entry.

The firmware alone, with no OS, writes: `Boot0000`, `Boot0001`, `BootOrder`, `ConIn`, `ConOut`, `ErrOut`, `Key0000`, `Key0001`, `Lang`, `PlatformLang`, `MTC`, `Timeout`, `VarErrorFlag`, `VendorKeysNv` and `certdb`.

## Findings

1. **`SbatLevel` is the one host change, and shim makes it.** Any current distribution's shim 16 writes the same value: Debian 13, Ubuntu and Fedora all ship it. It only matters for an OS on the same machine that boots with Secure Boot on through an older shim or GRUB. That OS would then be refused until it updates. On the Dell, Omarchy boots with Secure Boot off, and SBAT is only enforced with it on, so Omarchy isn't affected. *Mitigation:* the README says this plainly. It can't be avoided while we boot through Microsoft-signed shim, and shim is what keeps Secure Boot on without enrolling anything.
2. **Boot entries depend on the firmware.** OVMF adds one for the stick by itself. Real firmware varies: the Dell needed one added by hand. Nothing in our chain writes one.
3. **The stick writes to its own ESP** (`systemd-boot-random-seed`) when the ESP is mounted. OS-1 should decide whether that's wanted. It's harmless to the host, but it's a write on every boot, and the ESP is a FAT filesystem that can't take sudden removal well.
4. **gpt-auto ignores other disks.** It only looks at the disk the root came from, so the laptop's swap and home-typed partitions stay untouched. On the stick itself it still tries to mount and grow `home` (the unlock spike's finding). The product needs `/home` in fstab, or gpt-auto turned off for home.

## Not covered here

- Real firmware: the Dell's variable store before and after a boot. Linux can list it with `efivar -l` from Omarchy before and after. That's an optional check for the author.
- Suspend and hibernate: hibernation is refused under lockdown anyway. Suspend is its own spike.
