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

*(to be filled in from the report)*
