#!/usr/bin/env bash
# Runs a command against a private, invisible X server and a private D-Bus session, so
# tests and screenshots never touch the author's desktop (.claude/skills/run-app).
#
#   scripts/headless.sh <command> [args…]
#
# The webview renders at 2× (BISMILLAH_SCALE, default 2), like the author's display, so
# screenshots show glyph detail. BISMILLAH_XVFB_SCREEN overrides the virtual screen
# (default 5200x2400x24, which fits the widest specimen width of 2560 CSS px at 2×).
set -euo pipefail

# A private runtime directory keeps the app, its portals and its D-Bus services away
# from the author's Wayland compositor, keyring and audio.
runtime="$(mktemp -d "${TMPDIR:-/tmp}/bismillah-headless.XXXXXX")"
trap 'rm -rf "$runtime"' EXIT

screen="${BISMILLAH_XVFB_SCREEN:-5200x2400x24}"
scale="${BISMILLAH_SCALE:-2}"

xvfb-run --auto-servernum --server-args="-screen 0 ${screen} -nolisten tcp" \
  env -u WAYLAND_DISPLAY -u HYPRLAND_INSTANCE_SIGNATURE -u XDG_CURRENT_DESKTOP \
  -u XDG_SESSION_TYPE -u XDG_SESSION_DESKTOP -u DESKTOP_SESSION -u GNOME_KEYRING_CONTROL \
  -u SSH_AUTH_SOCK -u GTK_IM_MODULE -u QT_IM_MODULE -u XMODIFIERS \
  XDG_RUNTIME_DIR="$runtime" \
  GTK_USE_PORTAL=0 \
  dbus-run-session -- \
  env \
  GDK_BACKEND=x11 \
  GDK_SCALE="$scale" \
  GDK_DPI_SCALE=1 \
  GTK_IM_MODULE="${BISMILLAH_IM_MODULE:-gtk-im-context-simple}" \
  NO_AT_BRIDGE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  BISMILLAH_TEST=1 \
  "$@"
