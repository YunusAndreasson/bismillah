# Lays the stick's real screens (src/assets/screens/) onto the laptop in step 3's
# photograph, one picture per state of the editor that Screens.astro shows, at twice the
# photograph's size so the editor's text stays sharp. The photograph is upscaled; the
# screens are the app's own pixels, put into its perspective. Run by hand after
# scripts/screens.sh:
#   uv run --no-project --with pillow --with numpy python -I scripts/laptop.py
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SCALE = 2
# The laptop's screen in src/assets/steps/step-3.jpg (1536×1024), as scripts/screen.py
# found it: top left, top right, bottom right, bottom left.
QUAD = [(504, 141), (1321, 139), (1333, 616), (493, 616)]
STATES = ["page", "zuhd", "arabic", "suggestion", "files"]

still = Image.open("src/assets/steps/step-3.jpg").convert("RGB")
still = still.resize((still.width * SCALE, still.height * SCALE), Image.Resampling.LANCZOS)
quad = [(x * SCALE, y * SCALE) for x, y in QUAD]
w, h = still.size

# The screen in the photograph is wider than the app's 16:10: the capture is widened
# with its own paper colour at both sides, as a wider window would be, so nothing is
# stretched or cut.
ratio = (quad[1][0] - quad[0][0] + quad[2][0] - quad[3][0]) / (quad[3][1] - quad[0][1] + quad[2][1] - quad[1][1])
fh = 1800
fw = round(fh * ratio)

# Perspective coefficients mapping output (photograph) coordinates to frame coordinates.
src = [(0, 0), (fw, 0), (fw, fh), (0, fh)]
rows, rhs = [], []
for (x, y), (u, v) in zip(quad, src):
    rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.append(u)
    rows.append([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.append(v)
coeffs = tuple(np.linalg.solve(np.array(rows, float), np.array(rhs, float)))

big = Image.new("L", (w * 4, h * 4), 0)
ImageDraw.Draw(big).polygon([(x * 4, y * 4) for x, y in quad], fill=255)
mask = big.resize(still.size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))

for state in STATES:
    shot = Image.open(f"src/assets/screens/{state}-light.png").convert("RGB")
    frame = Image.new("RGB", (fw, fh), shot.getpixel((4, 900)))
    frame.paste(shot, ((fw - shot.width) // 2, 0))
    # A screen in a dark room reads a touch below the paper's full white.
    frame = frame.point(lambda v: round(v * 0.94))
    warped = frame.transform(still.size, Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC)
    out = still.copy()
    out.paste(warped, (0, 0), mask)
    # Closer on the laptop: the lamp stays, the empty table in front goes.
    out = out.crop((0, 80 * SCALE, w, 900 * SCALE))
    out.save(f"src/assets/laptop/{state}.jpg", quality=90)
    print("saved", f"src/assets/laptop/{state}.jpg")
