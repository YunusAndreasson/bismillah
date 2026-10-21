# Dell check: what OS-0 still needs from real hardware

One stick, one session, about 15 minutes. It covers everything the VM can't answer:
- **Signed boot:** does it boot with Secure Boot **on**?
- **GPU and display:** does it render on Intel with the NVIDIA card idle and powered down? Is the 4K panel at 2×?
- **Suspend lock:** what shows on a real lid close and open? Does the stick survive resume?
- **Size and boot baseline:** boot stages, unlock time and the stick's read speed.

The image writes everything it measures to `bismillah-report.txt` on the stick's ESP every 20 s. That's names and times only, never document text. Afterwards Claude reads the file from Omarchy.

## The image

`os/spikes/boot/work/img-dell/bismillah-spike-boot.raw`, built with:

```bash
mkosi --profile=app --profile=unlock --profile=nonet --profile=gpu --profile=slim \
      --profile=suspend --profile=dell -O work/img-dell -f build
```

It's the product-like image: no network drivers, GPU firmware, the stripped and zstd-compressed root, and the small initrd. It also has the unlock screen and the sleep daemon. Its ESP keeps the ID `5ef75eba-…`, so the *bismillah* boot entry made in attempt 4 still points at it.

## Steps

1. **Flash** (the script asks which USB disk, and for its model name):
   ```
   ! os/spikes/boot/flash-spike.sh os/spikes/boot/work/img-dell/bismillah-spike-boot.raw
   ```
2. **Secure Boot on:** restart into the firmware (F2), turn Secure Boot **on**, save.
3. **Boot the stick:** F12, then *bismillah* (or the stick's UEFI entry). If it doesn't boot, write down what the screen says and go to step 9.
4. **Set up:**
   - Press Enter on the keyboard layouts (or type yours).
   - Choose a throwaway passphrase, for example `Ward of the night 7`.
   - Type a line of text in the document.
   - Note whether the text is a comfortable size (2×) and whether anything flickered.
5. **Lid:** close the lid, wait 10 s, open it. Note:
   - what appears first and how long until the lock view shows (roughly: instant, about 1 s, longer)
   - **whether any document text showed at any moment**
6. **Unlock:** type the passphrase. The document should come back. Type another line and check that the status says *Saved*. That proves the stick works after resume.
7. **Wait 30 s,** so the report catches the resume. Then press the power button once; logind powers off.
8. **Secure Boot off again** in F2, or Omarchy won't boot.
9. **In Omarchy,** plug the stick in and tell Claude "read the Dell report". Claude mounts the ESP read-only (`udisksctl mount -b /dev/sdX1 -o ro`, no sudo) and reads `bismillah-report.txt`, plus `EFI/Dell/logs/` if the boot failed.

## What the report answers

| Question | Where in the report |
|---|---|
| Secure Boot was really on | `secure boot: 1` |
| Boot stages and the critical chain | `## boot`, `## marks` (`page-gate-shown` = unlock screen painted) |
| *Unlock* → caret on the Dell's CPU (Argon2id) | marks `app-unlock-sent` → `page-editable` |
| cage, the app and WebKit on i915, with render-engine time | `## who uses which GPU` |
| The NVIDIA card left closed and runtime-suspended | `## displays`: the `10de:` device, `runtime=suspended`, `D3cold` |
| Firmware loaded (i915 DMC, GuC/HuC; nouveau's) | `## kernel messages` |
| `deep` or `s2idle` suspend, and what the lid did | `## power`, marks `sleepd-*` |
| The stick after resume: no USB reset errors, no I/O errors | `## kernel messages` |
| Stick read speed (sequential and random 4 KiB) | `## stick` |
| RAM in use after unlock | `## memory` |

## Results

Run by the author on 2026-10-21 with the image above (app at `fb8b9bf`) on the Voyager 3.0 stick. The full report is [`results/dell-check.txt`](results/dell-check.txt). The author checked the screen and reports that it looked right.

| Question | Result |
|---|---|
| Secure Boot on | **Yes.** `secure boot: 1`; shim → systemd-boot → Debian 6.12.113 booted with nothing enrolled. |
| Boot stages | Firmware 11.7 s, loader 1.0 s, kernel 3.3 s, initrd 3.4 s, userspace to `graphical.target` 5.4 s. Unlock screen painted at 20.6 s after kernel start (VM: 11 s), about 33 s from power-on. |
| Where the time goes after switch-root | i915 binds at 10.0 s, cage's session starts at 11.7 s, **the app process starts at 17.4 s** and paints the unlock screen at 20.6 s. The 5.8 s between the session and the app process, and the app's 3.2 s, are cold reads from a slow stick. |
| First-boot setup | Format, open, `mkfs`, mount and the specimen copy: 6.8 s from *Set up* to the answer, then 0.31 s to an editable caret. |
| *Unlock* → caret | **Not measured cold** (the check didn't reboot). The suspend lock's verify, the same 1 s Argon2id slot, took **1.12 s** twice, and the in-process start took 0.31 s, so a cold unlock is about 1.5 s. The next Dell boot measures it. |
| GPU | cage, bismillah and WebKit all render on i915 (`renderD128`, 23.5 s and 15.0 s of render-engine time). No process opens the NVIDIA card. |
| NVIDIA card | nouveau binds it and runtime-suspends it: 119 s suspended and 67 s active. It woke about every 23 s, in step with the report's own 20 s probe (`lspci` reads its config space), so the probe accounts for most of the active time. |
| Firmware | i915 DMC `kbl_dmc_ver1_04` loaded. Kaby Lake doesn't use GuC or HuC by default; nouveau loads none for this card. |
| Suspend | `deep` (S3). Lid closed → lock view painted **31 ms** later, before sleep, both times. Both resumes passed the lock with the passphrase. |
| Lid within 30 s of a resume | Closed 8 s after the first resume, the lid only suspended **16.7 s later**: logind holds off lid events for `HoldoffTimeoutSec=` (30 s) from the previous suspend. The document stayed unlocked behind the closed lid for that time. |
| Stick after resume | Every USB device, the stick included, is reset on resume. No I/O or ext4 errors; the stick kept working. |
| Stick speed | 155 MB/s sequential, **565 random 4 KiB reads/s** (2.2 MiB/s): between our "cheap" (400/s) and "good" (2500/s) profiles. |
| Memory | 978 MiB RSS in the writer's processes (app 508, WebKit 303, cage 89, network process 76); 1.8 GiB used system-wide, including the GPU's buffers. |

