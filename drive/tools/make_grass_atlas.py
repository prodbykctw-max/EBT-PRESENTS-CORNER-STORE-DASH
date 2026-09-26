"""Grass-tuft atlas for the lawns, composed from the real CC0 grass scans (Poly Haven grass_bermuda_01).
Each row is one tuft card: a strip of grass plants standing side by side with every plant's base on the bottom edge
(the card is planted there). 4 variants, 512×128 each, stacked into a 512×512 atlas.
Output: public/drive/tex/grass_tuft.webp (+ a preview on blue in drive/art/foliage/).
Run: python drive/tools/make_grass_atlas.py
"""
import random, colorsys
from PIL import Image, ImageEnhance, ImageFilter

ROOT = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH"
SRC = ROOT + r"\drive\art\foliage\grass_bermuda_01"
random.seed(3)

diff = Image.open(SRC + r"\Diffuse.jpg").convert("RGB")
alpha = Image.open(SRC + r"\Alpha.png").point(lambda v: v / 257).convert("L")
sheet = diff.copy(); sheet.putalpha(alpha)

def blobs(a):
    w, h = a.size; px = a.load(); seen = set(); out = []
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            if px[x, y] > 128 and (x, y) not in seen:
                stack = [(x, y)]; box = [x, y, x, y]; n = 0
                while stack:
                    cx, cy = stack.pop()
                    if (cx, cy) in seen or not (0 <= cx < w and 0 <= cy < h) or px[cx, cy] <= 128: continue
                    seen.add((cx, cy)); n += 1
                    box = [min(box[0], cx), min(box[1], cy), max(box[2], cx), max(box[3], cy)]
                    stack += [(cx + 3, cy), (cx - 3, cy), (cx, cy + 3), (cx, cy - 3)]
                if n > 150: out.append(tuple(box))
    return out

def green(img):
    """mean hue of the opaque pixels is green (drops the dry brown clump)"""
    rgb, a = img.convert("RGB").resize((32, 32)), img.getchannel("A").resize((32, 32))
    px = [p for p, al in zip(rgb.getdata(), a.getdata()) if al > 128]
    r, g, b = (sum(c[i] for c in px) / len(px) for i in range(3))
    return g > r * 1.05

plants = []
for x0, y0, x1, y1 in blobs(alpha):
    w, h = x1 - x0, y1 - y0
    if h > 6 * w: continue                                   # the bare seed stalks
    p = sheet.crop((max(0, x0 - 3), max(0, y0 - 3), x1 + 4, y1 + 4))
    if green(p): plants.append(p)
print("plants:", len(plants))

W, H = 512, 128
atlas = Image.new("RGBA", (W, H * 4), (0, 0, 0, 0))
for row in range(4):
    strip = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    x = -10
    while x < W - 20:
        p = random.choice(plants)
        s = H * random.uniform(0.62, 1.0) / p.height                  # plants of different heights, none cut off
        q = p.resize((max(2, int(p.width * s)), max(2, int(p.height * s))), Image.LANCZOS)
        if random.random() < 0.5: q = q.transpose(Image.FLIP_LEFT_RIGHT)
        rgb = ImageEnhance.Brightness(q.convert("RGB")).enhance(random.uniform(0.75, 1.1)); rgb.putalpha(q.getchannel("A"))
        strip.alpha_composite(rgb, (int(x), H - rgb.height))          # base on the bottom edge
        x += rgb.width * random.uniform(0.3, 0.55)
    atlas.paste(strip, (0, row * H))

rgb = atlas.convert("RGB"); a = atlas.getchannel("A")
bleed = rgb.filter(ImageFilter.MaxFilter(7))                        # colour under the alpha so mips don't fringe
out = Image.composite(rgb, bleed, a.point(lambda v: 255 if v > 8 else 0)); out.putalpha(a)
out.save(ROOT + r"\public\drive\tex\grass_tuft.webp", "WEBP", quality=85, method=6)
prev = Image.new("RGB", out.size, (70, 110, 170)); prev.paste(out, (0, 0), out); prev.save(ROOT + r"\drive\art\foliage\grass_tuft_preview.png")
print("ok")
