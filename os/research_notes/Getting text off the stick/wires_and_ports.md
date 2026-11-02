# Wired, port-based and stick-based routes off a bismillah stick (no network, no radio)

Research date: 2026-10-31.

How to read the evidence:

- **Measured here** means I read it from the project's own build tree on 2026-10-31. That covers the cached Debian package `os/cache/mkosi/cache/apt/archives/linux-image-6.12.113+deb13-amd64_6.12.113-1_amd64.deb` (its `boot/config-*` and its module listing) and the built image tree `os/out/contents/release/` (dated 2026-10-29). Module sizes are the packaged `.ko.xz` bytes. Dependencies were not fully resolved, so treat sums as lower bounds.
- **Search summary** means the claim came from a search tool's summary and I did not open the page. Several GitHub, Apple and blog fetches timed out or were refused, and these are marked. Nothing here was tested on a real phone or capture dongle.

## Which routes are most surprising and practical?

### Takeaway
Three routes stand out:

1. **A separate single-partition FAT32 courier stick with both USB-C and USB-A plugs.** It adds no kernel modules and is the only route Apple's own wording clearly allows on an iPhone.
2. **An HDMI capture dongle showing the frames `bismillah-print` already draws.** It adds nothing to the stick and is nearly one-way, but the receiver must be a computer, a USB-C iPad or a compatible Android device, not an iPhone.
3. **A Pico dongle over raw HID.** It adds no kernel modules because `hidraw` and `usbhid` are already present, and it could store text and show up as a small USB drive on the phone side. That second half is my design and is untested.

Typing the text out through a dongle works, but it is only exact for ASCII unless the receiver is prepared. Laptop gadget mode, xHCI debug and bridge cables are effectively dead ends.

### Cited Findings
Route comparison. Stick-side cost is the compressed kernel module bytes to add, from the Debian 6.12.113 package and the image tree ([local: linux-image .deb], [local: os/out/contents/release/]).

| Route | Stick-side kernel cost (measured here) | Hardware price (with date) | iPhone | Android | Rate |
|---|---|---|---|---|---|
| FAT32 courier stick | 0 (`fs/fat` is in the image, 3 files) | Dual-head 64 GB: about $23.50, Amazon listing as of 2026-06-29 ([price history](https://www.pricebefore.com/sandisk-ultra-dual-drive-luxe-type-c-flash-drive-64gb-p484781.html), search summary) | Yes, by [Apple's guide](https://support.apple.com/en-lk/guide/iphone/external-storage-devices-iph95baac91f/16.0/ios) | Yes, by [AOSP vold source](https://android.googlesource.com/platform/system/vold/+/refs/heads/main/model/PublicVolume.cpp) | Far above what text needs |
| Outbox partition on the boot stick | 0 with FAT32; `exfat.ko.xz` is 49,240 B and not in the image | The stick itself | Unclear (single-data-partition rule) | Yes in code (see next section) | Same |
| HDMI capture dongle | 0 | MS2109 class $11; MS2130 $19 on 2022-11-07 ([CNX MS2109](https://cnx-software.com/?p=77825), [CNX MS2130](https://www.cnx-software.com/2022/11/07/ms2130-based-4k-hdmi-to-usb-3-0-video-capture-dongle-sells-for-19/?amp=1)). Old prices. | No UVC (see video section) | Only where the maker enabled it | Hundreds of KB/s claimed in theory; no verified full transfer found |
| Pico raw HID dongle | 0 (`CONFIG_HIDRAW=y`, `usbhid` in image) | Pico at 3.48 EUR net ([TME](https://www.tme.eu/dk/en/details/sc0915/raspberry-pi-embedded/raspberry-pi/raspberry-pi-pico/), undated, search summary) | As a typing keyboard; as a drive untested | Same | 64 KB/s ceiling at full speed |
| USB serial pair | `usbserial` 25,612 + `ftdi_sio` 23,312 B, or + `ch341` 9,900 B, or `cdc-acm` 20,132 B alone | Not found | No evidence | Not established | 11.5 KB/s at 115200 8N1 (arithmetic) |
| Raw printer | `usblp` 12,148 B | Not found | n/a | n/a | n/a |
| SD slot (PCI reader) | at least 192,912 B (`mmc_core`, `mmc_block`, `sdhci`, `sdhci-pci`) | Not found | Through a USB reader (inference) | Through a USB reader (inference) | As a stick |
| Laptop as USB gadget | at least 158,676 B (`dwc3`, `dwc3-pci`, `libcomposite`, `usb_f_mass_storage`) | A-to-A or C cable | Would look like a drive | Would look like a drive | Rare hardware |

The project's plan already has related items:

- It expects about 1 to 3 KB/s for camera QR ([local: os/PLAN.md line 881]).
- It lists encrypted backup to an allow-listed second stick ([local: os/PLAN.md line 885]).
- It excludes all networking, including USB tethering ([local: os/PLAN.md line 891]).
- It keeps QR output-only with no camera drivers on the stick ([local: os/PLAN.md line 892]).
- The uncommitted `crates/bismillah-print` crate builds fountain-coded QR frames for "Print to Phone (ADR-0021)" ([local: crates/bismillah-print/Cargo.toml]).

### Inferences
- **Suggested order:** courier stick first (cheapest and most universal), then the same frames over a capture dongle as a no-camera variant, then a Pico dongle only if a writer wants something with no drive at all.
- Kernel cost barely separates these routes, since every option is under 200 KB. The real differences are phone compatibility, what data stays on the stick unencrypted, and what new attack surface the helper must police.

### Gaps
- No route here was tested on hardware for this note. The first tests worth running are in the next section's Gaps.
- Current 2026 prices for capture dongles, FTDI cables, PL27A1 cables and 58 mm printers were not found.

## The stick as courier: outbox partitions, phones, reading LUKS, and a decryptor on the stick

### Takeaway
iPhones and Android both read FAT32 and exFAT. Android's mount code should happily find a FAT outbox among other partitions, but Apple documents "a single data partition", so same-stick outbox on iPhone must be tested before anyone relies on it. Reading LUKS directly is impossible from iOS or a web page and only partly possible on Android. A static HTML decryptor is weak on iPhone and, stored outside dm-verity, is not trustworthy as the only reader.

### Cited Findings
**iPhone**
- Apple's guide (iOS 16-era page, search summary) says an external device must have only a single data partition, formatted as APFS, APFS (encrypted), macOS Extended (HFS+), exFAT, FAT32 or FAT — [Apple iPhone User Guide](https://support.apple.com/en-lk/guide/iphone/external-storage-devices-iph95baac91f/16.0/ios). The current-version page [timed out](https://support.apple.com/guide/iphone/external-storage-devices-iph95baac91f/ios), so iOS 26/27 wording is unconfirmed.
- A community answer on Apple's forum says multiple data partitions and NTFS are not supported — [Apple Discussions](https://discussions.apple.com/thread/254827655) (search summary; not an official statement).
- iOS 18 added formatting of external drives in Files (APFS, exFAT, MS-DOS FAT) — [GSMArena](https://m.gsmarena.com/ios_18_and_ipados_18_support_external_drive_formatting-amp-63412.php).
- Apple's guide says hard drives often need external power, and a powered hub can be used on USB-C iPhones — [Apple iPhone User Guide](https://support.apple.com/en-lk/guide/iphone/external-storage-devices-iph95baac91f/16.0/ios). An iOS 13 review said an iPhone needed the drive externally powered, a Lightning-era claim — [MacStories](https://www.macstories.net/stories/ios-and-ipados-13-the-macstories-review/7).
- Third-party iOS apps reach a drive only through files or folders the user picks; there is no way to partition or view the partition map on the device — [MacStories](https://www.macstories.net/stories/ios-and-ipados-13-the-macstories-review/7).

**Android**
- AOSP `Disk.cpp` creates a public volume for each GPT partition with the Basic Data GUID `EBD0A0A2-B9E5-4433-87C0-68B6B72699C7`, and for MBR types 0x06, 0x07, 0x0b, 0x0c, 0x0e. Other GPT types are ignored, except the Android expand GUID (private volume). If nothing matches, it tries the whole device — [AOSP vold Disk.cpp](https://android.googlesource.com/platform/system/vold/+/refs/heads/main/model/Disk.cpp).
- `PublicVolume::doMount` accepts only `vfat` and `exfat` (each if supported on the device) and fails anything else with `-EIO`. NTFS is absent from that file — [AOSP vold PublicVolume.cpp](https://android.googlesource.com/platform/system/vold/+/refs/heads/main/model/PublicVolume.cpp).
- exFAT is not universal. Native support arrived on Pixels with Android 13, and one test found Pixel 6 Pro and 6a recognised exFAT while Pixel 5 and 5a still asked to format — [Android Police](https://www.androidpolice.com/pixel-android-13-exfat-support-history/), [Esper](https://www.esper.io/blog/android-dessert-bites-27-exfat-on-pixel-532176849) (search summary). Samsung and other makers had used exFAT for years — same sources.

**Dual-head sticks**
- SanDisk Ultra Dual Drive Luxe USB-C/USB-A, 64 GB: about $23.50 on a US Amazon listing as of 2026-06-29, €22.00 at one European retailer, undated — [price history](https://www.pricebefore.com/sandisk-ultra-dual-drive-luxe-type-c-flash-drive-64gb-p484781.html), [ProductChart](https://www.productchart.com/flashdrives/similar_to_48028) (search summaries; retailer attribution not opened).

**Stick side (measured here)**
- `vfat.ko.xz` (12,324 B) is in the image; `exfat.ko.xz` (49,240 B) is in the Debian package but not the image. `CONFIG_VFAT_FS=m`, `CONFIG_EXFAT_FS=m` — [local: Debian 6.12.113 config and image tree].

**Reading LUKS directly**
- WebUSB blocks claiming mass-storage interfaces (class 0x08), throwing SecurityError — [Chromium test](https://chromium.googlesource.com/chromium/src/+/80bb4f04ec77b8cba2067f8dab8121cb0b6be9b8/third_party/blink/web_tests/usb/protected-interface-classes.html). The stated reason is that low-level access would bypass permissions — [WICG explainer](https://github.com/WICG/webusb/blob/main/unrestricted-usb-explainer.md).
- The exception is Isolated Web Apps with `usb-unrestricted` permission, not an ordinary page — [Chromium Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/hXgwRCYta-k/m/NsLkciF1BwAJ).
- Android: Vault Explorer (F-Droid/IzzyOnDroid, GPL-3.0-or-later) lists LUKS plus VeraCrypt, BitLocker and others, with ext2/3/4 and FAT/exFAT inside. The page doesn't say which LUKS version, whether Argon2 is handled, or whether it opens raw USB partitions — [IzzyOnDroid](https://apt.izzysoft.de/fdroid/index/apk/com.aeidolon.vaultexplorer?repo=main). That page shows v1.37.2 dated 2026-10-27; an F-Droid search snippet showed [v1.4.0](https://f-droid.org/hu/packages/com.aeidolon.vaultexplorer/). The sources conflict, so check the live listing.
- Android: OTG Master reads raw sectors through the USB Host API, unlocks VeraCrypt only, and mounts only FAT32/exFAT — [F-Droid](https://f-droid.org/packages/app.fayaz.otgmaster/) (search summary).
- SecureDrop's documentation treats LUKS transfer devices as Linux-only and recommends VeraCrypt for cross-platform export — [SecureDrop docs](https://docs.securedrop.org/en/stable/set_up_transfer_and_export_device.html) (search summary).
- No iOS app opening LUKS appeared in searches (absence of results, not proof).

**A decryptor stored on the stick**
- MDN says `file:` URLs are potentially trustworthy, so a top-level `file:///` document is a secure context — [MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). StatiCrypt 3.5.4's package notes say WebCrypto needs HTTPS or localhost, which reads differently and should be tested — [StatiCrypt package](https://cdn.jsdelivr.net/npm/staticrypt@3.5.4/package.json) (search summary).
- StatiCrypt encrypts with AES-256 in CBC mode, is a static page with a password prompt, and advises 16+ character passwords — [StatiCrypt](https://github.com/robinmoisson/staticrypt/) (search summary).
- On iOS, forum reports say Quick Look does not run JavaScript and that Safari stopped opening local files via Shortcuts after iOS 14 — [MacPowerUsers](https://talk.macpowerusers.com/t/in-search-of-an-app-on-ipad-to-show-html-file-directly-from-shortcuts/28128), [MacPowerUsers](https://talk.macpowerusers.com/t/issue-showing-a-local-html-file-in-safari-ios-14/19778). These are anecdotal and old.

### Inferences
- **Same-stick outbox:** on Android, a FAT32 partition typed Basic Data should mount while the ESP, verity and LUKS partitions are ignored by GUID, assuming those use their own type GUIDs (I did not read the stick's repart definitions).
- **iOS:** Mac-formatted GPT drives carry an EFI partition and iOS reads them, which suggests non-data partitions are tolerated. That is reasoning, not documentation. Whether LUKS and verity partitions count as "data", and whether a FAT outbox after them is found, is unknown.
- **FAT32 over exFAT** for text: it costs no new module, works on older Pixels, and the 4 GB limit is irrelevant to documents. Arabic filenames rely on long file names, so mount options need checking (`/fs/nls/` is in the kernel module list, [local: os/mkosi/mkosi.conf]).
- **A plaintext outbox on the boot stick weakens the encrypted home.** A lost stick leaks whatever is in the outbox. A separate courier stick keeps that exposure on a device the writer can empty or leave at home, so it is the safer default. A same-stick outbox would need clearing on eject, or encrypted exports.
- **Is it safe for the stick to carry its own reader?** Only as a convenience, for three reasons:
  - The ESP and outbox are outside dm-verity, so anyone who holds the stick can swap the HTML and capture the passphrase on next use.
  - The reader runs on a host the appliance cannot vouch for, and the plaintext ends up there anyway.
  - The LUKS passphrase should never be typed there.
- **A sounder encrypted variant:** the appliance writes one encrypted file per export to FAT and shows a random one-time code on its own screen. The home passphrase stays out of it, and the outbox contains no reader that needs trusting. The reader lives on the receiving device, as an installed app or a known-good copy. An authenticated cipher should be preferred to CBC.

### Gaps
- **The key test, needing a real iPhone and Android phone:** make a GPT stick with ESP, verity, LUKS and a FAT32 Basic Data partition, and see whether Files shows it. I found no report covering this layout.
- iPhone USB-C power budget for sticks: the 4.5 W figure in my search was not confirmed by any result.
- Whether the File System Access API can open a raw block device: no source found. I found nothing suggesting it can.
- Whether Vault Explorer handles LUKS2 with Argon2id on a phone's memory, or a partition rather than a container file: its page doesn't say, and it would need a device test.
- `age`/`typage` or Argon2 WASM in a local page: searches returned nothing usable.
- Android Chrome's behaviour on a local HTML file from USB storage: no source found.

## Video output as a one-way wire

### Takeaway
A $11 to $19 capture dongle makes HDMI into an almost one-way wire with no change to the stick, and hobby projects show the method can work. Published rates are mostly theoretical, though, and the one detailed author's account shows a small transfer succeeding and a large one failing. iPad and some Android devices can take UVC input; iPhone cannot. DDC/EDID are poor side channels.

### Cited Findings
**Throughput: separated by evidence**
- *Claimed/theoretical:* `hdmiFileTransfer` uses 720p at 5 fps with 1 pixel per bit, no redundancy: about 110 KB per frame, about 550 KB/s. The author excludes overhead, reports no benchmarks, and calls it fragile. It uses an MS2130 or MS2109 dongle, recorded with ffmpeg — [hdmiFileTransfer](https://github.com/yesyesno8/hdmiFileTransfer). The project also pitches itself as a way past corporate monitoring (BitLocker and DLP), a framing that doesn't apply to a writer's own text.
- *Author-run tests, Patrick Desjardins, part 7:* 1920×1080 at 1 pixel per bit, capture at 30 fps, encode at 15 fps, 64-bit header per frame, video looped to recover frames. A small file of about 2 MB extracted correctly through a raw (copy) capture. Transcoding to H.264 slowed extraction and added decode errors. A 54 MB zip **failed**: 1.55 MB, or 6 frames, received across both a 328 MB and an 850 MB capture. The cause is suspected to be playback frame drops on the sending laptop and is unconfirmed — [Desjardins blog](https://patrickdesjardins.com/blog/how-to-transfer-files-between-computers-using-HDMI-Part-7-pagination). The frame capacity (about 259 KB) is derived.
- *Raw capture rate, not payload:* one 1080p60 capture logger recorded 14.5 to 19 MB/s of MJPEG with live video, and about 10.6 MB/s for a sparse desktop — [hdmi_capture](https://github.com/kchellappan/hdmi_capture) (search summary; attribution to this repo unverified).
- *Another hobby project* uses 4 frames/s at the output with a faster capture, and describes itself as for amusement — [Transfer-Data-Through-HDMI](https://github.com/zhaouv/Transfer-Data-Through-HDMI) (search summary; fetch timed out).
- *For comparison, optical screen-to-camera:* `qrdrop` reports about 6 kB/s at about 10 frames/s with a 1 MiB cap, and 2.08×N frames needed at 30% loss with a fountain code, against 10.7×N for a numbered loop — [qrdrop](https://github.com/stan-ely/qrdrop/releases/tag/v0.2.0) (project's own claim). The plan expects 1 to 3 KB/s for its own QR export ([local: os/PLAN.md line 881]).

**Dongles**
- MS2109: USB 2, MJPEG and chroma subsampling hurt fine text; capture up to 1080p — [Lovin HN mirror](https://brianlovin.com/hn/30906127) (comment, search summary). One user saw 5 fps at 1080p in YUY2 — [Cinelerra list](https://lists.cinelerra-gg.org/pipermail/cin/2023-February/006340.html) (search summary).
- MS2130: 1080p60 YUY2 (uncompressed 4:2:2), needs a real 5 Gb/s USB port or it falls back to USB 2 quality — [CNX](https://www.cnx-software.com/2022/11/07/ms2130-based-4k-hdmi-to-usb-3-0-video-capture-dongle-sells-for-19/?amp=1), [HyperHDR discussion](https://github.com/awawa-dev/HyperHDR/discussions/499) (search summaries).

**Receivers**
- iPad: iPadOS 17 and later on USB-C support UVC capture with apps including CapView (free) and VisionRelay — [CapView](https://apps.apple.com/us/app/capview-capture-monitor/id6475328492?uo=4), [VisionRelay](https://apps.apple.com/us/app/id6746391056), [ITmedia test](https://www.itmedia.co.jp/pcuser/spv/2309/21/news126_2.html).
- iPhone: developers report `AVCaptureDevice` finds no external devices on iPhone though it does on iPad, and an Apple engineer notes the iOS 17 symbol doesn't mean all devices support it — [Apple forums](https://developer.apple.com/forums/thread/775883), [Apple forums](https://developer.apple.com/forums/thread/776912), [Apple forums](https://developer.apple.com/forums/thread/780200) (search summary). No official iOS 26 statement found.
- Android: external UVC is a device-maker choice requiring `android.hardware.usb.host`, kernel UVC, the provider library and a manifest entry. The page says it isn't aimed at high-resolution or high-speed streaming — [AOSP](https://source.android.com/docs/core/camera/external-usb-cameras).

**DDC / EDID**
- DDC runs at 100 kHz or below, about 90 to 100 µs per byte, so about 10 KB/s raw — [sun4i DDC patch](https://lkml.iu.edu/hypermail/linux/kernel/1707.0/00166.html). DDC lines can be used as an I2C bus through i2c-dev — same source. `CONFIG_I2C_CHARDEV=m` and `CONFIG_DRM_DISPLAY_DP_AUX_CHARDEV=y` in the Debian kernel — [local: Debian 6.12.113 config].

### Inferences
- **Reuse the existing frames.** `bismillah-print` already draws fountain-coded frames, and a capture path removes focus, glare and framing problems, so denser or faster frames than a camera tolerates should decode. Rate needs measuring.
- **A plausible design target, my arithmetic only:** 1080p with 8×8-pixel luma cells is 240×135 = 32,400 bits, about 4 KB per frame. At 15 fps that's about 60 KB/s raw, or 30 KB/s after 50% fountain/FEC overhead. A 100 KB chapter would take a few seconds. Cells this large should survive MJPEG, and using luma only sidesteps chroma subsampling. The 550 KB/s claim isn't a sensible design target given the fragility above.
- **Fountain codes fit this link** because frame drops, not bit errors, were the failure seen in the Desjardins tests.
- **Nearly one-way, not strictly.** The dongle's EDID is read and parsed by the laptop, and hot-plug is signalled back. The return path is small, but a hostile dongle is not ruled out. It's still a much smaller surface than USB.
- **The receiver stays open.** A decoder is needed on the receiving side: a desktop tool, an iPad app or a local page. Video apps like CapView only display.
- **DDC is the wrong tool.** EDID flows sink to source, the opposite way, and DDC/CI writes would need a custom I2C receiver on the far end. Useful only as a curiosity.

### Gaps
- No measured, end-to-end, verified throughput for coded frames through an MJPEG dongle was found. This needs a bench test, ideally with both MS2109 and MS2130.
- Whether the stick's compositor (cage on wlroots) mirrors to an HDMI dongle on hotplug, and whether USB-C DisplayPort works given that the image has no `drivers/usb/typec` modules (0 files, measured here), was not checked. Many laptops may do DP alt mode in firmware, but I have no source for that.
- HDMI CEC throughput and commercial "video diode" products: nothing found.
- Whether Safari on iPad exposes a UVC device to `getUserMedia`: not found.

## HID-class dongles

### Takeaway
Raw HID needs no new kernel code on the stick and tops out around 64 KB/s at full speed, plenty for text. Sending out as typed keystrokes is proven (AlphaSmart) but slow, about 100 characters per second at best, and is exact only for characters the receiver's layout can produce. Arabic with marks is the hard case, so exact delivery needs a file route or an ASCII armour the receiver decodes.

### Cited Findings
**Stick side (measured here)**
- `CONFIG_HIDRAW=y`, `CONFIG_USB_HID=m`, `CONFIG_USB_HIDDEV=y`; `drivers/hid/usbhid` is in the image, and `/drivers/hid/` is in the kernel module list — [local: Debian 6.12.113 config, os/mkosi/mkosi.conf, image tree].

**Throughput**
- Spec ceiling: PJRC says Raw HID sends up to 1000 packets/s each way with 64-byte packets by default, with bandwidth reserved by the host controller — [PJRC](https://www.pjrc.com/teensy/rawhid.html). This means 64 KB/s.
- Measured, forum, Teensy 3.2 with PyUSB: about 15 µs/byte, about 67 kB/s — [PJRC forum](https://forum.pjrc.com/threads/67860-RAHID-performance?p=285043) (search summary).
- Measured, forum, Windows C# test at 125 µs intervals: 501.3 kB/s, target 500 kB/s, in a high-speed-style setup — [PJRC forum](https://forum.pjrc.com/threads/63948-USB-2-0-Teensy-port-at-8000-Hz-poll-rate?p=256576) (search summary; device speed unconfirmed).
- RP2040's native USB is full speed, 12 Mbps — [element14 thread](https://community.element14.com/products/raspberry-pi/f/forum/52439/raspberry-pi-pico-device-msc-increase-size) (search summary). A Pico-based host MSC demo reports a bit under 64 KB/s — [pico-usb-host-msc-demo](https://www.github.com/rppicomidi/pico-usb-host-msc-demo).
- No RP2040 raw HID benchmark was found.

**Precedent: AlphaSmart Neo "Send"**
- It appears as a plain USB keyboard and streams text into the open document as keystrokes, so accented characters go as keystrokes too — [Wikipedia](https://en.wikipedia.org/wiki/AlphaSmart), [Hackaday teardown](https://hackaday.com/2020/11/05/alphasmart-neo-teardown-this-is-the-way-to-write-without-distractions/) (search summaries).
- Speed is anecdotal: about 20 to 30 seconds per page from one reviewer, and about 1000 words per minute at the fastest setting from one Mac user (about 80 to 100 characters/s, converted) — [David Gerard](https://davidgerard.co.uk/blockchain/2019/04/14/the-alphasmart-neo-2-keyboard-for-writing-without-twitter/), [Literature & Latte forum](https://forum.literatureandlatte.com/t/inexpensive-laptop-substitute/3418) (search summary; which source said which was not confirmed).

**Unicode and Arabic typing**
- QMK's docs say Unicode input has no cross-OS standard and needs setup on host and firmware. Linux: Ctrl+Shift+U, hex, Space (IBus). macOS: Unicode Hex Input source, which can disable Option shortcuts, all code points. Windows: WinCompose, or the HexNumpad mode. Android and iOS are not covered — [QMK Unicode](https://docs.qmk.fm/features/unicode).
- Windows hex Alt input needs a registry key, per one reference page — [Shapecatcher](https://shapecatcher.com/unicode/info/1633) (search summary).
- iOS hardware layouts are chosen per keyboard, with "Arabic PC" recommended by one forum answer, and misplaced letters reported on iOS 17 despite the correct layout — [Apple Discussions](https://discussions.apple.com/thread/252884055), [AppleVis](https://applevis.com/comment/160672) (search summaries).

**Dongle hardware**
- Raspberry Pi Pico: 3.48 EUR net at TME (undated); lowest of 14 retailers listed as $6.00, updated 2026-09-29, on an Australian comparison site, so probably AUD — [TME](https://www.tme.eu/dk/en/details/sc0915/raspberry-pi-embedded/raspberry-pi/raspberry-pi-pico/), [BuyWisely](https://buywisely.com.au/product/raspberry-pi-pico-22aj1097) (search summaries).
- A Pico can act as a mass storage device on its default flash; backing it with an SD card takes custom code — [element14 thread](https://community.element14.com/products/raspberry-pi/f/forum/52439/raspberry-pi-pico-device-msc-increase-size) (search summary).

### Inferences
- **Scope note:** this covers the writer's own text typed into their own device. Attack-oriented uses of such devices were deliberately left out.
- **Rate in practice:** keystrokes need press and release reports. Neo-like speed (about 100 characters/s) puts a 30,000-character chapter at about 5 minutes.
- **What exact means here:** a keyboard sends key positions, not characters, so the receiver's layout decides what comes out. Vocalised Arabic and Qur'anic marks may have no key on a given layout, and hex-entry modes need host setup, with none known on iOS. Receiver autocorrect and smart punctuation can also change the text, which would break the "save exactly" spirit. So:
  - Plain Latin text can be typed exactly into a prepared receiver, with autocorrect off.
  - For exact Arabic, type ASCII armour (for example, base64 plus a checksum) into a decoder on the receiver, or avoid typing altogether.
- **The most interesting build, my design and untested: "HID in, drive out".** The dongle is raw HID towards the stick (no new driver) and a small FAT mass-storage device towards the phone or computer (no app). A text-sized 2 MB flash store is enough for many chapters. It also never exposes a filesystem to the appliance, so the helper parses no foreign filesystem from this device.
- **Use a non-radio board.** A plain Pico, not a Pico W, keeps the no-radio promise.
- **The helper should allow one dongle identity for this.** A dongle could also claim to be a keyboard, which the appliance accepts by design, so firmware provenance matters. Prefer one the writer flashed, and tie it to the planned USB rules ([local: os/PLAN.md line 885]).
- Raw HID over LED reports: 64-byte reports make LED-based signalling pointless here.

### Gaps
- Whether iOS mounts a full-speed RP2040 mass-storage device, and whether Android does: no test found. The device must be bench-tested with real phones.
- iOS has no known Unicode hex-entry mode for hardware keyboards: I found no source either way.
- Whether Android's physical-keyboard Arabic layouts include tashkil: no source found.
- Off-the-shelf products doing this for writers: none found.

## USB device mode and host-to-host cables

### Takeaway
Debian's signed kernel builds gadget support, so the kernel is not the blocker. Hardware is: most PCs are host-only, and where an Intel xDCI exists firmware often leaves it off. It can't be a general route for "arbitrary PC laptops". xHCI debug is switched off in Debian. Prolific bridge cables are networking by driver and by the project's own rules. A null-modem serial pair isn't networking but requires serial drivers and awkward phone support.

### Cited Findings
**Kernel (measured here from the Debian 6.12.113 package config)**
- Enabled as modules: `CONFIG_USB_GADGET=m`, `CONFIG_USB_CONFIGFS=m`, `CONFIG_USB_CONFIGFS_F_HID=y`, `CONFIG_USB_LIBCOMPOSITE=m`, `CONFIG_USB_DWC3=m`, `CONFIG_USB_DWC3_DUAL_ROLE=y`, `CONFIG_USB_DWC3_PCI=m`, `CONFIG_USB_ROLE_SWITCH=m`, `CONFIG_TYPEC_UCSI=m`, `CONFIG_UCSI_ACPI=m`, plus `g_mass_storage`, `g_serial`, `g_ether` and `usb_f_hid` modules in the package.
- `# CONFIG_USB_XHCI_DBGCAP is not set`, and `# CONFIG_USB_CDNS_SUPPORT is not set`.
- `CONFIG_LOCK_DOWN_IN_EFI_SECURE_BOOT=y`.
- The image's kernel module list excludes `-/drivers/usb/gadget/` and has 0 files in `drivers/usb/gadget`, `dwc3` and `typec` — [local: os/mkosi/mkosi.conf, image tree].

**Hardware**
- "Most PCs support USB host mode exclusively" — [Toradex](https://developer.toradex.com/linux-bsp/how-to/peripheral-access/usb-device-mode-linux) (search summary).
- ThinkPad X1 Carbon 6th gen: xDCI present but disabled with no UEFI option. The author got device mode only with hacking and a custom A-to-A cable — [Hackster on Konovalov](https://hackster.io/news/andrey-konovalov-turns-a-hacked-lenovo-thinkpad-laptop-into-a-flexible-usb-device-emulator-1e60af0efa86) (search summary; fetch returned 403).
- Coreboot code shows xDCI often gated by firmware and boot mode — [coreboot commit](https://forge.a-lec.org/GNUBoot/coreboot-kgpe-d16/commit/f5116952bb77ac361ad541dea00d9df28067219e) (search summary).
- Tiger Lake has a `dwc3-pci` ID (8086:9a15). Some parts split into a USB3-only CPU controller and a USB2-only PCH controller — [LKDDb](https://cateee.net/lkddb/web-lkddb/USB_DWC3_PCI.html), [LKML patch](https://lkml.iu.edu/hypermail/linux/kernel/2101.1/08764.html). An open Chromebook-forum question about gadget on Tiger Lake has no working answer — [Chrultrabook forum](https://forum.chrultrabook.com/t/xdci-drd-usb-gadget-on-voxel-tgl/3858).

**xHCI debug**
- DbC needs `USB_XHCI_DBGCAP`, a sysfs enable and a USB 3 A-to-A debug cable; the far side sees a USB debug device and `/dev/ttyUSB0` — [kernel docs](https://docs.kernel.org/driver-api/usb/usb3-debug-port.html). Debian leaves that option off (above).

**Bridge cables**
- `plusb` covers Prolific PL-2301/2302/25A1/27A1 and lives in `drivers/net/usb`. Its comments warn that unplugging confuses it and it can wedge under load — [plusb.c](https://git.zx2c4.com/wireguard-linux/tree/drivers/net/usb/plusb.c) (search summary). `CONFIG_USB_NET_PLUSB=m`, `CONFIG_USB_USBNET=m` — [local: config].

**Serial (measured sizes)**
- `usbserial` 25,612 B; `ftdi_sio` 23,312 B; `cp210x` 15,584 B; `ch341` 9,900 B; `pl2303` 12,544 B; `cdc-acm` 20,132 B. All are modules in Debian, none in the image — [local: package listing and image tree].

### Inferences
- **Gadget mode is a nice-to-have at most.** It would be elegant, since `g_mass_storage` would make the laptop look like a drive to a phone. Without a firmware switch and a hack, though, it won't work on most machines, and hacks conflict with the appliance's "laptop left untouched" rule.
- **xHCI DbC is closed:** enabling it needs a custom kernel, which would lose Debian's signature under Secure Boot.
- **Plusb is networking.** It makes a network interface through usbnet, which the image's no-USB-net rule and test forbid ([local: os/mkosi/mkosi.conf lines 94 to 96, os/PLAN.md line 891]). I would rule it out, not just discourage it.
- **A null-modem serial pair** is a byte stream with no network stack, which stays within the rule as long as the image has no PPP or SLIP. It's a usable but dull route for computer-to-computer use. 115200 8N1 gives about 11.5 KB/s (arithmetic), more than enough for text.

### Gaps
- How many laptops can do device mode: no survey found. "Rare" rests on one vendor's statement and individual reports.
- UCSI data-role swap to device on laptop firmware: nothing found.
- Whether the Debian modules' signatures allow all these to load under lockdown: `modinfo` signatures weren't checked, though they ship in the signed image package name.
- FTDI cable speeds and prices: search returned nothing. Android USB-serial without an app, and iPhone USB-serial: no sources found.

## Hardware data diodes

### Takeaway
Commercial diodes cost from five figures to six and are built for industrial networks, so they aren't relevant here. A DIY optocoupler on a UART is cheap and truly one-way, but a plain optocoupler limits speed. Text needs little speed, though: a slow rate would still move a chapter in under a minute.

### Cited Findings
- A Forcepoint data diode appliance was listed at $82,293.74, marked discontinued 2025-05-10 — [CDW](https://cdwg.com/product/forcepoint-data-diode-security-appliance/6716839) (search summary). An industry article says prices can reach six digits — [Smart Industry](https://www.smartindustry.com/articles/2021/dispelling-the-top-3-myths-about-data-diodes/) (search summary).
- OPSWAT's Fend is pitched as lower cost, with no price found — [OPSWAT](https://www.opswat.com/blog/data-diodes-delivering-air-gap-security-at-a-fraction-of-the-cost).
- DIY precedent: DYODE, a 2017 Wavestone talk, using copper-optical converters — [BruCON slides](https://files.brucon.org/2017/011_Arnaud_Soullier_Wavestone.pdf).
- TI: optocouplers are common for UART isolation, but their load resistor and phototransistor capacitance limit speed. A capacitor across the resistor sharpens edges, and push-pull parts are faster — [TI SLLA522](https://ti.com/lit/SLLA522).
- One forum builder saw garbage at 9600 and 115200 baud with a slow optocoupler and success below that — [Arduino forum](https://forum.arduino.cc/t/making-an-usb-ttl-using-opto-coupler/90709) (anecdote; the summary's wording is unclear about the exact working rate).
- A one-way UART wire protocol exists in Python — [data-diode on PyPI](https://pypi.org/project/data-diode).

### Inferences
- **Build sketch:** USB-UART adapter on the laptop (35 to 49 KB of modules), TX through an optocoupler or digital isolator, into a USB-UART or Pico on the receiver, with fountain or repeat coding because no acknowledgement can return. At 9600 baud (about 960 B/s) a 30,000-byte chapter takes about 31 seconds of clean transmission, so a slow part is acceptable for text.
- **What it adds:** a physical guarantee that the receiver can't reach the stick. But a Pico dongle or HDMI link is simpler for most writers, and the guarantee only matters if the receiver is the threat. For this product, it suits a small kit, not a mainstream route.

### Gaps
- No measured throughput for a complete DIY build found. No Owl or Advenica prices found. No Pico-based diode design found.

## Printers from an appliance with no CUPS

### Takeaway
Raw USB printing is tiny: 12 KB of kernel for `usblp`, with no spooler. A 58 mm thermal printer accepts raster data directly, which lets the webview's own Arabic shaping survive. IPP over USB needs a daemon, Avahi and HTTP, so it clashes with the appliance's design unless written natively.

### Cited Findings
- `usblp.ko.xz` is 12,148 B, `CONFIG_USB_PRINTER=m`, and `drivers/usb/class` has 0 files in the image — [local: package and image tree].
- Debian trixie packages, for scale: `ipp-usb` installed size 6,522 KB, `cups-filters` 1,911 KB, `cups` 1,102 KB, before dependencies — [local: os/cache apt Packages list dated 2026-10-21].
- Plain writes to `/dev/usb/lp0` work with ESC/POS once CUPS isn't holding the device — [escpos-php](https://github.com/f/escpos-php), [NixOS Discourse](https://discourse.nixos.org/t/problem-with-dev-usb-lp0/76634).
- 58 mm printers accept images up to 384 dots wide via `GS v 0`, though at least one printer uses another command set — [scruss.com](https://scruss.com/blog/tag/thermal/) (search summary). One library marks `GS v 0` as obsolete — [esc_pos_gen](https://pub.dev/documentation/esc_pos_gen/latest/esc_pos_gen/PosImage-class.html).
- A Kurdish/Arabic ESC/POS library shapes text itself and targets `/dev/usb/lp0` — [kurdish-escpos](https://packagist.org/packages/rawand201/kurdish-escpos).
- ipp-usb is an HTTP reverse proxy over IPP-over-USB for devices with interface class 7/1/4, requiring libusb, Avahi libraries and a running Avahi daemon, with loopback the default exposure — [ipp-usb](https://github.com/OpenPrinting/ipp-usb).

### Inferences
- **Paper is the most honest one-way output.** Raster keeps Arabic correct on the page, because the app renders it and the printer only sees dots. It can't reproduce the bytes for later editing, so it suits reading drafts, not moving a document. It could print a QR sequence, but a screen does that better.
- **The app needs a rasteriser** from the webview's output to 1-bit, plus a helper-owned write to the `usblp` node.
- **Full-size printers:** a small native IPP-over-USB client in the helper (no Avahi, no TCP) seems possible but adds an HTTP-speaking parser facing a device. I wouldn't build it first.

### Gaps
- Whether ordinary laser printers accept PDF or PostScript directly over `usblp`: no source retrieved. Likely model-dependent.
- Thermal printer price and print speed: not found. Arabic code pages on printers: not found; rasterising avoids the question.

## Other media: microSD and SD with a phone adapter

### Takeaway
A USB-attached card reader is just another courier stick, needing no new drivers. A built-in laptop slot may need about 193 KB or more of MMC modules that the image lacks today, and wouldn't reach a phone without an adapter anyway.

### Cited Findings
- `drivers/mmc` has 0 files in the image. Package sizes: `mmc_core` 88,376 B, `mmc_block` 29,720 B, `sdhci` 37,200 B, `sdhci-pci` 37,616 B, `rtsx_pci_sdmmc` 17,132 B. `CONFIG_MMC=m`, `CONFIG_MMC_SDHCI_PCI=m`, `CONFIG_MMC_REALTEK_PCI=m`, `CONFIG_MMC_REALTEK_USB=m` — [local: package and image tree].
- USB storage drivers are in the image, per `/drivers/usb/storage/` in the kernel module list — [local: os/mkosi/mkosi.conf].
- Apple's formats and single-partition rule apply to external storage devices generally — [Apple iPhone User Guide](https://support.apple.com/en-lk/guide/iphone/external-storage-devices-iph95baac91f/16.0/ios). AOSP's checks are the same for any public volume — [AOSP vold](https://android.googlesource.com/platform/system/vold/+/refs/heads/main/model/Disk.cpp).

### Inferences
- A microSD card in a USB-C reader behaves like the courier stick. It's small and cheap and hides easily, but it adds one small adapter to lose. A dual-head stick is simpler.
- Internal slots are a poor fit for an appliance meant for arbitrary laptops: many machines lack one, and PCIe readers need vendor-specific modules.

### Gaps
- Share of laptops with USB-attached vs PCIe readers: not found.
- Factory formats (microSDXC often ships exFAT) and specific reader compatibility with iPhone: not sourced. A courier card would need formatting FAT32 by the helper or by Files.
- Side note from the image tree, outside this scope: `modules.dep` in `os/out/contents/release/` lists 4,230 modules, including `plusb`, while 896 `.ko` files actually exist. The missing files can't load, but anyone auditing that list should know it overstates what's shipped.
