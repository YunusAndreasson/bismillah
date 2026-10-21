# bismillah OS — Roadmap

A bootable USB stick that starts straight into bismillah and nothing else: no network, no shell, the writer's texts encrypted, and the laptop it boots on left untouched. Later the same system installs to a laptop, and texts leave through animated QR codes.

This file is the plan for that work, written to be carried out over several sessions on the author's machine, almost entirely in virtual machines. The app's own roadmap stays in [../PLAN.md](../PLAN.md). Design, architecture and decisions keep their usual homes: [DESIGN.md](../DESIGN.md), [ARCHITECTURE.md](../ARCHITECTURE.md) and [docs/decisions/](../docs/decisions/).

*Revision 2, 2026-10-20.* Revision 1 was written from the alignment interview below and two research passes: the build options, and the Debian/mkosi Secure Boot facts, checked against primary sources. Revision 2 incorporates an external review:
- Recovery promises cut to *saved means saved*, with crash, power cut and removal tested separately.
- A bounded suspend handshake with an empty-VT fallback.
- An explicit setup state machine, with formatting reachable only from Blank.
- Helper bound to the boot device, not labels.
- Host promise narrowed to "no disk writes; NVRAM changes disclosed", proved with write tracing.
- Network checked from outside the release image, plus a kernel-config audit and NIC hotplug.
- Recorded inputs with an offline rebuild.
- A tested compatibility list instead of "any PC".

*Revision 3, same day.* A minimalism interview (bismillah is the only app that will ever run):
- GPU acceleration, logind and the WebKit sandbox kept.
- Pruning by a trace-based allowlist.
- No logging in release.
- Copy as rich text removed in appliance mode.
- Our own WebKitGTK scheduled after the stick's 1.0.

**Status:** Phase OS-0 in progress (2026-10-20). Done in the VM: signed boot ([os-signed-boot.md](../docs/spikes/os-signed-boot.md)), the app running under cage on Debian 13 ([os-app-on-debian.md](../docs/spikes/os-app-on-debian.md)), and unlock in the app: go, in-process, 1.70 s from *Unlock* to caret ([os-unlock-in-app.md](../docs/spikes/os-unlock-in-app.md)); keyboard: go, cage with a session restart, layouts from the LUKS2 token before unlock, a mixed Swedish/Arabic passphrase identical at setup, lock and unlock ([os-keyboard.md](../docs/spikes/os-keyboard.md)). No network: go, the stripped image leaves every NIC without a driver and sends nothing ([os-no-network.md](../docs/spikes/os-no-network.md)); host untouched: go, zero writes to the laptop disk, and shim's `SbatLevel` is the one firmware variable written ([os-host-untouched.md](../docs/spikes/os-host-untouched.md)); boot-device binding: go, the lookup refuses when two sticks of one build are attached, since the root may come from the other one ([os-boot-device-binding.md](../docs/spikes/os-boot-device-binding.md)). Suspend lock fallback: go, every case came back locked with no text after wake; a session restart must end the session's processes itself and switch back to its VT first ([os-suspend-lock.md](../docs/spikes/os-suspend-lock.md)). GPU and display: go in the VM, cage waits for the boot display and uses only it; WebKit isn't pinned ([os-gpu-display.md](../docs/spikes/os-gpu-display.md)). Size and boot baseline: recorded in the VM, root 500 MiB zstd, ESP 48 MB after trimming the modules initrd, 11 s from kernel to unlock screen ([os-size-boot.md](../docs/spikes/os-size-boot.md)). The stick boots on the Dell with Secure Boot off; everything OS-0 still needs from the Dell (Secure Boot on, i915 with NVIDIA idle, a real lid, boot timing) is one session with one image: [os/spikes/boot/DELL-CHECK.md](spikes/boot/DELL-CHECK.md). Then ADR-0013. Working rule from the author: make it work first, then optimise.

---

## How to use this plan across sessions

- **Start of a session:** read this file, then the latest `### Result` section. Work only in the first phase that isn't accepted.
- **End of a phase:** write its `### Result` section (built, measured, deviations, the author's manual checks). Then stop for the author's acceptance, as the app's phases do.
- **Decisions:** decisions made here are final within the OS work. Change one only through an ADR, the same rule AGENTS.md sets for the app.
- **One phase is one to three sessions.** Each session should end in a working state: images build, `os/verify.sh --fast` passes, and nothing is half-migrated.

---

## Decisions from the interview (2026-10-20)

| Topic | Decision |
|---|---|
| Audience | The author first; designed so other writers can be given a stick later (first-boot setup, no build-time personal settings). |
| Threats in scope | **A lost or stolen stick** (powered off), and **no forensic traces on the host** laptop. The promise we make for the second is narrower than the goal: *no writes to the host's disks; any firmware-variable change measured, minimised and disclosed* (see *Honest claims*). |
| Threats out of scope | A tampered stick (evil maid), and a compromised host laptop (firmware, keyloggers). Documented, not defended. |
| Login | **Passphrase only.** The disk unlock *is* the login; there is no second password. |
| Recovery | **None.** Forgetting the passphrase loses the texts, and setup says so plainly. |
| Hardware | The author's Dell Precision 5520 first; the *goal* is any modern x86_64 UEFI PC. What we *claim* is a **tested compatibility list** (machine, firmware, Secure Boot state, GPU, result) kept in `os/README.md`. Other machines are best effort, because certificate trust, revocations, firmware and GPU support are machine-dependent. No Apple Silicon or BIOS-only machines. |
| Test hardware | This Dell (Kaby Lake, Intel HD 630 + NVIDIA Quadro M1200, Swedish keyboard, BIOS 1.40.0; its Secure Boot db holds both the Microsoft UEFI CA 2011 and 2023, and Secure Boot is currently off because the host OS needs it off). VMs cover the rest, including the 2011-only and 2023-only firmware. |
| Boot speed | **As fast as possible.** Every stage is measured; budgets are set from the OS-0 measurements and then only tightened. |
| USB medium | **Any stick.** Optimise for slow, cheap media. |
| Base | **Debian 13 (trixie), built with mkosi on this Arch host,** then stripped (no shell, no package manager) and measured. Buildroot is reconsidered only if measurements miss the budgets. |
| Secure Boot | **Stays on.** We never ask the writer to change the host's firmware. We boot through Debian's Microsoft-signed shim → Debian-signed systemd-boot → Debian-signed kernel, so nothing is enrolled and nothing is changed on the host. |
| Surface | **The editor only.** The clock and battery are shown inside bismillah; power actions live in bismillah's menu and palette. No Wi-Fi, no audio, no terminal, no file manager. |
| Storage | One stick: a LUKS2-encrypted data partition holding the library, the app's settings and the OS settings the app owns (keyboard, time zone). |
| Persistence | The system is read-only and identical on every boot. Only the data partition changes. **Release images log nothing**, not even to RAM (no journald). The debug image logs to the serial port. |
| Lid close | **Suspend, and lock behind the passphrase.** |
| Unlock screen | **bismillah-styled.** It is drawn by bismillah itself (see *Architecture*). |
| Keyboard | **Every XKB layout**, chosen in Settings (up to four, with a switch key). The unlock screen's layout is **remembered unencrypted**: only the layout name. |
| Fonts | **The bundled set is enough** (the 16 faces in the binary, plus one small UI sans for `system-ui`). |
| Passphrase setup | **On first boot, on the stick itself.** This calibrates the KDF on real hardware and works for other writers. |
| Upgrades | **Reflash the system partitions from the dev machine and keep the data partition.** There is no update code on the stick. |
| App integration | **The same app in an appliance mode,** plus a small privileged helper behind a narrow typed socket. Desktop behaviour is unchanged. |
| Code location | **`os/` in this repo,** plus the helper crate in `crates/`. |
| Minimalism (second interview, same day) | bismillah is the only app that will ever run, so everything else is removed unless it earns its place:<br>• **GPU acceleration kept** (Mesa), for smoothness and battery.<br>• **logind kept**, with the bounded suspend handshake and the empty-VT fallback.<br>• **The WebKit sandbox kept** (bubblewrap + xdg-dbus-proxy), as defence in depth.<br>• **GPU families: Intel, AMD, NVIDIA-only (nouveau) and virtio**, so most machines boot.<br>• **Pruning by a trace-based allowlist**: ship only the files the full scenario suite opens, plus a declared list.<br>• **Copy as rich text removed** in appliance mode; the app runs fullscreen in cage with no window chrome or window state.<br>• **No logging in release.**<br>• **Our own WebKitGTK build** (no GStreamer, WebRTC, enchant or libsecret; trimmed ICU; the ADR-0011 Arabic-mark patch) is scheduled **after the stick's 1.0**.<br>• CPU microcode stays, because it carries security fixes. |
| Later | Animated QR export to **the author's phone through an app**. Laptop install (**dedicated or alongside another OS, undecided**). A screen-reader image flavour (**optional**). |

---

## Architecture at a glance

### Boot chain (Secure Boot on, nothing enrolled)

```
UEFI firmware (Secure Boot on, Microsoft keys)
  └─ EFI/BOOT/BOOTX64.EFI   shim 16.x, Microsoft-signed (2011 + 2023 CA, dual-signed)   [Debian]
      └─ EFI/BOOT/grubx64.efi   systemd-boot, Debian-signed; timeout 0, editor no      [Debian]
          └─ vmlinuz              Linux 6.12 (or the backports kernel), Debian-signed; lockdown on under SB  [Debian]
             initrd              ours, tiny: USB/NVMe/SATA, dm-verity, erofs. Unsigned (see "honest claims")
             cmdline             roothash=… quiet …                                      [ours, unsigned]
              └─ switch-root to the read-only, dm-verity-checked erofs system
                  ├─ bismillah-helper.service (root): narrow verbs over /run/bismillah/helper.sock
                  └─ bismillah-session.service (User=writer, tty1): cage -- bismillah --appliance
```

mkosi settings, **supported by mkosi's documentation and source (checked against mkosi main, 2026-10-20; host mkosi 27.1), pending OS-0 boot proof**: `Format=disk`, `ShimBootloader=signed`, `Bootloader=systemd-boot-signed`, `UnifiedKernelImages=none`. Debian ships no signed UKI, so with `auto` a bootable build fails. Leave `SecureBoot=` off. The packages are `shim-signed`, `shim-helpers-amd64-signed` (mkosi requires MokManager), `systemd-boot-efi-amd64-signed` and `linux-image-amd64`. mkosi writes `roothash=` into the Type 1 entry's options. The partition definitions in `mkosi.repart/` are our own: ESP, root `Verity=data`, `Verity=hash`.

### Why bismillah draws the unlock screen

Debian's kernel has no `simpledrm`, and `efifb` isn't a KMS device. A graphical unlock inside the initrd would therefore need the full GPU drivers and their firmware in the initrd: a large initrd that firmware reads slowly from cheap sticks.

So **only the data partition is encrypted; the system partition is not.** It contains nothing private and is verity-checked. The machine boots straight to cage and bismillah, and **the app's first screen is Setup or Unlock**:

- WebKit and GTK start (≈0.3–0.7 s) and the libraries are read from the stick *while the writer types the passphrase*. After *Unlock* only the KDF, the mount and the document load remain.
- The unlock screen is real bismillah: its tokens, fonts and ﷽ wordmark, every XKB layout through the compositor, a layout and Caps Lock indicator, and *show passphrase*.
- **One screen serves cold unlock, the suspend lock and first-boot setup.**

### Partitions on the stick (GPT, Discoverable Partitions Spec)

| # | Partition | Content | Written by |
|---|---|---|---|
| 1 | ESP, vfat, 256 MiB | shim, systemd-boot, kernel, initrd, loader entry. **No `fbx64.efi`**: shim's fallback would write boot entries into the host's NVRAM. | flash and reflash |
| 2 | root, erofs (lz4hc), fixed 2 GiB slot | The whole OS and bismillah, read-only. | flash and reflash |
| 3 | root-verity, 128 MiB slot | dm-verity hash tree | flash and reflash |
| 4 | home, rest of stick (≥ 4 GiB) | LUKS2 (argon2id) → ext4, mounted at `/home/writer`. Its header holds a non-secret JSON token: `{"type":"bismillah-keyboard","keyslots":[],"layouts":"se,ara",…}`. | created empty by flash; formatted at first boot; **never touched by reflash** |

Inside home are `Texts/` (the library, fixed in appliance mode), `.config/bismillah/` and `.local/share/bismillah/`. WebKit's caches and website data go to `/run/user/1000` (RAM). The minimum stick size is 8 GB.

### Processes and trust

- **`writer` (uid 1000):** cage and bismillah. No password, no login shell, no getty anywhere (`NAutoVTs=0`).
- **`bismillah-helper` (root):** a Rust crate in this workspace (`crates/bismillah-appliance`). It accepts requests only from uid 1000 (`SO_PEERCRED`) and has a fixed, versioned set of verbs:
  - `status`, `setup{passphrase, layouts}`, `unlock{passphrase}` and `verify{passphrase}`
  - `set_keyboard{layouts, switch}`
  - `power{off|reboot|suspend}`
  - event stream: `lock_now`, `battery_critical`

  Passphrases are held in `zeroize` buffers, passed to `cryptsetup` on stdin and never logged. The protocol types live in the crate and are shared with `src-tauri`.
- **logind** handles the lid (`HandleLidSwitch=suspend`). The helper holds a *delay* inhibitor. On `PrepareForSleep` it tells the app to lock, waits for the app to report that the lock view is painted, then releases the inhibitor.
  - **The delay is bounded.** logind stops waiting after `InhibitDelayMaxSec=` (5 s by default), so the handshake can't be the only protection. The helper gives the app 1.5 s. If the app doesn't confirm in time (frozen, crashed, disconnected from the socket), the helper switches to an empty VT, with no getty and a black screen, before releasing the inhibitor. The compositor loses the display, so nothing of the document is on screen when the machine sleeps.
  - **On resume** the helper stays on the empty VT until the app reports its lock view is painted. If the app doesn't respond within a few seconds, the helper restarts the session, and a restarted session always opens locked. Resume therefore never shows the document, whatever state the app is in.
  - **Whenever the app drops its socket connection**, the helper assumes it must lock. It accepts no further verbs except `verify` until the app has confirmed its lock view is painted again.
- **No other process takes input.** In release images there is no shell (`bash`/`dash`/`sh` removed), no `apt`/`dpkg`, no `login`/`agetty`/`su`, no emergency or rescue shell (masked), no systemd-boot editor, no SysRq, and no WebKit inspector.

### Honest claims (the wording the guide and README will use)

The wording follows ADR-0003: it separates what is tested from what is audited, and it never overclaims.

- **Tested:** the stick sends nothing on a network. In a VM with network cards attached, including ones hot-plugged while it runs (PCI and USB), **the release image emits zero packets**. QEMU captures each card's traffic (`filter-dump`) from outside the guest, so the test needs no instrumentation inside the release image. The debug image additionally shows that only `lo` exists.
- **Audited:** the release image contains no network, Wi-Fi or Bluetooth drivers and no network firmware (the image file-list check). The exact kernel configuration has no built-in (`=y`) network-device drivers beyond loopback (the kernel-config check).
- **Tested:** your texts are encrypted at rest (LUKS2, Argon2id). A powered-off lost or stolen stick reveals nothing but the keyboard layout name and that it is a bismillah stick.
- **Tested:** booting never writes to the laptop's disks. They are never mounted and their swap is never used. In the VM the host disk is a qcow2 overlay over a read-only base, and QEMU's block-write trace events are on. The test fails on any allocated overlay cluster or any traced write: an unchanged final hash alone wouldn't prove that nothing was written.
- **Measured and disclosed, not promised away:** writes to the firmware's variables (NVRAM). The OVMF variable store is diffed before and after; every change is minimised (e.g. no `fbx64.efi`, so shim writes no boot entries) and the remainder listed in `os/README.md`.
- **Saving on the stick:** a save shown as "Saved" is durable (ADR-0006). If the stick is pulled out, or the power dies abruptly, **edits made since the last completed save can be lost**. The recovery journal (ARCHITECTURE.md §5.7) lives on the same stick, and it is made durable only after a *failed* save, so it can't rescue text the stick never received. The low-battery shutdown (OS-3) narrows this window; it doesn't close it.
- **Not protected:**
  - a stick someone has secretly modified (the initrd and kernel command line aren't signed in this boot chain, so verity catches corruption, not tampering)
  - a hostile laptop
  - a suspended or running stick against RAM or DMA attacks (the disk key is in memory while suspended)
  - a forgotten passphrase.

---

## Repository layout (added by this plan)

```
os/
├─ PLAN.md                  this file
├─ README.md                making a stick, Secure Boot notes, what the stick does and doesn't protect (OS-5)
├─ mkosi/                   mkosi.conf, mkosi.conf.d/ (release, debug profiles), mkosi.repart/,
│                           mkosi.extra/ (units, logind.conf.d, loader.conf), mkosi.postinst, mkosi.finalize
├─ build/                   Debian 13 build container for the app (Containerfile, build-app.sh)
├─ scripts/                 build.sh, vm.ts (QEMU + QMP harness), flash.sh, perf.ts, verify.sh
└─ tests/                   VM scenario tests (*.vm.ts), image content checks (image-contents.test.ts)
crates/bismillah-appliance/ helper binary + shared protocol types (workspace lints, deny.toml apply)
src-tauri/src/appliance.rs  appliance mode: helper client, deferred init, paths
src/appliance/              Setup, Unlock/Lock views, power menu, clock/battery, keyboard & time settings
```

Commands added to `package.json` (thin wrappers over `os/scripts/`):

```bash
pnpm os:fetch        # the only networked stage: fetch every recorded input (os/inputs.lock) into os/cache/
pnpm os:app          # build bismillah .deb for Debian 13 in the pinned build container (offline: host cargo/pnpm caches mounted read-only)
pnpm os:build        # mkosi image, release profile (--debug for the debug profile)
pnpm os:vm           # boot the image headless in QEMU/OVMF (Secure Boot, MS keys); --window to look at it yourself
pnpm os:test         # VM scenario tests via QMP (setup, unlock, lock, save, reflash, host untouched, no network)
pnpm os:perf         # boot-stage table + image size budgets
os/scripts/flash.sh  # write or reflash a real stick (sudo, run by the author; refuses non-removable or mounted disks)
os/scripts/verify.sh # the OS gate: image contents, os:test, perf budgets (--fast: contents + one boot)
```

`pnpm verify` (the app gate) gains the appliance-mode unit and e2e tests but not the VM suite. `os/scripts/verify.sh` is the gate for any change under `os/` or `crates/bismillah-appliance/`.

---

## Development environment

- **Host packages** (the author installs; Claude suggests the command): `sudo pacman -S mkosi qemu-desktop edk2-ovmf swtpm virt-firmware apt debian-archive-keyring erofs-utils`. `docker` is already present for the build container.
- **The mkosi tools tree** uses `ToolsTree=yes` with `ToolsTreeDistribution=debian`. Debian's `ovmf` ships Microsoft-enrolled variables (`OVMF_VARS_4M.ms.fd`, `40-edk2-x86_64-secure-enrolled.json`) and Arch's doesn't. With them, `FirmwareVariables=microsoft` works and the VM boots Debian's signed shim exactly as a stock laptop would.
- **Recorded inputs, then an offline rebuild.** The goal is that the image can be *rebuilt offline from recorded inputs*. Bit-for-bit identical images are not a goal.
  - **`os/inputs.lock` records:**
    - the Debian snapshot date (`snapshot.debian.org`, with `trixie-security` for WebKitGTK 2.54.0)
    - the build container's image **digest**, not a tag
    - the exact Rust toolchain (trixie's rustc is 1.85; the workspace needs ≥ 1.90, so a pinned rustup toolchain in the container)
    - the Node and pnpm versions
    - the mkosi version, checked by `os/scripts/build.sh`, which refuses a different one
    - the tools-tree choice.
  - **`pnpm os:fetch`, the only stage that uses the network, runs on the dev machine:**
    - pulls the container by digest
    - `cargo vendor` and `pnpm fetch` into `os/cache/`, from inside the Debian container, so nothing relies on what happens to be in the Arch host's caches
    - fills mkosi's package cache
    - records hashes.
  - **Every later stage runs with the network off:** `docker --network=none`, and mkosi with `CacheOnly=always`.
  - **Proven** at the end of OS-1 and again in OS-5, by building from a clean checkout with only `os/cache/` and no network.
- **Headless by default, like the app's harness:** VMs run with `-display none`, a QMP socket and a serial log. Screenshots come from QMP `screendump`, and Claude inspects them. Typing goes through QMP `input-send-event`. `--window` exists only for the author. Nothing opens on the author's desktop during automated work.
- **The VM harness (`os/scripts/vm.ts`) knows these profiles:**
  - Stick attached as `usb-storage` on `qemu-xhci`.
  - Slow-stick throttling: `throttling.bps-read`/`iops-read` profiles for "cheap", "good" and "SSD".
  - A `virtio-net` NIC always attached, its traffic captured outside the guest with `filter-dump`. A scenario hot-plugs a second PCI NIC and a USB network adapter (`device_add`) while the app runs. Any captured packet fails the test.
  - A fake host disk (GPT with ext4, swap and an ESP), as a qcow2 overlay over a read-only base, with block-write trace events on. Any allocated overlay cluster or traced write fails the test, and the base hash is checked as well.
  - Two bismillah sticks attached at once, and sticks with duplicate labels, for the boot-device binding tests (OS-2).
  - The OVMF variable store, hashed and diffed before and after.
  - S3 enabled for suspend tests (`system_wakeup`).
  - Firmware-variable sets with the 2011 CA only, the 2023 CA only, and both (`virt-fw-vars`).
- **Debug and release profiles:**
  - **Debug** adds the serial console, journal-to-console, test markers (`BISMILLAH_MARK caret-ready` etc.) and a root shell **on the serial port only**.
  - **Release** has none of these, and `image-contents.test.ts` asserts it.
  - **The two are tested separately.** The debug image runs the instrumentation-heavy scenarios: markers, journal, inspecting interfaces. The **release image** runs smoke tests that observe it only from outside: boot, setup and unlock by QMP typing, screenshots, packet capture, host-disk overlay and trace, NVRAM diff. The release claims rest on the release smoke tests. The app's own `pnpm test:offline` proves the *app* offline in a network namespace; it says nothing about the OS around it, so it's not used as OS evidence.
- **Real hardware:** `os/scripts/flash.sh` and the Dell. The script:
  - Writes only to devices that are USB (`TRAN=usb`), removable or hotplug, unmounted and not part of the host's root.
  - Shows the model and size, and requires the model name typed back.
  - Always runs as the author's own `! sudo …` command. Claude never writes to a block device.

---

## Budgets (initial; OS-0 replaces each "≈" with a measured baseline and a target)

VM baselines and OS-4 targets are in [os-size-boot.md](../docs/spikes/os-size-boot.md#budgets-baselines-and-targets); the Dell's numbers replace the VM's when the Dell check is in.

| Measure | Initial target | Where measured |
|---|---|---|
| Firmware → shim | not ours (2–10 s); recorded only | `systemd-analyze` firmware/loader |
| systemd-boot → kernel → switch-root | ≤ 1.5 s (good stick) | `systemd-analyze`, VM "good" and the Dell |
| Switch-root → unlock screen painted | ≤ 1.5 s | `caret-ready`-style mark from the app |
| *Unlock* pressed → caret in last document | ≤ 2.0 s, of which the Argon2id KDF is ≈ 1.0–1.5 s (1 GiB memory, 4 lanes) | helper + app marks |
| Lid open → lock view visible | ≤ 1.0 s | Dell |
| Same stages on the "cheap stick" profile | recorded; regressions fail | VM |
| ESP payload (kernel + initrd + loaders) | ≤ 40 MiB, initrd ≤ 15 MiB | `os:perf` |
| erofs system partition | ≤ 600 MiB, then tightened | `os:perf` |
| RAM in use after unlock, 1 MB document | ≤ 1.2 GiB | `os:perf` |

---

## Phase OS-0 — Spikes (decide before building)

Each spike ends with a short written result in `docs/spikes/os-*.md`: **go**, **adjust** or **no-go**. The phase ends with **ADR-0013 (appliance OS)** recording the decisions above and the spike outcomes. It amends ADR-0009, since a single-app appliance is still desktop, and extends ADR-0003 to OS-level offline guarantees.

| Spike | Question | Accept when |
|---|---|---|
| Signed boot | Does an mkosi Debian 13 image with the signed shim → systemd-boot → kernel chain boot in OVMF with Secure Boot on and Microsoft keys, with no enrolment? With the 2011-only, 2023-only and both-CA variable sets? Does it boot on the Dell from a real stick? 6.12 vs the backports kernel (signed? newer GPU support?). | Boots in all three VM variable sets and on the Dell; kernel choice recorded |
| App on Debian | Does bismillah built in the Debian 13 container run under cage 0.2 with WebKitGTK 2.54.0 (trixie-security)? Cover: rendering, the specimen (Arabic, vocalised and mixed lines, ADR-0011), GTK dialogs centred by cage, clipboard, the WebKit sandbox (bwrap, xdg-dbus-proxy), and WebKit's network process with no interfaces. | Specimen screenshots match the Arch build's visual baselines (within the visual-test tolerance); no WebKit errors in the journal |
| Unlock in the app | The app starts before the data partition exists (deferred settings and library init, WebKit data in `/run`). Can the helper open LUKS2, mount it and hand over, so the app continues *in-process* to the last document? Compare with restarting the app after unlock. | In-process handover works, or the restart is ≤ 0.5 s warm; the choice recorded |
| Keyboard | Under cage, are XKB layouts from `XKB_DEFAULT_LAYOUT`/`_OPTIONS` (e.g. `se,ara`, a switch key) read from the LUKS2 token before unlock? Are changes applied by restarting the session (cage has no runtime keymap IPC)? Is a passphrase typed in Swedish and Arabic layouts identical at setup, unlock and the suspend lock? Is the active layout or direction readable for the indicator? | Round-trip proven by a VM test typing through QMP; a sway kiosk is the fallback if a session restart proves unacceptable |
| No network | Checks:<br>• With virtio-net attached, the debug image shows only `lo`.<br>• The release image emits zero packets on any NIC, including PCI and USB NICs hot-plugged while it runs (captured outside the guest).<br>• The image's module and firmware lists contain no network, Wi-Fi, Bluetooth, NFC, CAN or USB-net entries.<br>• The exact kernel config (`/boot/config-*` of the shipped kernel) has no built-in (`=y`) network-device drivers; anything built in is listed and judged. | All four hold, or the built-ins are listed with a reason in the spike result |
| Host untouched | With a fake host disk (qcow2 overlay plus block-write tracing) and a diffed OVMF variable store: after boot, use and shutdown, are there zero writes to the host disk, no swap activated and no partitions mounted? Which firmware variables change (systemd-boot `LoaderSystemToken`, shim's `SbatLevel` or MOK variables, boot entries)? | No allocated cluster and no traced write; every variable write listed with a mitigation or a documented reason |
| Suspend lock fallback | With the app frozen (`SIGSTOP`), crashed or disconnected at the moment of suspend, does the helper's empty-VT fallback blank the display before sleep? On resume does it stay blank until a lock view is painted, restarting the session if needed? Does cage/wlroots survive the VT round trip? | In every case, a screenshot taken immediately after `system_wakeup` shows no document text; the session comes back locked |
| Boot-device binding | Can the helper identify *its own* home partition with no labels: the disk holding the dm-verity root (from the device-mapper table), cross-checked against systemd-boot's `LoaderDevicePartUUID`, then the home GPT type on that same disk? Must hold with two bismillah sticks attached and with duplicate labels. | The right partition every time in the VM matrix; the helper refuses to act when the two sources disagree |
| GPU and display | Is cage on the real GPU driver without races (no simpledrm handover; wait for the boot-VGA DRM device; `WLR_DRM_DEVICES` on hybrids such as the Dell's Intel + NVIDIA)? Is llvmpipe usable as a fallback (`WEBKIT_DISABLE_COMPOSITING_MODE`)? What do the declared GPU families (Intel i915/xe, AMD amdgpu, NVIDIA-only nouveau, virtio-gpu) add in modules and firmware? | Dell renders on i915 with NVIDIA left idle; virtio renders in the VM; fallback documented; per-family sizes recorded |
| Size and boot baseline | First stripped image: size per component (WebKit, ICU, Mesa and LLVM, firmware, fonts) and boot stages, in VM ("good" and "cheap" sticks) and on the Dell from a real stick. A recommended stick to buy (random-read speed matters). | Budgets table filled with measured baselines and targets |

### Phase OS-0 result
*(to be written)*

---

## Phase OS-1 — A bootable appliance image (no encryption yet)

Goal: `pnpm os:build && pnpm os:vm` boots to bismillah on the stick layout, read-only, with nothing else on the system.

- `os/mkosi/`: Debian 13 at a pinned snapshot, the signed boot chain, the repart definitions (ESP, erofs root, verity), the release and debug profiles, `loader.conf` (`timeout 0`, `editor no`), and the kernel command line.
- **Stripping, first pass, by package and directory rules** (the trace-based allowlist replaces this in OS-4):
  - no shells, apt, dpkg database, docs, man pages, unused locales
  - no network modules or firmware; only GPU firmware
  - a prebuilt fontconfig cache
- **System units:**
  - mask networkd, resolved and timesyncd
  - mask getty and the emergency and rescue shells (release)
  - release: no journald and no other logging (stdout/stderr to `/dev/null`); debug: journal forwarded to the serial port
  - `NAutoVTs=0`
  - `efivarfs` read-only
  - `noresume`
  - no `fbx64.efi`
- `bismillah-session.service`: `User=writer`, `PAMName=login`, `TTYPath=/dev/tty1`, `cage -d -- bismillah --appliance`. If the app crashes, the session restarts, and a restarted session always opens locked.
- `os/inputs.lock` and `pnpm os:fetch` (see *Development environment*). `pnpm os:app` builds the app `.deb` in the Debian 13 container from the committed lockfiles and `os/cache/` only, with `--network=none`.
- `flash.sh` (first write) and `image-contents.test.ts`. The test asserts no `sh`, `bash`, `dash`, `apt`, `dpkg`, `agetty`, `login`, `su`, `sudo`, no `iwlwifi`/`bluetooth`/`e1000e`/`r8169`/`virtio_net` modules and no network firmware; and in release: no serial console, no debug markers, no inspector.
- For now the app runs in appliance mode with a temporary unencrypted test home (debug profile only), so that the image work can be accepted before encryption.

**Accept when:**
- VM and Dell boot to the editor with Secure Boot on.
- A clean checkout builds the image with the network off, from `os/cache/` alone.
- The release image emits no packets, including on hot-plugged NICs.
- The contents test passes.
- The first boot-stage numbers are recorded.
- The author has looked at it on the Dell from a real stick.

### Phase OS-1 result
*(to be written)*

---

## Phase OS-2 — Encryption, first-boot setup and unlock

Goal: a fresh stick asks for a layout and a passphrase once. From then on it boots to the bismillah unlock screen, and the passphrase is the login.

- **The helper crate (`crates/bismillah-appliance`):**
  - Verbs: `status`, `setup`, `unlock`, `verify`, `set_keyboard`.
  - Setup formats the home partition: LUKS2, argon2id, 1 GiB memory (capped at RAM/4), 4 lanes, `--iter-time` tuned to ≈1.0–1.5 s on the formatting machine.
  - It then creates ext4 on the volume and writes the keyboard token.
  - Unlock opens and mounts at `/home/writer`; verify uses `cryptsetup --test-passphrase`.
  - Dependencies are `zeroize` and `zxcvbn` (strength estimation is a hard problem), each recorded in ARCHITECTURE.md §2.
- **The Setup view (DESIGN.md tokens; copy reviewed):**
  1. Keyboard layout.
  2. Passphrase twice: a strength meter, refused below zxcvbn score 3, and an offer to generate a six-word passphrase from a bundled word list using local randomness.
  3. A plain statement: "There is no way to recover your texts without this passphrase."
  4. Time zone.
- **The Unlock view:**
  - ﷽ wordmark, passphrase field, layout and Caps Lock indicator, *show passphrase*.
  - A wrong passphrase gets a calm message; the KDF itself rate-limits, so there is no lockout.
  - *Power off*.
- **Appliance-mode app changes:**
  - Deferred settings and library init until unlocked.
  - Fixed library `~/Texts`.
  - Explicit config and data paths instead of XDG for its own files, with WebKit data in `/run`.
  - Passphrases never logged, and cleared from Rust memory after use.
- **Which partition:** the helper acts only on the home partition of **the disk it booted from**:
  - Found from the dm-verity root's backing device, cross-checked against `LoaderDevicePartUUID`, then by GPT type on that disk.
  - Never by label alone.
  - It refuses everything if the sources disagree.
- **The home partition's state.** The helper classifies the partition before anything else. Formatting is reachable from exactly one state.

  | State | How it is recognised | What the writer sees | Formatting allowed? |
  |---|---|---|---|
  | **Blank** | No LUKS signature in either LUKS2 header area or anywhere else blkid probes; the first and last MiB are all zeros, as flash wrote them | Setup | **Yes**, the only state where it is |
  | **Initialising** | LUKS2 header with our token in `state: "initialising"`. It is written before the volume holds any text, and set to `ready` only after ext4, the folders and a marker file are durable. | *Finish setup* (asks for the same passphrase, then completes the missing steps idempotently: mkfs only if no filesystem signature, folders, marker, token `ready`). Or *Start over*, after a typed confirmation that says the stick holds no texts yet. | Only via *Start over*, and only in this state |
  | **Ready** | Token `state: "ready"` | Unlock | **Never** |
  | **Unreadable** | Anything else: damaged header, unknown token, a LUKS header without our token, a filesystem that won't mount after the passphrase opened it | A calm explanation: your texts are not deleted; nothing on this stick will change; take the stick to the computer it was made on. *Power off*. | **Never on the stick.** Only `os/scripts/flash.sh --wipe-data` on the dev machine, with a typed confirmation, can erase it. |

  A wrong passphrase on a Ready stick is just a wrong passphrase. It never leads towards formatting, however many times it happens.
- **Failure paths, each with a test:**
  - a power cut or `kill -9` of the helper at **every** setup step (after luksFormat, after token write, after mkfs, after the marker, after `ready`): the next boot lands in Initialising or Ready, never Blank, never a format of anything holding text
  - each kind of damaged metadata leads to Unreadable, never to Setup
  - two bismillah sticks attached, and duplicate labels: the right stick is used, the other is never touched (its bytes are hashed)
  - wrong passphrase
  - data partition full
  - fsck needed after a power cut
  - corrupt keyboard token: falls back to `us` and says so on the unlock screen
- **Three separate data-loss scenarios, three separate tests:**
  1. **App crash** (`kill -9`): the recovery journal and durable saves behave exactly as on the desktop (ADR-0006).
  2. **Power cut** (QMP `quit`): every save confirmed before the cut is intact after reboot, and the filesystem is consistent; recent unsaved edits may be gone.
  3. **Stick removed** (QMP `device_del` of the stick while writing): the same assertion as the power cut. The system can't continue without its stick; the next boot must not need repair beyond the ext4 journal.

  None of these promises more than *saved means saved*.
- **VM tests via QMP:**
  - setup → reboot → unlock → write → save → power off → unlock → text intact
  - Arabic and Swedish passphrase characters

**Accept when:**
- All VM scenarios pass.
- The Dell sets up and unlocks a real stick.
- The design review (DESIGN.md §18) passes for Setup and Unlock in both themes, keyboard-only.
- The unlock-to-caret time is recorded.

### Phase OS-2 result
*(to be written)*

---

## Phase OS-3 — Appliance features in the app

Goal: the stick can be used every day without a desktop.

- **Power:** *Power off*, *Restart*, *Suspend* and *Lock* in the menu and the palette. Quit means power off: the app flushes saves first, then the helper powers off cleanly (unmount, close LUKS).
- **Lid:** suspend, with the lock view painted *before* sleep (the delay-inhibitor handshake) and verified by passphrase on resume. No flash of text on resume.
- **Clock and battery** in the quiet status area (DESIGN.md's fading chrome; errors never fade):
  - Battery is read from `/sys/class/power_supply`.
  - A notice at 10%. At critical battery (≈3%) the app flushes and the helper powers off. This narrows the window for losing unsaved edits; it doesn't close it, because batteries misreport and can die suddenly.
- **Settings › Keyboard:** up to four XKB layouts and the switch key. Applying saves, restarts the session and returns to the same caret. The unencrypted token is updated.
- **Settings › Time:**
  - The time zone is applied in the app with `Intl` and the `TZ` of the session.
  - **Clock correction:** an offset for hosts whose hardware clock keeps local time (common on Windows machines). It is stored in settings; **the RTC is never written.**
- **Brightness keys:** only if the Dell's firmware doesn't already handle them. Through the helper (`/sys/class/backlight`), bounded.
- **Hidden in appliance mode:** *Open link* (Ctrl+click explains that links can't open on this device), *Show in file manager*, *Open folder/file…* outside the library, *Another font*, *Copy as rich text* (there is no other app to paste into). Window size and maximised state are neither applied nor remembered; cage keeps the app fullscreen. About shows the OS image version and the snapshot date.
- **Docs:** the in-app guide gains an appliance section; DESIGN.md and ARCHITECTURE.md gain appliance sections.

**Accept when:**
- The VM suspend and lock tests pass (S3 plus `system_wakeup`): normal, app frozen, app crashed, app disconnected, and the inhibitor delay exceeded. A screenshot right after resume never shows document text.
- A low-battery path test passes (a fake `power_supply` in the debug profile).
- The design review passes.
- The author uses the stick for a writing session on the Dell.

### Phase OS-3 result
*(to be written)*

---

## Phase OS-4 — Boot speed and size

Goal: every stage at or under budget, on the "cheap stick" profile as well as the good one.

- **`pnpm os:perf`:**
  - a stage table (firmware, loader, kernel, initrd, switch-root, unlock painted, KDF, mount, caret), from `systemd-analyze` plus the app and helper marks
  - sizes per component
  - a comparison against the committed baseline that fails on regression.
- **The trace-based allowlist:**
  - **Recording.** The debug image carries a small fanotify recorder (`FAN_OPEN`/`FAN_OPEN_EXEC` on the root mount; part of the helper crate, debug feature only). The full VM scenario suite runs with it, and the union of opened files becomes `os/allowlist.txt` (committed, reviewed as a diff).
  - **The declared list**, for files a VM can't exercise:
    - kernel modules and firmware by hardware class: storage, USB, HID and input, ACPI, battery and lid, backlight, and the GPU families Intel, AMD, nouveau and virtio
    - every XKB layout
    - all time zones
    - every bundled font
    - CPU microcode.
  - **Building.** The release image ships the allowlist plus the declared list and nothing else. `image-contents.test.ts` fails on any file outside both.
  - **What the suite must exercise**, so that the trace is complete:
    - every Settings page, including keyboard and time zone
    - the native Open and Save As dialogs
    - Arabic, vocalised and mixed text; English and Arabic spelling, and grammar
    - setup, unlock and the Unreadable screen
    - suspend and resume
    - low battery
    - the guide and the About screen.
  - **When a file is missed**, the fix is a new test plus a re-trace, never a hand-added path, so the allowlist stays explained.
- **Candidates, each kept only if measured:**
  - Trim the initrd: only USB, NVMe and SATA storage, dm-verity, erofs; no cryptsetup or plymouth.
  - Trim the system: order units so that cage waits only for the GPU device; mask everything that isn't needed.
  - erofs: lz4hc level and cluster size; file ordering by boot access.
  - Read the WebKit, ICU and font files ahead while the unlock screen waits for typing.
  - Trim ICU data and Mesa drivers where packaging allows.
  - Copy the system to RAM on fast machines (makes stick removal survivable), weighed against the extra read time.
- **Reconsider Buildroot** only if the budgets can't be met with Debian: write the numbers into an ADR either way.

**Accept when:**
- Budgets are met or consciously re-set by the author.
- The baseline is committed.
- `os/scripts/verify.sh` fails on a regression.

### Phase OS-4 result
*(to be written)*

---

## Phase OS-5 — Hardening, reflash, and the stick's 1.0

- **Shell-escape audit:**
  - VT switching, SysRq, Ctrl+Alt+Del (it should power off cleanly)
  - the systemd-boot editor and the kernel command line
  - emergency and rescue targets, the GTK file chooser (paths typed by hand; Rust still validates against the library)
  - drag and drop, the WebKit inspector and context menu, `xdg-open`-style launches
  - the helper protocol: fuzz the parser, and refuse every verb when the peer isn't uid 1000.
- **Host-untouched proof**, in the VM scenario suite and recorded:
  - zero writes to the host disk (no allocated overlay cluster, no traced write), on the release image
  - zero packets on any NIC, including hot-plugged ones, on the release image
  - no host swap or LVM/RAID activation (lvm2 and mdadm aren't installed)
  - the firmware-variable diff is listed and minimised.
- **Reflash:** `flash.sh --update` identifies our stick by the GPT disk GUID and partition GUIDs that the first flash recorded (in `os/sticks.toml` on the dev machine, and as an image-id file on the ESP). It checks that all of them match and that the expected partition types are present, and never relies on labels. It then rewrites only ESP, root and verity, then verifies by reading back. It refuses if the new system exceeds its slot. A VM test makes a stick with data, reflashes it, unlocks it and finds the texts intact.
- **`os/README.md`:**
  - making a stick
  - why Secure Boot stays on and how the signed chain works
  - the honest claims
  - what to do when a PC won't boot it (2023-only firmware, firmware USB settings)
  - the recommended stick.
- **Offline rebuild proof again:** a clean checkout, `os/cache/` only, network off, builds the release image.
- **The tested compatibility list** in `os/README.md`: machine, firmware version, Secure Boot state, which Microsoft CAs are in its db, GPU, result.
- **A short security audit** in `docs/audits/` (like the app's 1.0 audit), and an offline audit of the image's file list.
- **Version:** the stick 1.0 is tagged with the app version and the Debian snapshot date.

**Accept when:**
- `os/scripts/verify.sh` is fully green.
- The audit is written.
- The author reflashes the Dell's stick without losing a text and accepts the stick 1.0.

### Phase OS-5 result
*(to be written)*

---

## Later (not scheduled; each needs its own short interview first)

- **Animated QR export to the author's phone.** Fountain-coded frames (BC-UR: the `ur` crate for fountain encoding, `qrcode` for frames), from a *Show as QR* command next to *Copy as rich text* (`src/core/commands.ts`, `workspace.svelte.ts`). It is one-way and optical, so the offline promise holds. Expected throughput is about 1–3 KB/s; a 50 KB chapter, compressed, takes 10–30 s. A receiver app on the phone decodes and saves Markdown. Stock camera apps can't decode animated QR. Its interview: which phone and OS, whether an existing BC-UR scanner is acceptable, and an integrity check (a hash shown on both sides).
- **Laptop install** (dedicated or alongside another OS: undecided). The same partitions written to the internal disk by an explicit *Install* action that never runs by itself. TPM2+PIN and the author's own Secure Boot keys become possible on that one machine. Data moves from the stick by copying the LUKS partition.
- **Our own WebKitGTK build** (decided; scheduled after the stick's 1.0). Debian's source package rebuilt with GStreamer, WebRTC, enchant, libsecret, geolocation and media disabled and a trimmed ICU data set, and carrying the Arabic-mark patch from ADR-0011, so that the desktop app gains from it too. Its interview: build time and machine, how WebKit security releases are tracked, and whether the Arch desktop package uses the same patch set.
- **Screen-reader flavour:** Orca, espeak-ng and audio as an optional image profile (about 100 MB, plus boot cost), restoring the app's AT-SPI promise on the stick.
- **Encrypted backup to a second stick** (allow-listed by the helper), and USBGuard-style rules for other USB devices.
- **Stronger suspend:** `cryptsetup luksSuspend` so the key leaves RAM while asleep. This needs the unlock path to run from RAM.
- **Tamper protection** (outside today's threat model): a signed UKI with the author's own keys, enrolled on the author's laptop only.

## Out of scope (permanently)

- Networking of any kind (Wi-Fi, Ethernet, Bluetooth, USB tethering), update servers, telemetry.
- A general desktop, terminal, file manager, browser, or any second application.
- Asking the writer to change the host's firmware settings (Secure Boot off, key enrolment) for the stick.
- Writing to the host's disks.

---

## Risks and how the plan meets them

1. **Secure Boot certificate rollover (2026).** The Microsoft 2011 CA expired in June 2026. Expiry alone doesn't stop a 2011-signed shim from booting while the CA is still trusted and the shim isn't revoked ([Microsoft guidance](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/linux-distribution-guidance-handling-2023keys)). The risk is machines that trust only the 2023 CA, and future revocations. Trixie's `shim-signed` 1.51 is dual-signed (2011 + 2023), and Debian's wiki warns that some buggy firmware rejects dual-signed shims. *Plan:* the three-variable-set VM matrix in OS-0 (built on the host with `virt-fw-vars --microsoft-db uefi11|uefi23|uefi+rom23`), the Dell (both CAs, so real hardware for the dual-signed case), and a newer laptop opportunistically; the README tells the writer what to do.
2. **Debian kernel modules and hardware breadth.** We can't build a network-free kernel on the signed path, so "no network" rests on removed modules and firmware plus kernel lockdown under SB (only Debian-signed modules load, and only from the verity root). New laptops may need the backports kernel (OS-0 decides).
3. **No early framebuffer (no simpledrm).** Nothing can be drawn before the GPU driver loads. *Plan:* the unlock screen lives in the app; the initrd stays graphics-free.
4. **Cheap sticks are slow at random reads.** *Plan:* reads happen while the writer types; erofs is tuned; a recommended stick; copy-to-RAM is evaluated in OS-4.
5. **A tampered stick can capture the passphrase** (unsigned initrd and command line). This is out of scope by the author's choice. *Plan:* honest wording, and keep the stick on your person; signed UKIs are a later item.
6. **Suspend keeps the key in RAM.** The lock view protects against casual access only. *Plan:* stated in the honest claims; `luksSuspend` later.
7. **Stick removed, or power lost, while running.** The system, the texts and the recovery journal all live on the stick, so edits since the last completed save can be lost. *Plan:* promise only *saved means saved* (ADR-0006); test crash, power cut and removal separately (OS-2). Copy-to-RAM (OS-4) keeps the *system* alive without the stick, but the texts still can't be saved until it's back. Whether to offer "reinsert the stick to save" is a later question.
8. **Two WebKit builds (Arch desktop, Debian stick).** Both are 2.54, but distro patches differ. *Plan:* the specimen visual baselines run against the Debian build in OS-0 and again whenever either side updates.

## Open questions for later interviews (not blocking OS-0 to OS-5)

- The phone side of the QR export (platform, app choice, integrity check).
- Laptop install: dedicated or dual boot.
- Whether other writers get pre-made sticks, or a published image plus `flash.sh`.
