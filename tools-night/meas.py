import sys, numpy as np
from PIL import Image
from scipy import ndimage as nd
def L(f): return np.asarray(Image.open(f).convert('RGB')).astype(float) @ [0.2126,0.7152,0.0722]
def subject(d, base, hide):
    a, b = L(f'{d}/{base}.png'), L(f'{d}/{base}_{hide}.png')
    m = np.abs(a-b) > 6
    m = nd.binary_opening(m, iterations=1)
    if m.sum() < 15: return None
    lab, n = nd.label(m); sizes = nd.sum(m, lab, range(1, n+1)); m = lab == (1+np.argmax(sizes))
    ring = nd.binary_dilation(m, iterations=14) & ~nd.binary_dilation(m, iterations=4)
    return a[m].mean(), b[ring].mean(), int(m.sum())   # subject mean (as drawn), surroundings mean (with the subject hidden: the road around)
def glow(d, base):
    a, b = L(f'{d}/{base}.png'), L(f'{d}/{base}_noglow.png')
    m = (a-b) > 12
    lab, n = nd.label(m)
    if n == 0: return 0, 0
    sizes = nd.sum(m, lab, range(1, n+1)); k = int(np.argmax(sizes))
    sl = nd.find_objects(lab)[k]
    return int(sizes[k]), max(sl[0].stop-sl[0].start, sl[1].stop-sl[1].start)
for d in sys.argv[1:]:
    for base in ['foot_start','foot_mid','foot_car','drive_straight','drive_signal']:
        try:
            r = subject(d, base, 'nome'); h = subject(d, base, 'nohim'); g = glow(d, base)
            fm = L(f'{d}/{base}.png')
            print(d, base, 'runner(mean,around,px)=', None if r is None else tuple(round(x,1) for x in r), 'bully=', None if h is None else tuple(round(x,1) for x in h), 'largest glow (px area, px span)=', g, 'frame mean', round(fm.mean(),1), 'black% (<8)', round((fm<8).mean()*100,1))
        except FileNotFoundError as e: print(d, base, 'missing', e)
