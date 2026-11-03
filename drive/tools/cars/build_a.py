"""Option A: the owner's car.glb (Crimson Demon X) as traffic -> cars/a.cars  (python3 build_a.py [out])"""
import os, sys, re, numpy as np, time, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *
from bpyutil import *

GRP = {  # suffix: (part, colour, tag)
 '01': (1, (255, 255, 255), 0), '02': (8, 0x34363b, 0), '03': (8, 0x0b0b0c, 0), '04': (3, 0x141414, 0), '05': (2, 0x070a0d, 1),
 '06': (8, 0x25272b, 0), '07': (6, 0xb8bcc0, 0), '08': (7, 0xa01820, 0), '09': (4, 0xf4efe0, 0), '10': (5, 0xb01016, 0), '11': (9, 0xffa030, 0),
}
RATIO = {0: (0.42, 0.80), 1: (0.07, 0.10), 2: (0.006, 0.010)}   # (wheel parts, everything else) per LOD
CREASE = {0: 38, 1: 45, 2: 55}

def OUT(n): return os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'public', 'drive', 'cars', n + '.cars')

def main(outp, src=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'public', 'drive', 'car.glb')):
    t0 = time.time(); objs = import_glb(src)
    by = {}
    for o in objs:
        m = re.search(r'\| (\d\d) ', o.name); k = m.group(1); wheel = bool(re.match(r'(FL|FR|RL|RR)_', o.name))
        by.setdefault((k, wheel), []).append(o)
    lods = {}
    for lod in (0, 1, 2):
        parts = []
        for (k, wheel), os_ in sorted(by.items()):
            part, colr, tag = GRP[k]
            if tag == 1 and lod > 0: tag = 0
            ratio = RATIO[lod][0 if wheel else 1]
            if k in ('09', '10', '11', '05') and lod < 2: ratio = max(ratio, 0.6 if lod == 0 else 0.15)
            bm = world_bm(os_); V, F = decimate_bm(bm, ratio); bm.free()
            V = to_gltf(V) + np.array([0, 0, 1.475])
            NV, NF, NN = crease_mesh(V, F, CREASE[lod])
            m = Mesh(NV, NF, NN); m.with_attrs(colr, part, tag)
            if k == '08': m.with_attrs(0xa01820, 7, 0)
            parts.append(m)
        lods[lod] = merge(parts)
        print('L%d' % lod, len(lods[lod].F), 'faces', round(time.time() - t0, 1))
    return lods


def cabin(zf, zr, w, yf, yroof, ybelt, dark=0x1c1c1f):
    """a simple room behind the glass (game axes): the car has no interior of its own"""
    P = []
    P.append(box(0, yf, (zf + zr) / 2, 2 * w, 0.04, zr - zf, 0x1f1d1b, 8, 2))                 # floor
    for sg in (-1, 1): P.append(box(sg * w, (yf + ybelt) / 2, (zf + zr) / 2, 0.03, ybelt - yf, zr - zf, 0x25272a, 8, 2))   # door cards
    P.append(box(0, yroof - 0.12, (zf + zr) / 2, 1.0, 0.03, zr - zf - 0.4, 0x8e8a83, 8, 2))        # headliner
    P.append(box(0, (yf + ybelt) / 2, zr, 2 * w, ybelt - yf + 0.15, 0.03, 0x1c1c1f, 8, 2))    # rear bulkhead
    P.append(box(0, yf + 0.35, zf + 0.12, 2 * w, 0.5, 0.25, 0x1d1d20, 8, 2))                    # dash
    P.append(box(0, yf + 0.52, zf + 0.30, 2 * w - 0.1, 0.07, 0.2, 0x232326, 8, 2))
    P.append(box(0, yf + 0.14, zf + 0.9, 0.2, 0.17, 0.9, 0x202023, 8, 2))                       # console
    sw = lathe([(0.17 - 0.016 + 0.016 * math.cos(a), 0.016 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 9)][:-1], 18, 'x', 0x151517, 8)
    sw.xform(R('y', 1.2)); sw.xform(T(-0.38, yf + 0.62, zf + 0.5)); P.append(sw)
    for x in (-0.4, 0.4):
        P.append(box(x, yf + 0.12, zf + 1.35, 0.5, 0.14, 0.5, 0x2f2b27, 8, 2))
        b = box(x, yf + 0.40, zf + 1.62, 0.5, 0.5, 0.12, 0x2f2b27, 8, 2); P.append(b)
        P.append(box(x, yf + 0.70, zf + 1.65, 0.2, 0.17, 0.07, 0x2a2623, 8, 2))
    for x in (-0.38, 0.38):
        P.append(box(x, yf + 0.12, zr - 0.5, 0.55, 0.12, 0.5, 0x2f2b27, 8, 2)); P.append(box(x, yf + 0.38, zr - 0.25, 0.55, 0.45, 0.1, 0x2f2b27, 8, 2))
    return merge(P)

def sub(m, mask): return Mesh(m.V, m.F[mask], m.N, m.C[mask], m.P[mask], m.T[mask], m.AO)

def finish(lods, outp, ao_rays=12):
    from build_c import lightbar, sensor, pushbar
    meshes = {}
    interior = cabin(-1.0, 1.4, 0.80, 0.42, 1.44, 1.02)
    occ = sub(lods[0], lods[0].T != 1)
    for lod in (0, 1, 2):
        m = lods[lod]
        if lod == 0: m = merge([m, interior])
        m = bake_ao(m, occ, n_rays=ao_rays if lod == 0 else 10, dist=1.2)
        if lod == 0: meshes['car.L0'] = sub(m, m.T != 1); meshes['car.L0g'] = sub(m, m.T == 1)
        else: meshes['car.L%d' % lod] = m
    roof_y = 1.46; roof_z = 0.2     # game z of the roof's middle
    def bar(lod):   # build space has X = length (nose +X): game z = -x
        return to_game(merge([lightbar(roof_y, -roof_z), pushbar(2.51, 0.5)]))
    def sens(lod): return to_game(merge([sensor(roof_y, -roof_z, lod)]))
    for lod in (0, 1, 2): meshes['police.L%d' % lod] = bar(lod); meshes['sensor.L%d' % lod] = sens(lod)
    L = 5.02; W0 = 1.70; wb = 2.95 / 2
    sc = lambda L_, hy=1.0: [L_ / L, L_ / L * hy, L_ / L]
    roles = {
      'sedan': {'body': 'car', 'addons': [], 'scale': sc(4.5)},
      'suv': {'body': 'car', 'addons': [], 'scale': sc(4.75, 1.12)},
      'police': {'body': 'car', 'addons': ['police'], 'scale': sc(4.95), 'livery': 'police'},
      'robotaxi': {'body': 'car', 'addons': ['sensor'], 'scale': sc(4.7, 1.12), 'livery': 'robotaxi'},
    }
    vehicle = {r: [wb * v['scale'][2], 0.85 * v['scale'][0]] for r, v in roles.items()}
    raw, gz = write_cars(outp, meshes, roles, {'vehicle': vehicle, 'lod': [20, 56], 'name': 'A: the owner car.glb as traffic'})
    print('written', outp, raw, gz, {k: len(v.F) for k, v in meshes.items()})

if __name__ == '__main__':
    lods = main(None)
    finish(lods, sys.argv[1] if len(sys.argv) > 1 else OUT('a'))
