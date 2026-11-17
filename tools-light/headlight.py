# python3 tools-light/headlight.py <dir>: how much brighter the road is with the headlights on: mean luma of the road band ahead of the car (the middle of the picture, between the car and the horizon) on / off, and the pixels that differ by more than 6
import sys, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1] + '/on.jpg').convert('L')).astype(float); b = np.asarray(Image.open(sys.argv[1] + '/off.jpg').convert('L')).astype(float)
H, W = a.shape; r = (slice(int(H * 0.40), int(H * 0.52)), slice(int(W * 0.25), int(W * 0.75)))   # the road just ahead of the car
print('road ahead mean luma on', round(a[r].mean(), 1), 'off', round(b[r].mean(), 1), 'gain', round(a[r].mean() - b[r].mean(), 1), '| pixels differing > 6:', int((np.abs(a - b) > 6).sum()), 'of', a.size)
Image.fromarray(np.concatenate([a, b], 1).astype(np.uint8)).save(sys.argv[1] + '/on_off.png')
