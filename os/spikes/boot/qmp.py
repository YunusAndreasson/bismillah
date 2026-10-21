"""Minimal QMP client for the spike: screendump and typing. Usage:
qmp.py SOCKET screendump OUT.ppm | qmp.py SOCKET type TEXT | qmp.py SOCKET key KEY... | qmp.py SOCKET cmd NAME [JSON-ARGS]
| qmp.py SOCKET wakeshots PREFIX COUNT INTERVAL (system_wakeup, then a screendump at once and every INTERVAL s)
| qmp.py SOCKET sleepshots PREFIX SECONDS (a screendump every 0.1 s until the guest is suspended)"""
import json, socket, sys, time

def connect(path):
    s = socket.socket(socket.AF_UNIX)
    s.connect(path)
    f = s.makefile("rw")
    f.readline()
    cmd(f, "qmp_capabilities")
    return f

def cmd(f, name, **args):
    f.write(json.dumps({"execute": name, "arguments": args}) + "\n")
    f.flush()
    while True:
        r = json.loads(f.readline())
        if "return" in r or "error" in r:
            if "error" in r:
                sys.exit(f"qmp {name}: {r['error']}")
            return r["return"]

def keys(f, names):
    ev = lambda n, down: {"type": "key", "data": {"down": down, "key": {"type": "qcode", "data": n}}}
    cmd(f, "input-send-event", events=[ev(n, True) for n in names])
    time.sleep(0.03)
    cmd(f, "input-send-event", events=[ev(n, False) for n in reversed(names)])
    time.sleep(0.03)

SHIFTED = {"!": "1", "?": "slash", ":": "semicolon", "\"": "apostrophe"}
PLAIN = {" ": "spc", ".": "dot", ",": "comma", "\n": "ret", "-": "minus", "/": "slash", "'": "apostrophe"}

f = connect(sys.argv[1])
op = sys.argv[2]
if op == "screendump":
    cmd(f, "screendump", filename=sys.argv[3])
elif op == "cmd":
    print(json.dumps(cmd(f, sys.argv[3], **(json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}))))
elif op == "wakeshots":
    prefix, count, interval = sys.argv[3], int(sys.argv[4]), float(sys.argv[5])
    start = time.monotonic()
    cmd(f, "system_wakeup")
    for i in range(count):
        due = start + i * interval
        time.sleep(max(0, due - time.monotonic()))
        cmd(f, "screendump", filename=f"{prefix}-{i:03d}.ppm")
        print(f"{i:03d} {time.monotonic() - start:.2f}")
elif op == "sleepshots":
    prefix, limit = sys.argv[3], float(sys.argv[4])
    start, i = time.monotonic(), 0
    while time.monotonic() - start < limit:
        status = cmd(f, "query-status")["status"]
        print(f"{i:03d} {time.monotonic() - start:.2f} {status}")
        if status == "suspended":
            break
        cmd(f, "screendump", filename=f"{prefix}-{i:03d}.ppm")
        i += 1
        time.sleep(0.1)
elif op == "key":
    keys(f, sys.argv[3:])
elif op == "type":
    for ch in sys.argv[3]:
        if ch.isupper():
            keys(f, ["shift", ch.lower()])
        elif ch in SHIFTED:
            keys(f, ["shift", SHIFTED[ch]])
        else:
            keys(f, [PLAIN.get(ch, ch)])
