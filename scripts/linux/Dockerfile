# The Linux machine in a container, so the whole gate (`pnpm verify`) also runs on a Mac:
# WebKitGTK, its WebDriver, Xvfb and D-Bus for the real-app suites (scripts/linux.sh).
# x86_64 Arch Linux, like the author's machine, so WebKitGTK and the fonts match the
# visual baselines as closely as a container can.
FROM --platform=linux/amd64 archlinux:latest

# pacman's download sandbox needs seccomp, which x86_64 emulation on a Mac (Rosetta) lacks.
# webkitgtk-6.0 ships /usr/bin/WebKitWebDriver, the same WebKit as webkit2gtk-4.1;
# Liberation is the installed font the Settings tests choose by name.
RUN pacman -Syu --noconfirm --needed --disable-sandbox \
      base-devel git rsync rustup nodejs npm \
      webkit2gtk-4.1 gtk3 libsoup3 librsvg dbus fontconfig \
      webkitgtk-6.0 \
      xorg-server-xvfb xorg-xauth xdotool fuse3 \
      noto-fonts noto-fonts-emoji ttf-liberation \
  && pacman -Scc --noconfirm --disable-sandbox \
  && npm install --global pnpm@11.2.2

# Not root: tests that check permissions can't fail as root (platform::is_root).
RUN useradd --create-home --uid 1000 writer
USER writer
ENV PATH=/home/writer/.cargo/bin:$PATH
# The Rust of the author's machine (mobile/PLAN.md, *What the Linux machine has*).
RUN rustup toolchain install 1.99.0 --profile minimal --component clippy,rustfmt \
  && rustup default 1.99.0 \
  && cargo install tauri-driver --locked \
  && cargo install cargo-deny --locked

WORKDIR /work/repo
