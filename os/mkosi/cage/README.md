# Cage input and startup policy

Cage 0.2.0 never configures libinput tapping. Most touchpads default to tapping off,
so moving the pointer works but only a physical button press clicks.

This builds the same upstream Cage version against the stick's Debian wlroots and
libinput, with a small input-device policy patch. On initial discovery and hotplug,
tap-capable libinput pointers get tap-to-click and disable-while-typing enabled.
Other input devices, physical click methods, acceleration and scrolling keep their
existing settings. Failed configuration is reported by Cage in debug builds' logs.
The normal release still discards session output.

Source: Debian's `cage_0.2.0.orig.tar.gz` (24,107 bytes), mirrored here as
`cage-0.2.0.tar.gz` so builds stay offline. Its SHA-256 is
`9d3f659e0f19636a958f9e1bf4d22268d7e2705d7e2989888401ec443c1cb6c3`,
from [Debian's signed source manifest](https://deb.debian.org/debian/pool/main/c/cage/cage_0.2.0-2.dsc).
The build refuses a Debian Cage package version other than `0.2.0-2`, including
security revisions, until its source changes have been reviewed and the patch
rebased. This prevents a snapshot update from silently dropping Debian fixes.
The archive contains the upstream MIT licence, which the build installs under the
app's licences folder. No new runtime library or daemon is added: wlroots already
uses libinput. `BuildPackages` exist only in mkosi's disposable build overlay.

`touchpad.h` is compiled into Cage by `tap-to-click.patch`. `build.chroot` verifies
the source hash, applies the patch without fuzz, compiles/runs `touchpad-test.c`
against the real headers, and builds release-mode Cage (no developer escape keys).
Debian 0.2.0-2 carries no upstream source patches. Its `dpkg-buildflags` policy
supplies `hardening=+all`; the installed binary is PIE
and stripped. The version marker is `0.2.0+bismillah.2`. Update the source checksum, review/rebase
the patch, and rerun the tests whenever the pinned Cage version changes.

References:

- [libinput's tapping behavior and default](https://wayland.freedesktop.org/libinput/doc/latest/tapping.html)
- [upstream Cage 0.2.0 input-device handling](https://github.com/cage-kiosk/cage/blob/v0.2.0/seat.c)

The policy tests cover tap enablement, disable-while-typing, unsupported pointers,
non-libinput devices, keyboards and configuration failures. The debug-only `touchpad-probe.c` creates a synthetic touchpad with physical
buttons via uinput, receives pointer events in a full-window Wayland client, and
checks taps, real contact/button clicks and two-finger scrolling. The VM sends an
ordinary keyboard event to check that taps are suppressed while typing and work
again after the guard expires. A direct QMP mouse click would bypass libinput and
would not test this bug. The probe is built only into the debug image.

A real laptop check is still required for its particular touchpad, physical click
feel, scrolling and palm rejection.

After fetching the build inputs once with `pnpm os:fetch`, verification from the
repository root is:

```sh
pnpm os:build release
pnpm os:build debug
node os/tests/image-contents.ts release debug
node os/scripts/test.ts touchpad
```

The Cage policy tests run during both image builds. The image audit checks the
custom version marker and licence, and rejects compiler tools in either image or
the touchpad probe in release. The VM test uses the actual patched compositor.

Validated 2026-10-25: both image audits, all five touchpad VM checks, suspend-lock,
the keyboard/editor tour and release escape-key checks pass. A fresh release
network capture sends zero frames, and size budgets pass. The complete timing run
reported 12 regressions on a heavily loaded host; the baseline was left unchanged.
See `os/PLAN.md` for the laptop acceptance steps and measurement limitation.

## Quiet startup

`startup.patch` keeps the compositor pointer hidden from initial device discovery
until actual pointer movement over a mapped app view. Movement over the empty
startup background and client cursor requests cannot reveal it early.
The first movement restores the default pointer and renews pointer focus so the
client can choose its own cursor. Keyboard-only use and new input devices do not
reveal it; the app continues to hide it while typing.

Output scaling finishes before mapping the fullscreen window onto a dark native
background. The gate contents stay transparent while keyboard labels and fonts
load and layout settles at the mapped viewport. They appear in one step. Mapping
before revealing contents avoids stale GTK/WebKit resize damage from the initial
hidden-window size, and the native background avoids a white frame. Errors remain
visible, so a failed helper does not silently leave a blank screen. No sleep or minimum splash duration is added.

The VM `startup` scenario verifies that the first screen appears without input,
the pointer is absent at the initial centre, movement reveals it, and typing
hides it. It also checks that first input leaves the lower form unchanged,
catching incomplete startup paint or displaced controls. Firmware logos and panel
resets before Linux takes over remain outside Cage's control; the physical laptop still needs a cold-boot check.
