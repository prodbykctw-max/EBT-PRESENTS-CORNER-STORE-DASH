# python3 tools-light/cmp.py a.jpg b.jpg : the number of pixels that differ (any channel), and the biggest channel difference
import sys, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int); b = np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(int)
d = np.abs(a - b).max(axis=2)
print('size', a.shape[:2], 'differing pixels', int((d > 0).sum()), 'of', d.size, 'max channel diff', int(d.max()), 'pixels > 8:', int((d > 8).sum()))
