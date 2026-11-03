"""Option C: procedural unbranded street cars -> public/drive/cars/c.cars   (python3 build_c.py [out])"""
import os, sys, numpy as np, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *
from carbody import *

def OUT(n): return os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'public', 'drive', 'cars', n + '.cars')

def sub(m, mask): return Mesh(m.V, m.F[mask], m.N, m.C[mask], m.P[mask], m.T[mask], m.AO)

def lightbar(roof_y, x0):
    parts = []
    parts.append(box(x0, roof_y + 0.035, 0, 0.30, 0.05, 1.20, 0x15161a, 8))
    for k, (z0, c_) in enumerate(((-0.30, 0xb10101), (0.30, 0x0108e2))):
        parts.append(box(x0, roof_y + 0.095, z0, 0.26, 0.085, 0.50, c_, 9))
    parts.append(box(x0, roof_y + 0.095, 0.0, 0.26, 0.075, 0.12, 0xdadfe3, 9))
    parts.append(box(x0, roof_y + 0.145, 0, 0.30, 0.012, 1.18, 0x15161a, 8))
    for z in (-0.5, 0.5): parts.append(box(x0, roof_y + 0.01, z, 0.12, 0.03, 0.06, 0x15161a, 8))
    return merge(parts)

def pushbar(xf, y):
    return merge([box(xf + 0.04, y, 0, 0.07, 0.16, 1.0, 0x15161a, 8), box(xf + 0.02, y + 0.12, -0.5, 0.05, 0.28, 0.06, 0x15161a, 8), box(xf + 0.02, y + 0.12, 0.5, 0.05, 0.28, 0.06, 0x15161a, 8)])

def sensor(roof_y, x0, lod):
    seg = 18 if lod == 0 else 10
    puck = lathe([(0.0, 0.0), (0.135, 0.0), (0.135, 0.07), (0.115, 0.075), (0.115, 0.11), (0.125, 0.115), (0.125, 0.185), (0.10, 0.20), (0.0, 0.205)], seg, 'y', 0x17191c, 8)
    band = lathe([(0.1262, 0.12), (0.1262, 0.18)], seg, 'y', 0x0a1114, 2)
    mast = box(0, 0, 0, 0.0, 0.0, 0.0, 0, 0) if False else None
    base = box(0, 0.0, 0, 0.42, 0.03, 0.30, 0xe9edef, 7)
    out = merge([puck, band, base]); out.xform(T(x0, roof_y, 0)); return out

def side_sensors(B, lod):
    p = B.p; xm = p['mirror'][0] + 0.02; ym = float(np.minimum(B.f_belt(np.array(xm)), B.f_top(np.array(xm)) - 0.012)) + 0.0; zw = float(B.f_w(np.array(xm))) + 0.02
    parts = []
    for sg in (1, -1):
        d = lathe([(0.0, 0.0), (0.045, 0.0), (0.045, 0.03), (0.0, 0.05)], 10, 'y', 0x17191c, 8); d.xform(T(xm - 0.05, ym - 0.02, sg * (zw + 0.02))); parts.append(d)
    f = box(p['xf'] + 0.012, 0.58, 0, 0.02, 0.03, 0.55, 0x17191c, 8); parts.append(f)
    return merge(parts)

def make_body(name, ao=True):
    """-> {lod: (mesh in game space)} with L0 split into body+glass"""
    out = {}; occ = None
    for lod in (0, 1, 2):
        cn, B = build_car(name, lod)
        m = merge(cn)
        if lod == 0:
            occ = sub(m, m.T != 1)
        out[lod] = (m, B)
    return out, occ

def bake(m, occ, n=14):
    # glass cells are skipped by the occluder (you can see through them); the interior is dark because the roof is not
    return bake_ao(m, occ, n_rays=n, dist=1.2)

def main(outp):
    t0 = time.time(); meshes = {}; roles = {}
    bodies = {}
    for name in ('sedan', 'suv', 'cross'):
        out, occ = make_body(name)
        bodies[name] = out
        for lod in (0, 1, 2):
            m, B = out[lod]
            m = bake(m, occ, 14 if lod == 0 else 10)
            g = to_game(m)
            if lod == 0:
                meshes[f'{name}.L0'] = sub(g, g.T != 1); meshes[f'{name}.L0g'] = sub(g, g.T == 1)
            else: meshes[f'{name}.L{lod}'] = g
        print(name, {l: len(meshes[k].F) for l, k in ((0, f'{name}.L0'), (1, f'{name}.L1'), (2, f'{name}.L2'))}, 'glass', len(meshes[f'{name}.L0g'].F), round(time.time() - t0, 1))
    # add-ons
    for lod in (0, 1, 2):
        Bs = bodies['sedan'][lod][1]; Bc = bodies['cross'][lod][1]
        roof = float(Bs.f_top(np.array(-0.2)))
        lb = lightbar(roof, -0.2); pb = pushbar(Bs.p['xf'], 0.42)
        meshes[f'police.L{lod}'] = to_game(merge([lb, pb]))
        roofc = float(Bc.f_top(np.array(-0.2)))
        meshes[f'sensor.L{lod}'] = to_game(merge([sensor(roofc, -0.2, lod), side_sensors(Bc, lod)]))
    SP = SPECS
    pol = [1.067, 1.05, 1.1]     # sedan body stretched to the police hitbox 4.95 x 1.90 (game axes: x width, y height, z length)
    roles = {
      'sedan': {'body': 'sedan', 'addons': [], 'scale': [1, 1, 1]},
      'suv': {'body': 'suv', 'addons': [], 'scale': [1, 1, 1]},
      'police': {'body': 'sedan', 'addons': ['police'], 'scale': pol, 'livery': 'police'},
      'robotaxi': {'body': 'cross', 'addons': ['sensor'], 'scale': [1, 1, 1], 'livery': 'robotaxi'},
    }
    vehicle = {'sedan': [SP['sedan']['wb'], SP['sedan']['wz']], 'suv': [SP['suv']['wb'], SP['suv']['wz']],
               'police': [SP['sedan']['wb'] * pol[2], SP['sedan']['wz'] * pol[0]], 'robotaxi': [SP['cross']['wb'], SP['cross']['wz']]}
    raw, gz = write_cars(outp, meshes, roles, {'vehicle': vehicle, 'lod': [20, 56], 'name': 'C: procedural street cars'})
    print('written', outp, raw, gz, round(time.time() - t0, 1))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else OUT('c'))
