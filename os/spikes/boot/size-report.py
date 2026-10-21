"""OS-0 "Size and boot baseline": sizes of an extracted image root, by component.

Each file counts once (hard links too), at its apparent size, which is what an
uncompressed erofs stores. Files go to the component of the Debian package that owns
them (dpkg's file lists in the root); unowned files go by directory.
Usage: python3 size-report.py ROOT [--packages N]
"""

import os
import re
import sys
from collections import defaultdict

COMPONENTS = [  # (component, package-name pattern), first match wins
    ("Boot packages (not used from the root)", r"^grub|^shim|systemd-boot-efi|^mokutil|efibootmgr|libefi"),
    ("WebKit", r"libflite|libwebkit2gtk|libjavascriptcoregtk|libwpe|libmanette|libwoff|libhyphen|libavif|libjxl|libwebp|libdav1d|libaom|libyuv|libgav1|librav1e|libsvtav1|libde265|libheif|libx265|libvpx|libopenjp2|libjpeg|liblcms2|libsecret|libenchant|libhunspell|libgcrypt|libtasn1|libsoup|libpsl|libnghttp|libbrotli|libsqlite3|libxslt|libsystemd|libharfbuzz-icu"),
    ("GStreamer", r"gstreamer|libgst|liborc"),
    ("ICU", r"^libicu"),
    ("LLVM", r"^libllvm|libz3|libclang"),
    ("Mesa", r"mesa|libgallium|libgbm|libglapi|libdrm|libvulkan|libgl1|libegl|libgles|libglx|libglvnd|libopengl|libxshmfence|libwayland|libsensors|libelf|libedit|libspirv|libclc"),
    ("GTK/GLib/Pango/Cairo", r"libgtk|libgdk|libglib|libpango|libcairo|libpixman|libharfbuzz|libfreetype|libfontconfig|libfribidi|libthai|libdatrie|libgraphite|libatk|libatspi|libepoxy|libxkbcommon|libxkb|libx11|libxcb|libxext|libxrender|libxi|libxfixes|libxrandr|libxcomposite|libxdamage|libxcursor|libxinerama|libxau|libxdmcp|libpng|libtiff|librsvg|libgdk-pixbuf|shared-mime|iso-codes|adwaita|hicolor|gtk-update|libcolord|libcups|libavahi|libdeflate|libjbig|liblerc|libsharpyuv|libzstd|libbz2|liblzma|xkb-data|dconf|gsettings|libdconf"),
    ("Fonts", r"^fonts-|fontconfig"),
    ("cage/wlroots/seat", r"cage|wlroots|libwlroots|libseat|libinput|libliftoff|libdisplay-info|libmtdev|libevdev|libwacom|libgudev|wlr-randr|libudev"),
    ("Kernel image", r"^linux-image"),
    ("WebKit sandbox", r"bubblewrap|xdg-dbus-proxy"),
    ("Python (spike only)", r"python|libpython|libmpdec|libexpat|gir1\.2|libgirepository|libffi"),
    ("Firmware", r"^firmware-"),
    ("Encryption", r"cryptsetup|libcryptsetup|libargon2|libdevmapper|libjson-c|libpopt|libssl"),
    ("systemd/udev/dbus", r"^systemd|^udev|^dbus|libpam|libnss-systemd|libkmod|kmod"),
    ("Base system", r"."),
]
DIRS = [  # unowned files: (component, path prefix)
    ("Kernel modules", "usr/lib/modules/"),
    ("Firmware", "usr/lib/firmware/"),
    ("The app", "usr/bin/bismillah"),
    ("Generated caches", "var/cache/"),
    ("Generated caches", "usr/lib/udev/hwdb.bin"),
]
STRIPPABLE = ["usr/share/doc/", "usr/share/man/", "usr/share/locale/", "usr/share/info/",
              "usr/share/i18n/", "usr/share/zoneinfo/", "usr/share/lintian/", "usr/share/bash-completion/",
              "var/lib/dpkg/", "var/lib/apt/", "var/cache/", "var/log/"]


def mib(n):
    return f"{n / 1048576:7.1f}"


def main():
    root = sys.argv[1].rstrip("/") + "/"
    top = int(sys.argv[sys.argv.index("--packages") + 1]) if "--packages" in sys.argv else 25
    owner = {}
    info = root + "var/lib/dpkg/info/"
    for name in os.listdir(info):
        if name.endswith(".list"):
            package = name[:-5].split(":")[0]
            with open(info + name) as f:
                for line in f:
                    path = line.strip().lstrip("/")
                    # usrmerge: packages list /lib, the image has /usr/lib.
                    owner.setdefault(path, package)
                    for alias in ("lib/", "bin/", "sbin/", "lib64/"):
                        if path.startswith(alias):
                            owner.setdefault("usr/" + path, package)
    seen = set()
    by_component, by_package, strippable = defaultdict(int), defaultdict(int), defaultdict(int)
    modules = defaultdict(int)
    total = 0
    for dirpath, dirs, files in os.walk(root):
        for name in files:
            full = os.path.join(dirpath, name)
            st = os.lstat(full)
            if (st.st_dev, st.st_ino) in seen or not os.path.isfile(full) or os.path.islink(full):
                continue
            seen.add((st.st_dev, st.st_ino))
            rel = full[len(root):]
            size = st.st_size
            total += size
            for prefix in STRIPPABLE:
                if rel.startswith(prefix):
                    strippable[prefix] += size
            if rel.startswith("usr/lib/modules/"):
                parts = rel.split("/")
                key = "/".join(parts[4:6]) if len(parts) > 6 else "/".join(parts[4:5])
                modules[key] += size
            package = owner.get(rel)
            component = None
            if package is None:
                component = next((c for c, p in DIRS if rel.startswith(p)), "Unowned: " + "/".join(rel.split("/")[:2]))
            else:
                by_package[package] += size
                component = next(c for c, pattern in COMPONENTS if re.search(pattern, package))
                component = next((c for c, p in DIRS if rel.startswith(p)), component)
            by_component[component] += size
    print(f"Total {mib(total)} MiB in {len(seen)} files\n\nBy component (MiB):")
    for c, n in sorted(by_component.items(), key=lambda kv: -kv[1]):
        print(f"  {mib(n)}  {c}")
    print(f"\nLargest packages (MiB):")
    for p, n in sorted(by_package.items(), key=lambda kv: -kv[1])[:top]:
        print(f"  {mib(n)}  {p}")
    print("\nStrippable by directory (MiB):")
    for p, n in sorted(strippable.items(), key=lambda kv: -kv[1]):
        print(f"  {mib(n)}  {p}")
    print("\nKernel modules by directory (MiB):")
    for p, n in sorted(modules.items(), key=lambda kv: -kv[1])[:15]:
        print(f"  {mib(n)}  {p}")


main()
