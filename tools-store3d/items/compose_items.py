# python3 -I tools-store3d/items/compose_items.py <dir> <out.jpg> [tagA tagB ...]
# The before/after sheet: for each tag (default: before after) one row of the seven pickups, each cropped around the item from
# <dir>/<tag>_<ID>_full.png (items.mjs), centre from <dir>/<tag>_stats.json, enlarged 2x (nearest) so the detail can be judged.
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
d, outp = sys.argv[1], sys.argv[2]; tags = sys.argv[3:] or ['before', 'after']
IDS = ['APPLE', 'CHIPS', 'CHICKEN', 'LEMONADE', 'BREAD', 'MILK', 'RICE & BEANS']
CW, CH, Z = 150, 150, 2   # crop in device px (dpr 2), then x2
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except Exception: font = ImageFont.load_default()
W, H = CW * Z, CH * Z; sheet = Image.new('RGB', (110 + W * len(IDS), 40 + H * len(tags)), (16, 18, 30)); dr = ImageDraw.Draw(sheet)
for r, tag in enumerate(tags):
    st = json.load(open(os.path.join(d, f'{tag}_stats.json')))
    dr.text((8, 40 + r * H + H // 2 - 12), tag.upper(), fill=(255, 220, 90), font=font)
    for c, i in enumerate(IDS):
        if r == 0: dr.text((110 + c * W + 8, 8), i, fill=(255, 255, 255), font=font)
        f = os.path.join(d, f"{tag}_{i.replace(' & ', '_').replace(' ', '_')}_full.png")
        if not os.path.exists(f) or i not in st: continue
        cx, cy = st[i]['c'][0] * 2, st[i]['c'][1] * 2 + 12
        im = Image.open(f).convert('RGB').crop((int(cx - CW / 2), int(cy - CH / 2), int(cx + CW / 2), int(cy + CH / 2))).resize((W, H), Image.LANCZOS)
        sheet.paste(im, (110 + c * W, 40 + r * H))
sheet.save(outp, quality=90); print(outp, sheet.size)
