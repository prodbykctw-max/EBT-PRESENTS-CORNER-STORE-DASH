# python3 tools-allb/sheet.py : BEFORE (main) | AFTER (this branch) sheets, 1600 px wide, into tools-allb/out/
import os
from PIL import Image, ImageDraw, ImageFont
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
def cell(path, title, crop=None):
    im = Image.open(path).convert('RGB')
    if crop: im = im.crop(crop)
    h = round(im.height * 800 / im.width); im = im.resize((800, h), Image.LANCZOS)
    d = ImageDraw.Draw(im); w = d.textlength(title, font=F) + 24
    d.rectangle([0, 0, w, 46], fill=(0, 0, 0)); d.text((12, 6), title, fill=(255, 255, 255), font=F)
    return im
def sheet(name, a, b):
    W = Image.new('RGB', (1600, max(a.height, b.height)), (0, 0, 0)); W.paste(a, (0, 0)); W.paste(b, (800, 0))
    W.save(f'{D}/{name}.jpg', quality=88); print(name, W.size)
B, A = 'BEFORE (main: A+B people)', 'AFTER (all B, with shoes)'
sheet('sheet1_close_sidewalk_group', cell(f'{D}/before_close.jpg', B, (0, 150, 585, 1000)), cell(f'{D}/after_close.jpg', A, (0, 150, 585, 1000)))
sheet('sheet2_bodies_midstride', cell(f'{D}/lineup_before.jpg', 'BEFORE (main: B bodies, no shoes)', (0, 0, 1600, 900)), cell(f'{D}/lineup_after.jpg', A, (0, 0, 1600, 900)))
sheet('sheet3_onfoot_start', cell(f'{D}/before_foot.jpg', B), cell(f'{D}/after_foot.jpg', A))
sheet('sheet4_driving_midroute', cell(f'{D}/before_drive.jpg', B), cell(f'{D}/after_drive.jpg', A))
