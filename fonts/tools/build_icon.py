#!/usr/bin/env python3
"""Draw bismillah's icon: the letter bāʾ (ب), the first letter of the Basmallah.

The bāʾ is Amiri Bold's own outline (SIL OFL 1.1, the font bismillah sets Arabic in),
in the light page colour (`surface-editor`, #F7F6F2) on the accent green (#1E6B4A),
on the rounded tile of the earlier icon. Its ink box is 60% of the tile wide, centred,
and set a little low so the bowl and its dot sit at the tile's optical centre.

Writes src-tauri/icons/source.svg. Then make the other sizes from it:

    pnpm exec tauri icon src-tauri/icons/source.svg -o target/scratch/icons
    cp target/scratch/icons/{32x32,64x64,128x128,128x128@2x,icon}.png \
       target/scratch/icons/icon.{ico,icns} src-tauri/icons/

Run: uv run --with fonttools python -I fonts/tools/build_icon.py
"""

from __future__ import annotations

from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "fonts/source/amiri/Amiri-Bold.ttf"
OUT = ROOT / "src-tauri/icons/source.svg"

TILE = 1024
RADIUS = 224
GREEN = "#1E6B4A"  # accent, light (DESIGN.md §9.2)
PAPER = "#F7F6F2"  # surface-editor, light
WIDTH = 0.60  # of the tile, for the letter's ink box
NUDGE = 10  # px down from the box's centre: the dot is light, the bowl heavy


def main() -> None:
    font = TTFont(FONT)
    glyphs = font.getGlyphSet()
    name = font.getBestCmap()[ord("ب")]
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(pen)
    bounds = BoundsPen(glyphs)
    glyphs[name].draw(bounds)
    x0, y0, x1, y1 = bounds.bounds
    scale = TILE * WIDTH / (x1 - x0)
    tx = TILE / 2 - (x0 + x1) / 2 * scale
    ty = TILE / 2 + (y0 + y1) / 2 * scale + NUDGE
    OUT.write_text(
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {TILE} {TILE}">
  <!-- bismillah's icon: the bāʾ (ب) from Amiri Bold (SIL OFL 1.1). fonts/tools/build_icon.py -->
  <rect width="{TILE}" height="{TILE}" rx="{RADIUS}" fill="{GREEN}"/>
  <path transform="translate({tx:.1f} {ty:.1f}) scale({scale:.4f} {-scale:.4f})" fill="{PAPER}" d="{pen.getCommands()}"/>
</svg>
""",
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
