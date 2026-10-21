#!/usr/bin/python3
# The allowlist (os/PLAN.md, OS-4): a finalize script that leaves in the image only
#   - the files the system opened in the VM scenarios (allowlist.txt, recorded by
#     bismillah-trace and merged by os/scripts/allowlist.ts),
#   - the files a VM can't open (allowlist-declared.txt, globs with their reasons),
#   - the libraries every kept program and library needs (DT_NEEDED), and
#   - the links and folders that lead to them.
# Kernel modules and firmware are chosen by mkosi.conf (KernelModules=), /etc is the
# image's own configuration, and both are kept whole.
#
# Lines in allowlist-declared.txt starting with "debug:" apply to the debug image only:
# the tests' own tools. BISMILLAH_UNPRUNED=1 (os/scripts/build.sh --unpruned) builds
# the whole system, which is how the trace is recorded.
#
# `prune.py initrd` (initrd.finalize) does the same for mkosi's initrd from
# initrd-keep.txt alone: what its boot runs, which its serial log lists.
import os
import re
import struct
import subprocess
import sys

root = os.environ["BUILDROOT"]
src = os.environ["SRCDIR"]
initrd = sys.argv[1:] == ["initrd"]
debug = "debug" in os.environ.get("PROFILES", "").split(",")
if os.environ.get("BISMILLAH_UNPRUNED") == "1" and not initrd:
    print("prune: unpruned build, keeping every file")
    sys.exit(0)

KEPT_WHOLE = ("/etc/", "/usr/lib/modules/", "/usr/lib/firmware/", "/var/", "/boot/", "/efi/")


def lines(name):
    with open(os.path.join(src, name), encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                yield line


traced = set() if initrd else set(lines("allowlist.txt"))
if not initrd and len(traced) < 100:
    sys.exit("prune: allowlist.txt is empty: record it first (os/scripts/trace.sh)")
globs = []
for line in lines("initrd-keep.txt" if initrd else "allowlist-declared.txt"):
    if line.startswith("debug:"):
        if debug:
            globs.append(line[len("debug:"):].strip())
    else:
        globs.append(line)


def pattern(glob):
    """A glob as a regex: "**" crosses folders, "*" and "?" don't."""
    out = ""
    for part in re.split(r"(\*\*|\*|\?)", glob):
        out += {"**": ".*", "*": "[^/]*", "?": "[^/]"}.get(part, re.escape(part))
    return re.compile(out + "$")


patterns = [pattern(g) for g in globs]


def declared(path):
    return any(p.match(path) for p in patterns)


def real(path, depth=0):
    """The path inside the image with every link followed, or None if it leads nowhere."""
    parts = [p for p in path.split("/") if p]
    at = ""
    for i, part in enumerate(parts):
        nxt = f"{at}/{part}"
        full = root + nxt
        if os.path.islink(full):
            if depth > 40:
                return None
            target = os.readlink(full)
            base = target if target.startswith("/") else f"{at}/{target}"
            resolved = real(os.path.normpath(base), depth + 1)
            if resolved is None:
                return None
            at = resolved
        elif os.path.lexists(full):
            at = nxt
        else:
            return None
    return at or "/"


def dynamic(path):
    """DT_NEEDED and DT_RUNPATH/DT_RPATH of an ELF64 file, or None."""
    try:
        with open(root + path, "rb") as f:
            head = f.read(64)
            if len(head) < 64 or head[:4] != b"\x7fELF" or head[4] != 2:
                return None
            phoff, = struct.unpack_from("<Q", head, 32)
            phentsize, phnum = struct.unpack_from("<HH", head, 54)
            f.seek(phoff)
            ph = f.read(phentsize * phnum)
            loads, dyn, interp = [], None, []
            for i in range(phnum):
                ptype, = struct.unpack_from("<I", ph, i * phentsize)
                offset, vaddr = struct.unpack_from("<QQ", ph, i * phentsize + 8)
                filesz, = struct.unpack_from("<Q", ph, i * phentsize + 32)
                if ptype == 1:
                    loads.append((vaddr, offset, filesz))
                elif ptype == 2:
                    dyn = (offset, filesz)
                elif ptype == 3:
                    # The program's loader (ld-linux), by its absolute path.
                    here = f.tell()
                    f.seek(offset)
                    interp = [f.read(filesz).rstrip(b"\0").decode("latin1")]
                    f.seek(here)
            if not dyn:
                return interp, []
            f.seek(dyn[0])
            table = f.read(dyn[1])
            entries, strtab = [], 0
            for at in range(0, len(table) - 15, 16):
                tag, value = struct.unpack_from("<qQ", table, at)
                if tag == 0:
                    break
                if tag == 5:
                    strtab = value
                elif tag in (1, 15, 29):
                    entries.append((tag, value))
            load = next((l for l in loads if l[0] <= strtab < l[0] + l[2]), None)
            if not load:
                return [], []

            def string(off):
                f.seek(load[1] + strtab - load[0] + off)
                return f.read(512).split(b"\0", 1)[0].decode("latin1")

            needed = interp + [string(v) for t, v in entries if t == 1]
            runpath = [p for t, v in entries if t != 1 for p in string(v).split(":")]
            return needed, runpath
    except OSError:
        return None


LIBRARY_DIRS = ["/usr/lib/x86_64-linux-gnu", "/usr/lib", "/lib/x86_64-linux-gnu", "/lib"]

# Every file and link in the image, outside what is kept whole.
everything = []
for dirpath, dirnames, filenames in os.walk(root):
    rel = dirpath[len(root):] or "/"
    for name in filenames + [d for d in dirnames if os.path.islink(os.path.join(dirpath, d))]:
        path = os.path.join(rel, name)
        if not path.startswith(KEPT_WHOLE):
            everything.append(path)

keep = set()
queue = []


def want(path):
    target = real(path)
    if target and target not in keep and not os.path.isdir(root + target):
        keep.add(target)
        queue.append(target)


for path in everything:
    if os.path.islink(root + path):
        continue
    if path in traced or declared(path):
        want(path)
# Traced paths are the files themselves; a listed link keeps what it leads to.
for path in traced:
    if os.path.lexists(root + path):
        want(path)
while queue:
    path = queue.pop()
    d = dynamic(path)
    if not d:
        continue
    needed, runpath = d
    origin = os.path.dirname(path)
    dirs = [r.replace("${ORIGIN}", origin).replace("$ORIGIN", origin) for r in runpath]
    dirs += LIBRARY_DIRS + [origin]
    for lib in needed:
        if lib.startswith("/"):
            if real(lib):
                want(lib)
            continue
        for d in dirs:
            if real(f"{d}/{lib}"):
                want(f"{d}/{lib}")
                break
        else:
            print(f"prune: {path} needs {lib}, which the image doesn't have", file=sys.stderr)

removed = 0
removed_bytes = 0
for path in everything:
    full = root + path
    if os.path.islink(full):
        continue
    if path not in keep:
        removed_bytes += os.lstat(full).st_size
        os.unlink(full)
        removed += 1
# Links that led to a removed file, and folders left empty.
for path in everything:
    full = root + path
    if os.path.islink(full) and real(path) is None and not declared(path):
        os.unlink(full)
for dirpath, dirnames, filenames in os.walk(root + "/usr", topdown=False):
    rel = dirpath[len(root):]
    if not rel.startswith(KEPT_WHOLE) and not os.listdir(dirpath) and not declared(rel + "/"):
        os.rmdir(dirpath)
print(f"prune{' initrd' if initrd else ''}: kept {len(keep)} files, removed {removed} ({removed_bytes / 2**20:.1f} MiB)")
# The loader's cache names the libraries that are left (the initrd has no ldconfig).
if not initrd:
    subprocess.run(["ldconfig", "-r", root], check=False)
