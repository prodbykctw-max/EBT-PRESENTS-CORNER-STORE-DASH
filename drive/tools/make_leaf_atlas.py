"""Leaf-cluster atlas for the street trees, composed from the real CC0 leaf scans (Poly Haven island_tree_02).
A single leaf per card would need thousands of cards per tree; games put a whole twig of leaves on each card.
Output: drive/art/foliage/leaf_clusters.png (1024², RGBA, 2×2 tiles) and public/drive/tex/leaves.webp.
Run: python drive/tools/make_leaf_atlas.py
"""
import math, random
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH"
SRC = ROOT + r"\drive\art\foliage\island_tree_02"
random.seed(7)

diff = Image.open(SRC + r"\leaves_diff.jpg").convert("RGB")
a16 = Image.open(SRC + r"\leaves_alpha.png")
mx = max(a16.getextrema()[1], 1)
alpha = a16.point(lambda v: v * 255 / mx).convert("L")
sheet = diff.copy(); sheet.putalpha(alpha)

# the 8 leaves on the scan sheet (top row of 5, bottom row of 3), found as connected alpha blobs
def blobs(a):
    w, h = a.size; px = a.load(); seen = set(); out = []
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            if px[x, y] > 128 and (x, y) not in seen:
                stack = [(x, y)]; box = [x, y, x, y]; n = 0
                while stack:
                    cx, cy = stack.pop()
                    if (cx, cy) in seen or not (0 <= cx < w and 0 <= cy < h) or px[cx, cy] <= 128: continue
                    seen.add((cx, cy)); n += 1
                    box = [min(box[0], cx), min(box[1], cy), max(box[2], cx), max(box[3], cy)]
                    stack += [(cx + 4, cy), (cx - 4, cy), (cx, cy + 4), (cx, cy - 4)]
                if n > 200: out.append(tuple(box))
    return out
atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
leaves = [sheet.crop((x0, y0, x1 + 4, y1 + 4)) for x0, y0, x1, y1 in blobs(alpha)]
print("leaves found:", len(leaves))

T = 512                                   # tile size; atlas is 2×2 tiles

def stem_base(leaf):
    """the scans stand leaves upright, stem at the bottom: the stem base is the lowest opaque pixel column"""
    a = leaf.getchannel("A"); w, h = a.size; px = a.load()
    for y in range(h - 1, -1, -1):
        xs = [x for x in range(w) if px[x, y] > 100]
        if xs: return (sum(xs) / len(xs), y)
    return (w / 2, h - 1)

def put_leaf(img, leaf, at, direction, scale, shade):
    """paste a leaf so its STEM BASE sits on the twig at `at` and the blade points along `direction` (radians,
    image coords): leaves grow from the twig, they are never just scattered near it"""
    lf = leaf.resize((max(2, int(leaf.width * scale)), max(2, int(leaf.height * scale))), Image.LANCZOS)
    rgb = ImageEnhance.Brightness(lf.convert("RGB")).enhance(shade); rgb.putalpha(lf.getchannel("A")); lf = rgb
    bx, by = stem_base(lf)
    R = int(math.hypot(lf.width, lf.height)) + 4                        # pad so the stem base is the canvas centre
    pad = Image.new("RGBA", (R * 2, R * 2), (0, 0, 0, 0)); pad.paste(lf, (int(R - bx), int(R - by)), lf)
    # source leaf points up (image angle -90°); PIL rotates counter-clockwise on screen (y down): α = -(φ + 90°)
    pad = pad.rotate(-(math.degrees(direction) + 90), resample=Image.BICUBIC, center=(R, R))
    img.alpha_composite(pad, (int(at[0] - R), int(at[1] - R)))

for tile in range(4):
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # a branchlet from the bottom centre up, with alternate side twigs; every leaf hangs off a node on a twig
    base, tip = (T * 0.5, T * 0.99), (T * (0.5 + random.uniform(-0.06, 0.06)), T * 0.16)
    twigs = [(base, tip, 1.0)]
    for k in range(4):
        f = 0.3 + k * 0.16; ox = base[0] + (tip[0] - base[0]) * f; oy = base[1] + (tip[1] - base[1]) * f
        side = -1 if (k + tile) % 2 else 1; L = T * random.uniform(0.22, 0.3)
        ang = math.atan2(tip[1] - base[1], tip[0] - base[0]) + side * random.uniform(0.6, 0.95)   # side twigs angle up and out
        twigs.append(((ox, oy), (ox + math.cos(ang) * L, oy + math.sin(ang) * L), 0.8))
    leaves_to_draw = []
    for (x0, y0), (x1, y1), size in twigs:
        axis = math.atan2(y1 - y0, x1 - x0)
        nodes = 6 if size == 1.0 else 5
        for j in range(nodes):                                          # alternate phyllotaxy along the twig
            f = 0.22 + 0.78 * j / nodes; px, py = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
            side = 1 if j % 2 else -1
            lean = random.uniform(0.6, 1.05) * (1 - 0.35 * f)             # blades lean out, more toward the base
            leaves_to_draw.append(((px, py), axis + side * lean, (0.17 + 0.07 * (1 - f)) * size))
        # a terminal leaf at the tip, pointing on along the twig
        leaves_to_draw.append(((x1, y1), axis + random.uniform(-0.12, 0.12), 0.15 * size))
    for (x0, y0), (x1, y1), size in twigs:   # twigs first, leaves over them
        d.line([(x0, y0), (x1, y1)], fill=(84, 64, 44, 255), width=6 if size == 1.0 else 3)
    random.shuffle(leaves_to_draw)
    for at, direction, frac in leaves_to_draw:
        leaf = random.choice(leaves)
        put_leaf(img, leaf, at, direction, frac * T / leaf.height, random.uniform(0.8, 1.12))
    atlas.paste(img, ((tile % 2) * T, (tile // 2) * T))
    print("tile", tile, "leaves", len(leaves_to_draw))

# padding: bleed colour into transparent pixels so mipmaps don't fringe dark
rgb = atlas.convert("RGB"); a = atlas.getchannel("A")
bleed = rgb.filter(ImageFilter.MaxFilter(9))
out = Image.composite(rgb, bleed, a.point(lambda v: 255 if v > 8 else 0)); out.putalpha(a)
out.save(ROOT + r"\drive\art\foliage\leaf_clusters.png")
out.resize((512, 512), Image.LANCZOS).save(ROOT + r"\public\drive\tex\leaves.webp", "WEBP", quality=85, method=6)
prev = Image.new("RGB", out.size, (70, 110, 170)); prev.paste(out, (0, 0), out); prev.resize((512, 512)).save(ROOT + r"\drive\art\foliage\leaf_clusters_preview.png")
print("ok")
