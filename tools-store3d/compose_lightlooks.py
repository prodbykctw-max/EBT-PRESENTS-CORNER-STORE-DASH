#!/usr/bin/env python3
"""python3 tools-store3d/compose_lightlooks.py <dir> [sheet.jpg]
From lightlooks.mjs's frames: the 4 x 3 sheet (columns 1. NOW .. 4. BLACKOUT, rows A/B/C), each frame as its own JPEG, the pixel
diff of 'now' against main, the readability numbers (the player and the bully vs the floor round them, the live pickup's ring) and,
if flash_<look>/ exists, the largest frame-to-frame change of any large area. Writes <dir>/numbers.json."""
import json, sys, os, glob
from PIL import Image, ImageDraw, ImageFont
import numpy as np
D = sys.argv[1]; SHEET = sys.argv[2] if len(sys.argv) > 2 else os.path.join(D, 'store_light_options.jpg')
R = json.load(open(os.path.join(D, 'lightlooks.json')))
LOOKS = [('now', '1. NOW'), ('dusk', '2. DUSK'), ('night', '3. NIGHT'), ('blackout', '4. BLACKOUT')]
ROWS = [('A', 'by the dairy aisle'), ('B', 'by the checkouts'), ('C', 'at the front doors')]
def load(f): return np.asarray(Image.open(f).convert('RGB')).astype(np.float32)
def lin(a): a = a / 255.0; return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
def Y(a): l = lin(a); return 0.2126 * l[..., 0] + 0.7152 * l[..., 1] + 0.0722 * l[..., 2]   # relative luminance 0..1
def L8(a): return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]          # display value 0..255
out = {'frames': {}, 'readability': {}, 'nowVsMain': {}, 'stats': {}}
# ---- the frames as JPEGs + the sheet
font = None
for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
    if os.path.exists(f): font = ImageFont.truetype(f, 34); small = ImageFont.truetype(f, 20); break
tiles = {}
for look, lab in LOOKS:
    for k, _ in ROWS:
        f = os.path.join(D, f'{look}_{k}.png')
        if not os.path.exists(f): continue
        im = Image.open(f).convert('RGB'); j = os.path.join(D, f'{LOOKS.index((look, lab)) + 1}_{look}_{k}.jpg'); im.save(j, quality=92); out['frames'][f'{look}_{k}'] = j; tiles[(look, k)] = im
if tiles:
    w, h = next(iter(tiles.values())).size; s = 0.5; tw, th = int(w * s), int(h * s); top, left, gap = 64, 0, 8
    sheet = Image.new('RGB', (len(LOOKS) * (tw + gap) + gap, top + len(ROWS) * (th + gap) + gap), (14, 16, 26)); g = ImageDraw.Draw(sheet)
    for ci, (look, lab) in enumerate(LOOKS):
        x = gap + ci * (tw + gap); g.text((x + tw / 2, top / 2), lab, fill=(255, 214, 80), font=font, anchor='mm')
        for ri, (k, _) in enumerate(ROWS):
            if (look, k) in tiles: sheet.paste(tiles[(look, k)].resize((tw, th), Image.LANCZOS), (x, top + gap + ri * (th + gap)))
    sheet.save(SHEET, quality=90); out['sheet'] = SHEET
# ---- now vs main
for k, _ in ROWS:
    a, b = os.path.join(D, f'now_{k}.png'), os.path.join(D, f'main_{k}.png')
    if os.path.exists(a) and os.path.exists(b):
        A, B = load(a), load(b); d = np.abs(A - B).max(axis=2)
        out['nowVsMain'][k] = {'differingPixels': int((d > 0).sum()), 'of': int(d.size), 'maxChannelDiff': int(d.max())}
        for suf in ('', '_still'):
            c = os.path.join(D, f'main2_{k}{suf}.png'); a2 = os.path.join(D, f'now_{k}{suf}.png'); b2 = os.path.join(D, f'main_{k}{suf}.png')
            if os.path.exists(c):
                d2 = np.abs(load(b2) - load(c)).max(axis=2); d3 = np.abs(load(a2) - load(b2)).max(axis=2)
                out['nowVsMain'][k]['mainVsMain2' + suf] = {'differingPixels': int((d2 > 0).sum()), 'maxChannelDiff': int(d2.max())}
                out['nowVsMain'][k]['nowVsMain' + suf] = {'differingPixels': int((d3 > 0).sum()), 'maxChannelDiff': int(d3.max())}
# ---- readability: the person = where hiding them changed the frame (above their feet); the floor = a ring round their feet
for look, _ in LOOKS:
    sh = R.get('shots', {}).get(look); 
    if not sh: continue
    for k, _ in ROWS:
        at = sh['at'].get(k); f = os.path.join(D, f'{look}_{k}_still.png')
        if not at or not os.path.exists(f): continue
        full = load(f); dpr = full.shape[1] / at['view']['w']; Yf = Y(full); L = L8(full); r = {}
        hidden = {}
        for who, tag in (('player', 'noP'), ('bully', 'noB')):
            hidden[who] = load(os.path.join(D, f'{look}_{k}_{tag}.png'))
        H, W = Yf.shape; yy, xx = np.mgrid[0:H, 0:W]
        masks = {}
        for who in ('player', 'bully'):
            fx, fy = [v * dpr for v in at['feet'][who]]; hy = at['head'][who][1] * dpr
            m = (np.abs(full - hidden[who]).sum(axis=2) > 30) & (yy < fy + 3 * dpr) & (yy > hy - 12 * dpr) & (np.abs(xx - fx) < 40 * dpr)
            masks[who] = m
        both = masks['player'] | masks['bully']
        for who in ('player', 'bully'):
            m = masks[who]; fx, fy = [v * dpr for v in at['feet'][who]]; ppm = at['pxPerM'] * dpr
            if fx < 0 or fy < 0 or fx >= W or fy >= H or m.sum() < 50: r[who] = None; continue
            rr = np.hypot(xx - fx, (yy - fy)); ring = (rr > 0.7 * ppm) & (rr < 1.5 * ppm) & ~both & (Yf >= 0)
            # (the HUD's own panels are not floor: leave out the header band and the EBT LIST box)
            ring &= ~((yy < 64 * dpr)); ring &= ~((xx < 106 * dpr) & (yy < 286 * dpr))
            yp, yf = float(Yf[m].mean()), float(Yf[ring].mean())
            r[who] = {'personY': round(yp, 4), 'floorY': round(yf, 4), 'contrast': round((max(yp, yf) + 0.05) / (min(yp, yf) + 0.05), 2), 'personL': round(float(L[m].mean()), 1), 'floorL': round(float(L[ring].mean()), 1), 'px': int(m.sum())}
        it = at.get('item')
        if it:
            ix, iy = [v * dpr for v in it['at']]; ppm = at['pxPerM'] * dpr
            if 0 <= ix < W and 0 <= iy < H:
                rr = np.hypot(xx - ix, yy - iy); ring = (rr > 0.45 * ppm) & (rr < 0.66 * ppm) & ~both
                r['itemRing'] = {'id': it['id'], 'ringL': round(float(L[ring].mean()), 1), 'ringY': round(float(Yf[ring].mean()), 4), 'ringMaxL': round(float(np.percentile(L[ring], 95)), 1)}
        r['frameMeanL'] = round(float(L.mean()), 1)
        out['readability'][f'{look}_{k}'] = r
        out['stats'][f'{look}_{k}'] = at.get('stats')
# ---- flashing: 3 s of frames; per 1/16 x 1/16 block of the screen (and the whole screen), the largest change in mean luminance
for fd in sorted(glob.glob(os.path.join(D, 'flash_*'))):
  for pre, tag in (('f', ''), ('g', '_3d_only')):
    fs_ = sorted(glob.glob(os.path.join(fd, pre + '*.png')))
    if len(fs_) < 2: continue
    prev = None; worst = {'blockDeltaY': 0, 'blockDeltaL': 0, 'frameDeltaL': 0}; nb = 16; series = []
    for f in fs_:
        a = load(f); Yv, Lv = Y(a), L8(a); H, W = Yv.shape; bh, bw = H // nb, W // nb
        by = Yv[:bh * nb, :bw * nb].reshape(nb, bh, nb, bw).mean(axis=(1, 3)); bl = Lv[:bh * nb, :bw * nb].reshape(nb, bh, nb, bw).mean(axis=(1, 3)); fl = float(Lv.mean())
        if prev is not None:
            worst['blockDeltaY'] = max(worst['blockDeltaY'], float(np.abs(by - prev[0]).max())); worst['blockDeltaL'] = max(worst['blockDeltaL'], float(np.abs(bl - prev[1]).max())); worst['frameDeltaL'] = max(worst['frameDeltaL'], abs(fl - prev[2]))
        prev = (by, bl, fl); series.append(round(fl, 2))
    out['flash_' + os.path.basename(fd) + tag] = {'frames': len(fs_), 'blockArea': f'1/{nb} x 1/{nb} of the screen ({W // nb} x {H // nb} px)', **{k: round(v, 4) for k, v in worst.items()}, 'frameMeanL': series}
json.dump(out, open(os.path.join(D, 'numbers.json'), 'w'), indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ('frames',)}, indent=1)[:6000])
