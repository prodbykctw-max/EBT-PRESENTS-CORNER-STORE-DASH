# python3 tools-store3d/compose_sheet.py <dir>  -> <dir>/store3d_sheet.jpg : "NOW | 3D" x 3 rows (A top / B mid / C bottom), same phone framing
import sys
from PIL import Image, ImageDraw, ImageFont
d = sys.argv[1]; W, pad, top = 440, 16, 46
rows = [('A', 'Near the dairy aisle and the exit (top of the store)'), ('B', 'Mid-store by the checkouts (PAY spots on)'), ('C', 'Bottom, by the produce and the meat')]
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 26); f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 20)
except Exception: F = f2 = ImageFont.load_default()
ims = []
for k, cap in rows:
    a = Image.open(f'{d}/{k}_now.png').convert('RGB'); b = Image.open(f'{d}/{k}_3d.jpg').convert('RGB')
    h = round(W * a.height / a.width); ims.append((a.resize((W, h), Image.LANCZOS), b.resize((W, round(W * b.height / b.width)), Image.LANCZOS), cap))
H = top + sum(max(a.height, b.height) + 50 + pad for a, b, _ in ims)
S = Image.new('RGB', (W * 2 + pad * 3, H), (16, 18, 32)); g = ImageDraw.Draw(S)
y = pad
for a, b, cap in ims:
    g.text((pad, y), 'NOW (painted board)', font=F, fill=(245, 197, 24)); g.text((W + pad * 2, y), '3D (real-time, realistic look)', font=F, fill=(120, 220, 160)); g.text((W + pad * 2 + 0, y + 30), cap, font=f2, fill=(200, 200, 215))
    y += 62; S.paste(a, (pad, y)); S.paste(b, (W + pad * 2, y)); y += max(a.height, b.height) + pad
S = S.crop((0, 0, S.width, y)); S.save(f'{d}/store3d_sheet.jpg', quality=90); print(S.size)
