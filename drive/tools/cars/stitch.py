import sys, os
from PIL import Image, ImageDraw, ImageFont
d = sys.argv[1]; names = sys.argv[2].split(','); shots = sys.argv[3].split(',')
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 26)
except Exception: F = ImageFont.load_default()
for sh in shots:
    ims = []
    for n in names:
        p = f'{d}/{sh}__{n}.jpg'
        if not os.path.exists(p): continue
        im = Image.open(p).convert('RGB'); dr = ImageDraw.Draw(im); lab = 'CURRENT' if n == 'CURRENT' else 'OPTION ' + n
        dr.rectangle([0, 0, 12 + 17 * len(lab), 38], fill=(0, 0, 0)); dr.text((8, 4), lab, fill=(255, 255, 255), font=F); ims.append(im)
    w, h = ims[0].size; cols = 2; rows = (len(ims) + 1) // 2
    S = Image.new('RGB', (w * cols + 4, h * rows + 4 * (rows - 1)), (255, 255, 255))
    for i, im in enumerate(ims): S.paste(im, ((i % cols) * (w + 4), (i // cols) * (h + 4)))
    S.save(f'{d}/side_{sh}.jpg', quality=90); print(f'{d}/side_{sh}.jpg', S.size)
