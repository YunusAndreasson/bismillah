# Makes the pictures of the laptop scene (Screens.astro), one for each moment of her
# night (src/assets/scenes/, PROMPTS.md there), laying the stick's real screens
# (src/assets/screens/) onto her laptop where a moment shows it. Each is saved twice, at
# twice the photograph's size so the editor's text stays sharp: a wide strip for a
# computer's window, and a square for a phone, wide enough for a whole screen. The photographs are upscaled; the
# screens are the app's own pixels, put into their perspective, and then each whole
# frame is graded after the film's frames (the director project's production.yaml,
# look.grade), screen and all, so they sit in the film's world. Run by hand after
# scripts/screens.sh:
#   uv run --no-project --with pillow --with numpy python -I scripts/laptop.py
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SCALE = 2
# The wide strip's shape (1536:820), every scene the same, so the stage never moves.
WIDE = 1536 / 820
PHONE = 1

# name: the generated photograph (src/assets/scenes/),
# the app's screen laid on it or None where the moment shows an action instead, and a
# point: on a screen's generated blank page, to find its corners from (or the corners
# themselves), or, without a screen, what the crops centre on (1536×1024).
SCENES = {
    "words": ("words", "page-light", (475, 515)),
    "zuhd": ("zuhd", "zuhd-light", (828, 396)),
    "arabic": ("arabic", "arabic-light", (677, 350)),
    "private": ("tape", None, (820, 470)),
    "anywhere": ("anywhere", "page-light", (1142, 495)),
}
# Every screen at the app's own size, as it is: where the writing must be read, the
# camera comes closer instead (the author, 2026-10-29: a screen shown larger looked
# false; Zuhd's, at its own size and close, looks real).


def find_screen(still: Image.Image, near: tuple[int, int]) -> list[tuple[int, int]]:
    """The generated blank page, the near-white region around `near`: each of its four
    edges is fitted with a line through the middle of that edge, where nothing touches
    it (a lit page beside the laptop can join a corner), and the corners are where the
    lines meet, pushed out by a pixel, as the threshold stops short of the soft edge."""
    a = np.asarray(still).astype(int)
    bright = a.min(axis=2) > 200
    # A copy: an image made from an array shares its memory, which the fill leaves alone.
    mask = Image.fromarray((bright * 255).astype(np.uint8)).copy()
    ImageDraw.floodfill(mask, near, 128)
    region = np.asarray(mask) == 128
    ys, xs = np.nonzero(region)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()

    def edge(along: np.ndarray, across: np.ndarray) -> tuple[float, float]:
        # across = m * along + c, refitted without the points more than 2px off.
        m, c = np.polyfit(along, across, 1)
        keep = np.abs(across - (m * along + c)) < 2
        return tuple(np.polyfit(along[keep], across[keep], 1))

    cols = np.arange(round(x0 + 0.25 * (x1 - x0)), round(x1 - 0.25 * (x1 - x0)))
    rows = np.arange(round(y0 + 0.25 * (y1 - y0)), round(y1 - 0.25 * (y1 - y0)))
    top = edge(cols, np.array([np.nonzero(region[:, x])[0].min() for x in cols], float))
    bottom = edge(cols, np.array([np.nonzero(region[:, x])[0].max() for x in cols], float))
    left = edge(rows, np.array([np.nonzero(region[y])[0].min() for y in rows], float))
    right = edge(rows, np.array([np.nonzero(region[y])[0].max() for y in rows], float))

    def meet(h: tuple[float, float], v: tuple[float, float]) -> tuple[float, float]:
        # y = mh x + ch and x = mv y + cv.
        (mh, ch), (mv, cv) = h, v
        y = (mh * cv + ch) / (1 - mh * mv)
        return mv * y + cv, y

    g = 1
    corners = [meet(top, left), meet(top, right), meet(bottom, right), meet(bottom, left)]
    signs = [(-g, -g), (g, -g), (g, g), (-g, g)]
    return [(round(x + dx), round(y + dy)) for (x, y), (dx, dy) in zip(corners, signs)]


# The film's grade made for a lit page: its colour, vignette and grain, without the
# darkening a cinema can afford (brightness -0.035, gamma 0.88), so each moment reads
# at a glance on a phone in daylight (the author, 2026-10-29: "this will be viewed by
# humans").
GRADE = "eq=contrast=1.06:saturation=0.9,vignette=angle=PI/5,noise=alls=6:allf=t+u"


def grade(image: Image.Image) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        image.save(f"{tmp}/in.png")
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", f"{tmp}/in.png", "-vf", GRADE, f"{tmp}/out.png"],
            check=True,
        )
        return Image.open(f"{tmp}/out.png").convert("RGB")


def lay(still: Image.Image, quad, screen: str) -> Image.Image:
    w, h = still.size
    # The screen in the photograph may be wider than the app's 16:10: the capture is
    # widened with its own paper colour at both sides, as a wider window would be, so
    # nothing is stretched or cut.
    ratio = (quad[1][0] - quad[0][0] + quad[2][0] - quad[3][0]) / (
        quad[3][1] - quad[0][1] + quad[2][1] - quad[1][1]
    )
    shot = Image.open(f"src/assets/screens/{screen}.png").convert("RGB")
    fw = max(shot.width, round(shot.height * ratio))
    frame = Image.new("RGB", (fw, shot.height), shot.getpixel((4, 900)))
    frame.paste(shot, ((fw - shot.width) // 2, 0))
    # Narrower than 16:10, the capture keeps its width and loses rows at the bottom,
    # where the status line is, rather than being squeezed. The status line goes back
    # at the bottom of what is kept.
    fh = min(shot.height, round(fw / ratio))
    if fh < shot.height:
        status = shot.crop((0, shot.height - 90, shot.width, shot.height))
        frame = frame.crop((0, 0, fw, fh))
        frame.paste(status, ((fw - shot.width) // 2, fh - 90))
    # A screen in a room reads a touch below the paper's full white.
    frame = frame.point(lambda v: round(v * 0.94))

    src = [(0, 0), (fw, 0), (fw, fh), (0, fh)]
    rows, rhs = [], []
    for (x, y), (u, v) in zip(quad, src):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.append(u)
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.append(v)
    coeffs = tuple(np.linalg.solve(np.array(rows, float), np.array(rhs, float)))
    warped = frame.transform(still.size, Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC)

    big = Image.new("L", (w * 4, h * 4), 0)
    ImageDraw.Draw(big).polygon([(x * 4, y * 4) for x, y in quad], fill=255)
    mask = big.resize(still.size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    out = still.copy()
    out.paste(warped, (0, 0), mask)
    return out


for name, (photo, screen, point) in SCENES.items():
    still = Image.open(f"src/assets/scenes/{photo}.jpg").convert("RGB")
    if screen:
        quad = point if len(point) == 4 else find_screen(still, point)
        print(name, "screen corners TL TR BR BL:", quad)
        cx = sum(x for x, _ in quad) / 4
        cy = sum(y for _, y in quad) / 4
    else:
        cx, cy = point
    still = still.resize((still.width * SCALE, still.height * SCALE), Image.Resampling.LANCZOS)
    quad2 = [(x * SCALE, y * SCALE) for x, y in quad] if screen else None
    out = lay(still, quad2, screen) if screen else still
    out = grade(out)
    cx, cy = cx * SCALE, cy * SCALE
    w, h = out.size

    # The wide strip: the whole width, its rows around the screen or the action.
    sh = round(w / WIDE)
    y0 = round(min(max(cy - sh * 0.45, 0), h - sh))
    out.crop((0, y0, w, y0 + sh)).save(f"src/assets/laptop/{name}.jpg", quality=90)

    # The phone's square, around the same point, as tall as the picture allows.
    ph = round(h * 0.92)
    pw = round(ph * PHONE)
    x0 = round(min(max(cx - pw / 2, 0), w - pw))
    y1 = round(min(max(cy - ph * 0.5, 0), h - ph))
    out.crop((x0, y1, x0 + pw, y1 + ph)).save(f"src/assets/laptop/{name}-phone.jpg", quality=88)
    print("saved", f"src/assets/laptop/{name}.jpg", "and", f"{name}-phone.jpg")
