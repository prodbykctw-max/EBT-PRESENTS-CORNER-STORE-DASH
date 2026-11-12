"""Pack the renders from bake_cart_ride.py into the two ending sprite strips and write standalone/cartp.b64 / carts.b64
(lossless WebP, the same way compose_sheets.py writes player.b64; build.mjs embeds them).

  cartp: 3 portrait frames side by side (the victory / Hall of Fame bounce)      -> cartp.b64
  carts: 8 side-view frames side by side (the credits ride, wheels turn)         -> carts.b64
Every frame of a strip is cropped by ONE shared box (the union of their silhouettes) so the cart never jumps between frames.
Run: python3 standalone/tools/compose_cart_ride.py <folder with portrait_0..2.png and side_0..7.png>
"""
import base64, io, os, sys
import numpy as np
from scipy import ndimage as ndi
from PIL import Image
SRC = sys.argv[1]
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PAD = 4

def heal(im, maxarea=60):
    """The scan has a few 1-2 px holes in the jeans that show the page behind as pink specks. Fill every small hole fully enclosed by
    the silhouette (the cart's wire cells are far bigger than maxarea, so they stay open): opaque, colour from the nearest solid pixels."""
    a = np.array(im).astype(np.float32); solid = a[..., 3] > 128
    holes = ndi.binary_fill_holes(solid) & ~solid
    lab, n = ndi.label(holes)
    if n == 0: return im
    sizes = ndi.sum(holes, lab, range(1, n + 1))
    small = np.isin(lab, [i + 1 for i, z in enumerate(sizes) if z <= maxarea])
    small = ndi.binary_dilation(small, iterations=1)                 # the half-transparent rim of each speck too
    ok = (solid & ~small).astype(np.float32)
    for c in range(3):
        num = ndi.uniform_filter(a[..., c] * ok, 5); den = ndi.uniform_filter(ok, 5)
        fill = np.where(den > 1e-4, num / np.maximum(den, 1e-4), a[..., c])
        a[..., c] = np.where(small, fill, a[..., c])
    a[..., 3] = np.where(small, 255, a[..., 3])
    print("  healed", int(small.sum()), "px in", n, "holes")
    return Image.fromarray(a.astype(np.uint8), "RGBA")

def pack(prefix, n, scale, out):
    paths = [os.path.join(SRC, f"{prefix}_{i}.png") for i in range(n)]
    ims = [heal(Image.open(p).convert("RGBA")) for p in paths]
    boxes = [im.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox() for im in ims]
    x0, y0 = max(0, min(b[0] for b in boxes) - PAD), max(0, min(b[1] for b in boxes) - PAD)
    x1, y1 = min(ims[0].width, max(b[2] for b in boxes) + PAD), min(ims[0].height, max(b[3] for b in boxes) + PAD)
    w, h = round((x1 - x0) * scale), round((y1 - y0) * scale)
    sheet = Image.new("RGBA", (w * n, h), (0, 0, 0, 0))
    for i, im in enumerate(ims):
        sheet.alpha_composite(im.crop((x0, y0, x1, y1)).resize((w, h), Image.LANCZOS), (i * w, 0))
    buf = io.BytesIO(); sheet.save(buf, "WEBP", lossless=True, quality=100, method=6)
    open(os.path.join(REPO, "standalone", out), "w").write(base64.b64encode(buf.getvalue()).decode())
    print(out, sheet.size, len(buf.getvalue()), "bytes (webp)")

pack("portrait", 3, float(os.environ.get("CSD_PSCALE", "0.5")), "cartp.b64")
pack("side", 8, float(os.environ.get("CSD_SSCALE", "0.62")), "carts.b64")
