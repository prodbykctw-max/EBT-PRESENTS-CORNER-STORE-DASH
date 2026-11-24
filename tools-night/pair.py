import sys
from PIL import Image, ImageDraw
a, b, names, out = sys.argv[1], sys.argv[2], sys.argv[3].split(','), sys.argv[4]
W=390; H=780; s=Image.new('RGB',(W*len(names), H*2+40),'black'); d=ImageDraw.Draw(s)
for k,n in enumerate(names):
    for r,dd in enumerate([a,b]):
        s.paste(Image.open(f'{dd}/{n}.png'),(W*k, 20+r*(H+20)))
        d.text((W*k+5, 3+r*(H+20)), f'{dd} {n}', fill='white')
s=s.resize((s.width//2, s.height//2)); s.save(out)
