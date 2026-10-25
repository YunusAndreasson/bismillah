# Typewriter-only image review

Reviewed 2026-10-25. This inventory distinguishes files removed from the image,
services disabled, and libraries that still have to ship. It applies to the release
stick; the debug image deliberately adds a serial command line and diagnostic tools.

## Changes in this review

The broad input-driver selection also included hardware with no writing purpose.
`mkosi/mkosi.conf` now excludes:

- Every driver under `drivers/input/joystick/` (including Xbox controllers and legacy
  serial/parallel-port joysticks).
- Every driver under `drivers/input/gameport/` (legacy game ports).
- `drivers/input/misc/pcspkr` (the PC speaker, which can beep without an ALSA driver).

`tests/image-contents.ts` checks these exclusions in both built images. It also now
checks that camera/capture-card, radio and TV-tuner driver classes remain absent.
Keyboard, mouse, touchpad and laptop hotkey support stay.

The release profile also removes `/usr/bin/stty` (debug serial-terminal setup) and
`/usr/bin/journalctl` (journal inspection). The shared trace had retained both from
diagnostic runs, although release has no command line or running journal. The debug
image keeps them. The contents audit checks their absence in release. Together
these two executables occupy 169,528 bytes; with the 32 modules below, the new
exclusions remove 34 files and 357,348 bytes (349.0 KiB) before filesystem compression.

The built-image comparison removes exactly 32 module files, totalling 187,820 bytes
(183.4 KiB of compressed module data; 248 KiB allocated in the extracted tree).
Under `/usr/lib/modules/6.12.113+deb13-amd64/kernel/`, every removed file is:

```text
drivers/input/gameport/emu10k1-gp.ko.xz
drivers/input/gameport/fm801-gp.ko.xz
drivers/input/gameport/gameport.ko.xz
drivers/input/joystick/a3d.ko.xz
drivers/input/joystick/adi.ko.xz
drivers/input/joystick/analog.ko.xz
drivers/input/joystick/cobra.ko.xz
drivers/input/joystick/db9.ko.xz
drivers/input/joystick/gamecon.ko.xz
drivers/input/joystick/gf2k.ko.xz
drivers/input/joystick/grip.ko.xz
drivers/input/joystick/grip_mp.ko.xz
drivers/input/joystick/guillemot.ko.xz
drivers/input/joystick/iforce/iforce-serio.ko.xz
drivers/input/joystick/iforce/iforce-usb.ko.xz
drivers/input/joystick/iforce/iforce.ko.xz
drivers/input/joystick/interact.ko.xz
drivers/input/joystick/joydump.ko.xz
drivers/input/joystick/magellan.ko.xz
drivers/input/joystick/pxrc.ko.xz
drivers/input/joystick/sidewinder.ko.xz
drivers/input/joystick/spaceball.ko.xz
drivers/input/joystick/spaceorb.ko.xz
drivers/input/joystick/stinger.ko.xz
drivers/input/joystick/tmdc.ko.xz
drivers/input/joystick/turbografx.ko.xz
drivers/input/joystick/twidjoy.ko.xz
drivers/input/joystick/walkera0701.ko.xz
drivers/input/joystick/warrior.ko.xz
drivers/input/joystick/xpad.ko.xz
drivers/input/joystick/zhenhua.ko.xz
drivers/input/misc/pcspkr.ko.xz
```

## Already removed or excluded

| Capability                                   | What the build removes or disables                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ethernet, Wi-Fi, USB tethering and Bluetooth | Network and radio driver classes and network firmware are excluded. This includes virtio-net and USB network adapters. Network-dependent storage, filesystems and offload drivers are excluded too, because their dependencies otherwise bring network drivers back. |
| Other communications devices                 | NFC, CAN, InfiniBand, ISDN, ATM, USB gadget networking and FireWire networking driver classes are excluded.                                                                                                                                                          |
| Network services                             | networkd, its socket/wait-online/storage services, resolved, timesyncd and the network generator are masked. Their unused executables are pruned. There is no online update service or telemetry.                                                                    |
| Sound output and microphone recording        | ALSA hardware drivers, including USB audio, are absent. No audio server or mixer UI is provided. Sound core modules remain as dependencies of laptop hotkey drivers; these cannot drive speakers or record a microphone on their own.                                |
| Webcams, video capture, radio and TV         | No camera/capture-card, radio or TV-tuner hardware drivers are selected. Some media core modules remain as GPU/HID dependencies.                                                                                                                                     |
| Browser and external links                   | No browser or URL launcher is shipped. Links never open, including Ctrl+click; the app's link-opening IPC and GIO launcher code were removed in ADR-0015. Markdown links and address tooltips remain part of writing. Remote images never load.                      |
| File-manager integration                     | No file manager, `xdg-open` or `gio` launcher. _Show in file manager_ and its IPC were removed in ADR-0015. The editor's own library and native file chooser remain.                                                                                                 |
| Rich clipboard export                        | _Copy as rich text_, its IPC/native clipboard path, markdown-it, markdown-it-footnote and DOMPurify were removed in ADR-0015. Plain Markdown copy/paste remains.                                                                                                     |
| General desktop and terminal                 | Only cage and bismillah run as the writer's session. No desktop shell, terminal, second application or per-user systemd manager.                                                                                                                                     |
| Interactive command line and logins          | Release has no sh/bash/dash, Perl, Python or BusyBox. login, agetty, sulogin, su and sudo are absent. Gettys, emergency/rescue shells and the debug shell are masked.                                                                                                |
| Package management                           | apt, dpkg, their helpers, caches and package databases are removed. The system is updated by reflashing from another computer.                                                                                                                                       |
| Alternative bootloader                       | GRUB executables and data are removed. Shim's fallback loader is absent. systemd-boot's menu, editor and firmware entry are disabled.                                                                                                                                |
| Duplicate boot files                         | The root filesystem's extra kernel, kernel config and System.map are removed; the boot uses the kernel on the ESP.                                                                                                                                                   |
| Release diagnostics                          | Journald services/sockets and journal maintenance are masked, systemd logs nowhere, and app/session output goes to null. Release contains no trace recorder, socket probe, debug console, boot marks or WebKit inspector configuration.                              |
| Escape shortcuts                             | SysRq is disabled from kernel start; cage disables VT switching. Ctrl+Alt+Del powers off cleanly rather than rebooting. The loader offers no editable command line.                                                                                                  |
| Host-volume activation                       | No LVM, mdadm, dmraid or swapon tools in release; no automatic GPT-volume generator. The helper alone mounts the selected stick's home.                                                                                                                              |
| Host TPM and crash storage                   | TPM setup, PCR measurement/locking services and pstore cleanup are masked. Firmware variables mount read-only.                                                                                                                                                       |
| Unused maintenance and mounts                | e2scrub jobs, GRUB hooks, extension-image services, and unused hugepage, message-queue, binfmt, FUSE-control, configfs, debugfs and tracing mounts are masked.                                                                                                       |
| Documentation and auxiliary data             | System locales/translations, manuals, info pages, package documentation, lintian data and shell completions are stripped. The C locale, app guide, licences, fonts, keyboard layouts and time zones remain.                                                          |
| General initrd tools                         | The initrd is separately pruned: no shell, Perl, btrfs tools, networkd, login/sulogin or hardware database. It keeps only the boot tools and their dependencies.                                                                                                     |
| Idle developer work                          | Kernel lockup watchdogs are disabled. The per-user service-manager startup, first-boot work and unused generators are removed from normal boot.                                                                                                                      |
| Privilege escalation via mount               | mount and umount have their setuid bits removed; the root helper performs mounting.                                                                                                                                                                                  |

The exact build policy is in `mkosi/mkosi.conf`, the release profile,
`allowlist.txt`, `allowlist-declared.txt`, `initrd-keep.txt`, `prune.py`, and the
`/dev/null` unit links under `mkosi.extra` and the release profile. The allowlist
removes every unneeded executable/data file outside the explicitly preserved trees;
it is more exhaustive than a package-name blacklist.

## What can be trimmed further

Debian's WebKitGTK still requires GStreamer, audio/video codecs, ALSA client
libraries, Flite speech libraries, libsoup/TLS, and other supporting libraries.
`WebKitNetworkProcess` also serves WebKit's local resource loading and remains.
Deleting these shared libraries would leave unresolved ELF dependencies and prevent
the editor from starting. They do not mean the stick has working audio or networking.
The signed Debian kernel retains built-in protocol stacks and loopback; this review
does not claim those were removed.

The next substantial reduction is the custom WebKitGTK build already scheduled in
PLAN.md: disable media, WebRTC, speech, geolocation, enchant and libsecret, and then
recompute the dependency closure. ICU data and Mesa/LLVM could also shrink with
custom builds, but ICU serves Arabic/text/time zones and Mesa/LLVM supports the GPU
families and software-rendering fallback. These need their own measured build and
regression work. They have not been removed in this review.

GPU acceleration, power/thermal/backlight management, logind and sleep locking,
WebKit's sandbox, USB storage, encryption, durable saving and file recovery all earn
their place. Removing them would compromise writing, compatibility or the writer's
texts. An optional screen-reader image would deliberately restore audio; it remains
future work.

## Verification

- Rebuilt the app offline from current commit `66a16cb` and rebuilt release and
  debug images. Both extracted images record that app commit, including ADR-0015's
  removal of link opening, file-manager integration and rich copy.
- The release/debug/initrd contents audit passes. A comparison with the previous
  extracted release confirms exactly the 34 removed files listed above, with no
  missing shared libraries.
- `pnpm check`, `pnpm lint` and all 432 frontend tests pass.
- Every functional VM scenario passes across the full run and targeted retries.
  The initial full run had two failures: OVMF exhausted its USB-detection retries
  during the round trip, and the twin-stick assertion expected only `two_sticks`.
  The round trip passes on retry. The twin test now accepts either existing safe
  refusal (`two_sticks` or `no_boot_disk`) and additionally hashes the boot stick,
  so both sticks must remain byte-for-byte unchanged; that strengthened test passes.
  The existing Rust `disk::decide` tests explicitly allow `no_boot_disk` when root
  data/hash partitions resolve to two disks. No helper behavior was changed.
- Network capture reports **zero frames** on virtio, PCIe Ethernet and USB Ethernet.
  Save/crash/power-cut/full-disk/removal, interrupted setup, damaged home, suspend
  locking, power, the editor tour, host-disk protection, escape keys, helper socket
  and reflash scenarios all pass.
- `node os/scripts/perf.ts --sizes` passes: ESP payload 23.6 MiB, initrd 9.9 MiB,
  erofs root 356.4 MiB (baseline 356.7 MiB), with no size regressions. The root-size
  difference also includes the refreshed app; the precise removal total above
  counts only the new file exclusions.
- After the touchpad fix, the full three-boot-per-profile performance comparison
  completed but reported **12 timing regressions** under host load averages around
  12–18. Even the pre-Cage kernel → switch-root stage on the good profile increased
  to 4.37 s from 2.69 s. These results do not isolate the input patch's timing impact.
  Sizes pass and writer-process PSS is 695.8 MiB (1 GiB budget). The baseline was not
  changed. The full OS gate remains red pending a quiet-host performance check.
  The complete measurements are preserved in `os/out/tap-performance-report.md`
  and `os/out/tap-performance-result.json`.

The subsequent [touchpad fix](mkosi/cage/README.md) rebuilds the existing Cage
compositor to enable light taps and disable-while-typing; it adds no runtime library
or daemon. Compiler tools stay in the build overlay, and its synthetic-input probe
is debug-only. The release image audit checks those boundaries. A fresh capture
of the final release image again records zero frames on all three NIC types;
`os/out/tap-final-contents.log`, `os/out/tap-network.log` and `os/out/tap-sizes.log`
record the final contents, offline-network and size checks.

Local evidence: `os/out/trim-verification.log` (initial full run),
`os/out/trim-retry.log` (successful round-trip/twin retry),
`os/out/trim-twin-check.log` (strengthened twin test), `os/out/trim-sizes.log`,
and `os/out/trim-performance-retry.log` (incomplete performance run).
