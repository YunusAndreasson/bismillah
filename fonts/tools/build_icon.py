#!/usr/bin/env python3
"""Draw bismillah's icon: a single text cursor, centred on the tile.

The cursor is the editor's own caret, drawn bold enough to read at 16 px, in the light
page colour (`surface-editor`, #F7F6F2) on the accent green (#1E6B4A) (DESIGN.md §7,
author's choice 2026-11-03: "very clean, like the single cursor centered inside the
icon"). It is upright and symmetrical, so its centre is the tile's centre.

Writes two sources:

- src-tauri/icons/source.svg: the tile filling the square, the scalable icon Linux
  installs, and the source of the PNG and ICO sizes.
- src-tauri/icons/macos.svg: the same tile on Apple's icon grid (an 824 px tile with a
  100 px margin in 1024), so it sits with the other icons in the Dock and Finder.

Then make the other sizes:

    pnpm exec tauri icon src-tauri/icons/source.svg -o target/scratch/icons
    cp target/scratch/icons/{32x32,64x64,128x128,128x128@2x,icon}.png \
       target/scratch/icons/icon.ico src-tauri/icons/
    pnpm exec tauri icon src-tauri/icons/macos.svg -o target/scratch/icons-mac
    cp target/scratch/icons-mac/icon.icns src-tauri/icons/

Run: python3 -I fonts/tools/build_icon.py
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ICONS = ROOT / "src-tauri/icons"

CANVAS = 1024
GREEN = "#1E6B4A"  # accent, light (DESIGN.md §9.2)
PAPER = "#F7F6F2"  # surface-editor, light
# Of the tile: the cursor's height and width. Its ends are round, as the stroke of a pen.
HEIGHT = 0.46
WIDTH = 0.068


def tile(size: float, radius: float) -> str:
    offset = (CANVAS - size) / 2
    bar_w = size * WIDTH
    bar_h = size * HEIGHT
    x = (CANVAS - bar_w) / 2
    y = (CANVAS - bar_h) / 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS} {CANVAS}">\n'
        "  <!-- bismillah's icon: a single text cursor. fonts/tools/build_icon.py -->\n"
        f'  <rect x="{offset:g}" y="{offset:g}" width="{size:g}" height="{size:g}" '
        f'rx="{radius:g}" fill="{GREEN}"/>\n'
        f'  <rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{bar_h:.1f}" '
        f'rx="{bar_w / 2:.1f}" fill="{PAPER}"/>\n'
        "</svg>\n"
    )


def main() -> None:
    (ICONS / "source.svg").write_text(tile(CANVAS, 224), encoding="utf-8")
    # Apple's grid: 824 in 1024, corner radius about 22.5% of the tile.
    (ICONS / "macos.svg").write_text(tile(824, 185.4), encoding="utf-8")


if __name__ == "__main__":
    main()
