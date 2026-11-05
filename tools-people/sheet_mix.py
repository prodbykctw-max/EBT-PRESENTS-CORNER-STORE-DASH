# python3 tools-people/sheet_mix.py : CURRENT (?people=none) next to the A+B mix (default), 1600 px wide
import json, os
from PIL import Image, ImageDraw, ImageFont
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'mix')
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
F2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
J = {k: json.load(open(f'{D}/{k}.json')) for k in ('none', 'mix')}
def sheet(shot, key):
    W = Image.new('RGB', (1600, 500), (20, 20, 24)); d = ImageDraw.Draw(W)
    for i, (k, t) in enumerate((('none', 'CURRENT (?people=none)'), ('mix', 'MIX: half A, half B (default)'))):
        W.paste(Image.open(f'{D}/{k}_{shot}.jpg').convert('RGB').resize((800, 450)), (i * 800, 0))
        w = d.textlength(t, font=F) + 20; d.rectangle([i * 800, 0, i * 800 + w, 36], fill=(0, 0, 0)); d.text((i * 800 + 10, 5), t, fill=(255, 255, 255), font=F)
        if key: d.text((i * 800 + 10, 466), f'{J[k][key]["calls"]} draw calls, {J[k][key]["triangles"]:,} triangles per frame (all passes)', fill=(255, 210, 90), font=F2)
    W.save(f'{D}/side_{shot}.jpg', quality=88)
sheet('crowd', 'crowd'); sheet('chase', 'chase'); sheet('pair', None)
print('ok')
