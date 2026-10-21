# Dell boot test: the stick boots (2026-10-20)

**Attempt 4 worked:** with the boot entry pointed at the stick, the Dell booted it into bismillah under cage, and everything worked. One problem: on the 3840×2160 panel (≈282 dpi) cage ran at scale 1, so the text was tiny. That is fixed in the image (see *After it booted*). **Secure Boot was off** for that boot (the author, 2026-10-21), so step 3 below, booting it with Secure Boot on, is still the open OS-0 check.

OS-0's "Does it boot on the Dell from a real stick?" ([PLAN.md](../../PLAN.md)). We tried three times. The stick never appeared in the Dell's boot list; we saw only the hard drive and Limine (Omarchy).

## What we know

- **The stick is fine as far as Linux can tell.** It holds a GPT with ESP (vfat, 512M), erofs root and verity hash. The ESP has `EFI/BOOT/BOOTX64.EFI` (Debian shim 16.1, signed by *Microsoft Corporation UEFI CA 2011*), `EFI/BOOT/grubx64.EFI` (systemd-boot, Debian-signed), `mmx64.efi`, `loader/entries/bismillah-spike-boot-*.conf`, the kernel and the initrds.
- **The Dell does see the stick.** It wrote SupportAssist logs onto the stick's ESP at `EFI/Dell/logs/diags_{current,previous}.xml` (2026-10-20 22:21 local time, two boots 30 s apart). Both say:
  > NO_BOOT: Operating System Loader has no signature. Incompatible with SecureBoot. All bootable devices failed Secure Boot verification.
  > DevicesTested: Memory, Hard Drive
- So **Secure Boot was on** for those two boots. The author reports it was off for the other attempts. Logs appear only when a boot fails, so the attempts with Secure Boot off left no trace.
- From PLAN.md: the Dell is a Precision 5520, BIOS 1.40.0. Its db holds the Microsoft UEFI CA 2011 and 2023, and Secure Boot is normally off because Omarchy (Limine, unsigned) needs it off.
- Fast Boot was off. USB boot support was on.

## Found on attempt 4's prep (2026-10-20): the boot entries were wrong

The machine we build on **is** the Dell (`/sys/class/dmi/id`: Dell Inc. Precision 5520, BIOS 1.40.0), so `efibootmgr` on it shows the Dell's own entries:

| Entry | Points at | Meaning |
|---|---|---|
| Boot0000 *Limine* | partition `54b916f8…`, `\EFI\limine\limine_x64.efi` | `54b916f8…` was **the stick's ESP ID** (the image's, from mkosi), not the NVMe's (`b3a2f27b…`). The firmware matched the stick to this entry, which is probably why no separate "UEFI: Voyager" entry appeared and "Limine" did. Booting it fails: there is no Limine on the stick. How the entry got this ID is unknown. |
| Boot0001 *UEFI: KXG50ZNV1T02 NVMe…* | NVMe ESP, `\EFI\boot\bootx64.efi` | What actually boots Omarchy (`BootCurrent`). |
| Boot0002 *bismillah* | **NVMe** ESP (`b3a2f27b…`), `\EFI\BOOT\BOOTX64.EFI` | The entry added by hand in F2. The disk picked was the internal NVMe, not the stick, so it boots Omarchy's fallback loader. |

With Secure Boot on, all three entries lead to unsigned Limine (or nothing), hence "All bootable devices failed Secure Boot verification": the shim on the stick was never tried.

Fixes so far: the stick's ESP ID was changed to `5EF75EBA-E4B0-4E2A-B1A7-631A2999DB75`, so it no longer matches Boot0000. (This is harmless, because only the root/verity IDs are in `roothash=`.) Boot0002 still has to be pointed at the stick; see the next try below.

**Build fix to do:** give each image's ESP a fresh random ID (or reflash and change it), so it can never collide with a host entry again.

## Next try (attempt 4), step by step

USB boot support was already on (confirmed by the author).

1. With the stick plugged into this laptop (it is `/dev/sda`; check with `lsblk`), replace the wrong entry with one that points at the stick. Then restore the boot order, so Omarchy stays the default, and make the stick the **next boot only**:
   ```bash
   sudo efibootmgr -b 0002 -B                                                   # delete the NVMe "bismillah"
   sudo efibootmgr -c -d /dev/sda -p 1 -L bismillah -l '\EFI\BOOT\BOOTX64.EFI'  # new entry on the stick
   sudo efibootmgr -o 0001,0000,XXXX                                            # XXXX = the new entry's number, printed above
   sudo efibootmgr -n XXXX                                                      # boot it once, on the next restart
   ```
2. Leave Secure Boot **off** and restart, with the stick still in. It should boot the stick. If it doesn't, press F12 and pick *bismillah*.
3. Once it boots with Secure Boot off, turn Secure Boot **on** in F2 and boot *bismillah* from F12. That is the actual OS-0 test.
4. Turn Secure Boot back **off** afterwards, or Omarchy won't boot.
5. If it fails, write down what the screen said, then plug the stick into the laptop and ask Claude to read `EFI/Dell/logs/` on it (`udisksctl mount -b /dev/sda1 -o ro`, no sudo).

Remaining suspects if the stick boots with Secure Boot off but not with it on: Expert Key Management in custom mode, or a `dbx` update.

## After it booted

- **HiDPI:** `/usr/libexec/bismillah-session` runs inside cage before the app. It sets each output with at least 192 dpi (GNOME's rule) to scale 2 through `wlr-randr` (cage 0.2.0 supports wlr-output-management). Outputs with no physical size (VMs, projectors) stay at 1×. A screen plugged in after start isn't rescaled yet.
- **Dark by default:** `/etc/gtk-3.0/settings.ini` sets `gtk-application-prefer-dark-theme`. The app follows the system scheme, so it opens dark unless the writer picks a theme. Checked in the VM (screenshot); the 2× scale still needs a Dell boot.

## Once it boots

Record the working firmware settings here and in PLAN.md (Test hardware row), and put the needed settings in `flash-spike.sh`'s closing message, which currently says only "turn Secure Boot on … boot it (F12)".
