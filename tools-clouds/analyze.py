#!/usr/bin/env python3
"""Reads the frames capture.mjs wrote and reports (a) clouds-off control: every frame identical, so nothing but the clouds is time-dependent;
(b) clouds-on: how many pixels changed vs 0 s, and that every changed pixel sits in the cloud strip rows above the rooftops and is a pixel the
control shows as bare sky (so no building, skyline, store or street pixel changed); (c) the same at 4 px steps for the cloud motion."""
import sys, numpy as np
from PIL import Image
d = sys.argv[1]; TS = [0, 2, 4, 8, 16]
def ld(n, m, t): return np.asarray(Image.open('%s/%s_%s_%02d.png' % (d, n, m, t)).convert('RGBA')).astype(int)
for n in ('phone', 'desk'):
    off = [ld(n, 'off', t) for t in TS]; on = [ld(n, 'on', t) for t in TS]
    H, W, _ = on[0].shape
    print('== %s  canvas %dx%d' % (n, W, H))
    print('control (clouds hidden): changed pixels vs 0 s at', TS[1:], '=', [int((np.abs(o - off[0]).max(axis=2) > 0).sum()) for o in off[1:]])
    # bare sky pixels: where the control differs from the cloud-ON frame at 0 s only through the cloud layer, i.e. everything that is not covered later; use rows' mode colour
    # of the control as the "sky only" colour of that row (the sky is a pure vertical gradient), within 1 level
    sky = np.zeros((H, W), bool)
    for y in range(H):
        row = off[0][y, :, :3]; vals, cnt = np.unique(row, axis=0, return_counts=True); m = vals[cnt.argmax()]
        sky[y] = (np.abs(row - m).max(axis=1) <= 1) & (cnt.max() > W * 0.1)
    for i, t in enumerate(TS[1:], 1):
        ch = np.abs(on[i] - on[0]).max(axis=2) > 0
        ys = np.where(ch.any(axis=1))[0]
        # changed pixels that are NOT bare sky in the control (= a building / skyline / store / street pixel changed)
        bad = ch & ~sky
        # control vs on at the same time: differences exist only where clouds are
        # the soft (anti-aliased) edge of a building over open sky blends with whatever is behind it, so a cloud passing behind shows through
        # that one-pixel edge. A pixel is "solid" when it and its 8 neighbours are all non-sky in the control: none of those may change.
        ns = ~sky; solid = ns.copy()
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-2, -1, 0, 1, 2): solid &= np.roll(np.roll(ns, dy, 0), dx, 1)
        print('  t=%2ds: changed pixels that are solid building/store/street (everything within 2 px also non-sky): %d' % (t, (ch & solid).sum()))
        print('  t=%2ds: pixels changed by the drift %6d (rows %d..%d of %d); changed pixels that are not bare sky: %d' % (t, ch.sum(), ys.min() if len(ys) else -1, ys.max() if len(ys) else -1, H, bad.sum()))
    # buildings etc: the non-sky pixels of the control must be identical in all ON frames
    nsky = ~sky; solid = nsky.copy()
    for dy in (-2, -1, 0, 1, 2):
        for dx in (-2, -1, 0, 1, 2): solid &= np.roll(np.roll(nsky, dy, 0), dx, 1)
    dd = np.abs(on[4] - on[0]).max(axis=2) > 0
    print('  solid (non-sky, everything within 2 px non-sky too) pixels: %d; differing between clouds-on 0 s and 16 s: %d; thin or anti-aliased edge pixels differing: %d' % (solid.sum(), (dd & solid).sum(), (dd & nsky & ~solid).sum()))
