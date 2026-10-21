# OS-0 spike: suspend lock fallback

**Question** (os/PLAN.md, OS-0): the app may be frozen (`SIGSTOP`), crashed or disconnected at the moment of suspend. Does the helper's empty-VT fallback blank the display before sleep? On resume, does the screen stay blank until a lock view is painted, restarting the session if needed? Does cage/wlroots survive the VT round trip?

**Verdict: go, with two changes to the plan's recovery steps.** In the VM (Secure Boot on, S3, 2026-10-21), all five cases came back locked. No screenshot after wake showed document text:
- normal
- app frozen
- app frozen, then continued after wake
- app crashed
- app disconnected

The two changes, both for when the session must restart:
1. **The helper must end the session's processes itself.** Stopping the service alone hangs when the app is frozen.
2. **The session's VT must be active before the new session starts.** wlroots won't start on an inactive VT.

## Setup

- **App:** branch `spike/os-unlock`, commit `fb8b9bf` (`src-tauri/src/spike_suspend.rs`). With `BISMILLAH_SPIKE_EVENTS` set, the app keeps one connection to the sleep daemon. On `lock` it shows the lock view (the keyboard spike's `SpikeUnlock`, verified by the helper). Two animation frames later it answers `painted`. A session that starts while home is unlocked but `/run/bismillah/must-lock` exists opens on the lock view, and a verified passphrase clears the flag.
- **Sleep daemon:** `os/spikes/boot/mkosi.profiles/suspend/mkosi.extra/usr/libexec/bismillah-sleepd`, about 200 lines of Python standing in for the Rust helper's sleep role.
  - It holds a logind *delay* inhibitor for `sleep`.
  - **On `PrepareForSleep(true)`:** it writes `must-lock`, sends `lock`, and waits 1.5 s for `painted`. Without an answer it switches to VT 8, which has no getty (`NAutoVTs=0`, `ReserveVT=0`, `vt.global_cursor_default=0`). Then it releases the inhibitor.
  - **On resume after a fallback:** it asks for the lock again and waits 3 s. If the app paints, it switches back to VT 1. If not, it restarts the session (below).
- **Image:** `mkosi --profile=app --profile=unlock --profile=probe --profile=suspend`. `probe` is a root command channel on the second serial port, for the test only.
- **Run:** `os/spikes/boot/suspend-test.sh <vars> <out> <image>`.
  - QEMU runs with S3 enabled (`-global ICH9-LPC.disable_s3=0`); the guest offers `deep`.
  - Each case shows the document, breaks the app, then runs `systemctl suspend`.
  - From the suspend request until the guest sleeps, it takes a screenshot every 0.1 s.
  - Then it sends QMP `system_wakeup` and screenshots at once and every 0.25 s for 10 s.
  - Finally it types the passphrase and expects the document back.
  
  Evidence: `os/spikes/boot/results/suspend-lock.txt`.

![Each row: before, last frame before sleep, wake +0, +0.5, +2, +4, +6 s, after unlock](img/os/suspend-cases.png)

## Results

| Case | Before sleep | After wake | Back to the document |
|---|---|---|---|
| **Normal** | `painted` 40–50 ms after `lock`; the lock view was on screen in the first frame, 0.11 s after the request | Lock view at 0.5 s | Passphrase verified, same process |
| **Frozen**: every app process stopped, cage running | No answer; after 1.5 s, VT 8 (black) | Black for 3 s, then the session restarts: VT 1 at +3.2 s, lock view at +4.3 s | Passphrase, then the deferred startup in the new process |
| **Late**: frozen at sleep, continued at wake | VT 8 (black) | The continued app painted the lock view while VT 8 was active; back on VT 1 0.2 s after wake, showing the lock view | Same process |
| **Crashed**: killed as the suspend starts | systemd restarted the session (`Restart=on-failure`) within the 1.5 s. The new app opened locked, because `must-lock` was set, and answered `painted`. No fallback was needed. | Lock view at 0.5 s | New process |
| **Disconnected**: the daemon dropped the app's connection | No connection, so straight to VT 8 | The session restarts; lock view at +1.3 s | New process |

In every case, every frame from wake until unlock showed either black, cage's grey start-up frame, or the lock view. None showed text.

## Findings for OS-2

1. **End the session's processes yourself.** `systemctl restart` hung for 80 s with a frozen app. Stopping the service SIGTERMs cage, and cage waits for its client. The client lives in PAM's `session-cN.scope`, which the service's stop doesn't touch, so nothing continues the stopped process. The daemon now SIGTERMs and SIGCONTs every process in the writer's session scopes, waits 2 s, then SIGKILLs what's left. After that the restart takes 0.1 s.
2. **Switch back before starting the new session.** wlroots gives up after 10 s ("Timeout waiting session to become active") when its VT isn't the active one. So the order is: end the old session, switch to VT 1, start the new one. That's safe, because nothing of the old session is left to show. VT 1 shows an empty text console for about 0.2 s, then cage's grey frame, then the lock view.
3. **cage survives the VT round trip.** Losing the display only logs `Atomic commit failed: Permission denied`. In the *late* case the same cage showed the lock view again, which the app had painted while the VT was inactive. No document frame showed, at 0.25 s sampling. A shorter flash would be missed, so OS-2's VM test should sample faster around the switch back.
4. **A killed app can lose typing.** The frozen and disconnected cases restart the session, so anything typed since the last autosave is lost. A frozen app couldn't have saved it anyway. A disconnected but working app still could, so OS-2 should give it SIGTERM and a moment to flush, as here, before SIGKILL.
5. **`painted` is the app's word, not the compositor's.** Two `requestAnimationFrame`s after showing the view held in every run: the first frame of each burst already showed the lock. The 1.5 s bound and the fallback stay the guarantee.
6. **The crash path works through systemd plus `must-lock`.** A session restarted for any reason opens locked once the daemon has set the flag. In the product the helper keeps that state, and the app asks for it at start.
7. **VM harness:** virtio-gpu doesn't come back from S3 in QEMU ("Display output is not active"), so the suspend tests use the standard VGA (`bochs-drm`). The guest's xHCI resets on every resume (`xHC error in resume, USBSTS 0x401, Reinit`), and the USB stick carried on: the verity root and LUKS home kept working through USB persist. That's QEMU's xHCI; the Dell has to show the same for its own.
8. **Test pitfalls:** freezing *every* `writer` process, including the user's systemd manager, makes logout hang. The serial command channel loses input while the guest wakes, so the test waits for the daemon's `resumed` mark before sending more.

## Not covered here

- **The Dell** is now covered ([the Dell check](../../os/spikes/boot/DELL-CHECK.md)): `deep` S3, the lock view painted 31 ms after the lid closed, both resumes passed the lock, and the stick survived each resume's USB reset without errors. The author saw no document text. The panel's own wake time wasn't timed; it looked immediate.
- **A lid closed soon after a resume** (found on the Dell): logind ignores lid events for `HoldoffTimeoutSec=` (30 s) from the previous suspend, so the lid suspended 16.7 s late and the document stayed unlocked behind it. OS-2 therefore locks on the lid itself: the helper watches logind's `LidClosed` and asks the app to lock straight away, whether or not sleep follows.
- **The inhibitor delay limit:** logind's `InhibitDelayMaxSec=` (5 s). The daemon decides within 1.5 s, so it never reached the limit.
- **Hibernate:** refused under lockdown; not offered.
