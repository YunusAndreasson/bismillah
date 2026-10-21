#!/usr/bin/env bash
# OS-0 "Suspend lock fallback": one boot of the suspend image (app + unlock + suspend
# profiles) in the Secure Boot VM with S3 enabled. After setup, each case puts the
# document on screen, breaks the app in its own way, suspends through logind, then
# wakes the VM with a burst of screenshots from the first instant of resume:
#   normal        the app locks when asked
#   frozen        every app process stopped (SIGSTOP), and left stopped
#   late          stopped before sleep, continued right after resume
#   crashed       the app killed as the suspend starts
#   disconnected  the sleep daemon's connection to the app dropped (SIGUSR1)
# After each case the passphrase is typed to get back to the document.
# The display is QEMU's standard VGA: virtio-gpu doesn't come back from S3.
# Usage: suspend-test.sh <vars.fd> <out-dir> <image.raw> [case...]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
vars=$1
out=$(realpath -m "$2")
image=$3
shift 3
cases=("${@:-normal frozen late crashed disconnected}")
read -r -a cases <<<"${cases[*]}"
pass='Ward of the night 7'
mkdir -p "$out"
sock=$(mktemp -u "${XDG_RUNTIME_DIR:?}/bismillah-qmp.XXXXXX")
cmdsock=$(mktemp -u "${XDG_RUNTIME_DIR:?}/bismillah-cmd.XXXXXX")
log=$out/serial.log
qemu=
trap '{ [ -z "$qemu" ] || kill "$qemu" 2>/dev/null || true; }; rm -f "$sock" "$cmdsock"; true' EXIT
cp --sparse=always "$image" "$out/stick.raw"
cp "$vars" "$out/vars.fd"
sync

qmp() { python3 "$here/qmp.py" "$sock" "$@"; }
# The app frozen: every process in the app's cgroup (PAM's session scope) except
# cage, so bismillah and WebKit's processes, but not the user's systemd.
procs='/sys/fs/cgroup$(cut -d: -f3 /proc/$(pgrep -x bismillah)/cgroup)/cgroup.procs'
freeze="for p in \$(cat $procs); do [ \"\$(cat /proc/\$p/comm)\" = cage ] || kill -STOP \$p; done"
thaw="for p in \$(cat $procs); do kill -CONT \$p; done"
# A root command in the guest, through the spike's channel on ttyS1.
guest() { printf '%s\n' "$1" | socat - UNIX-CONNECT:"$cmdsock"; }

count() { local n; n=$(grep -ac -- "$1" "$log" 2>/dev/null); echo "${n:-0}"; }
wait_for() { # pattern, seconds, [count]
  local i
  for ((i = 0; i < $2 * 10; i++)); do
    [ "$(count "$1")" -ge "${3:-1}" ] && return 0
    sleep 0.1
  done
  echo "timeout: $1 (${3:-1})" >&2
  return 1
}
state() { qmp cmd query-status | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])'; }

qemu-system-x86_64 \
  -machine q35,smm=on,accel=kvm -cpu host -smp 2 -m 2G \
  -global driver=cfi.pflash01,property=secure,value=on \
  -global ICH9-LPC.disable_s3=0 \
  -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.secboot.4m.fd \
  -drive if=pflash,format=raw,unit=1,file="$out/vars.fd" \
  -device qemu-xhci,id=xhci \
  -drive if=none,id=stick,format=raw,file="$out/stick.raw" \
  -device usb-storage,bus=xhci.0,drive=stick,bootindex=0 \
  -nic none -display none -no-reboot -vga std \
  -qmp unix:"$sock",server=on,wait=off \
  -serial file:"$log" -serial unix:"$cmdsock",server=on,wait=off &
qemu=$!

# Setup: accept the offered layouts (the session restarts), then the passphrase.
wait_for page-gate-shown 120
sleep 2
qmp key ret
wait_for page-gate-shown 60 2
sleep 2
qmp type "$pass"
qmp key ret
wait_for page-editable 60
sleep 2
guest 'cat /sys/power/state /sys/power/mem_sleep; cat /proc/cmdline'
qmp screendump "$out/0-document.ppm"

for c in "${cases[@]}"; do
  echo "== $c" | tee -a "$out/cases.txt"
  passed=$(($(count page-lock-passed) + $(count page-editable)))
  qmp screendump "$out/$c-before.ppm"
  case $c in
    normal) guest 'systemctl suspend' ;;
    frozen | late)
      guest "$freeze; systemctl suspend" ;;
    crashed) guest 'pkill -KILL -x bismillah; systemctl suspend' ;;
    disconnected)
      guest 'pkill -USR1 -f bismillah-sleepd'
      wait_for sleepd-app-disconnected 10 "$(($(count sleepd-app-disconnected) + 1))" || true
      guest 'systemctl suspend' ;;
  esac
  # From the suspend request until the guest sleeps: what was on screen.
  qmp sleepshots "$out/$c-sleep" 15 >>"$out/cases.txt"
  echo "state: $(state)" | tee -a "$out/cases.txt"
  qmp screendump "$out/$c-asleep.ppm"
  if [ "$c" = late ]; then
    # Continue the app as soon as the guest runs again (input sent earlier is lost).
    resumed=$(count sleepd-resumed)
    qmp wakeshots "$out/$c-wake" 1 0 >>"$out/cases.txt"
    wait_for sleepd-resumed 10 "$((resumed + 1))"
    guest "$thaw"
    qmp screendump "$out/$c-wake-001.ppm"
    for i in $(seq 2 40); do sleep 0.25; qmp screendump "$out/$c-wake-$(printf %03d "$i").ppm"; done
  else
    qmp wakeshots "$out/$c-wake" 40 0.25 >>"$out/cases.txt"
  fi
  sleep 3
  qmp screendump "$out/$c-after.ppm"
  guest 'echo SPIKE diag; cat /sys/class/tty/tty0/active; loginctl list-sessions --no-legend; systemctl is-active bismillah-session; journalctl -b -o short-monotonic --no-pager -n 30 -u bismillah-session -u systemd-logind | sed "s/^/SPIKE j /"'
  qmp type "$pass"
  qmp key ret
  wait_for 'page-lock-passed\|page-editable' 60 "$((passed + 1))" || true
  sleep 2
  qmp screendump "$out/$c-unlocked.ppm"
done

qmp cmd system_powerdown >/dev/null
timeout 60 tail --pid="$qemu" -f /dev/null || kill "$qemu"
for f in "$out"/*.ppm; do magick "$f" "${f%.ppm}.png" && rm "$f"; done
grep -a -E 'BISMILLAH_MARK (sleepd|page-lock|page-locked|app-lock|events|page-editable|page-gate)|SPIKE (case|cmd)|mem_sleep|deep|s2idle|freeze mem|PM: |ACPI: PM|cage|Restart' "$log" >"$out/marks.txt" || true
