# python3 tools-people/sheet.py : side-by-side sheets (CURRENT / OPTION A / OPTION B + a numbers cell), 1600 px wide JPEGs
import json, os
from PIL import Image, ImageDraw, ImageFont
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
S = os.path.join(D, 'shots')
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
F2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 19)
labels = [('cur', 'CURRENT (boxes)'), ('A', 'OPTION A (parametric)'), ('B', 'OPTION B (MakeHuman CC0)')]
PER = {'cur': 'per person: 352 tris, one model', 'A': 'per person: 1604 near / 465 far (all parts)', 'B': 'per person: 3108 near / 853 far (all parts)'}
st = {k: json.load(open(f'{S}/{k}.json')) for k, _ in labels}
def cell(k, shot, title):
    im = Image.open(f'{S}/{k}_{shot}.jpg').convert('RGB').resize((800, 450))
    d = ImageDraw.Draw(im); w = d.textlength(title, font=F) + 20
    d.rectangle([0, 0, w, 36], fill=(0, 0, 0)); d.text((10, 5), title, fill=(255, 255, 255), font=F)
    return im
def numbers(keys):
    im = Image.new('RGB', (800, 450), (24, 24, 28)); d = ImageDraw.Draw(im); y = 14
    d.text((14, y), 'draw calls / triangles per frame (all passes)', fill=(255, 255, 255), font=F); y += 40
    for k, t in labels:
        row = f'{t}'
        d.text((14, y), row, fill=(255, 210, 90), font=F2); y += 28
        d.text((34, y), PER[k], fill=(230, 230, 230), font=F2); y += 26
        for key, nm in keys:
            v = st[k][key]; d.text((34, y), f'{nm}: {v["calls"]} calls, {v["triangles"]:,} tris', fill=(230, 230, 230), font=F2); y += 26
        y += 12
    return im
def sheet(shot, out, keys):
    W = Image.new('RGB', (1600, 900), (0, 0, 0))
    for i, (k, t) in enumerate(labels):
        W.paste(cell(k, shot, t), ((i % 2) * 800, (i // 2) * 450))
    W.paste(numbers(keys), (800, 450))
    W.save(f'{D}/{out}', quality=88)
sheet('crowd', 'side_crowd_closeup.jpg', [('crowd', 'this view')])
sheet('chase', 'side_street_view.jpg', [('chase', 'this view')])
sheet('walkA', 'side_walk_phaseA.jpg', [])
sheet('walkB', 'side_walk_phaseB.jpg', [])
sheet('far', 'side_far_lod.jpg', [])
print('ok')
