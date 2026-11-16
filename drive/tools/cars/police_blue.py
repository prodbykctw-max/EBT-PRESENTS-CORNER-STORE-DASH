"""Police light bars are BLUE ONLY (Georgia reserves flashing blue for law enforcement; no red flashing either, WCAG 2.3.1).
Recolours the red light-bar lens vertices (part 9, red-dominant) of every police mesh in a.cars / b.cars / c.cars / bc.cars to the bar's
blue, in place, byte for byte otherwise.   python3 police_blue.py   (idempotent; build_c.py's lightbar() makes both lenses blue for a rebuild)"""
import gzip, json, os, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__)); CARS = os.path.join(HERE, '..', '..', '..', 'public', 'drive', 'cars')
BLUE = (0x01, 0x08, 0xe2)
for name in ('a', 'b', 'c', 'bc'):
    p = os.path.join(CARS, name + '.cars'); raw = open(p, 'rb').read(); d = bytearray(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw)
    jl = struct.unpack('<I', d[4:8])[0]; h = json.loads(bytes(d[8:8 + jl])); base = 8 + jl; changed = 0
    for mn, m in h['meshes'].items():
        if not mn.startswith('police'): continue
        n = m['n']
        for i in range(n):
            if d[base + m['part'] + i] != 9: continue
            o = base + m['col'] + i * 3; r, g, b = d[o], d[o + 1], d[o + 2]
            if r > 2 * max(g, b, 1): d[o:o + 3] = bytes(BLUE); changed += 1
    open(p, 'wb').write(gzip.compress(bytes(d), 9, mtime=0) if raw[:2] == b'\x1f\x8b' else bytes(d))
    print(name, 'red lens vertices recoloured:', changed)

# props.glb (the comic look, ?cars=none): the prop_police light bar's red lens (vertex colour 177,1,1) -> the same blue
p = os.path.join(CARS, '..', 'props.glb'); raw = bytearray(open(p, 'rb').read()); jl = struct.unpack('<I', raw[12:16])[0]
j = json.loads(bytes(raw[20:20 + jl])); b0 = 20 + jl + 8
mesh = next(m for m in j['meshes'] if m['name'] == 'prop_police'); a = j['accessors'][mesh['primitives'][0]['attributes']['COLOR_0']]
bv = j['bufferViews'][a['bufferView']]; o0 = b0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride', 3); ch = 0
for i in range(a['count']):
    o = o0 + i * st
    if tuple(raw[o:o + 3]) == (177, 1, 1): raw[o:o + 3] = bytes(BLUE); ch += 1
open(p, 'wb').write(raw); print('props.glb prop_police red lens vertices recoloured:', ch)
