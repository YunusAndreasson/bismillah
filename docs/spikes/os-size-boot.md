# OS-0 spike: size and boot baseline

**Question** (os/PLAN.md, OS-0): for the first stripped image, how big is each component (WebKit, ICU, Mesa and LLVM, firmware, fonts)? How long does each boot stage take, in the VM with "good" and "cheap" sticks, and on the Dell from a real stick? And which stick should we recommend, given that random-read speed matters?

**Verdict: baseline recorded, in the VM and on the Dell.** The first stripping pass and a compressed root meet the root budget: **500 MiB** against 600. The kernel-modules initrd fix brings the ESP from 186 MB to 48 MB, still over its 40 MiB budget because of the 32 MB base initrd. In the VM the boot stages are 3 to 4 times their initial budgets, so OS-4 has a measured baseline to cut from. *Unlock* → caret is 2.1 to 2.7 s against 2.0. Every time below is from QEMU on this laptop. The Dell boot (`os/spikes/boot/DELL-CHECK.md`) gives the real-hardware numbers and the stick's measured speed.

## The image

`mkosi --profile=app --profile=unlock --profile=nonet --profile=gpu --profile=probe --profile=slim`: the app with the unlock screen, no network drivers, the GPU firmware, and the first stripping pass (`os/spikes/boot/mkosi.profiles/slim/`):
- No translations, docs, man or info pages, lintian or bash-completion.
- No GRUB: shim-signed pulls it in, but the stick boots systemd-boot.
- No Debian copy of the kernel in `/boot`.
- A small kernel-modules initrd (below).
- The root as erofs, zstd-compressed. `--profile=erofs-lz4hc` and `--profile=erofs-none` switch the compression for comparison.

## Sizes

| Partition | Before stripping | Stripped, uncompressed | Stripped, lz4hc | **Stripped, zstd** | Budget |
|---|---|---|---|---|---|
| Root (erofs) | 1086 MiB | 930 MiB | 520 MiB | **500 MiB** | ≤ 600 MiB |
| Verity hash | 7.3 MiB | 7.3 MiB | 4.1 MiB | 3.9 MiB | — |
| ESP payload | 186 MB | — | — | **48.4 MB** | ≤ 40 MiB |

**ESP payload, now:**
- kernel: 12.2 MB
- base initrd: **32.0 MB** (budget ≤ 15 MiB)
- modules initrd: 2.1 MB
- shim, MokManager and systemd-boot: 2.2 MB

**Before the fix**, mkosi put every kernel module in the modules initrd, and with them all the GPU firmware: **127 MB**. Debian's kernel was also copied a second time from `/boot`.

**The root by component** (uncompressed, 928 MiB; `os/spikes/boot/size-report.py`, files assigned through dpkg's lists):

| Component | MiB | Main parts |
|---|---|---|
| WebKit and its media stack | 197 | libwebkit2gtk 96, JavaScriptCore 32, flite (speech) 26, AV1/JPEG XL/WebP codecs, libsoup |
| GPU firmware | 156 | AMD 81, NVIDIA 62 (GSP images), Intel 13 |
| LLVM | 150 | libllvm19 124 and libz3 27, for Mesa's llvmpipe and radeonsi |
| Base system | 98 | coreutils, libc, perl-base, bash, util-linux, dpkg |
| Kernel modules | 73 | after removing network drivers; includes a second 11.6 MiB kernel copy |
| GTK, GLib, Pango, Cairo | 55 | adwaita-icon-theme 13 |
| Mesa | 45 | mesa-libgallium 41 (every driver in one library) |
| ICU | 37 | libicu76 |
| The app | 36 | one binary, fonts and dictionaries inside |
| systemd, udev, dbus | 19 | udev's hwdb 13 |
| GStreamer | 17 | WebKit's media |
| Encryption | 9 | cryptsetup, OpenSSL, argon2 |
| Fonts | 3.5 | system fonts; the app's own are in its binary |
| cage, wlroots, seat | 4 | |

Also present: 8.5 MiB of dpkg database and 1.4 MiB of caches under `/var`. The image mounts a tmpfs over `/var`, so these are never seen.

## Boot

`os/spikes/boot/boot-test.sh` boots one copy of the stick: unthrottled for setup, then once per profile.
- **Throttles:** QEMU caps reads per request and per byte (`throttling.iops-read` and `bps-read`).
  - **good:** 150 MB/s and 2500 requests/s, a fast USB 3 stick
  - **cheap:** 25 MB/s and 400 requests/s
- **Times:** the app's marks as uptime from kernel start, `systemd-analyze`, and wall time from QEMU's start, which includes OVMF and the loader.

**zstd root** (seconds):

| Stage | Unthrottled | good | cheap |
|---|---|---|---|
| Firmware + loader (QEMU wall time minus uptime) | 2.8 | 3.2 | 4.4 |
| Kernel | 1.2 | 1.2 | 1.3 |
| Initrd (USB stick found at ≈3.5, verity root mounted) | 3.4 | 3.4 | 3.9 |
| Userspace to the session | 2.2 | 2.0 | 3.4 |
| Session to app process (PAM, user manager, cage, `wlr-randr`) | 1.8 | 1.8 | 4.2 |
| App process to unlock screen painted | 2.5 | 2.5 | 4.2 |
| **Kernel start → unlock screen** | **11.1** | **10.9** | **17.1** |
| **QEMU start → unlock screen** | **13.9** | **14.1** | **21.5** |
| *Unlock* pressed → caret (the Argon2id KDF ≈ 1.7–2.0 of it) | 2.1 | 2.4 | 2.7 |

**By compression,** QEMU start → unlock screen:

| Root | Unthrottled | good | cheap |
|---|---|---|---|
| zstd | 13.9 | 14.1 | 21.5 |
| lz4hc | 14.9 | 14.3 | 21.7 |
| uncompressed | 16.2 | 14.4 | 25.3 |

Evidence: `os/spikes/boot/results/size-boot-baseline.txt`.

## Findings for OS-1 and OS-4

1. **Compress the root.** zstd or lz4hc halves it (930 → 500–520 MiB). On the cheap stick it boots 3.8 s faster than uncompressed, and no slower on a fast one. zstd and lz4hc are within the noise for time, and zstd is 20 MiB smaller. **Take zstd**; the Dell decides if its CPU disagrees.
2. **Set the initrd's modules explicitly.** mkosi's default modules initrd takes every module and its firmware (127 MB). The stick needs only USB host and storage, `sd_mod`, device-mapper and verity, erofs and efivarfs. Two traps:
   - **crc32c:** erofs needs `libcrc32c`, which finds its crc32c implementation through the crypto API, a softdep mkosi doesn't follow. Without `crc32c_generic`/`crc32c-intel` the root fails to mount (emergency mode).
   - **sha256:** dm-verity picks its sha256 when the initrd opens the root, and keeps it. Without `sha256-ssse3` there, every root read would be hashed in plain C. With it, the kernel logs `sha256 using shash "sha256-avx2"`.
3. **The base initrd (32 MB) is next.** It's mkosi's default initrd with systemd, udev, cryptsetup and more. The helper unlocks home after switch-root, so the initrd only needs udev, veritysetup and the root mount. Target ≤ 15 MiB in OS-4.
4. **Most of the boot isn't the stick.** Unthrottled and "good" are the same. The VM's time goes to:
   - finding the USB stick (≈ 3.5 s from kernel start)
   - starting the session: PAM and the user manager, then cage and `wlr-randr`, then WebKit
   
   OS-4's cuts:
   - start the session as soon as local filesystems are up, not at `graphical.target`
   - drop the user manager if nothing needs it
   - skip `wlr-randr` when nothing needs scaling
   - measure on the Dell before tuning further
5. **The cheap stick costs 6 to 8 s,** mostly in loading the session's libraries: WebKit, LLVM and ICU, about 450 MiB of random page-ins. Every MiB cut from the root is boot time on cheap sticks. The largest cuts:
   - LLVM (150 MiB): our own Mesa without llvmpipe, or WebKit's software path
   - GPU firmware compression (156 → ≈ 53 MiB with zstd)
   - WebKit's speech and media codecs (≈ 60 MiB)
6. **Duplicates to remove:** a second kernel copy (11.6 MiB) under `/usr/lib/modules`, Debian's `/boot` copies (done), and `/var` content under the tmpfs.
7. **RAM after unlock:** 847 MiB used system-wide with the specimen open (Dell-image smoke test in the VM, 2 GiB). Budget ≤ 1.2 GiB.
8. **VM harness:** QEMU's `throttling.iops-size` counts a large read as many small ones. A first run with it capped all reads at 1.6 MB/s ("cheap") and took 132 s to the unlock screen. Throttles must charge per request without it.

## Budgets: baselines and targets

| Measure | Initial target | VM baseline (zstd) | Dell (Voyager 3.0 stick) | Target for OS-4 |
|---|---|---|---|---|
| Firmware → shim | recorded only | 2.8 s (OVMF, unthrottled) | 11.7 s, plus 1.0 s loader | recorded only (the machine's own) |
| systemd-boot → kernel → switch-root | ≤ 1.5 s (good stick) | 4.6 s (good) | 6.7 s | ≤ 2.5 s in the VM, ≤ 4.0 s on the Dell |
| Switch-root → unlock screen painted | ≤ 1.5 s | 6.3 s (good) | 14.0 s (app process starts after 10.8 s) | ≤ 3.0 s in the VM, ≤ 6.0 s on the Dell |
| *Unlock* pressed → caret | ≤ 2.0 s | 2.4 s (good), KDF ≈ 1.8 s in a 2-vCPU VM | ≈ 1.5 s (verify 1.12 s + start 0.31 s; cold unlock not run) | ≤ 2.0 s on the Dell, measured cold |
| Same stages on the cheap stick | recorded | 17.1 s to the unlock screen | — | regressions fail |
| ESP payload, initrd | ≤ 40 MiB, ≤ 15 MiB | 48.4 MB, base initrd 32.0 MB | same image | ≤ 40 MiB, ≤ 15 MiB (unchanged) |
| erofs system partition | ≤ 600 MiB | 500 MiB | same image | ≤ 450 MiB, then tightened |
| RAM after unlock | ≤ 1.2 GiB | 847 MiB | 1.8 GiB used, incl. GPU buffers; 978 MiB RSS in the writer's processes | ≤ 1.0 GiB of RSS; system-wide recorded |

**After OS-4** (2026-10-22, VM): ESP 23.6 MiB, initrd 9.9 MiB, root 357 MiB; kernel → switch-root 2.69 s and switch-root → unlock painted 4.68 s on the good stick, 10.0 s kernel → unlock on the cheap one; 829 MiB in the writer's processes. `pnpm os:perf` measures these against `os/perf-baseline.json` (os/PLAN.md, *Phase OS-4 result*; ADR-0014).

## The stick to recommend

Buy for random reads, not for the sequential speed on the box. Our "good" profile, **≥ 150 MB/s sequential and ≥ 2500 random 4 KiB reads/s on USB 3**, boots as fast as the unthrottled disk in the VM. The cheap profile (25 MB/s, 400/s) adds 7.5 s.

A quick search found no recent, comparable 4 KiB random-read tests of current USB sticks. So OS-0 names no model. The criterion goes in the README, and the Dell check measures the stick in hand (sequential and 2000 random 4 KiB reads, direct). Sticks with an SSD-class controller, often sold as "solid state flash drives", are the likely kind. A named recommendation waits until one has been measured with the report.

Minimum size stays 8 GB: today's image is about 1.0 GiB (ESP 512 MiB, root 504 MiB), and the rest is the writer's home.

## Not covered here

- **The Dell** is now in the table above ([the Dell check](../../os/spikes/boot/DELL-CHECK.md)). Its stick reads 155 MB/s sequentially but only 565 random 4 KiB reads/s, close to our cheap profile, and that is where its boot goes: 5.8 s from cage's session to the app process, and 3.2 s for the app to paint. OS-4's allowlist and read-ahead work starts there. A cold *Unlock* → caret, and the cold Mesa shader cache, are measured on the next Dell boot.
- **The trace-based allowlist:** OS-4's real pruning, and the size table it produces.
