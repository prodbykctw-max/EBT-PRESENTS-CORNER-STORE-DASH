# python3 tools-light/sheet.py <dir with pv/> : light_sheet.jpg, before next to the after shots, flyover row and street row, each column labelled with phase and Atlanta time
import sys, os
from PIL import Image, ImageDraw, ImageFont
d = sys.argv[1]
cols = [('before', 'BEFORE (origin/main)', 'fixed afternoon'), ('a_dawn', 'DAWN', '07:05'), ('b_morning', 'MORNING', '08:00'), ('c_day', 'BRIGHT DAY', '13:00'),
        ('d_golden', 'GOLDEN HOUR', '16:55'), ('e_dusk', 'PINK DUSK', '17:47'), ('f_blue', 'BLUE HOUR', '18:15'), ('g_night', 'NIGHT', '21:00'), ('h_rain', 'RAINY NIGHT', '21:00')]
W, H = 270, 480
try: f1 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 19); f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
except Exception: f1 = f2 = ImageFont.load_default()
sheet = Image.new('RGB', (W * len(cols), 58 + H * 2 + 28), (14, 14, 18)); g = ImageDraw.Draw(sheet)
for i, (k, name, t) in enumerate(cols):
    g.text((i * W + 8, 6), name, fill=(255, 255, 255), font=f1); g.text((i * W + 8, 30), t + ' Atlanta' if k != 'before' else t, fill=(200, 200, 210), font=f2)
    for r, kind in enumerate(['fly0', 'street']):
        p = os.path.join(d, 'pv', f'{k}_{kind}.jpg')
        if os.path.exists(p): sheet.paste(Image.open(p).convert('RGB').resize((W - 4, H)), (i * W + 2, 58 + r * (H + 14)))
g.text((8, 58 + H * 2 + 20 - 14 + 2), 'row 1: opening flyover (same frame)   row 2: street level behind the car (same spot).  Nov 16 2026 Atlanta: sunrise 07:10, sunset 17:36', fill=(170, 170, 180), font=f2)
sheet.save(os.path.join(d, 'light_sheet.jpg'), quality=88); print(sheet.size)
