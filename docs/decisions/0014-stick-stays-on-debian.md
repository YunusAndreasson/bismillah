# 0014 — The stick stays on Debian

- **Status:** Proposed (2026-10-22), for the author's acceptance of OS-4
- **Date:** 2026-10-22
- **Builds on:** [0013](0013-appliance-os.md)

## Context
OS-4 had to bring every boot stage and size within budget (os/PLAN.md, *Budgets*; docs/spikes/os-size-boot.md), and to reconsider Buildroot only if Debian couldn't, writing the numbers down either way. The baseline at the start of OS-4 had a 30.6 MiB initrd, a 46.5 MiB ESP and a 494 MiB root, and in the VM (debug image, "good" stick) the unlock screen painted 9.9 s after kernel start.

## Decision
Stay on Debian 13, built with mkosi, and keep cutting it from measurements:
- **The root holds only what was seen opened.** A debug-only fanotify recorder lists every file the VM scenarios open (`os/mkosi/allowlist.txt`, recorded by `os/scripts/trace.sh`), a declared list names what a VM can't open, with reasons, and `prune.py` keeps those and their libraries. Kernel modules are chosen by hardware class.
- **The initrd keeps only what its boot runs** (`initrd-keep.txt`), packed with zstd's slowest level, loads the USB storage drivers at once, and mounts the system's RAM folders.
- **The boot waits for nothing it doesn't use:** no per-user manager, no first-boot presets, no unused generators or API mounts, no 1 s usb-storage delay.
- **Every change is measured** by `pnpm os:perf`, against the committed `os/perf-baseline.json`; `os/scripts/verify.sh` fails on a regression.

## Numbers (VM, debug image; os/PLAN.md, *Phase OS-4 result*)
| Measure | Budget | Start of OS-4 | Now |
|---|---|---|---|
| ESP payload | ≤ 40 MiB | 46.5 MiB | 23.6 MiB |
| initrd (base + modules) | ≤ 15 MiB | 34.5 MB | 9.9 MiB |
| erofs root | ≤ 450 MiB | 494 MiB | 357 MiB |
| kernel → switch-root, good stick | ≤ 2.5 s | 4.40 s | 2.69 s |
| switch-root → unlock painted, good stick | ≤ 3.0 s | 5.46 s | 4.68 s |
| *Unlock* → caret, good stick | ≤ 2.0 s | 1.72 s | 1.81 s |
| kernel → unlock painted, cheap stick | recorded | 16.1 s | 10.0 s |
| RAM in the writer's processes (PSS), 1 MB document | ≤ 1.0 GiB | — | 829 MiB |

Part of the time saved is the debug image's quieter console, which had also slowed the starting measurements. Two VM stages remain over budget, by 0.2 s and 1.7 s. About 1.2 s of the time after switch-root is Mesa's software renderer starting cage and WebKit, which a laptop's GPU doesn't need. The Dell decides those two.

## Why not Buildroot
- **Secure Boot.** The stick boots with Secure Boot on and nothing enrolled because Debian's shim, systemd-boot and kernel are signed (0013). A Buildroot kernel would need our own keys enrolled in every laptop, which 0013 ruled out.
- **Security updates.** Debian publishes WebKitGTK and kernel fixes; with Buildroot we would track and rebuild them ourselves.
- **What is left isn't Debian's.** The sizes are now well inside budget. The remaining boot time after switch-root is cage, Mesa and WebKit starting, the same components Buildroot would ship; in the VM much of it is software rendering, which a real GPU doesn't need.

## Consequences
- The allowlist must be re-recorded when the app or the image changes what it opens. A file a scenario doesn't reach is fixed by a new scenario step and a new trace, never by adding its path by hand; the contents check fails on any file that is neither traced, declared nor needed.
- Hardware a VM can't show depends on the declared list and the module classes. The Dell check is the first proof on real hardware.
- The debug image's serial console now carries only warnings, failures and marks: at info level it slowed every stage.
