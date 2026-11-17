# python3 -I tools-steer/same_diff.py a.jpg b.jpg  -> how many pixels differ, by how much, and where
import sys
from PIL import Image, ImageChops
a, b = (Image.open(p).convert('RGB') for p in sys.argv[1:3])
d = ImageChops.difference(a, b); bb = d.getbbox(); px = d.load(); n = big = 0
for y in range(d.height):
    for x in range(d.width):
        m = max(px[x, y])
        if m: n += 1
        if m > 24: big += 1
print('size', a.size, 'differing pixels', n, '> 24/255:', big, 'bbox', bb)
