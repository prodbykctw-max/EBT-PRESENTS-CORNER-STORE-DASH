# python3 tools-light/beacon.py <dir> <fps>: colour and pulse of the police roof lights: mean R,G,B around the beacon per frame, the dominant frequency of its brightness, the red share
import sys, glob, json, numpy as np
from PIL import Image
d, fps = sys.argv[1], float(sys.argv[2]); xy = json.load(open(d + '/beacon_xy.json')); files = sorted(glob.glob(d + '/f*.jpg'))
c0 = next(v for v in xy if v); rows = []
for f, c in zip(files, xy):
    c = c or c0; im = Image.open(f).convert('RGB'); W, H = im.size; cx, cy = c[0] / c[2] * W, c[1] / c[3] * H; R = 22
    a = np.asarray(im.crop((int(cx - R), int(cy - R), int(cx + R), int(cy + R))), dtype=float)
    lum = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]); m = lum >= np.percentile(lum, 95)   # the brightest 5 percent of the patch: the lamp itself
    rows.append((a[..., 0][m].mean(), a[..., 1][m].mean(), a[..., 2][m].mean(), lum[m].mean()))
A = np.array(rows); L = A[:, 3]; L = L - L.mean(); sp = np.abs(np.fft.rfft(L * np.hanning(len(L)))); fr = np.fft.rfftfreq(len(L), 1 / fps)
k = 1 + int(np.argmax(sp[1:]))
print(json.dumps({'frames': len(A), 'lamp_mean_rgb': [round(x, 1) for x in A[:, :3].mean(axis=0)], 'blue_over_red': round(float(A[:, 2].mean() / max(A[:, 0].mean(), 1)), 2), 'lamp_lum_min': round(float(A[:, 3].min()), 1), 'lamp_lum_max': round(float(A[:, 3].max()), 1), 'dominant_hz': round(float(fr[k]), 2)}))
