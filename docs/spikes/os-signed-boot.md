# OS-0 spike: signed boot

**Question** (os/PLAN.md, OS-0): does an mkosi Debian 13 image with the signed shim → systemd-boot → kernel chain boot in OVMF with Secure Boot on and Microsoft keys, with nothing enrolled, for the 2011-only, 2023-only and both-CA variable sets? And on the Dell from a real stick?

**Verdict: go in the VM.** The Dell run is still open (it needs the author to flash a stick).

## Setup

- Spike image: [`os/spikes/boot/`](../../os/spikes/boot/). Debian 13 with mkosi 27.1 and a Debian tools tree. `Bootloader=systemd-boot-signed`, `ShimBootloader=signed`, `UnifiedKernelImages=none`. Our own repart definitions: ESP, erofs root with `Verity=data`, `Verity=hash`.
- VM: `os/spikes/boot/run-vm.sh`. Arch's `OVMF_CODE.secboot.4m.fd` on q35 with SMM, the stick as `usb-storage` on `qemu-xhci`, no NIC, headless, serial log.
- Variable sets built with `virt-fw-vars` from Arch's blank `OVMF_VARS.4m.fd`, Secure Boot on, Microsoft KEK 2011 + 2023:

  | Set | db |
  |---|---|
  | `ca2011` | Microsoft Corporation UEFI CA 2011, Windows Production PCA 2011 (`--microsoft-db none` plus `--add-db`, because virt-fw-vars' `uefi11` profile also adds the 2023 CA) |
  | `ca2023` | Microsoft UEFI CA 2023 (`uefi23`) |
  | `both` | UEFI CA 2011 + UEFI CA 2023 (`uefi11`) |
  | `nodb` | none (negative control) |

## Results

| Set | Result |
|---|---|
| both | Boots. `secureboot: Secure boot enabled`, lockdown `[integrity]`, root `/dev/mapper/root` erofs, verity `verified` |
| ca2011 | Boots, same |
| ca2023 | Boots, same (trixie's shim 16 is dual-signed) |
| nodb | Refused by the firmware: `Access Denied -- rejected probably by Secure Boot`. Secure Boot really is enforcing. |

The kernel loads Debian's Secure Boot CA into the platform keyring and locks down, so only Debian-signed modules load.

## Findings

1. **The ESP must be at least 512 MiB with FAT32.** At 256 MiB, `mkfs.fat` makes a FAT32 with fewer than 65525 clusters. UEFI picks the FAT type by cluster count, so OVMF read it as FAT16, found no files, and reported `Not Found`. The plan's 256 MiB ESP becomes 512 MiB (or a 256 MiB FAT16, to be weighed in OS-4).
2. **mkosi puts the Type 1 entry and kernel in `/boot`.** The ESP definition needs both `CopyFiles=/boot:/` and `CopyFiles=/efi:/`.
3. **Firmware variables** (diff against a baseline in which the firmware had already booted once, without the stick):
   - `Boot0002` + `BootOrder` (the USB disk), `MTC` and `MemoryTypeInformation`: written by OVMF's boot manager for any removable device it sees. That's firmware behaviour and differs per machine.
   - **`SbatLevel`** (`sbat,1,2025021800 / shim,4 / grub,5`): written by **shim**. It is the only variable our chain writes. A revocation level; it only ever moves forward, and a host that has booted any recent shim already has it. To disclose in `os/README.md`.
   - No `LoaderSystemToken` (systemd-boot writes it only with a random seed on the ESP), no MOK variables, no boot entries from us (there's no `fbx64.efi`).
4. **Kernel choice: Debian 6.12 (trixie-security, 6.12.113) for now.** trixie-backports carries 7.2.9 as `linux-signed-amd64`, so it's signed and could go on the same chain if the Dell or a newer laptop needs it. Neither kernel has `simpledrm` (`CONFIG_DRM_SIMPLEDRM` unset, `CONFIG_SYSFB_SIMPLEFB` unset, `CONFIG_FB_EFI=y`), which confirms the plan's "the app draws the unlock screen".
5. **Network built-ins:** `modules.builtin` of 6.12.113 contains only `drivers/net/netkit` (a BPF virtual device, no hardware) under network drivers. Every NIC, Wi-Fi, Bluetooth, CAN and NFC driver is a module, so leaving modules and firmware out covers them. The `NET_VENDOR_*=y` lines in the config are menu switches, not drivers.

## Not yet done

- **The Dell from a real stick** (the author runs the flash; Claude never writes to a block device).
- Sizes and boot times. The first image's initrd is 127 MB (every module), deliberately left as it is: make it work first, optimise in OS-4.
