"""OS-0 "GPU and display": what each GPU family adds to an extracted image root.

Kernel modules: each family's driver and its dependency closure (modules.dep), split
into what only that family needs and what the families share. Firmware: the family's
directories under /usr/lib/firmware. Sizes are on-disk (Debian's modules are .ko.xz).
Usage: python3 gpu-sizes.py ROOT
"""
import glob
import os
import sys

root = sys.argv[1]
moddir = glob.glob(os.path.join(root, "usr/lib/modules/*"))[0]
deps = {}
with open(os.path.join(moddir, "modules.dep")) as f:
    for line in f:
        mod, _, rest = line.partition(":")
        deps[mod] = rest.split()

FAMILIES = {  # driver modules, firmware directories
    "Intel (i915)": (["i915"], ["i915"]),
    "Intel (xe)": (["xe"], ["xe"]),
    "AMD (amdgpu)": (["amdgpu"], ["amdgpu"]),
    "AMD, pre-GCN (radeon)": (["radeon"], ["radeon"]),
    "NVIDIA (nouveau)": (["nouveau"], ["nvidia"]),
    "virtio-gpu": (["virtio-gpu"], []),
    "QEMU std VGA (bochs)": (["bochs"], []),
}


def find(name):
    for mod in deps:
        base = os.path.basename(mod).split(".ko")[0]
        if base.replace("_", "-") == name.replace("_", "-"):
            return mod
    raise SystemExit(f"no module {name}")


def closure(mod, seen=None):
    seen = set() if seen is None else seen
    if mod not in seen:
        seen.add(mod)
        for d in deps.get(mod, []):
            closure(d, seen)
    return seen


def size(mod):
    path = os.path.join(moddir, mod)
    return os.path.getsize(path) if os.path.exists(path) else 0


def du(path):
    total = 0
    for dirpath, _, files in os.walk(path):
        for name in files:
            p = os.path.join(dirpath, name)
            if not os.path.islink(p):
                total += os.path.getsize(p)
    return total


mods = {fam: set().union(*(closure(find(m)) for m in ms)) for fam, (ms, _) in FAMILIES.items()}
count = {}
for s in mods.values():
    for m in s:
        count[m] = count.get(m, 0) + 1
mib = lambda n: f"{n / 1048576:6.1f}"
print(f"{'family':24} {'own mods':>8} {'shared':>7} {'firmware':>8}  (MiB, on disk)")
for fam, (_, fw) in FAMILIES.items():
    own = sum(size(m) for m in mods[fam] if count[m] == 1)
    shared = sum(size(m) for m in mods[fam] if count[m] > 1)
    firmware = sum(du(os.path.join(root, "usr/lib/firmware", d)) for d in fw)
    print(f"{fam:24} {mib(own):>8} {mib(shared):>7} {mib(firmware):>8}")
shared_all = {m for m, n in count.items() if n > 1}
print(f"\nShared by two or more families: {mib(sum(size(m) for m in shared_all))} MiB:",
      " ".join(sorted(os.path.basename(m).split('.ko')[0] for m in shared_all)))
everything = set().union(*mods.values())
print(f"All families together: modules {mib(sum(size(m) for m in everything))} MiB,",
      f"firmware {mib(du(os.path.join(root, 'usr/lib/firmware')))} MiB")
print(f"All kernel modules in the image: {mib(du(moddir))} MiB")
