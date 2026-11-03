"""print the tri counts per LOD / bytes of the three .cars files:  python3 report.py"""
import gzip, json, struct, os, sys
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'public', 'drive', 'cars')
for n in 'abc':
    raw = open(os.path.join(d, n + '.cars'), 'rb').read(); size = len(raw)
    data = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
    jl = struct.unpack('<I', data[4:8])[0]; h = json.loads(data[8:8 + jl]); M = h['meshes']
    print(n.upper(), h.get('name'), 'file bytes', size, 'uncompressed', len(data))
    for role, r in h['roles'].items():
        t = lambda lv: sum(M[f'{x}.{lv}']['tris'] for x in [r['body']] + r.get('addons', []) if f'{x}.{lv}' in M)
        g = M.get(f"{r['body']}.L0g", {}).get('tris', 0)
        print(f'  {role:9s} L0 {t("L0")} + glass {g}   L1 {t("L1")}   L2 {t("L2")}   (body {r["body"]}, addons {r.get("addons")}, scale {r["scale"]})')
