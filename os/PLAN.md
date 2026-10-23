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
- Copy as rich text removed in appliance mode (later removed everywhere, with links and *Show in file manager*: ADR-0015, 2026-10-23).
- Our own WebKitGTK scheduled after the stick's 1.0.

**Status:** Phase OS-5 built (2026-10-22) and waiting for the author's acceptance of the stick 1.0: reflashing that keeps the texts, the ways out closed (one let a reload skip the lock view), the laptop shown untouched, the README and the security audit (*Phase OS-5 result* below). Phase OS-4 accepted (2026-10-22): the sizes are within budget, the boot is 2.4 s faster in the VM, and the author accepted the two VM boot stages still over budget (*Phase OS-4 result* below; ADR-0014). Its Dell steps are still listed there. Phase OS-3 built (2026-10-21) and waiting for the author's check on the Dell: lock before sleep and on the lid, power in the menu, the clock and battery, Settings › This stick (*Phase OS-3 result* below). The author moved on from OS-2 before its Dell check; that check is still listed under *Phase OS-2 result*. Phase OS-2 built (2026-10-21): a blank stick asks for a keyboard, a passphrase and a time zone once, formats its home (LUKS2, Argon2id) and from then on boots to the bismillah unlock screen. Every VM scenario passes; the result is in *Phase OS-2 result* below. OS-1 was accepted when the author moved on. Working rule from the author: make it work first, then optimise.

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

Built 2026-10-21. Every spike is **go**, two with changes to the plan; the write-ups are in `docs/spikes/os-*.md` and the decisions in [ADR-0013](../docs/decisions/0013-appliance-os.md) (*Proposed*).

| Spike | Verdict | What changes |
|---|---|---|
| Signed boot | go: 2011-only, 2023-only and both-CA VMs, and the Dell with Secure Boot on | The ESP is 512 MiB FAT32 (256 MiB reads as FAT16). Kernel: Debian 6.12; backports 7.2 is signed if needed. Shim's `SbatLevel` is disclosed. |
| App on Debian | go for building and rendering | Dialogs, clipboard, the WebKit sandbox and the network process are checked in OS-1 with the debug shell. |
| Unlock in the app | go, in-process: 1.70 s in the VM, about 1.5 s on the Dell | None |
| Keyboard | go: cage with a 1.6 s session restart | None; sway isn't needed |
| No network | go: zero frames on three NICs, no network modules or firmware | None |
| Host untouched | go: zero writes to the laptop disk | Firmware boot-manager entries for removable disks are the machine's own; disclosed. |
| Boot-device binding | go | With two sticks of one build, the helper refuses; the unlock screen asks for the other stick to be removed. |
| Suspend lock | go: every VM case and both Dell lid closes came back locked | A session restart ends the session's processes and returns to its VT first. **New on the Dell:** the lid locks on `LidClosed` itself, since logind's 30 s hold-off after a resume delayed one suspend by 16.7 s. |
| GPU and display | go: i915 on the Dell, NVIDIA idle and runtime-suspended | WebKit isn't pinned. nouveau stays for hybrids' power. |
| Size and boot | baseline recorded | Root 500 MiB (met), ESP 48 MB (over by 8), Dell: unlock screen 20.6 s after kernel start on a 565-reads/s stick. OS-4 targets are in `docs/spikes/os-size-boot.md`. |

**Deviations:** the spike app code went onto main, behind its environment flags, at the author's request (2026-10-21), so the OS builds the current editor; OS-1 and OS-2 replace it. A cold *Unlock* → caret on the Dell wasn't run (the check didn't reboot); OS-1's first Dell image measures it.

**The author's acceptance check:**
1. Read ADR-0013 and accept it, or say what to change.
2. Confirm the plan changes above: the 512 MiB ESP, refusing with two sticks of one build, and locking on the lid itself.

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

Built 2026-10-21 (commits 64773f1 to the OS-1 result). `os/scripts/verify.sh` passes: the app and both images built offline, the contents check, and every VM scenario.

**What exists:**
- `os/mkosi/`: the product image at Debian snapshot `20261021T083704Z`. Release and debug profiles, the repart definitions (512 MiB ESP, zstd erofs root under dm-verity, an empty home), `loader.conf` (`timeout 0`, `editor no`) and the units. The session runs `cage -d -- bismillah --appliance` and starts again whenever it ends.
- **Release:** no shell, perl, apt, dpkg database, getty, `login`, `su` or `sulogin`. journald and the emergency, rescue and debug shells are masked, systemd logs nowhere and every unit's output goes to `/dev/null`. `quiet`, no serial console, no SysRq. Home is RAM only (tmpfs) until OS-2 encrypts it, so nothing unencrypted is ever written to the stick.
- **Debug:** the serial console with the journal on it, the app's boot marks (`BISMILLAH_MARKS=1`), a root command line on ttyS1, and a plain ext4 test home.
- **Both:** no network modules or firmware, efivarfs read-only, `noresume`, no `fbx64.efi`, and every getty, networkd, resolved and timesyncd unit masked.
- **The app** (`src-tauri/src/appliance.rs`): `--appliance` makes `~/Texts` the library (mode 0700) and scales screens of 192 dpi or more to 2x through `wlr-randr`, so the session needs no shell script. It prints boot marks only where `BISMILLAH_MARKS` is set.
- **Recorded inputs:** `os/inputs.lock` (snapshot, container base digest, Rust, Node, pnpm, mkosi). `pnpm os:fetch` is the only networked stage and fills `os/cache/`: the build container, vendored crates, the pnpm store and metadata cache, mkosi's package and metadata caches, and its tools tree. `pnpm os:app` and `pnpm os:build` run with the network off.
- **Tests:** `os/scripts/vm.ts` (the QMP harness), `os/scripts/test.ts` (the scenarios, `pnpm os:test`), `os/tests/image-contents.ts`, `os/scripts/verify.sh` (`pnpm os:verify`), `os/scripts/rebuild-offline.sh` and `os/scripts/flash.sh`.

**Measured (VM, Secure Boot on, Microsoft keys):**

| | ssd | good stick | cheap stick |
|---|---|---|---|
| systemd-analyze (kernel + initrd + userspace) | 1.1 + 3.5 + 2.0 = 6.6 s | 1.2 + 3.8 + 2.1 = 7.1 s | 1.2 + 3.8 + 3.0 = 8.0 s |
| kernel start → app process | 8.4 s | 9.0 s | 12.9 s |
| kernel start → editor ready (`page-editable`) | 9.9 s | 10.5 s | 15.8 s |
| release: QEMU start → settled screen | 16–21 s | | 24.3 s |

- Root 488 MiB (budget 600). Verity 3.9 MiB.
- ESP payload about 48 MB: kernel 12.2 MB, initrd 34.5 MB, plus shim and systemd-boot (budget 40, initrd budget 15). Unchanged since OS-0; OS-4 cuts the initrd.

**Proved:**
- **Secure Boot:** the release image boots and the editor answers typing with the 2011-only, 2023-only and both-CA variable sets.
- **No network:** zero frames on a virtio NIC, and on an e1000e and a USB NIC hot-plugged while it ran.
- **Inside the debug image:** Secure Boot on, lockdown `integrity`, the root `erofs ro` and verified, efivarfs `ro`, only `lo`, no getty unit, the app as `writer`.
- **Offline rebuild:** a clean checkout of 5a36a4a, given only `os/cache/`, built the app from nothing (403 crates) and both images in a network namespace with only `lo`. mkosi synced no metadata.

**Deviations and findings:**
- **The app ships as a file tree, not a `.deb`:** `os/out/app/` goes in through `ExtraTrees=`, with the commit in `/usr/share/bismillah/commit`. The image has no dpkg to install a package with.
- **The contents check is a plain Node script** (`os/tests/image-contents.ts`), not a vitest suite, so `pnpm test` doesn't need images.
- **The tools tree is a recorded input:** mkosi builds its default tools tree with its own settings, ignoring `CacheOnly=` and our cache directories, so a clean checkout rebuilt it online. It is now built by `os:fetch` and kept in `os/cache/mkosi.tools`.
- **pnpm 11 checks the lockfile against its supply-chain policy even offline,** which needs registry metadata. The metadata cache is therefore kept in `os/cache/pnpm-cache`, and the check still runs.
- **Host hardware stays untouched beyond OS-0's list:** Debian's systemd enables `systemd-tpm2-setup` (it would store a key in the laptop's TPM), the pcrlock and pcrphase units, and `systemd-pstore` (it deletes crash records from firmware variables). All are masked, as are GRUB's suspend hook, the network generator and sysext/confext. The contents check asserts it.
- **The umask comes from PAM:** the login session takes its umask from PAM, not from the unit, so the app creates `~/Texts` 0700 itself.
- **Welcome screen not painted:** under software rendering (the VM has no 3D, so Mesa uses `kms_swrast`), WebKit never paints the empty-library welcome screen. It is there, and a click reaches it. The guide and the editor paint. With `WEBKIT_DISABLE_COMPOSITING_MODE=1` it paints. The VM scenarios therefore open the guide (F1, a sample that is never saved) before typing. Whether real GPUs show it is the Dell's question; OS-3 decides what an empty stick opens on.
- **OVMF sometimes reports "No bootable option"** for a stick it boots the next time, as it did in OS-0. `vm.ts` boots up to three times.

**The author's acceptance check:**
1. Flash the release image: `bash os/scripts/flash.sh release` (it asks for sudo and for the stick's model name).
2. With Secure Boot on, boot the Dell from it (F12). It should go straight to bismillah, dark, at 2x.
3. Note whether the welcome screen ("Nothing open", with its three actions) is visible, and roughly how long from power-on to the screen.
4. Press F1 and type in the guide. Nothing you type is kept: home is in RAM until OS-2.
5. Power off with the power button.

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

Built 2026-10-21 (commits dffbbb0 to the OS-2 result). The app gate (`pnpm verify`), the contents check and every VM scenario pass.

**What exists:**
- **The helper** (`crates/bismillah-appliance`): the protocol and passphrase rules the app shares, and `bismillah-helper`, root, socket-activated, answering uid 1000 only (`SO_PEERCRED`, socket mode 0600).
  - Verbs: `status`, `setup`, `finish`, `start_over`, `unlock`, `verify`, `set_keyboard`, `power`. The plan's list plus the two Initialising actions and power, which the screens need before the app has started.
  - **Which partition:** the OS-0 lookup in Rust (root disk from dm-verity's slaves, `LoaderDevicePartUUID` on exactly that disk, the one home-type partition there). Anything else is `not_found` and touches nothing.
  - **State:** Blank (no blkid signature, and the first 8 MiB and last MiB are zeros), Initialising, Ready and Unreadable, from two LUKS2 tokens: `bismillah-state` (slot 0) and `bismillah-keyboard` (slot 1). Formatting is reachable from Blank only and erasing (`start_over`) from Initialising only.
  - **Setup writes the header in one step:** it is made in RAM (`luksFormat --header`, Argon2id at 1 GiB or RAM/4, 4 lanes, `--iter-time 1000`), both tokens are added there, and `luksHeaderRestore` writes it to the stick. So the stick never holds a LUKS header without bismillah's state; a header without it is someone else's, and Unreadable.
  - Then open, `mkfs.ext4`, mount (`nodev,nosuid,noatime`), folders and a marker, and the state token `ready`, each flushed, each a mark (`helper-formatted`, `-filesystem`, `-marker`, `-ready`). Unlock runs `e2fsck -p` first and mounts nothing it can't check.
  - Passphrases are `Zeroizing` buffers, go to cryptsetup on stdin only, and never print (`Secret`'s Debug is redacted).
- **The app** (`src-tauri/src/appliance.rs`, `src/appliance/`): everything that reads home waits behind the gate, which shows:
  - **Setup:** 1. keyboard (a layout and an optional second, Alt+Shift between them; choosing restarts the session so cage uses them); 2. the passphrase twice, rated by zxcvbn and refused below score 3, with *Suggest a passphrase* (six words from the EFF large list, the kernel's randomness) and "There is no way to recover your texts without this passphrase."; 3. the time zone (stored as the `time_zone` setting; OS-3 applies it).
  - **Unlock:** ﷽ (the Basmallah's pre-shaped ink, so it draws before any font), the passphrase, *Show passphrase*, the keyboard indicator (layout, direction, Caps Lock), a calm wrong-passphrase message, *Power off*.
  - **Finish setup** with *Start over…* behind typing "start over"; **Unreadable**, **two sticks** and **not found**, which offer only power.
  - A session restarted while home is open asks for the passphrase again (`verify`) and reopens nothing.
  - The app's own files are fixed under home; the session points every `XDG_*_HOME` at RAM, so WebKit, GTK, fontconfig and Mesa write nothing under home before unlock. The app refuses to start unless home is a mount of its own.
- **The image:** the helper and its socket, `cryptsetup-bin` and `e2fsprogs`, `/home` in RAM until the helper mounts `/home/writer`, and the home partition flashed blank with the GPT no-auto flag. The session runs `bismillah-helper keyboard-env` before cage. The debug image now sets up and unlocks like the release image; its plain ext4 test home is gone.
- **Tests:** `cargo test` (the lookup, the state tokens, Blank, the protocol, passphrase strength and generation), `src/appliance/gate.test.ts`, `tests/e2e/appliance.e2e.ts` (every screen in the real app against a stand-in helper, a scratch `HOME`, keyboard order, the exact bytes sent, screenshots in both themes), the contents check (helper, socket, tools, no-auto, blank home, `/home` in RAM), and the VM scenarios below.

**Measured (VM, 2 vCPUs, 2 GiB, Secure Boot on):**

| | |
|---|---|
| Setup: helper start → ready (header, KDF benchmark, mkfs, folders) | 6.0–7.4 s |
| Argon2id in the VM | 472 MiB (RAM/4), 2 threads (cryptsetup caps lanes at the CPU count) |
| *Unlock* pressed → home mounted (KDF + `e2fsck -p` + mount) | 1.37–1.46 s |
| *Unlock* pressed → editor ready, last document open | **1.51–1.58 s** (budget 2.0) |
| Release: QEMU start → setup screen settled | 17.3–19.3 s (ssd), 26.7 s (cheap) |

**Proved in VMs** (`node os/scripts/test.ts`):
- **Round trip** (debug): blank → layouts `se,ara` → a passphrase typed in Swedish and Arabic (`åäö بلا …`, its exact bytes confirmed against the header) → write and save → power off → a wrong passphrase only fails → unlock → the text is intact. The header holds the state token and the layout names; home is mounted `nosuid,nodev,noatime`, home and `Texts` 0700.
- **Setup interrupted** at every step: the helper killed after *formatted*, and the power cut after *filesystem*, *marker* and *ready*. Each next state is Initialising (Finish setup, or Start over → Blank) or Ready, never Blank.
- **Damaged metadata** is Unreadable, and nothing is written to it: an unknown state, no state token, a garbled header, another file system. A damaged file system is never mounted or formatted; a damaged keyboard token gives cage's default (US) and says so.
- **Two sticks:** a twin of the same build → refused, its bytes unchanged; a stick of another build attached → this stick's own home is used, the other unchanged.
- **Saved means saved:** after `kill -9` of the app, a power cut, and pulling the stick, every save confirmed before is intact; a full home fails the save visibly and the next save after freeing space keeps everything.
- **Release:** boots with all three key sets and the cheap stick to setup; setup → next boot unlocks.

**Deviations and findings:**
- **`flash.sh` is unchanged:** editing it (growing home to the rest of the stick, `--wipe-data` for an Unreadable stick) is blocked for the agent, since the script writes block devices. So a real stick's home is still the image's 512 MiB, and Unreadable can only be cleared by reflashing. Both are for the author to add or approve.
- **`PrivateNetwork=` hid the mount:** it gives a service its own mount namespace, so the home the helper mounted never reached the session, and the app wrote texts to the RAM under it. The helper now runs without namespacing, and the app checks that home is mounted.
- **`blkid -p` succeeds on an empty partition** (it reports the GPT entry's own tags), so only a `TYPE` or `PTTYPE` counts as a signature.
- **The welcome screen paints after unlock** in the VM, which OS-1 saw blank under software rendering.
- **cage's pointer** sits in the middle of the unlock screen. OS-3 hides it while typing.
- **The VM firmware's misses** ("failed to load Boot… Not Found", then a reset) came more often with sticks booted several times; `vm.ts` now recognises every form of the miss and boots again.
- Setup runs the helper's KDF benchmark each time, so it takes 6–7 s once per stick, within the plan.

**The author's acceptance check:**
1. Flash the release image: `bash os/scripts/flash.sh release`.
2. With Secure Boot on, boot the Dell from it (F12). Setup asks for a keyboard: choose Swedish and, if you like, Arabic as the second. The screen reloads.
3. Choose a passphrase (or *Suggest a passphrase*), type it again, choose the time zone, and *Set up the stick*. Note roughly how long it takes; the editor opens.
4. Open the library (*Library*, bottom left), make a new file in `Texts`, write a line, and wait for *Saved*.
5. Power off with the power button, boot again, type a wrong passphrase, then the right one. Note roughly how long from *Unlock* to the editor, and check the line is there.
6. Look at Setup and Unlock: keyboard only, and whether the indicator shows Swedish and switches to right to left with Alt+Shift.

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
- **Hidden in appliance mode:** *Open folder/file…* outside the library, *Another font*. Links, *Show in file manager* and *Copy as rich text* are gone from bismillah everywhere (ADR-0015, 2026-10-23). Window size and maximised state are neither applied nor remembered; cage keeps the app fullscreen. About shows the OS image version and the snapshot date.
- **Docs:** the in-app guide gains an appliance section; DESIGN.md and ARCHITECTURE.md gain appliance sections.

**Accept when:**
- The VM suspend and lock tests pass (S3 plus `system_wakeup`): normal, app frozen, app crashed, app disconnected, and the inhibitor delay exceeded. A screenshot right after resume never shows document text.
- A low-battery path test passes (a fake `power_supply` in the debug profile).
- The design review passes.
- The author uses the stick for a writing session on the Dell.

### Phase OS-3 result

Built 2026-10-21 (commits 9db0b85 to the OS-3 result). The app's unit and e2e tests, the contents check and the VM scenarios pass; see *Gates* below.

**What exists:**
- **The helper keeps the lock** (`crates/bismillah-appliance/src/helper/session.rs`, `sleep.rs`, `lid.rs`, `vt.rs`):
  - The app holds one **events connection** (`events` verb): the helper sends `{"event":"lock"}`, the app answers `{"report":"painted"}`.
  - A logind **delay inhibitor** (the `dbus` crate, already in Tauri's tree). Before sleep: lock, and 1.5 s for `painted`; otherwise VT 8 (empty). After a fallback: 3 s for `painted` on resume, else the session's processes are ended (SIGTERM, SIGCONT, SIGKILL after 2 s), VT 1, a new session. logind's `InhibitDelayMaxSec=5` is now set explicitly, with `HandleLidSwitch=suspend` on battery and mains.
  - **The lid** (`SW_LID`, read from its evdev device) locks at once, whether or not sleep follows.
  - **A dropped connection** keeps the lock up: until a passphrase is verified the helper answers only `status`, `verify`, `resume` and `power` (`Answer::Locked` otherwise). A restarted helper starts locked if home is mounted.
  - `power{suspend}` joins off and reboot. `resume` lets the session that a keyboard change restarted reopen home once, within a minute, without the passphrase.
- **The app** (`src-tauri/src/appliance.rs`, `src/appliance/`, `workspace.svelte.ts`):
  - **The lock view** is the Unlock screen titled *Locked*, over everything; the rest is `inert` and no command runs (`runCommand` refuses while locked, so native-menu accelerators don't act either). It reports `painted` two frames after it is shown, and saves behind it. It shows on the helper's `lock`, on *Lock*, before *Suspend*, and whenever the events connection drops. While the gate is still up, Rust answers `painted` itself.
  - **Commands:** *Lock*, *Suspend*, *Restart*, *Power off* (`Ctrl+Q`) in File and the palette; each saves first. Quit, Open…, Open folder… and Fullscreen are left out of the registry on the stick (`useStickCommands()`); links, *Show in file manager* and *Copy as rich text* are gone everywhere (ADR-0015). Window size is neither restored nor remembered. The first screen offers only *New file…* and the guide.
  - **Clock and battery** at the end of the status line: 24-hour, in the `time_zone` setting, through `Intl`; the battery summed over `/sys/class/power_supply`. A notice at 10%; at 3% it saves and powers off.
  - **Settings › This stick:** up to four layouts and the switch key (Alt+Shift, Ctrl+Shift, Super+Space, Caps Lock), applied with one button: save, store in the header, leave the caret's offset in `$XDG_RUNTIME_DIR`, restart, `resume`, caret back. The time zone, and *This computer's clock keeps local time* (`clock_keeps_local_time`): the clock is corrected by the zone's offset and the RTC never written. *Another font* is hidden; Files & privacy says what the stick keeps unencrypted (the layout names).
  - **About** names the Debian snapshot and the commit; the stick now carries the licences About points to (`/usr/share/licenses/bismillah/`).
- **Docs:** the guide's *On the bismillah stick*, DESIGN.md §19, ARCHITECTURE.md §12.4 and the `dbus` row in §2.
- **Tests:** helper unit tests (lock gating, the events handshake, resume once, session scopes, lid device and events), app unit tests (battery reading), `power.test.ts` (levels, zone offsets, the clock correction), `commands.stick.test.ts` (the stick's registry, nothing runs behind the lock), `appliance.e2e.ts` (clock, battery notice, palette, the helper's lock and the `painted` report, shortcuts blocked behind it, verify, Settings › This stick, Ctrl+Q), and the VM scenarios `suspend-lock` and `power`.

**Proved in VMs** (debug image, S3 with `-device VGA`, `system_wakeup`):

| Case | The helper | Document on screen asleep or after wake |
|---|---|---|
| Normal | locked before sleep, 0.08–0.10 s after the request | never |
| App frozen (all its processes stopped) | fallback at 1.53 s; session restarted 3 s after wake | never (it showed for those 1.5 s while the helper waited) |
| Frozen, continued after wake | fallback; the app painted late, back on VT 1 | never |
| App killed just before | no app to ask: empty VT at once | never |
| Helper killed (connection dropped) | the app locked itself, reconnected; the next sleep handshaked normally | never |

Every case decided within logind's 5 s delay, and the passphrase brought the document back. *Lock* from the palette covers the text and `Ctrl+N` doesn't act behind it; a restarted helper locks the app at once. `power`: a fake battery (below) at 9% shows the notice; at 3% the app saved unsaved typing and powered off, home clean (`e2fsck`: clean); `Ctrl+Q` saved and powered off cleanly.

**Deviations and findings:**
- **"Inhibitor delay exceeded"** is tested as its guarantee: the helper's longest decision (1.53 s, app frozen) stays well inside logind's 5 s, which is now set explicitly; logind never logged its timeout. Lowering it below 1.5 s would let the system sleep before the fallback.
- **The fake battery is a folder**, not `test_power`: Debian's kernel doesn't build it, Secure Boot lockdown wouldn't load one we built, and QEMU has no battery device. The app reads `BISMILLAH_POWER_SUPPLY` when set; only the debug session sets it, and the contents check refuses it in release.
- **The battery is read by the app**, not sent by the helper (`battery_critical` isn't a helper event): the app must save before powering off anyway. A frozen app won't power off at 3%.
- **The keyboard change returns to the caret without the passphrase** (`resume`), which the plan implied but didn't specify. Not run in a VM; the e2e test covers the request, the Dell check the restart.
- **Clock correction is a switch** (*keeps local time*), not a number of hours: the offset follows from the time zone, summer time included.
- **cage's pointer still shows** in the middle of the screen: hiding it while typing works only once the pointer has been over the page, because cage draws it itself until then. Left for OS-4/OS-5 (a cage option, or moving the pointer to a corner at start).
- **Brightness keys** wait for the Dell check: only if its firmware doesn't handle them.
- **The lid** can't be tested in QEMU (no lid device); the Dell check covers it.
- **The serial console loses journal lines** now and then (interleaved with the kernel's); the suspend scenario also accepts the kernel's `PM: suspend exit`.

**The author's acceptance check:**
1. Flash the release image (`bash os/scripts/flash.sh release`; this erases the stick's texts, as setup is new) and set it up on the Dell, or keep the OS-2 stick and reflash only if you accept losing its texts.
2. Write for a while. Check the clock and battery at the bottom right, and that they fade with the rest while you type.
3. Close the lid, wait, open it: the lock view, never your text. Type the passphrase. Close and open the lid again within 30 s of the last resume: still locked.
4. *Lock*, *Suspend*, *Restart* and *Power off* from the File menu (Alt) and the palette; `Ctrl+Q` powers off.
5. Settings › This stick: add a layout, *Apply layouts*; bismillah restarts and returns to your caret without asking for the passphrase. Change the time zone; if the clock is off by whole hours, try *This computer's clock keeps local time*.
6. Try the brightness keys and say whether they work.
7. Use the stick for a writing session.

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

Built 2026-10-21/22 (commits c42964b to the OS-4 result). The full VM suite (133 checks, including a new tour of the app) passes on the pruned images, and `os/perf-baseline.json` is committed.

**What exists:**
- **`pnpm os:perf`** (`os/scripts/perf.ts`):
  - Sizes from the release image, and unpacked bytes per component.
  - Boot stages from the debug image's marks and `systemd-analyze`: a stick set up once, booted cold three times on the good and the cheap stick (median), unlocked each time.
  - RAM with a 1 MB English and Arabic document open.
  - It compares all of these with the baseline, fails on a regression (times +15% + 0.3 s, sizes +2%, RAM +10%) and reports the budgets beside it. `os/scripts/verify.sh` runs it (`--sizes` in `--fast`).
- **The allowlist:**
  - `bismillah-trace` is a fanotify recorder (`FAN_OPEN`/`FAN_OPEN_EXEC` on the root's whole file system, so the WebKit sandbox counts). It is built only with the helper crate's `trace` feature and installed only in the debug image. It starts at boot when the VM harness passes an SMBIOS credential (`BISMILLAH_TRACE=1`) and writes to a third serial port.
  - `os/scripts/trace.sh` builds the debug image unpruned, runs every debug scenario with the recorder, merges the result into `os/mkosi/allowlist.txt` (682 files) and rebuilds both images.
  - `os/mkosi/allowlist-declared.txt` lists, with reasons, what a VM can't open: every XKB layout, every time zone (none installed: the app's zones come from ICU), the fonts, the GPU families' Mesa drivers, udev's rules and database, systemd's early files.
  - `prune.py` (a finalize script) keeps the traced and declared files, the libraries they need (DT_NEEDED and the loader) and the links to them.
  - The contents check fails on any release file that is neither traced, declared nor needed, and on any program missing a library.
  - The new `tour` scenario walks every part of the app by keyboard: vocalised Arabic, English spelling and grammar, Settings, both themes, the guide, About, the native New file dialog, find, the views, Lock and Restart. Setup, unlock, Unreadable, suspend and low battery were already covered by other scenarios.
- **Kernel modules by hardware class** (`mkosi.conf`):
  - storage, USB, HID and input, I2C, ACPI, power, thermal, backlight
  - the Intel, AMD, nouveau, virtio and QEMU VGA GPU drivers
  - no sound drivers. Sound's core stays as a dependency of `thinkpad_acpi`.
- **The initrd keeps only what its boot runs** (`initrd-keep.txt`, `prune.py initrd`). It is packed with zstd -19, loads the USB storage drivers from `modules-load.d` at once, and mounts the system's RAM folders from its own fstab.
- **Boot waits removed** (found with the journal's monotonic timeline):
  - usb-storage's 1 s delay is now 100 ms.
  - The RAM folders' mounts waited 0.8 s for systemd's rate-limited mount monitor; the initrd mounts them now.
  - `user@.service` is masked; PAM waited 0.45 s for it.
  - An empty `machine-id` stops every boot counting as a first boot.
  - Only two generators remain (fstab, debug).
  - The unused API mounts and e2fsprogs' shell-script scrubber are masked.
  - erofs uses 64 KiB clusters.

**Measured** (VM, debug image, median of 3; `os/out/perf/report.md`):

| Measure | Budget | Start of OS-4 | Now |
|---|---|---|---|
| ESP payload | ≤ 40 MiB | 46.5 MiB | 23.6 MiB |
| initrd (base + modules) | ≤ 15 MiB | 34.5 MB | 9.9 MiB |
| erofs root | ≤ 450 MiB | 494 MiB | 357 MiB |
| kernel → switch-root, good | ≤ 2.5 s | 4.40 s | 2.69 s |
| switch-root → unlock painted, good | ≤ 3.0 s | 5.46 s | 4.68 s |
| *Unlock* → caret, good | ≤ 2.0 s | 1.72 s | 1.81 s |
| kernel → unlock painted, cheap | recorded | 16.1 s | 10.0 s |
| switch-root → unlock painted, cheap | recorded | 10.95 s | 7.23 s |
| RAM, writer's processes (PSS), 1 MB document | ≤ 1.0 GiB | — | 829 MiB (877 MiB system-wide) |

**Deviations and findings:**
- **Two boot stages are over their VM budget**: 2.69 s against 2.5, and 4.68 s against 3.0. The rest after switch-root is cage, Mesa and WebKit starting. In the VM about 1.2 s of that is the software renderer (virtio-gpu without virgl falls back to llvmpipe). The Dell's i915 doesn't need it, so the Dell's numbers decide whether to re-set these budgets. ADR-0014 records why Buildroot wouldn't change this.
- **The "start of OS-4" times flatter the result a little.** The debug image's serial console was slowing them: QEMU keeps the console to 115200 baud and PID1 waits on it. The console now carries only warnings, failures and the marks, logged at notice. The tests that read the helper's messages allow for the journal's colour codes.
- **The release image can't be timed from inside**, since it prints nothing. Seen from outside, OVMF's own time varies from 3.7 to 9 s between boots, which swamps the difference. So the stages come from the debug image, which now boots the same way apart from its console, journal and recorder.
- **The allowlist files live in `os/mkosi/`**, not `os/`: mkosi's scripts see only their own folder.
- **The debug image is pruned too**, plus its tools (`debug:` lines). That way the whole suite runs on the pruned system, and the trace is recorded on an unpruned build.
- **No CPU microcode** is installed; the firmware's own is used.
- **File ordering by boot access and reading ahead** weren't done: mkfs.erofs can't order files, and 64 KiB clusters already cut the cheap stick's reads. **Trimming ICU and Mesa** needs our own builds (the later WebKitGTK work).
- **`/usr/bin/stty`** is in the trace because the debug command line runs it at start, and it exited before the recorder could check its cgroup. It is harmless and 50 KB.
- **cage's pointer** is still shown at start (left for OS-5).

**The author's acceptance check:**
1. Look at the budgets and ADR-0014, and accept them, or re-set the two VM boot stages.
2. Flash the release image on the Dell (`bash os/scripts/flash.sh release`; this erases the stick's texts) and set it up. It still boots with Secure Boot on, the keyboard, touchpad and brightness keys work, and the lid locks: this is the first run of the trimmed modules and files on real hardware.
3. Use it for a while: Settings, New file…, Arabic text, spelling. Anything missing (a blank icon, a failing feature) is a gap in the trace. Tell me, and it gets a scenario step and a new trace.
4. Time a cold boot to the unlock screen (power button → unlock screen) and *Unlock* → caret, and compare with OS-0's 33 s and 1.5 s.

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

Built 2026-10-22 (commits 3cc9386 to the OS-5 result). `os/scripts/verify.sh` passes in full: the reflash tool's 6 tests, both images' contents, 163 VM checks (the four new scenarios included) and the measurements with no regression. `pnpm verify` passes too (426 frontend and 191 Rust tests, 27 real-app suites). The audit is [docs/audits/2026-10-22-stick-1.0.md](../docs/audits/2026-10-22-stick-1.0.md), and the stick's own documentation is [os/README.md](README.md).

**What exists:**
- **Reflash** (`os/scripts/stick.ts`, `flash.sh --update`):
  - The first flash writes a prepared copy of the image with the stick's own disk, ESP and home GUIDs. It records them in `os/sticks.toml` (gitignored) and in the ESP's `bismillah/stick-id`, a 512-byte placeholder the build ships and the tool fills in place.
  - `--update` checks the GPT GUIDs against both, refuses any other partition layout or a system bigger than the stick's slots, then writes root and verity, then the ESP. It gives root and verity the new build's GUIDs, and reads all three back. A registry flag lets an update cut off while writing the ESP run again.
  - root and verity now have fixed slots (640 and 8 MiB) instead of minimised ones, so a later, larger build fits. The image grew from 1.45 to 1.75 GB; flashing it writes the slots' zeros too.
  - `os/tests/stick.test.ts` (6 tests on made-up sticks) runs in `verify.sh`, and the `reflash` scenario does debug → release → debug on one stick with a text in it.
- **Ways out, closed:**
  - systemd-boot's menu can't be opened by a held key any more (`timeout menu-disabled`).
  - SysRq is off from the kernel command line onwards, not only once sysctl.d applies.
  - Ctrl+Alt+Del powers off (on an empty VT; in the session the app gets the keys), and repeating it does nothing more drastic.
  - `mount` and `umount` lose their setuid bit (`harden.finalize`).
  - In the app, on the stick: dialog paths, drops and *Open folder* outside `~/Texts` are refused; WebKit's page menu (with *Reload*) is suppressed; and a page loaded after the app started opens behind the lock view.
- **The helper:** a client has 5 s to send its request line. A parser fuzz test (200 000 damaged lines), and a debug-only `bismillah-probe` that the `helper-socket` scenario runs against the real helper.
- **Scenarios:** `host-untouched` (release and debug, with a laptop NVMe disk behind a qcow2 overlay and the variable store diffed), `ways-out`, `helper-socket` and `reflash`. The contents check adds the loader's settings, the command line, the stick-id, Ctrl+Alt+Del, launchers, LVM, RAID and swap tools, a shell-free initrd, and setuid and world-writable files.
- **`os/README.md`:** making and updating a stick, why Secure Boot stays on, the honest claims with the firmware variables listed, what to do when a laptop won't boot it, the recommended stick, and the tested laptops.
- **`perf.ts`** measures the erofs file system and the verity tree by their superblocks, since their slots are now larger than they are.

**Found by the audit** (each is fixed, and has a test that fails without the fix):

| Finding | Severity |
|---|---|
| WebKit's page menu offered *Reload*. A reloaded page showed the text without the passphrase, even when the stick was locked. | High: it bypassed the lock view |
| A path typed into a native dialog, such as `/tmp/note.md`, was saved into RAM, shown as saved, and lost at power-off | High for the writer's trust (the "Saved" promise) |
| A client that connected to the helper and sent nothing held it up indefinitely, the lock before sleep included | Medium: only the writer's uid can connect |
| Every stick flashed from one image had the same GUIDs, so two such sticks were twins, and an ESP GUID once collided with a firmware boot entry on the Dell | Medium |
| SysRq worked until the system had started; a held key opened the loader's menu; Ctrl+Alt+Del restarted; `mount` was setuid | Low: none of them reached a shell |

**Measured** (VM, debug image, median of 3; `os/out/perf/report.md`): sizes unchanged (ESP 23.6 MiB, initrd 9.9 MiB, erofs root 356.7 MiB in its 640 MiB slot). On the good stick, kernel → switch-root 2.87 s, switch-root → unlock painted 4.16 s, *Unlock* → caret 1.63 s; on the cheap stick, kernel → unlock painted 9.99 s. RAM 826 MiB. All within the regression bounds of OS-4's baseline, which stays.

**Deviations and findings:**
- **Plan's partition table:** the ESP is 512 MiB (OS-0), root and verity are 640 and 8 MiB rather than 2 GiB and 128 MiB, and home stays 512 MiB, because flash.sh doesn't grow it yet. Texts need little room, but growing home to the rest of the stick is still open.
- **"The kernel-config check"** in the honest claims wasn't added. The claim rests on the module and firmware audit and on the tested zero frames; the README's wording says so.
- **QEMU's block-write trace events** weren't used. QEMU's own per-disk write counters, read after the guest powers off, and the qcow2 overlay's allocation, together prove the same thing.
- **cage's pointer** still shows at start. A transparent cursor theme for cage didn't take, and was removed again. It disappears as soon as the writer types (the app hides it).
- **The first screen often paints white in the VM** until a key is pressed. This was already the case in OS-4's runs (three of four first frames). *Found in the stick QA pass afterwards* (docs/audits/2026-10-22-stick-qa.md): on llvmpipe WebKit's DMA-BUF renderer shows a frame only when the next input arrives. The helper now turns that renderer off where the boot display has no GPU driver Mesa renders on; the Dell's i915 keeps it, and decides whether it matters there.
- **Found setting up the Dell (2026-10-22):** setup's *Continue* was disabled until the passphrase was strong enough and typed twice, so Tab skipped it and Enter did nothing. It now stays enabled; pressed too early, it says what's missing and puts the caret in that field (`appliance.e2e.ts`). The touchpad's pointer moved but taps didn't click: libinput leaves tapping off on touchpads, and Debian's cage 0.2.0 has no option to turn it on. Pressing the pad down clicks.
- **Version:** the stick 1.0 is the tag `stick-1.0` (app 1.0.0, Debian snapshot 20261021T083704Z), made when the author accepts it.

**Offline rebuild:** A clean checkout of a404084, given only `os/cache/`, built the app from nothing and both images in a network namespace with only `lo` (`os/scripts/rebuild-offline.sh`).

**The author's acceptance check:**
1. Flash the Dell's stick afresh once: `bash os/scripts/flash.sh release` (**this erases the stick's texts**, the last time). The new layout has fixed slots and records the stick in `os/sticks.toml`. Set it up and write something.
2. Rebuild (`pnpm os:build`) and reflash it: `bash os/scripts/flash.sh --update release`. It asks for sudo and the stick's model name. Boot it, unlock it, and check that the text is there.
3. On the Dell, with Secure Boot on: hold a key while it starts (no menu should appear), and try Ctrl+Alt+F2, Alt+SysRq+B and a right-click outside the text (none should do anything). Lock it from the palette, right-click, and check that nothing offers *Reload*.
4. If you like, add the Dell's row in `os/README.md`'s *Tested laptops* from what you see, including whether the first screen paints at once.
5. Read the audit, and accept the stick 1.0. I then tag it `stick-1.0`.

---

## Later (not scheduled; each needs its own short interview first)

- **Animated QR export to the author's phone.** Fountain-coded frames (BC-UR: the `ur` crate for fountain encoding, `qrcode` for frames), from a *Show as QR* command in the Edit menu (`src/core/commands.ts`, `workspace.svelte.ts`). It is one-way and optical, so the offline promise holds. Expected throughput is about 1–3 KB/s; a 50 KB chapter, compressed, takes 10–30 s. A receiver app on the phone decodes and saves Markdown. Stock camera apps can't decode animated QR. Its interview: which phone and OS, whether an existing BC-UR scanner is acceptable, and an integrity check (a hash shown on both sides).
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
