"""Reference ink boxes for Arabic words, computed with HarfBuzz and the font's own glyph
bounds (no rasteriser). Used by arabic-rendering.ts to check what WebKitGTK draws.

    uv run --with uharfbuzz --with fonttools python -I spikes/webview/arabic_reference.py \
        <font.ttf> <words.json> <size_px> > reference.json

For each word: ink top and bottom relative to the baseline (px, y up) and ink width.
"""

import json
import sys

import uharfbuzz as hb
from fontTools.ttLib import TTFont


def main() -> None:
    font_path, words_path, size = sys.argv[1], sys.argv[2], float(sys.argv[3])
    words = json.load(open(words_path, encoding="utf-8"))
    tt = TTFont(font_path)
    upm = tt["head"].unitsPerEm
    glyf = tt["glyf"]
    order = tt.getGlyphOrder()
    font = hb.Font(hb.Face(hb.Blob.from_file_path(font_path)))
    scale = size / upm
    out = []
    for word in words:
        buf = hb.Buffer()
        buf.add_str(word)
        buf.guess_segment_properties()
        buf.language = "ar"
        hb.shape(font, buf, {})
        x = 0
        top, bottom, left, right = -1e9, 1e9, 1e9, -1e9
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            g = glyf[order[info.codepoint]]
            if g.numberOfContours != 0:
                g.recalcBounds(glyf)
                gx, gy = x + pos.x_offset, pos.y_offset
                top = max(top, gy + g.yMax)
                bottom = min(bottom, gy + g.yMin)
                left = min(left, gx + g.xMin)
                right = max(right, gx + g.xMax)
            x += pos.x_advance
        out.append(
            {
                "word": word,
                "top": round(top * scale, 2),
                "bottom": round(bottom * scale, 2),
                "width": round((right - left) * scale, 2),
            }
        )
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
