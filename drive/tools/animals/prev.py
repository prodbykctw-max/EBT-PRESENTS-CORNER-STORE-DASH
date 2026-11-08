"""point-cloud previews for posing work (no GL): side/top views of skinned vertices with texture colours"""
import numpy as np
from PIL import Image, ImageDraw
def montage(frames, fn, view=(2, 1), size=(300, 260), cols=6, bounds=None, colors=None):
    """frames: list of (N,3) arrays; view: axes (h, v)"""
    allp = np.vstack(frames) if bounds is None else None
    b = bounds or (allp[:, view[0]].min(), allp[:, view[0]].max(), allp[:, view[1]].min(), allp[:, view[1]].max())
    s = min((size[0] - 12) / (b[1] - b[0]), (size[1] - 12) / (b[3] - b[2]))
    rows = (len(frames) + cols - 1) // cols
    im = Image.new('RGB', (cols * size[0], rows * size[1]), 'white'); d = ImageDraw.Draw(im)
    for k, P in enumerate(frames):
        ox, oy = (k % cols) * size[0], (k // cols) * size[1]
        order = np.argsort(P[:, 3 - view[0] - view[1]] if P.shape[1] > 2 else 0)
        for i in order:
            x = ox + 6 + (P[i, view[0]] - b[0]) * s; y = oy + size[1] - 6 - (P[i, view[1]] - b[2]) * s
            c = tuple(colors[i]) if colors is not None else (60, 60, 200)
            d.rectangle((x - 1, y - 1, x + 1, y + 1), fill=c)
        d.text((ox + 4, oy + 2), str(k), fill=(0, 0, 0))
    im.save(fn)
