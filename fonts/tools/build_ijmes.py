#!/usr/bin/env python3
"""Build "Bismillah Duo" and "Bismillah Mono": iA Writer Duo/Mono with the IJMES gap closed.

iA Writer Duo and Mono lack the IJMES letters ḥ ṣ ḍ ṭ ẓ (and capitals) and the
half rings ʿ ʾ (fonts/README.md). This script adds them, built only from each
font's own outlines, so they match by construction:

- ḥ ṣ ḍ ṭ ẓ Ḥ Ṣ Ḍ Ṭ Ẓ are composites of the base letter and the font's own
  dotbelowcomb, placed at the font's own mark-to-base anchors, exactly as the
  font builds its Vietnamese dot-below letters (ạ ẹ ị ọ ụ). The anchors' weight
  variation becomes gvar deltas on the component offset, so the dot follows
  the letter across the weight axis.
- ʿ (U+02BF) and ʾ (U+02BE) are the left and right halves of the font's own
  ring accent (U+02DA), cut at its top and bottom extremes and moved to sit
  with the quotation marks. Each kept point keeps its own gvar deltas, so the
  half rings vary across the weight and spacing axes like the ring does.

The output is a modified version under the SIL OFL 1.1, so it must not use the
Reserved Font Names "iA Writer" or "Plex": every name record is renamed and a
modification note is added. The OFL licence file is copied next to the output.

Run: uv run --with fonttools python -I fonts/tools/build_ijmes.py
"""

from __future__ import annotations

import argparse
import array
import math
import shutil
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import ttProgram
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent, GlyphCoordinates
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.varLib.iup import iup_delta

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "fonts" / "source"
BUILD = ROOT / "fonts" / "build"

# (source file, output family, output PostScript family, style)
FONTS = [
    ("ia-writer-duo/iAWriterDuoV.ttf", "Bismillah Duo", "BismillahDuo", "Regular"),
    ("ia-writer-duo/iAWriterDuoV-Italic.ttf", "Bismillah Duo", "BismillahDuo", "Italic"),
    ("ia-writer-mono/iAWriterMonoV.ttf", "Bismillah Mono", "BismillahMono", "Regular"),
    ("ia-writer-mono/iAWriterMonoV-Italic.ttf", "Bismillah Mono", "BismillahMono", "Italic"),
]

DOT_BELOW = {
    0x1E24: "H", 0x1E25: "h",
    0x1E62: "S", 0x1E63: "s",
    0x1E0C: "D", 0x1E0D: "d",
    0x1E6C: "T", 0x1E6D: "t",
    0x1E92: "Z", 0x1E93: "z",
}
HALF_RINGS = {0x02BF: "left", 0x02BE: "right"}  # ʿ ʾ

# Half-ring placement, in font units at the default instance.
HALF_RING_TOP = 746  # quotation marks top out at 740; a round shape overshoots slightly
HALF_RING_SCALE = 1.25  # the ring is an accent; as a letter it needs the size and weight of the quotes
ITALIC_PIVOT_Y = 258  # Duo's italics are centred in the cell around mid x-height

RESERVED_NAMES = ("iA Writer", "iAWriter", "Plex")
MODIFICATION_NOTE = (
    "Modified by the bismillah project (2026) from the upstream fonts at "
    "https://github.com/iaolo/iA-Fonts: renamed because of the OFL Reserved Font Names, "
    "and extended with the IJMES transliteration letters ḥ ṣ ḍ ṭ ẓ Ḥ Ṣ Ḍ Ṭ Ẓ ʿ ʾ, "
    "built from the font's own outlines."
)


RegionKey = tuple[tuple[str, tuple[float, float, float]], ...]


def region_key(axes: dict[str, tuple[float, float, float]]) -> RegionKey:
    return tuple(sorted((tag, tuple(float(v) for v in t)) for tag, t in axes.items()))


def full_deltas(font: TTFont, glyph_name: str) -> dict[RegionKey, list[tuple[float, float]]]:
    """Every point's delta (contour points, then the 4 phantom points) for each region."""
    glyf, gvar = font["glyf"], font["gvar"]
    glyph = glyf[glyph_name]
    coords, ends, _ = glyph.getCoordinates(glyf)
    n_points = len(glyph.components) if glyph.isComposite() else len(coords)
    out: dict[RegionKey, list[tuple[float, float]]] = {}
    for tv in gvar.variations.get(glyph_name, []):
        deltas = list(tv.coordinates)
        contour, phantom = deltas[:n_points], deltas[n_points:]
        if not glyph.isComposite() and any(d is None for d in contour):
            contour = list(iup_delta(contour, list(coords), list(ends)))
        contour = [d if d is not None else (0, 0) for d in contour]
        phantom = [d if d is not None else (0, 0) for d in phantom]
        out[region_key(tv.axes)] = [tuple(d) for d in contour] + [tuple(d) for d in phantom]
    return out


def anchor_deltas(font: TTFont, anchor) -> dict[RegionKey, tuple[float, float]]:
    """Per-region (dx, dy) of a format-3 anchor, read from the GDEF variation store."""
    if anchor is None or anchor.Format != 3:
        return {}
    store = font["GDEF"].table.VarStore
    tags = [a.axisTag for a in font["fvar"].axes]
    out: dict[RegionKey, list[float]] = {}
    for i, dev in enumerate((anchor.XDeviceTable, anchor.YDeviceTable)):
        if dev is None:
            continue
        if dev.DeltaFormat != 0x8000:
            raise ValueError("expected a VariationIndex device table")
        data = store.VarData[dev.StartSize]
        for region_index, delta in zip(data.VarRegionIndex, data.Item[dev.EndSize]):
            region = store.VarRegionList.Region[region_index]
            axes = {
                tag: (ax.StartCoord, ax.PeakCoord, ax.EndCoord)
                for tag, ax in zip(tags, region.VarRegionAxis)
                if ax.PeakCoord != 0
            }
            out.setdefault(region_key(axes), [0.0, 0.0])[i] += delta
    return {k: (v[0], v[1]) for k, v in out.items()}


def dot_below_anchors(font: TTFont) -> tuple[dict[str, object], object]:
    """Base anchors for dotbelowcomb's mark class, and dotbelowcomb's own mark anchor."""
    gpos = font["GPOS"].table
    for lookup in gpos.LookupList.Lookup:
        for sub in lookup.SubTable:
            if lookup.LookupType == 9:
                sub = sub.ExtSubTable
            if getattr(sub, "LookupType", lookup.LookupType) != 4:
                continue
            marks = sub.MarkCoverage.glyphs
            if "dotbelowcomb" not in marks:
                continue
            record = sub.MarkArray.MarkRecord[marks.index("dotbelowcomb")]
            bases = {
                name: sub.BaseArray.BaseRecord[i].BaseAnchor[record.Class]
                for i, name in enumerate(sub.BaseCoverage.glyphs)
            }
            return bases, record.MarkAnchor
    raise ValueError("no mark-to-base anchors for dotbelowcomb")


def add_glyph(font: TTFont, name: str, glyph: Glyph, advance: int, codepoint: int) -> None:
    glyf = font["glyf"]
    order = font.getGlyphOrder()
    if name in order:
        raise ValueError(f"{name} already exists")
    font.setGlyphOrder(order + [name])
    glyf.glyphOrder = font.getGlyphOrder()
    glyf.glyphs[name] = glyph
    glyph.recalcBounds(glyf)
    font["hmtx"].metrics[name] = (advance, glyph.xMin)
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[codepoint] = name
    if "GDEF" in font and font["GDEF"].table.GlyphClassDef:
        font["GDEF"].table.GlyphClassDef.classDefs[name] = 1  # base glyph


def build_dot_below(font: TTFont) -> list[str]:
    bases, mark_anchor = dot_below_anchors(font)
    mark_var = anchor_deltas(font, mark_anchor)
    gvar = font["gvar"]
    added = []
    for codepoint, base in DOT_BELOW.items():
        anchor = bases[base]
        dx0 = anchor.XCoordinate - mark_anchor.XCoordinate
        dy0 = anchor.YCoordinate - mark_anchor.YCoordinate

        glyph = Glyph()
        glyph.numberOfContours = -1
        glyph.components = []
        for comp_name, x, y in ((base, 0, 0), ("dotbelowcomb", dx0, dy0)):
            comp = GlyphComponent()
            comp.glyphName, comp.x, comp.y, comp.flags = comp_name, x, y, 0
            glyph.components.append(comp)
        glyph.components[0].flags = 0x0200  # USE_MY_METRICS: metrics come from the base letter

        base_var = full_deltas(font, base)
        base_anchor_var = anchor_deltas(font, anchor)
        variations = []
        for key in sorted(set(base_var) | set(base_anchor_var) | set(mark_var)):
            bx, by = base_anchor_var.get(key, (0, 0))
            mx, my = mark_var.get(key, (0, 0))
            phantom = base_var.get(key, [(0, 0)] * 4)[-4:]
            coords = [(0, 0), (round(bx - mx), round(by - my))] + [tuple(p) for p in phantom]
            if any(c != (0, 0) for c in coords):
                variations.append(TupleVariation(dict(key), coords))

        name = f"uni{codepoint:04X}"
        add_glyph(font, name, glyph, font["hmtx"][base][0], codepoint)
        gvar.variations[name] = variations
        added.append(name)
    return added


def contour_ranges(coords, ends):
    start = 0
    for end in ends:
        yield list(range(start, end + 1))
        start = end + 1


def cyclic_slice(indices: list[int], first: int, last: int) -> list[int]:
    i, j = indices.index(first), indices.index(last)
    return indices[i : j + 1] if i <= j else indices[i:] + indices[: j + 1]


def build_half_rings(font: TTFont, scale: float = HALF_RING_SCALE) -> list[str]:
    glyf, gvar = font["glyf"], font["gvar"]
    ring = glyf["ring"]
    coords, ends, flags = ring.getCoordinates(glyf)
    contours = list(contour_ranges(coords, ends))
    if len(contours) != 2:
        raise ValueError("expected the ring accent to have an outer and an inner contour")

    def width(c):
        xs = [coords[i][0] for i in c]
        return max(xs) - min(xs)

    outer, inner = sorted(contours, key=width, reverse=True)

    def extremes(c):
        on = [i for i in c if flags[i] & 1]
        return max(on, key=lambda i: coords[i][1]), min(on, key=lambda i: coords[i][1])

    outer_top, outer_bottom = extremes(outer)
    inner_top, inner_bottom = extremes(inner)
    ring_var = full_deltas(font, "ring")
    slant = math.tan(math.radians(-font["post"].italicAngle))
    advance = font["hmtx"]["ring"][0]

    added = []
    for codepoint, side in HALF_RINGS.items():
        # Outer contours run clockwise (bottom, left, top, right) and inner ones
        # anticlockwise, so both halves are forward slices and stay clockwise.
        if side == "left":
            points = cyclic_slice(outer, outer_bottom, outer_top) + cyclic_slice(inner, inner_top, inner_bottom)
        else:
            points = cyclic_slice(outer, outer_top, outer_bottom) + cyclic_slice(inner, inner_bottom, inner_top)

        # Scale about the half ring's centre, then place it: top at HALF_RING_TOP,
        # centred in the cell (on the italic axis for italics).
        raw = [coords[i] for i in points]
        cx = (max(p[0] for p in raw) + min(p[0] for p in raw)) / 2
        cy = (max(p[1] for p in raw) + min(p[1] for p in raw)) / 2
        pts = [((x - cx) * scale, (y - cy) * scale) for x, y in raw]
        top, bottom = max(p[1] for p in pts), min(p[1] for p in pts)
        ty = HALF_RING_TOP - top
        target_x = advance / 2 + ((top + bottom) / 2 + ty - ITALIC_PIVOT_Y) * slant
        tx = target_x - (max(p[0] for p in pts) + min(p[0] for p in pts)) / 2

        glyph = Glyph()
        glyph.numberOfContours = 1
        glyph.coordinates = GlyphCoordinates([(round(x + tx), round(y + ty)) for x, y in pts])
        glyph.endPtsOfContours = [len(pts) - 1]
        glyph.flags = array.array("B", [flags[i] & 1 for i in points])
        glyph.program = ttProgram.Program()
        glyph.program.fromBytecode(b"")

        variations = []
        for key, deltas in ring_var.items():
            kept = [deltas[i] for i in points]
            # Scale the change of shape but not the overall shift (the spacing
            # axis moves every point by the same amount).
            mx = sum(d[0] for d in kept) / len(kept)
            my = sum(d[1] for d in kept) / len(kept)
            kept = [(mx + (dx - mx) * scale, my + (dy - my) * scale) for dx, dy in kept]
            coords_var = kept + deltas[-4:]
            variations.append(TupleVariation(dict(key), [tuple(map(round, d)) for d in coords_var]))

        name = f"uni{codepoint:04X}"
        add_glyph(font, name, glyph, advance, codepoint)
        gvar.variations[name] = variations
        added.append(name)
    return added


def rename(font: TTFont, family: str, ps_family: str, style: str) -> None:
    name = font["name"]
    ps_name = f"{ps_family}-{style}"
    version = (name.getDebugName(5) or "Version 2.000").replace("Version ", "")
    is_italic = style == "Italic"
    # RIBBI naming, as the upstream files do: one family, Regular or Italic.
    values = {
        1: family,
        2: style,
        3: f"{version};BSML;{ps_name}",
        4: f"{family} {style}" if is_italic else family,
        6: ps_name,
        10: MODIFICATION_NOTE,
        16: family,
        17: style,
    }
    for record in list(name.names):
        if record.nameID in values:
            name.removeNames(nameID=record.nameID)
    for name_id, value in values.items():
        name.setName(value, name_id, 3, 1, 0x409)
    # Remaining records that carry the old name, e.g. named-instance PostScript names.
    old_ps = (name.getDebugName(500) or "").split("-")[0]
    for record in name.names:
        text = record.toUnicode()
        if old_ps and old_ps in text:
            record.string = text.replace(old_ps, ps_family)
    for record in name.names:
        text = record.toUnicode()
        if record.nameID not in (0, 13, 14) and any(r in text for r in RESERVED_NAMES):
            raise ValueError(f"name {record.nameID} still contains a Reserved Font Name: {text!r}")
    if font["post"].formatType != 2.0:
        raise ValueError("expected a post table with glyph names (format 2)")


def drop_dangling_stat_values(font: TTFont) -> None:
    """Upstream Duo's STAT names SPCG values with name IDs that don't exist, so
    OpenType Sanitizer (used by Chromium-based webviews) drops the whole table."""
    if "STAT" not in font or not font["STAT"].table.AxisValueArray:
        return
    ids = {record.nameID for record in font["name"].names}
    stat = font["STAT"].table
    stat.AxisValueArray.AxisValue = [v for v in stat.AxisValueArray.AxisValue if v.ValueNameID in ids]
    stat.AxisValueCount = len(stat.AxisValueArray.AxisValue)


def build(source: Path, out: Path, family: str, ps_family: str, style: str, scale: float) -> list[str]:
    font = TTFont(source, recalcTimestamp=False)  # reproducible output
    added = build_dot_below(font) + build_half_rings(font, scale)
    rename(font, family, ps_family, style)
    drop_dangling_stat_values(font)
    font.save(out)
    return added


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=BUILD)
    parser.add_argument("--half-ring-scale", type=float, default=HALF_RING_SCALE, help="for trying designs")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for rel, family, ps_family, style in FONTS:
        source = SOURCE / rel
        out = args.out / f"{ps_family}-{style}.ttf"
        added = build(source, out, family, ps_family, style, args.half_ring_scale)
        print(f"{out}: added {', '.join(added)}")
    shutil.copy(SOURCE / "ia-writer-duo" / "LICENSE.md", args.out / "LICENSE.md")


if __name__ == "__main__":
    main()
