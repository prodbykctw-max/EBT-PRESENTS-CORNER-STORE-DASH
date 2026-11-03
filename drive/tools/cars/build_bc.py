"""Combine B and C into one file: public/drive/cars/bc.cars  (python3 build_bc.py)

The owner's pick ("combine B and C"): SUV, police and robotaxi use C's bodies; ordinary sedan-role cars are a mix of C's sedan and
B's Khronos CarConcept body (about 1 in 3, chosen per car at runtime by cars.js from a counter, see `mix`).
No geometry is rebuilt: the packed meshes of b.cars and c.cars are copied byte for byte into one container, so the file only holds
the bodies that are used (B's police light bar / sensor add-ons and its stretched SUV / police / robotaxi roles are left out).

B's body is scaled onto C's sedan footprint: its four wheel centres are 2.792 m apart (C's sedan: 2.700), so z and y use 2.700/2.792
(wheels stay round, the wheel bottoms stay on y = 0 and the seated pose is the one the game computes for C's sedan), and x uses 0.80
so its body is as wide as C's sedan (2 x 1.016 m against 2 x 1.020 m).
"""
import gzip, json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARS = os.path.join(HERE, '..', '..', '..', 'public', 'drive', 'cars')


def read(path):
    d = open(path, 'rb').read()
    if d[:2] == b'\x1f\x8b': d = gzip.decompress(d)
    assert d[:4] == b'CARS'
    jl = struct.unpack('<I', d[4:8])[0]
    return json.loads(d[8:8 + jl]), d, 8 + jl


def blob_len(m, field):
    n = m['n']
    return {'pos': n * 6, 'nrm': n * 3, 'col': n * 3, 'part': n, 'ao': n, 'idx': m['m'] * (4 if m['wide'] else 2)}[field]


def main(out=os.path.join(CARS, 'bc.cars')):
    hb, db, bb = read(os.path.join(CARS, 'b.cars'))
    hc, dc, bc = read(os.path.join(CARS, 'c.cars'))
    blobs = []; off = 0; meshes = {}

    def take(src_h, src_d, src_base, name, new):
        nonlocal off
        m = dict(src_h['meshes'][name])
        for f in ('pos', 'nrm', 'col', 'part', 'ao', 'idx'):
            b = src_d[src_base + m[f]: src_base + m[f] + blob_len(m, f)]
            b = b + b'\0' * ((-len(b)) % 4)
            blobs.append(b); m[f] = off; off += len(b)
        meshes[new] = m

    for name in hc['meshes']: take(hc, dc, bc, name, name)                           # every C mesh is used
    for lv in ('L0', 'L0g', 'L1', 'L2'): take(hb, db, bb, f'car.{lv}', f'bcar.{lv}')  # only B's body

    k = 2.700 / 2.792
    roles = dict(hc['roles'])
    roles['sedanB'] = {'body': 'bcar', 'addons': [], 'scale': [0.80, round(k, 4), round(k, 4)], 'as': 'sedan', 'doubleL0': True}
    head = {'version': 1, 'meshes': meshes, 'roles': roles, 'vehicle': hc['vehicle'], 'lod': hc['lod'],
            'name': 'BC: C street cars, with B (Khronos CarConcept, CC-BY 4.0) as about one sedan in three',
            'mix': {'sedan': {'alt': 'sedanB', 'every': 3}}}
    j = json.dumps(head, separators=(',', ':')).encode(); j += b' ' * ((-len(j)) % 4)
    data = b'CARS' + struct.pack('<I', len(j)) + j + b''.join(blobs)
    z = gzip.compress(data, 9, mtime=0)
    open(out, 'wb').write(z)
    print('written', out, 'raw', len(data), 'gzip', len(z))


if __name__ == '__main__':
    main(*sys.argv[1:2])
