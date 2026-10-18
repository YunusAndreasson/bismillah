"""Reference ink boxes for the Arabic rendering check (ADR-0011), computed with HarfBuzz
and each font's own glyph bounds (no rasteriser). tests/visual/arabic-rendering.visual.ts
compares what WebKitGTK draws with these numbers.

Regenerate after changing a bundled Arabic font or the word sources below, then rerun the
visual suite with UPDATE_BASELINES=1 and review the diff of the expected errors:

    uv run --with uharfbuzz --with fonttools python -I tests/visual/tools/arabic_reference.py \
        > tests/fixtures/arabic-rendering-reference.json

For every vocalised word in the sources and every font: the ink's top and bottom relative
to the baseline (px at SIZE, y up). Each font's SHA-256 is recorded so the test notices
when a font changes under a stale reference.
"""

import hashlib
import json
import re
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont

REPO = Path(__file__).resolve().parents[3]
SIZE = 40
FONTS = [
    ("IBM Plex Sans Arabic", "fonts/source/ibm-plex-sans-arabic/IBMPlexSansArabic-Regular.ttf"),
    ("Amiri", "fonts/source/amiri/Amiri-Regular.ttf"),
    ("Amiri Quran", "fonts/source/amiri/AmiriQuran.ttf"),
]
# Vocalised words from the specimen and the Qur'an fixtures.
SOURCES = [
    "docs/specimen.md",
    "tests/fixtures/profiles.md",
    "tests/fixtures/quran/tanzil-uthmani.txt",
    "tests/fixtures/quran/qurancom-qpc-hafs.txt",
]
VOCALISED = re.compile("[ً-ْٰۖ-ۭ]")
NOT_ARABIC = re.compile("[^؀-ۿࢠ-ࣿ]")


def words() -> list[str]:
    found: dict[str, None] = {}
    for source in SOURCES:
        text = (REPO / source).read_text(encoding="utf-8")
        for token in re.split(r"[\s|]+", text):
            word = NOT_ARABIC.sub("", token)
            if len(word) > 1 and VOCALISED.search(word):
                found.setdefault(word, None)
    return list(found)


def ink(font_path: Path, word_list: list[str]) -> list[dict[str, float]]:
    tt = TTFont(font_path)
    upm = tt["head"].unitsPerEm
    glyf = tt["glyf"]
    order = tt.getGlyphOrder()
    font = hb.Font(hb.Face(hb.Blob.from_file_path(str(font_path))))
    scale = SIZE / upm
    out = []
    for word in word_list:
        buf = hb.Buffer()
        buf.add_str(word)
        buf.guess_segment_properties()
        buf.language = "ar"
        hb.shape(font, buf, {})
        top, bottom = -1e9, 1e9
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            g = glyf[order[info.codepoint]]
            if g.numberOfContours != 0:
                g.recalcBounds(glyf)
                top = max(top, pos.y_offset + g.yMax)
                bottom = min(bottom, pos.y_offset + g.yMin)
        out.append({"top": round(top * scale, 2), "bottom": round(bottom * scale, 2)})
    return out


def main() -> None:
    word_list = words()
    fonts = []
    for family, file in FONTS:
        path = REPO / file
        fonts.append(
            {
                "family": family,
                "file": file,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "ink": ink(path, word_list),
            }
        )
    reference = {
        "generator": "tests/visual/tools/arabic_reference.py",
        "harfbuzz": hb.version_string(),
        "size": SIZE,
        "words": word_list,
        "fonts": fonts,
    }
    json.dump(reference, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
