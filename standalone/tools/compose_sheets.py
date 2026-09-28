"""Pack the cells rendered by bake_characters.py into the game's sprite sheets (rows D, U, R x 8 frames, 96 px)
and write standalone/<name>.b64 for build.mjs.

The bully is the main character's rig and walk cycle, recoloured, so he walks as well as the player does:
white tee -> red hoodie (torso band only, so the cap logo and the sneaker soles keep theirs), jeans -> charcoal,
red kicks -> black. The game draws him bigger (BULLY_DISPLAY), so he reads as the heavier kid.
Run: python standalone/tools/compose_sheets.py
"""
import base64, colorsys, io, os
from PIL import Image

CHAR_DIR = r"C:\Users\Owner\Desktop\corner-store-dash-character"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES, CELL = 8, 96

def load_cells(name):
    """all frames cropped by ONE shared square box (the union of every frame's silhouette, feet at the bottom),
    so the character fills the cell and never jumps between frames"""
    raw = {}
    for row in "DUR":
        for c in range(FRAMES):
            p = os.path.join(CHAR_DIR, "renders2", f"{name}_{row}_{c}.png")
            if not os.path.exists(p): return None
            raw[(row, c)] = Image.open(p).convert("RGBA")
    boxes = [im.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox() for im in raw.values()]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes); x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    side = int(max(x1 - x0, y1 - y0) * 1.04); cx = (x0 + x1) // 2
    box = (cx - side // 2, y1 - side + 2, cx - side // 2 + side, y1 + 2)          # feet on the bottom edge
    return {k: im.crop(box).resize((CELL, CELL), Image.LANCZOS) for k, im in raw.items()}

def bully_recolour(im):
    im = im.copy(); px = im.load(); W, H = im.size
    for y in range(H):
        fy = y / H
        for x in range(W):
            r, g, b, a = px[x, y]
            if a < 8: continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 0.2 < fy < 0.64 and s < 0.2 and v > 0.55:                         # the white tee -> red hoodie
                k = v ** 1.2; px[x, y] = (int(200 * k), int(32 * k), int(38 * k), a)
            elif 0.52 <= h <= 0.72 and s > 0.18:                                  # denim -> charcoal
                gv = int(255 * v * 0.42); px[x, y] = (gv, gv, int(gv * 1.06), a)
            elif fy > 0.86 and (h < 0.04 or h > 0.93) and s > 0.45:                # red kicks -> black
                gv = int(255 * v * 0.22); px[x, y] = (gv, gv, gv, a)
    return im

def write(name, cells, fn=None):
    sheet = Image.new("RGBA", (CELL * FRAMES, CELL * 3), (0, 0, 0, 0))
    for ri, row in enumerate("DUR"):
        for c in range(FRAMES):
            cell = cells[(row, c)]
            sheet.alpha_composite(fn(cell) if fn else cell, (c * CELL, ri * CELL))
    sheet.save(os.path.join(CHAR_DIR, f"{name}_sheet.png"), optimize=True)
    buf = io.BytesIO(); sheet.save(buf, "PNG", optimize=True)
    open(os.path.join(REPO, "standalone", f"{name}.b64"), "w").write(base64.b64encode(buf.getvalue()).decode())
    print(name, len(buf.getvalue()), "bytes")

player = load_cells("player")
if player is None: raise SystemExit("player cells missing: run bake_characters.py first")
write("player", player)
write("bully", player, bully_recolour)
