# The bismillah stick

A USB stick that starts a laptop straight into bismillah and nothing else. The stick has no network, no shell and no other program. Your texts are encrypted on it, and the laptop it boots on is left untouched. You don't change the laptop's firmware settings: Secure Boot stays on.

This folder builds it. The plan and each phase's results are in [PLAN.md](PLAN.md), and the decisions are in [ADR-0013](../docs/decisions/0013-appliance-os.md) and [ADR-0014](../docs/decisions/0014-stick-stays-on-debian.md). The security audit is [docs/audits/2026-10-22-stick-1.0.md](../docs/audits/2026-10-22-stick-1.0.md).

The [typewriter-only review](TRIMMING.md) lists everything removed or disabled,
the additional input-driver cuts, and the WebKit dependencies still worth trimming.

On supported touchpads, light taps click and accidental touches are suppressed
while typing. Physical clicks and two-finger scrolling remain available.

## Making a stick

You need this repository on a Linux machine with mkosi 27.1 (`os/inputs.lock` records the version), podman, QEMU and OVMF for the tests, and a USB stick of 2 GB or more.

```bash
pnpm os:fetch     # once, online: Debian packages, the build container and the tools
pnpm os:build     # the app, then the release image, offline from os/cache/
pnpm os:verify    # contents, every VM scenario and the measurements
bash os/scripts/flash.sh release
```

`flash.sh` lists your USB disks and asks which one to erase. It refuses any disk that isn't USB, removable or hot-pluggable, that holds this machine's root, or that is still mounted. If it cannot inspect the root disk ancestry or mounted partitions, it refuses to proceed. Device aliases are checked by their kernel device names. It writes nothing until you type the stick's model name back.

The first flash erases the whole stick. It checks that the image's partitions are complete before preparing its copy, gives the stick its own disk, ESP and home GUIDs, writes them into the ESP's `bismillah/stick-id`, and records them in `os/sticks.toml` on this machine. That file is never committed, and updating the stick later needs it, so keep it. Registry changes use an atomic replacement and are synced to disk; a failed write preserves the previous entries.

At its first boot the stick asks for a keyboard, a passphrase and a time zone. It then formats its home partition (LUKS2 with Argon2id, calibrated on that laptop). From then on it boots to the unlock screen. **There is no recovery: if you forget the passphrase, the texts are gone.**

## Updating a stick, keeping its texts

```bash
pnpm os:build
bash os/scripts/flash.sh --update release
```

`--update` rewrites only the system: the ESP, the root and the root's verity hashes. The home partition, its encryption header and your texts are never opened. Before it writes anything, it checks:

- that the stick's disk GUID and the GUIDs of its ESP and home are the ones `os/sticks.toml` recorded at the first flash, and that the ESP's stick-id names the same three. Labels are never trusted, because any disk can carry any label.
- that the stick has exactly an ESP, a root, a verity and a home partition, and nothing else.
- that the primary GPT header and partition table have valid checksums before trusting their offsets, on both the stick and the image.
- that the image contains the complete ESP, root and verity partitions, so a truncated image is refused before changing the stick.
- that the new system fits the stick's slots: the root slot is 640 MiB and the verity slot 8 MiB, against a root of about 360 MiB today.

It then writes the root and verity first and the ESP last, gives the root and verity partitions the new build's GUIDs (the boot finds them by the root hash), and reads all three back. An update cut off halfway can be run again.

There is no update code on the stick itself: it never fetches, installs or changes its own system.

## Why Secure Boot stays on

The stick boots through programs that the laptop's firmware already trusts. Nothing is enrolled, and no setting is changed:

```
the laptop's firmware (Secure Boot on, Microsoft's keys)
  └─ shim                Debian's, signed by Microsoft (2011 and 2023 CAs)
      └─ systemd-boot    signed by Debian; no menu, no editor
          └─ Linux 6.12  signed by Debian; kernel lockdown is on under Secure Boot
              └─ the system: read-only erofs, every block checked by dm-verity
                  ├─ bismillah-helper (root): the home partition, unlock, power
                  └─ cage and bismillah (the writer, uid 1000)
```

Under Secure Boot the kernel loads only Debian-signed modules, and only from the verified root, so the drivers left out of the image (network, Wi-Fi, Bluetooth, sound) can't be added at runtime.

## What the stick promises, and what it doesn't

Each claim says how it is known: **tested** means a VM scenario checks it on every build, and **audited** means the image's contents are checked on every build. The scenarios are in `scripts/test.ts`, the contents check is `tests/image-contents.ts`, and the last results are in PLAN.md (*Phase OS-5 result*).

- **Tested: the stick sends nothing on a network.** In a VM with network cards attached, including PCIe and USB cards plugged in while it runs, the release image sends zero frames. The frames are captured by QEMU, outside the stick.
- **Audited:** the image has no network, Wi-Fi or Bluetooth drivers, and no network firmware.
- **Tested: your texts are encrypted at rest** (LUKS2, Argon2id). A lost or stolen stick that is powered off reveals only the keyboard layout's name and that it is a bismillah stick.
- **Tested: the stick never writes to the laptop's disks.** It never mounts them or uses their swap, and it never assembles their RAID or LVM volumes (it has no tools for either). In the VM the laptop's disk is a qcow2 overlay. After setup, writing and power-off, QEMU counts zero write requests to it and the overlay holds no data.
- **Measured and disclosed: firmware variables.** One boot through the stick changes these variables in the laptop's firmware:
  - `SbatLevel`, written by shim. It records the Secure Boot revocation level (SBAT) that current shims all write. Another system on the laptop that boots with Secure Boot on through an older shim or GRUB would then be refused until it is updated. With Secure Boot off, SBAT isn't enforced.
  - A boot entry for the stick (`Boot####`, `BootOrder`), on firmware that adds entries for removable disks by itself (OVMF does). Nothing on the stick writes boot entries: it ships no `fbx64.efi`, shim's fallback loader.
  - The firmware's own bookkeeping, such as `MemoryTypeInformation`, which it also writes without any system at all.
- **Tested: a save shown as "Saved" is on the stick.** If the stick is pulled out or the power dies, edits since the last completed save can be lost. The low-battery shutdown narrows that window.
- **Not protected:**
  - a stick someone has modified in secret: the initrd and kernel command line aren't signed in this boot chain, so verity catches damage, not tampering
  - a hostile laptop: its firmware, a keylogger
  - a stick that is suspended or running, against attacks on its memory: the disk key is in RAM while it sleeps
  - a forgotten passphrase.

## When a laptop won't boot it

1. **Pick the stick in the firmware's boot menu** (Dell: F12; others: F9, F10, F11, F12 or Esc). Firmware usually lists it as "UEFI: <stick name>".
2. **If the stick isn't listed:**
   - Turn on USB boot in the firmware settings, if there is such a setting.
   - Some firmware ties an old boot entry to a partition ID. On Linux, `efibootmgr -v` shows the entries; every stick has its own IDs, so a new flash doesn't collide.
3. **If the firmware says the loader isn't signed,** the laptop may trust only one of Microsoft's two certificate authorities, or its firmware may reject dual-signed shims (Debian's wiki warns of some). Write down the message and the laptop's model and firmware version. The VMs test 2011-only, 2023-only and both.
4. **If it starts but the screen stays black,** its GPU may not be one the stick supports: Intel, AMD, NVIDIA (nouveau) and virtio are.

The laptop's settings are never the fix: don't turn Secure Boot off for the stick.

## Recommended stick

Any USB stick of 2 GB or more works, but cheap sticks read small random blocks slowly, which is what booting does. Prefer a USB 3 stick that supports UAS, or a small USB SSD. On a slow stick the unlock screen comes up 10 s after the kernel starts (measured on QEMU's "cheap stick" profile), against 7 s on a good one.

## Tested laptops

| Laptop | Firmware | Secure Boot | Microsoft CAs in db | GPU | Result |
|---|---|---|---|---|---|
| Dell Precision 5520 | 1.40.0 (AMI) | on | 2011 and 2023 | Intel HD 630 (i915); NVIDIA Quadro M1200 idle under nouveau | Boots, unlocks, sleeps and locks on the lid (OS-0 check, 2026-10-21). The 1.0 image waits for the author's check. |
| QEMU q35 + OVMF (edk2) | Arch's edk2-ovmf | on | 2011 only | virtio-gpu, VGA | Boots (every build, `release-ca2011`) |
| QEMU q35 + OVMF (edk2) | Arch's edk2-ovmf | on | 2023 only | virtio-gpu, VGA | Boots (every build, `release-ca2023`) |
| QEMU q35 + OVMF (edk2) | Arch's edk2-ovmf | on | both | virtio-gpu, VGA | Boots (every build, every scenario) |

Other machines are best effort. Certificate trust, revocations, firmware and GPU support all differ between machines. Add a row for each laptop the stick is tried on, whatever the result.

## Folder layout

| Path | What it is |
|---|---|
| `mkosi/` | The image: Debian 13 packages, the units and settings, the partitions (`mkosi.repart/`), the release and debug profiles, the allowlist and `prune.py` |
| `build/` | The container that builds the app offline (`build-app.sh`) |
| `scripts/` | `fetch.sh`, `build.sh`, `flash.sh`, `stick.ts` (which stick is ours; reflash), `verify.sh`, the VM harness `vm.ts`, the scenarios `test.ts`, `perf.ts`, `trace.sh` |
| `tests/` | The image contents check; reflash, boot timing, capture evidence, QMP and firmware-cache regressions |
| `inputs.lock`, `cache/` | The recorded inputs (mkosi, Debian snapshot), and the fetched ones (not committed) |
| `spikes/` | OS-0's experiments, kept for reference |


Startup keeps the pointer hidden until movement and reveals the first screen after
its labels, fonts and display scaling are ready. Firmware logos and panel resets
before Linux takes over still depend on the laptop.
