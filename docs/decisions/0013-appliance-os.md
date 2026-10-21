# 0013 — Appliance OS: bismillah on a bootable stick

- **Status:** Proposed (OS-0 complete in the VM and on the Dell; awaiting the author's acceptance)
- **Date:** 2026-10-21
- **Amends:** [0009](0009-desktop-only.md) (a single-app appliance is still desktop), [0003](0003-offline-boundary.md) (offline guarantees at the OS level)

## Context
The author wants to write on any laptop without touching it: a USB stick that boots straight into bismillah, keeps the texts encrypted, and leaves the host as it was. The interview of 2026-10-20 fixed the goals and the threats (os/PLAN.md, *Decisions from the interview*): a lost or stolen stick, and no traces on the host. A tampered stick and a hostile laptop are out of scope. Phase OS-0 then tested each open question in a VM with Secure Boot on (docs/spikes/os-*.md).

## Decision
- **Base and boot chain.** Debian 13, built with mkosi, stripped (no shell, no package manager, no logging in release). Boot through Debian's Microsoft-signed shim → Debian-signed systemd-boot → Debian-signed kernel 6.12, so Secure Boot stays on and nothing is enrolled. trixie-backports' signed 7.2 kernel is the fallback for newer hardware. The ESP has no `fbx64.efi`.
- **Stick layout.** ESP (512 MiB FAT32: at 256 MiB, firmware reads it as FAT16), an erofs root checked by dm-verity, and a LUKS2 (Argon2id) home that reflashing never touches. Only home is encrypted; the system holds nothing private.
- **The app is the whole surface.** cage runs bismillah in an appliance mode as `writer`. The app draws the setup, unlock and suspend-lock screen itself, because Debian's kernel has no `simpledrm` and a graphical initrd would need the full GPU stack. It starts before home exists and continues in the same process after unlock (1.70 s from *Unlock* to caret in the VM; restarting the app instead cost 0.85 s more).
- **A narrow root helper** (`crates/bismillah-appliance`) opens, mounts and locks home, sets the keyboard and handles power over a typed socket that accepts only uid 1000.
- **Keyboard.** XKB layouts are stored by name in an unencrypted LUKS2 token, read before unlock, and changed by restarting the cage session (1.6 s). cage stays; sway isn't needed.
- **Closing the lid locks.** The helper watches logind's `LidClosed` and has the app lock at once, whether or not sleep follows: on the Dell, logind held off a lid close for 16.7 s after a recent resume (`HoldoffTimeoutSec=`), with the document unlocked behind the lid.
- **Suspend locks.** The helper holds a bounded logind delay inhibitor. If the app doesn't confirm its lock view is painted, the helper blanks the screen on an empty VT before sleep. On resume it waits there, and restarts the session locked if it must. A restart first ends the session's processes, then switches back to the session's VT, because wlroots won't start on an inactive VT.
- **Its own home only.** The helper finds home on the disk that holds the verified root, cross-checked against systemd-boot's `LoaderDevicePartUUID`. When the two disagree (two sticks of one build attached), it refuses and the unlock screen asks for the other stick to be removed.
- **Display.** cage waits for the boot-VGA DRM device and uses only it. Software rendering works as a fallback without settings. WebKit's render device isn't pinned (pinning it broke rendering); on the Dell it chose i915 by itself. nouveau stays in the image, because on hybrids it is what runtime-suspends the NVIDIA card.
- **No network.** No network modules or firmware ship. The kernel's only built-in network driver is `netkit`, a virtual device with no hardware.

## Consequences
- **What we can honestly claim** (os/PLAN.md, *Honest claims*): the release image sent zero frames on virtio, PCIe and hot-plugged USB NICs. The laptop disk got zero writes and zero allocated clusters. Shim's `SbatLevel` is the one firmware variable our chain writes, and `os/README.md` must disclose it. Firmware writes its own boot-manager entries for any removable disk, which we can't prevent.
- **Not defended:** a stick tampered with while away (the initrd and command line aren't signed), a hostile laptop, RAM or DMA attacks on a suspended stick, and a forgotten passphrase (there is no recovery).
- **Budgets are not yet met.** The root is 500 MiB (budget 600). The ESP is 48 MB (budget 40), because of the 32 MB base initrd. VM boot stages are 3–4× their first budgets. On the Dell, with a stick doing 565 random reads/s, the unlock screen is painted 20.6 s after kernel start (about 33 s from power-on, 11.7 s of it the firmware's), and cold reads of cage and the app take most of that. *Unlock* to caret is about 1.5 s on the Dell (budget 2.0). OS-4 cuts from this baseline.
- **Desktop behaviour is unchanged.** Appliance mode is a separate start path behind its own flag, and the desktop build never contacts a helper.
- **Spike code is temporary.** The OS-0 spike modules (`spike_*.rs`, `src/appliance/SpikeUnlock.svelte`) sit on main behind `BISMILLAH_SPIKE_*` variables. OS-1 and OS-2 replace them with the product's appliance mode and helper.

## The Dell (2026-10-21)
On the Precision 5520 from a real stick (os/spikes/boot/DELL-CHECK.md):
- it booted with Secure Boot on and nothing enrolled
- everything rendered on i915, and the NVIDIA card was never opened and runtime-suspended
- both lid closes locked within 31 ms, before `deep` sleep, and the stick survived each resume
- the lid hold-off after a resume, above, is the one change it brings.

Still to measure on the Dell, in OS-1: a cold *Unlock* → caret (the check didn't reboot) and the cold shader cache.
