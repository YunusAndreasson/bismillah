#!/usr/bin/env bash
# The phone app on this machine's emulator (mobile/PLAN.md, M0).
#   build             release APK, signed with the debug key, checked for INTERNET
#   dev               debug APK, installed and opened on the emulator
#   show              the installed app, on an emulator with a window
#   shot [out-dir] [pages]   specimen screenshots from the running app, light and dark
#   test [shots-dir]  the storage's unit tests, then real frames through the debug app (M1)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=mobile/env.sh
. "$here/env.sh"
export PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH

# avdmanager writes here on this machine, while the emulator looks in ~/.android/avd.
export ANDROID_AVD_HOME=$HOME/.config/.android/avd

avd=bismillah
package=org.bismillah.reader
image="system-images;android-35;google_apis;x86_64"
outputs=$here/src-tauri/gen/android/app/build/outputs/apk
build_tools=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)

# This AVD's emulator, by name: other sessions may have their own running.
serial() {
  adb devices | awk '/^emulator-.*device$/ {print $1}' | while read -r candidate; do
    if [ "$(adb -s "$candidate" emu avd name 2>/dev/null | head -1 | tr -d '\r')" = "$avd" ]; then
      echo "$candidate"
      break
    fi
  done
}

device() {
  avdmanager list avd -c | grep -qx "$avd" ||
    echo no | avdmanager create avd -n "$avd" -k "$image" -d pixel_7 >/dev/null
  if [ -z "$(serial)" ]; then
    setsid nohup emulator -avd "$avd" -no-window -no-audio -no-boot-anim -no-snapshot-save \
      >"${TMPDIR:-/tmp}/bismillah-emulator.log" 2>&1 </dev/null &
  fi
  for _ in $(seq 90); do
    ANDROID_SERIAL=$(serial)
    [ -n "$ANDROID_SERIAL" ] && break
    sleep 2
  done
  [ -n "$ANDROID_SERIAL" ] || { echo "the $avd emulator did not start" >&2; exit 1; }
  export ANDROID_SERIAL
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 2; done
}

tauri() { (cd "$here" && ../node_modules/.bin/tauri "$@"); }

refuse_internet() {
  if "$build_tools/aapt2" dump permissions "$1" | grep -q 'android.permission.INTERNET'; then
    echo "$1 declares INTERNET" >&2
    exit 1
  fi
  echo "no INTERNET permission: $1"
}

# A writer's texts stay on the phone: no cloud backup, and no transfer to a new device.
refuse_backup() {
  local manifest
  manifest=$("$build_tools/aapt2" dump xmltree --file AndroidManifest.xml "$1")
  grep -q 'android:allowBackup.*=false' <<<"$manifest" &&
    grep -q 'android:fullBackupContent.*=false' <<<"$manifest" &&
    grep -q 'android:dataExtractionRules' <<<"$manifest" || {
    echo "$1 allows backup" >&2
    exit 1
  }
  echo "no backup or device transfer: $1"
}

case "${1:-}" in
  build)
    tauri android build --apk --target x86_64 --target aarch64
    unsigned=$outputs/universal/release/app-universal-release-unsigned.apk
    signed=$outputs/universal/release/bismillah-release.apk
    # The key Gradle signs debug builds with, so that either build installs over the other.
    keystore=$HOME/.config/.android/debug.keystore
    [ -f "$keystore" ] || keytool -genkeypair -keystore "$keystore" -storepass android \
      -alias androiddebugkey -keypass android -keyalg RSA -validity 10000 \
      -dname "CN=Android Debug,O=Android,C=US"
    "$build_tools/zipalign" -f 4 "$unsigned" "$signed.aligned"
    "$build_tools/apksigner" sign --ks "$keystore" --ks-pass pass:android --out "$signed" "$signed.aligned"
    rm -f "$signed.aligned" "$signed.idsig"
    refuse_internet "$signed"
    refuse_backup "$signed"
    ;;
  dev)
    tauri android build --debug --apk --target x86_64
    device
    adb install -r "$outputs/universal/debug/app-universal-debug.apk"
    adb shell am start -n "$package/.MainActivity"
    ;;
  show)
    # With a window on the author's desktop, for looking at. Close any windowless run first.
    # This session's Xwayland socket can be named X0_, which the emulator doesn't look for.
    [ -z "$(serial)" ] || { echo "the $avd emulator is already running: close it first" >&2; exit 1; }
    [ -S /tmp/.X11-unix/X0 ] || [ ! -S /tmp/.X11-unix/X0_ ] || export DISPLAY=/tmp/.X11-unix/X0_
    QT_QPA_PLATFORM=xcb setsid nohup emulator -avd "$avd" -no-audio -no-boot-anim -no-snapshot-save \
      >"${TMPDIR:-/tmp}/bismillah-emulator.log" 2>&1 </dev/null &
    device
    adb shell am start -n "$package/.MainActivity"
    ;;
  shot)
    out=${2:-$here/dist-shots}
    pages=${3:-9}
    device
    mkdir -p "$out"
    for mode in light dark; do
      [ "$mode" = light ] && night=no || night=yes
      adb shell cmd uimode night "$night" >/dev/null
      adb shell am force-stop "$package"
      adb shell am start -n "$package/.MainActivity" >/dev/null
      # The first paint takes seconds on the emulator, and an unpainted screen is one flat colour.
      for _ in $(seq 60); do
        sleep 1
        adb exec-out screencap -p >"$out/specimen-$mode-0.png"
        [ "$(stat -c %s "$out/specimen-$mode-0.png")" -gt 60000 ] && break
      done
      sleep 2
      for page in $(seq 0 "$pages"); do
        adb exec-out screencap -p >"$out/specimen-$mode-$page.png"
        echo "$out/specimen-$mode-$page.png"
        adb shell input swipe 540 2000 540 400 900
        sleep 2
      done
    done
    adb shell cmd uimode night no >/dev/null
    ;;
  test)
    (cd "$here/src-tauri" && cargo test)
    # The frames come from the root workspace, on the system's Rust like the rest of it.
    (cd "$here/.." && env -u CARGO_HOME -u RUSTUP_HOME PATH="/usr/bin:$PATH" \
      cargo build -q -p bismillah-print --example frames --example library_frames --locked)
    tauri android build --debug --apk --target x86_64
    device
    adb install -r "$outputs/universal/debug/app-universal-debug.apk"
    node "$here/../tests/mobile/receive.ts" "${2:-}"
    ;;
  *)
    echo "usage: mobile/run.sh build|dev|show|shot|test" >&2
    exit 2
    ;;
esac
