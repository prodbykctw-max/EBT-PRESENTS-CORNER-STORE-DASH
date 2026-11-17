# python3 tools-store3d/compose_ingame.py <dir> <out.jpg>
# The in-game sheet from tools-store3d/ingame.mjs's frames: "painted | 3D in game" at A / B / C, the caught moment and the win moment,
# then the lunge cue strip (every 3rd frame at 60 fps, the crop round the bully) with its measured mean brightness drawn under it.
# Also prints whether each painted shot is pixel-identical to main's (decoded pixels, not file bytes).
import sys, json, os
from PIL import Image, ImageDraw, ImageFont, ImageChops
d, outp = sys.argv[1], sys.argv[2]
J = json.load(open(os.path.join(d, 'ingame.json')))
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 24); f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
except Exception: F = f2 = ImageFont.load_default()
for k in 'ABC':
    a, m = os.path.join(d, f'{k}_painted.png'), os.path.join(d, f'{k}_main.png')
    if os.path.exists(a) and os.path.exists(m):
        A, M = Image.open(a).convert('RGBA'), Image.open(m).convert('RGBA')
        diff = ImageChops.difference(A, M).getbbox() if A.size == M.size else 'size'
        print(k, 'painted vs main:', 'IDENTICAL pixels' if diff is None else f'differ in {diff}', A.size)
W, pad = 420, 14
rows = [('A', 'A: near the dairy aisle (top)'), ('B', 'B: mid-store by the checkouts, PAY on'), ('C', 'C: bottom, produce and the door'), ('caught', 'caught (GOTCHA!)'), ('win', 'the win: paid at a register')]
ims = []
for k, cap in rows:
    pa, pb = os.path.join(d, f'{k}_painted.png'), os.path.join(d, f'{k}_3d.png')
    if not (os.path.exists(pa) and os.path.exists(pb)): continue
    a, b = Image.open(pa).convert('RGB'), Image.open(pb).convert('RGB')
    ims.append((a.resize((W, round(W * a.height / a.width)), Image.LANCZOS), b.resize((W, round(W * b.height / b.width)), Image.LANCZOS), cap))
lf = sorted(f for f in os.listdir(d) if f.startswith('lunge_') and f.endswith('.png'))
H = pad + sum(max(a.height, b.height) + 44 + pad for a, b, _ in ims) + 420
S = Image.new('RGB', (W * 2 + pad * 3, H), (16, 18, 32)); g = ImageDraw.Draw(S); y = pad
for a, b, cap in ims:
    g.text((pad, y), 'painted', font=F, fill=(245, 197, 24)); g.text((W + pad * 2, y), '3D in game (?store=3d)', font=F, fill=(120, 220, 160)); g.text((pad + 130, y + 4), cap, font=f2, fill=(200, 200, 215))
    y += 36; S.paste(a, (pad, y)); S.paste(b, (W + pad * 2, y)); y += max(a.height, b.height) + pad
if lf and 'lunge' in J:
    g.text((pad, y), "the bully's lunge cue, every 3rd frame at 60 fps (crop round him), and the crop's mean brightness per frame", font=f2, fill=(200, 200, 215)); y += 28
    tw = (S.width - pad * 2) // len(lf)
    for i, f in enumerate(lf):
        im = Image.open(os.path.join(d, f)).convert('RGB'); im = im.resize((tw - 4, round((tw - 4) * im.height / im.width))); S.paste(im, (pad + i * tw, y))
    y += round((tw - 4) * 160 / 220) + 10
    fr = J['lunge']['frames']; lo, hi = 0, 255; gh = 120; x0 = pad; gw = S.width - pad * 2
    g.rectangle([x0, y, x0 + gw, y + gh], outline=(80, 80, 100))
    pts = [(x0 + gw * i / max(1, len(fr) - 1), y + gh - gh * (f['meanLum'] - lo) / (hi - lo)) for i, f in enumerate(fr)]
    g.line(pts, fill=(255, 210, 90), width=3)
    pa = [(x0 + gw * i / max(1, len(fr) - 1), y + gh - gh * f['ringAlpha']) for i, f in enumerate(fr)]
    g.line(pa, fill=(230, 60, 70), width=2)
    g.text((x0 + 6, y + 4), f"gold: mean brightness 0..255 (range {J['lunge']['lumRange'][0]:.1f}..{J['lunge']['lumRange'][1]:.1f}, biggest frame-to-frame change {J['lunge']['maxFrameToFrameLumChange']})   red: ring opacity 0..1", font=f2, fill=(220, 220, 230))
    y += gh + pad
S = S.crop((0, 0, S.width, y)); S.save(outp, quality=88); print(S.size)
