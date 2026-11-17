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
H = top + sum(max(a.height, b.height) + 50 + pad for a, b, _ in ims) + 700
S = Image.new('RGB', (W * 2 + pad * 3, H), (16, 18, 32)); g = ImageDraw.Draw(S)
y = pad
for a, b, cap in ims:
    g.text((pad, y), 'NOW (painted board)', font=F, fill=(245, 197, 24)); g.text((W + pad * 2, y), '3D (real-time, realistic look)', font=F, fill=(120, 220, 160)); g.text((W + pad * 2 + 0, y + 30), cap, font=f2, fill=(200, 200, 215))
    y += 62; S.paste(a, (pad, y)); S.paste(b, (W + pad * 2, y)); y += max(a.height, b.height) + pad
import os
if os.path.exists(f'{d}/street.png'):   # a frame of the realistic drive for exposure / contrast / saturation comparison
    st = Image.open(f'{d}/street.png').convert('RGB'); sw = S.width - pad * 2; sh = round(sw * 0.42)
    # centre crop of the street frame, as a strip
    r = sw / st.width; st = st.resize((sw, round(st.height * r)), Image.LANCZOS); top0 = max(0, (st.height - sh) // 2); st = st.crop((0, top0, sw, top0 + sh))
    g.text((pad, y), 'the street, for comparison (realistic drive, same exposure pipeline)', font=f2, fill=(200, 200, 215)); y += 30
    S.paste(st, (pad, y)); y += sh + pad
S = S.crop((0, 0, S.width, y)); S.save(f'{d}/store3d_sheet.jpg', quality=90); print(S.size)
