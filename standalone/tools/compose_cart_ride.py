"""Pack the renders from bake_cart_ride.py into the two ending sprite strips and write standalone/cartp.b64 / carts.b64
(lossless WebP, the same way compose_sheets.py writes player.b64; build.mjs embeds them).

  cartp: 3 portrait frames side by side (the victory / Hall of Fame bounce)      -> cartp.b64
  carts: 4 side-view frames side by side (the credits ride, wheels turn)         -> carts.b64
Every frame of a strip is cropped by ONE shared box (the union of their silhouettes) so the cart never jumps between frames.
Run: python3 standalone/tools/compose_cart_ride.py <folder with portrait_0..2.png and side_0..3.png>
"""
import base64, io, os, sys
from PIL import Image
SRC = sys.argv[1]
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PAD = 4

def pack(prefix, n, scale, out):
    paths = [os.path.join(SRC, f"{prefix}_{i}.png") for i in range(n)]
    ims = [Image.open(p).convert("RGBA") for p in paths]
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
pack("side", 4, float(os.environ.get("CSD_SSCALE", "0.62")), "carts.b64")
