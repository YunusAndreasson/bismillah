#!/usr/bin/env python3
"""Verify the fonts built by build_ijmes.py and render proof sheets.

Checks, at several weight and spacing instances:
- the cmap covers the IJMES set and the smart-punctuation set;
- each dot-below composite puts the dot exactly where the font's own GPOS
  mark-to-base anchor puts it for the decomposed sequence h + U+0323, so both
  forms look the same (a pixel comparison is not used: FreeType's autohinter
  hints a composite as one glyph, which moves edges by subpixel amounts);
- the half rings are single clockwise contours with no self-intersections.

Run: uv run --with fonttools --with pillow python -I fonts/tools/verify_ijmes.py --proofs <dir>
"""

from __future__ import annotations

import argparse
import sys
import unicodedata
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "fonts" / "build"
SOURCE = ROOT / "fonts" / "source"

PAIRS = [
    ("BismillahDuo-Regular.ttf", "ia-writer-duo/iAWriterDuoV.ttf"),
    ("BismillahDuo-Italic.ttf", "ia-writer-duo/iAWriterDuoV-Italic.ttf"),
    ("BismillahMono-Regular.ttf", "ia-writer-mono/iAWriterMonoV.ttf"),
    ("BismillahMono-Italic.ttf", "ia-writer-mono/iAWriterMonoV-Italic.ttf"),
]
IJMES = "āīūĀĪŪḥṣḍṭẓḤṢḌṬẒʿʾ"
PUNCTUATION = "“”‘’–—…«»"
DOT_LETTERS = "ḥṣḍṭẓḤṢḌṬẒ"
INSTANCES = [
    {"wght": 400, "SPCG": 0},
    {"wght": 450, "SPCG": 0},
    {"wght": 650, "SPCG": 0},
    {"wght": 700, "SPCG": 0},
    {"wght": 700, "SPCG": 150},
]
SAMPLE = "al-Fātiḥa, Qurʾān, ḥadīth, ʿilm, ṣalāh, ḍalāl, ṭahāra, ẓulm, Ḥanbalī, ʿAbd al-Raḥmān"


class FlattenPen(BasePen):
    """Flattens outlines to polygons (quadratic curves split into short segments)."""

    def __init__(self, glyphset):
        super().__init__(glyphset)
        self.contours: list[list[tuple[float, float]]] = []

    def _moveTo(self, p):
        self.contours.append([p])

    def _lineTo(self, p):
        self.contours[-1].append(p)

    def _qCurveToOne(self, p1, p2):
        p0 = self.contours[-1][-1]
        for i in range(1, 9):
            t = i / 8
            x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t**2 * p2[0]
            y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t**2 * p2[1]
            self.contours[-1].append((x, y))

    def _curveToOne(self, p1, p2, p3):
        raise ValueError("unexpected cubic curve")

    def _closePath(self):
        pass


def signed_area(poly):
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1])) / 2


def self_intersects(poly) -> bool:
    edges = list(zip(poly, poly[1:] + poly[:1]))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    for i, (a, b) in enumerate(edges):
        for j in range(i + 2, len(edges)):
            if i == 0 and j == len(edges) - 1:
                continue
            c, d = edges[j]
            if (
                cross(a, b, c) * cross(a, b, d) < 0
                and cross(c, d, a) * cross(c, d, b) < 0
            ):
                return True
    return False


def check_font(built: Path, failures: list[str]) -> None:
    font = TTFont(built)
    cmap = font.getBestCmap()
    missing = [c for c in IJMES + PUNCTUATION if ord(c) not in cmap]
    if missing:
        failures.append(f"{built.name}: missing {''.join(missing)}")
    for loc in INSTANCES:
        inst = instantiateVariableFont(TTFont(built), loc)
        glyphset = inst.getGlyphSet()
        gpos = inst["GPOS"].table.LookupList.Lookup[0].SubTable[0]
        marks = gpos.MarkCoverage.glyphs
        mark = gpos.MarkArray.MarkRecord[marks.index("dotbelowcomb")]
        bases = gpos.BaseCoverage.glyphs
        for ch in DOT_LETTERS:
            name = cmap[ord(ch)]
            base = unicodedata.normalize("NFD", ch)[0]
            anchor = gpos.BaseArray.BaseRecord[bases.index(base)].BaseAnchor[mark.Class]
            comp = inst["glyf"][name].components[1]
            want = (anchor.XCoordinate - mark.MarkAnchor.XCoordinate, anchor.YCoordinate - mark.MarkAnchor.YCoordinate)
            if abs(comp.x - want[0]) > 1 or abs(comp.y - want[1]) > 1:  # both sides rounded
                failures.append(f"{built.name} {loc}: {ch} dot at {(comp.x, comp.y)}, anchor says {want}")
            if inst["hmtx"][name][0] != inst["hmtx"][base][0]:
                failures.append(f"{built.name} {loc}: {ch} advance differs from {base}")
        for ch in "ʿʾ":
            pen = FlattenPen(glyphset)
            glyphset[cmap[ord(ch)]].draw(pen)
            if len(pen.contours) != 1:
                failures.append(f"{built.name} {loc}: {ch} has {len(pen.contours)} contours")
                continue
            poly = pen.contours[0]
            if signed_area(poly) >= 0:
                failures.append(f"{built.name} {loc}: {ch} is not clockwise")
            if abs(signed_area(poly)) < 1000:
                failures.append(f"{built.name} {loc}: {ch} is degenerate")
            if self_intersects(poly):
                failures.append(f"{built.name} {loc}: {ch} self-intersects")


def render_proofs(out: Path, failures: list[str]) -> list[Path]:
    from PIL import Image, ImageDraw, ImageFont

    out.mkdir(parents=True, exist_ok=True)
    made = []
    nfd_sample = "".join(
        unicodedata.normalize("NFD", c) if c in DOT_LETTERS else {"ʿ": "‘", "ʾ": "’"}.get(c, c)
        for c in SAMPLE
    )
    label_font = ImageFont.load_default(size=16)

    def face(path: Path, size: int, wght: int):
        f = ImageFont.truetype(str(path), size, layout_engine=ImageFont.Layout.RAQM)
        f.set_variation_by_axes([wght, 0])
        return f

    for built_name, source_rel in PAIRS:
        built, source = BUILD / built_name, SOURCE / source_rel
        rows = []
        for wght in (400, 700):
            rows.append((f"{built_name} wght {wght}: precomposed, new ʿ ʾ", face(built, 40, wght), SAMPLE))
            rows.append((f"upstream wght {wght}: h+U+0323 via GPOS, ‘ ’ for comparison", face(source, 40, wght), nfd_sample))
        img = Image.new("L", (2200, 110 * len(rows) + 20), 255)
        draw = ImageDraw.Draw(img)
        for i, (label, fnt, text) in enumerate(rows):
            y = 20 + 110 * i
            draw.text((20, y), label, font=label_font, fill=110)
            draw.text((20, y + 30), text, font=fnt, fill=0)
        path = out / f"proof-{built.stem}.png"
        img.save(path)
        made.append(path)

        # Large glyph sheet for close inspection.
        sheet_text = "ḥṣḍṭẓ ḤṢḌṬẒ ʿʾ ‘’ ạọ ˚"
        sheet = Image.new("L", (2600, 520), 255)
        sd = ImageDraw.Draw(sheet)
        for i, wght in enumerate((400, 700)):
            sd.text((20, 10 + 255 * i), f"wght {wght}", font=label_font, fill=110)
            sd.text((20, 10 + 255 * i), sheet_text, font=face(built, 150, wght), fill=0)
        path = out / f"glyphs-{built.stem}.png"
        sheet.save(path)
        made.append(path)

    return made


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--proofs", type=Path, help="directory for proof PNGs")
    args = parser.parse_args()
    failures: list[str] = []
    for built_name, _ in PAIRS:
        check_font(BUILD / built_name, failures)
    if args.proofs:
        for p in render_proofs(args.proofs, failures):
            print(p)
    if failures:
        print("\n".join(failures), file=sys.stderr)
        sys.exit(1)
    print(f"OK: {len(PAIRS)} fonts × {len(INSTANCES)} instances")


if __name__ == "__main__":
    main()
