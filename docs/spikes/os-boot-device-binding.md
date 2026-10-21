# OS-0 spike: boot-device binding

**Question** (os/PLAN.md, OS-0): can the helper identify *its own* home partition with no labels? The method:
1. Find the disk holding the dm-verity root, from the device-mapper table.
2. Cross-check it against systemd-boot's `LoaderDevicePartUUID`.
3. Take the home GPT type on that same disk.

It must hold with two bismillah sticks attached and with duplicate labels.

**Verdict: go, with one change to the plan.** The lookup picks the right partition with a decoy `bismillah-home` on the laptop disk, and with a second stick from another build. With **two sticks of the same build**, though, the running system came from the stick the firmware did *not* boot. The lookup saw that and **refused**, which is what the acceptance asks for. It can only refuse there, never choose, so the real Unlock screen needs a "remove the other stick" message.

## The lookup

`os/spikes/boot/mkosi.profiles/bindcheck/mkosi.extra/usr/libexec/bismillah-find-home`, about 30 lines of shell for OS-2's Rust helper to port:

1. **Root disk:** the disk under the device-mapper device mounted at `/`. It reads `/sys/class/block/dm-N/slaves`, which lists the verity data and hash partitions, and both must be on one disk.
2. **Loader disk:** reads `LoaderDevicePartUUID`, which systemd-boot sets to its own ESP, and finds every disk with a partition of that UUID. There must be exactly one, and it must be the root disk.
3. **Home:** the one partition of type `933ac7e1-…` (GPT home) on that disk.

Anything else prints `refuse <reason>`.

**efivarfs files can't seek,** so `tail -c +5 file` (skip the 4 attribute bytes) fails. Read through a pipe instead. The same bug blanked the Secure Boot line in the earlier spike report.

## Runs

`os/spikes/boot/host-test.sh <vars> <out> <bind image> bind [host] [twin|twin-unique]`. The firmware always boots STICK-A, which has `bootindex=0`. Evidence: `os/spikes/boot/results/boot-device-binding.txt`.

| Case | Disks | Root came from | Lookup |
|---|---|---|---|
| One stick | STICK-A | STICK-A | `/dev/sda4` on STICK-A ✓ |
| Laptop disk with a decoy `bismillah-home` (label and home type) | STICK-A, NVMe | STICK-A | `/dev/sda4` on STICK-A ✓ |
| Second stick, same build (same image flashed twice) | STICK-B as `sda`, STICK-A as `sdb` | **STICK-B** | `refuse loader partition on several disks: sda sdb` ✓ |
| Second stick, own partition UUIDs (like another build) | STICK-A, STICK-B | STICK-A | `/dev/sda4` on STICK-A ✓ |

In the same-build case the system really ran from STICK-B: its write counters show the ESP random-seed write on B and nothing on A. Two sticks of one build share every partition UUID, and the initrd took the verity root from whichever stick it found first. The kernel command line names the root only by `roothash=`. The firmware's own pointer, `LoaderDevicePartUUID`, matches both sticks, so no lookup can tell from inside which stick the firmware read.

## Findings for OS-2

1. **Port the lookup as written,** including the refusal when the loader partition is on several disks. The Unlock screen shows it as: *"Two bismillah sticks are attached. Remove the one you didn't start from, then restart."* Make no write and no unlock before that.
2. **Pin the root to the boot disk.** This would make same-build sticks safe beyond refusing: systemd's gpt-auto can take the root from the loader's own disk (`root=gpt-auto` alongside `roothash=`), rather than any disk with the right UUID. It's untested here. OS-1 should try it with the same `twin` case. Even then, the ESP UUID stays identical across same-build sticks, so the refusal stays.
3. **Per-stick UUIDs at flash time.** Giving each stick fresh partition UUIDs breaks the boot, because the root's UUID is derived from its root hash. Only the ESP and home UUIDs could change, and that doesn't remove the root ambiguity. Don't do it.
4. **gpt-auto on home** (again): without `/home` in fstab, the stick's own empty home partition sends the system to emergency mode. The binding image needed the same tmpfs line as the app image.

## Not covered here

- Real hardware with two physical sticks: the logic doesn't depend on the bus, but the Dell enumerates USB in its own order.
- A stick with LUKS already set up. The lookup works on partition types only, before anything is opened.
