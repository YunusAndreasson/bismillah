# Lays a real frame of the editor onto the blank laptop screen of a generated still, so
# the only text in a picture is the app's own (src/assets/steps/PROMPTS.md). Run by hand:
#   uv run --no-project --with pillow --with numpy python -I scripts/screen.py \
#     <still.png> media/stills/04-first-question.jpg <out.png>
import sys
import numpy as np
from PIL import Image, ImageFilter

still = Image.open(sys.argv[1]).convert("RGB")
frame = Image.open(sys.argv[2]).convert("RGB")
a = np.asarray(still).astype(int)

# The screen: the large near-white region in the middle of the picture.
bright = a.min(axis=2) > 225
h, w = bright.shape
bright[:, : w // 4] = False  # the lamp sits at the left
ys, xs = np.nonzero(bright)
pts = np.stack([xs, ys], axis=1)
s, d = pts.sum(1), pts[:, 0] - pts[:, 1]
tl, br = pts[s.argmin()], pts[s.argmax()]
tr, bl = pts[d.argmax()], pts[d.argmin()]
# The threshold stops a pixel short of the screen's soft edge, so push each corner out
# by two pixels; the frame then covers every pixel of the generated white.
grow = 2
quad = [
    (int(tl[0]) - grow, int(tl[1]) - grow),
    (int(tr[0]) + grow, int(tr[1]) - grow),
    (int(br[0]) + grow, int(br[1]) + grow),
    (int(bl[0]) - grow, int(bl[1]) + grow),
]
print("screen corners TL TR BR BL:", quad)

# Perspective coefficients mapping output (still) coordinates to frame coordinates.
fw, fh = frame.size
src = [(0, 0), (fw, 0), (fw, fh), (0, fh)]
rows, rhs = [], []
for (x, y), (u, v) in zip(quad, src):
    rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.append(u)
    rows.append([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.append(v)
coeffs = np.linalg.solve(np.array(rows, float), np.array(rhs, float))

# A screen seen across a table is a touch soft, never sharper than the photograph.
frame = frame.filter(ImageFilter.GaussianBlur(0.6))
warped = frame.transform(still.size, Image.Transform.PERSPECTIVE, tuple(coeffs), Image.Resampling.BICUBIC)

# The mask: the same quad, rendered at 4x and scaled down for clean edges.
from PIL import ImageDraw
big = Image.new("L", (w * 4, h * 4), 0)
ImageDraw.Draw(big).polygon([(x * 4, y * 4) for x, y in quad], fill=255)
mask = big.resize(still.size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.4))

out = still.copy()
out.paste(warped, (0, 0), mask)
out.save(sys.argv[3])
print("saved", sys.argv[3])
