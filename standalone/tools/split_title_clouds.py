#!/usr/bin/env python3
"""Split the painted title sky into a cloud-free sky and a separate cloud layer, so the clouds can drift.

  python3 standalone/tools/split_title_clouds.py [--preview DIR]

Reads   standalone/tools/title_sky_orig.b64   the original painted sky (512x768 opaque WebP, clouds baked in; kept
                                              here only as the source and for comparison, it is NOT inlined in the page)
Writes  standalone/title_sky.b64              the same sky with the clouds removed (opaque, 512x768)
        standalone/title_clouds.b64           RGBA WebP of just the clouds, same pixel scale as the sky (512 wide),
                                              the top CLOUD_H rows only (the clouds all sit above y=270)
--preview DIR also writes PNGs for looking at the result (orig, clean sky, clouds, recomposite, 4x crops, diff).

How it works. The sky gradient is purely vertical (the script prints the numbers that show it: the spread across
a row of cloud-free sky is compression noise, about 1 level, and no left-to-right trend), so the background behind any
cloud pixel is known exactly: B(y), the per-row colour, estimated from the cloud-free pixels of each row (median, two
passes, smoothed down the rows). A pixel's distance from B(y) gives the cloud's alpha (smoothstep, so the edge is soft), and
its colour is solved so that alpha-compositing it over B(y) gives back the original pixel: C = B + (P - B) / a.
Where alpha is low that division is noisy, so there the colour is the alpha-weighted blur of the solid cloud colour
around it (no dark or light fringe at the edge). Because the gradient is vertical and the clouds only ever move sideways,
a cloud over B(y) at any horizontal offset is the same picture as the original.
"""
import argparse, base64, io, os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, gaussian_filter1d, label

HERE = os.path.dirname(os.path.abspath(__file__))
SA = os.path.normpath(os.path.join(HERE, '..'))
T0, T1 = 5.0, 26.0      # RGB distance from the background where a cloud starts (alpha 0) / is solid (alpha 1)
SOLID_D = 45            # a patch is a cloud only if some pixel is at least this far from the gradient
CLOUD_H = 272           # rows kept in the cloud layer (the lowest cloud pixel is at y ~255)

def load(p):
    return Image.open(io.BytesIO(base64.b64decode(open(p).read().strip()))).convert('RGB')

def b64(im, **kw):
    b = io.BytesIO(); im.save(b, 'WEBP', **kw); return base64.b64encode(b.getvalue()).decode()

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--preview'); a = ap.parse_args()
    im = np.asarray(load(os.path.join(HERE, 'title_sky_orig.b64'))).astype(np.float64)
    H, W, _ = im.shape
    # how vertical is the gradient? (cloud-free rows only, y >= CLOUD_H)
    clean = im[CLOUD_H:]
    row_sd = clean.std(axis=1)
    cols = [clean[:, x:x + 64].mean(axis=1) for x in range(0, W, 64)]
    trend = np.max(np.abs(np.array(cols) - np.mean(cols, axis=0)))
    print('cloud-free rows: per-row spread across x  mean %s  max %s (levels of 255)' % (row_sd.mean(0).round(2), row_sd.max(0).round(2)))
    print('cloud-free rows: largest left-to-right trend of a 64 px column block vs the row mean: %.2f levels' % trend)
    # background per row, two passes
    B = np.median(im, axis=1)                                  # (H,3)
    for _ in range(2):
        d = np.linalg.norm(im - B[:, None, :], axis=2)
        ok = d < T0 * 0.8
        Bn = np.empty_like(B)
        for y in range(H):
            v = im[y][ok[y]]
            Bn[y] = np.median(v, axis=0) if len(v) > 20 else B[y]
        B = Bn
    B = gaussian_filter1d(B, 3, axis=0, mode='nearest')
    Bf = np.repeat(B[:, None, :], W, axis=1)
    d = np.linalg.norm(im - Bf, axis=2)
    al = smooth(T0, T1, d)
    al[CLOUD_H:] = 0                                           # the clouds are all in the top rows; below, differences are only compression noise
    al[:CLOUD_H] = np.where(gaussian_filter(al[:CLOUD_H], 1.5) > 0.02, al[:CLOUD_H], 0)   # drop isolated noise specks (no cloud pixel has no neighbours)
    # colour: exact where alpha is solid enough, else the alpha-weighted neighbourhood of the solid colour
    # the original's compression leaves a few faint smudges in the open sky (distance 5..15 from the gradient, no solid core):
    # they are not clouds and would drift as dirt, so any connected patch whose strongest pixel is not clearly a cloud is dropped
    lab, nl = label(al > 0, structure=np.ones((3, 3)))
    peak = np.zeros(nl + 1); np.maximum.at(peak, lab.ravel(), d.ravel())
    dropped = [i for i in range(1, nl + 1) if peak[i] < SOLID_D]
    print('patches: %d kept, %d faint smudges dropped (peak distance < %d)' % (nl - len(dropped), len(dropped), SOLID_D))
    al = np.where(np.isin(lab, dropped), 0, al)
    A = np.maximum(al, 1e-3)[..., None]
    Cx = np.clip(Bf + (im - Bf) / A, 0, 255)
    w = (al >= 0.6).astype(np.float64)
    num = np.stack([gaussian_filter(Cx[..., c] * w, 2.0) for c in range(3)], -1)
    den = gaussian_filter(w, 2.0)[..., None]
    num2 = np.stack([gaussian_filter(Cx[..., c] * w, 5.0) for c in range(3)], -1)
    den2 = gaussian_filter(w, 5.0)[..., None]
    fill = np.where(den > 1e-3, num / np.maximum(den, 1e-9), num2 / np.maximum(den2, 1e-9))
    C = np.where((al >= 0.6)[..., None], Cx, fill)
    C = np.where(al[..., None] > 0, C, Bf)
    # what the page will show at rest: clouds over the clean sky
    rec = Bf * (1 - al[..., None]) + C * al[..., None]
    err = np.abs(rec - im).max(axis=2)
    msk = al > 0
    print('cloud pixels: %d (%.1f%% of the sky)  recomposite error vs original: mean %.2f  p99 %.1f  max %.1f levels' % (msk.sum(), 100 * msk.mean(), err[msk].mean(), np.percentile(err[msk], 99), err.max()))
    rows = np.where(msk.any(axis=1))[0]
    print('cloud rows: %d..%d' % (rows.min(), rows.max()))
    assert rows.max() < CLOUD_H - 4, 'clouds reach below the kept strip'
    sky = Image.fromarray(np.clip(np.rint(Bf), 0, 255).astype(np.uint8), 'RGB')
    rgba = np.dstack([np.clip(np.rint(C), 0, 255), np.rint(al * 255)]).astype(np.uint8)[:CLOUD_H]
    cl = Image.fromarray(rgba, 'RGBA')
    skyb = b64(sky, lossless=True, quality=100, method=6)
    clb = b64(cl, lossless=True, quality=100, method=6, exact=True)
    open(os.path.join(SA, 'title_sky.b64'), 'w').write(skyb)
    open(os.path.join(SA, 'title_clouds.b64'), 'w').write(clb)
    print('title_sky.b64 %d bytes (was %d), title_clouds.b64 %d bytes' % (len(skyb), len(open(os.path.join(HERE, 'title_sky_orig.b64')).read().strip()), len(clb)))
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
        o8 = Image.fromarray(im.astype(np.uint8)); o8.save(a.preview + '/orig.png'); sky.save(a.preview + '/sky_clean.png')
        # clouds over a mid-grey and over the sky, read back from the encoded WebP (what the page decodes)
        cl2 = Image.open(io.BytesIO(base64.b64decode(clb))).convert('RGBA')
        full = Image.new('RGBA', (W, H), (0, 0, 0, 0)); full.paste(cl2, (0, 0))
        full.save(a.preview + '/clouds_rgba.png')
        sky2 = Image.open(io.BytesIO(base64.b64decode(skyb))).convert('RGBA')
        recon = Image.alpha_composite(sky2, full).convert('RGB'); recon.save(a.preview + '/recomposite.png')
        grey = Image.alpha_composite(Image.new('RGBA', (W, H), (128, 128, 128, 255)), full).convert('RGB'); grey.save(a.preview + '/clouds_on_grey.png')
        diff = np.abs(np.asarray(recon).astype(int) - im.astype(int)).max(axis=2)
        print('recomposite (decoded WebP) vs original: max %d, pixels off by >8: %d' % (diff.max(), (diff > 8).sum()))
        Image.fromarray(np.clip(diff * 8, 0, 255).astype(np.uint8)).save(a.preview + '/diff_x8.png')

main()
