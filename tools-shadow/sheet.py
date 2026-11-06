# python3 tools-shadow/sheet.py : BEFORE / AFTER sheets (1600 px wide JPEGs) into tools-shadow/out/
import os
from PIL import Image, ImageDraw, ImageFont
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
def cell(k, shot, title):
    im = Image.open(f'{D}/{k}_{shot}.jpg').convert('RGB'); h = round(im.height * 800 / im.width); im = im.resize((800, h), Image.LANCZOS)
    d = ImageDraw.Draw(im); w = d.textlength(title, font=F) + 24
    d.rectangle([0, 0, w, 46], fill=(0, 0, 0)); d.text((12, 6), title, fill=(255, 255, 255), font=F)
    return im
for shot, name in [('close', 'sheet1_close_sidewalk_group'), ('foot', 'sheet2_onfoot_start'), ('drive', 'sheet3_driving_midroute')]:
    a, b = cell('before', shot, 'BEFORE (main)'), cell('after', shot, 'AFTER (contact shadow)')
    W = Image.new('RGB', (1600, max(a.height, b.height)), (0, 0, 0)); W.paste(a, (0, 0)); W.paste(b, (800, 0))
    W.save(f'{D}/{name}.jpg', quality=88); print(name, W.size)
