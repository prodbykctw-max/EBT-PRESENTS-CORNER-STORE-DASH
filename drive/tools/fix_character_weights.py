"""Untangle the hands from the jeans and the tee in public/drive/character.glb (the on-foot model of you and the bully).

The Tripo model was rigged with the arms hanging against the hips, and its automatic skin weights tied them together:
hundreds of vertices of the jeans and the tee around the pockets also follow the hand bones, and ~370 vertices of each
hand also follow the thigh bones. So in the run each hand dragged a patch of jeans with it (it looked like he was
grabbing and pulling his pockets) and each stride pulled the hands down toward the jeans. The scan is also one fused
surface: where a hand touched the hip, a few triangles join hand to tee/jeans.

Below the elbow (model height < 0.56; the model is 0.982 tall, feet at 0) every vertex is put on one side, by distance
along the surface from sure seeds (arm: on the forearm/hand bone line; body: well away from it, or jeans-coloured):
  arm  follows the arm bones only (its leg and body weights are dropped)
  body loses its forearm/hand weights (and its upper-arm weights below 0.5, the hips)
then each triangle that still joins an arm vertex to a body vertex is split: its arm corners are swapped for copies
that follow the body (the weights of the triangle's nearest body corner). The tee and jeans keep their whole surface
and follow the body; the hand comes away from them. Weights are renormalised; a vertex left with no weight takes its
nearest bone on its side. The weights, the indices and the added vertices change; every other byte (texture,
animation, skeleton) is copied as it was. Run it once on a fresh export (drive/tools/export_character.py):
    python3 drive/tools/fix_character_weights.py public/drive/character.glb [--dry]
"""
import colorsys, io, json, struct, sys
import numpy as np
from PIL import Image

path = sys.argv[1]; dry = '--dry' in sys.argv
d = open(path, 'rb').read()
jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + jl]); B0 = 20 + jl + 8
CT = {5126: ('f', 4), 5121: ('B', 1), 5123: ('H', 2)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def read(i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; n = NC[a['type']]
    f, sz = CT[a['componentType']]; st = bv.get('byteStride', sz * n); off = B0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    assert not a.get('normalized'), 'normalized integer weights are not handled'
    return [list(struct.unpack_from('<%d%s' % (n, f), d, off + k * st)) for k in range(a['count'])]

skin = j['skins'][0]; joints = [j['nodes'][x]['name'] for x in skin['joints']]
bind = {n: np.linalg.inv(np.array(m).reshape(4, 4).T)[:3, 3] for n, m in zip(joints, read(skin['inverseBindMatrices']))}
pr = j['meshes'][0]['primitives'][0]; at = pr['attributes']
P, NM, UV, J, W = (read(at[k]) for k in ('POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'))
I = [x[0] for x in read(pr['indices'])]
mat = j['materials'][pr['material']]; ti = mat['pbrMetallicRoughness']['baseColorTexture']['index']
img = j['images'][j['textures'][ti]['source']]; ibv = j['bufferViews'][img['bufferView']]
tex = Image.open(io.BytesIO(d[B0 + ibv.get('byteOffset', 0):B0 + ibv.get('byteOffset', 0) + ibv['byteLength']])).convert('RGB'); TW, TH = tex.size; px = tex.load()
def colour(uv):
    r, g, b = px[min(TW - 1, int(uv[0] % 1 * TW)), min(TH - 1, int(uv[1] % 1 * TH))]; h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if 0.52 <= h <= 0.72 and s > 0.18: return 'denim'
    if (h < 0.12 or h > 0.95) and s > 0.25 and v < 0.75: return 'skin'
    return 'other'

ELBOW, HIPS = 0.56, 0.5
ARM = lambda n: any(k in n for k in ('Upperarm', 'Forearm', 'Hand', 'Clavicle'))
LOW_ARM = lambda n: any(k in n for k in ('Forearm', 'Hand'))
def seg(p, a, b):
    ab = b - a; t = np.clip(np.dot(p - a, ab) / np.dot(ab, ab), 0, 1); return float(np.linalg.norm(p - (a + t * ab)))
def arm_dist(p):
    p = np.array(p); best = (9.0, None)
    for S in 'LR':
        F, H = bind[S + '_Forearm'], bind[S + '_Hand']; tip = H + (H - F) / np.linalg.norm(H - F) * 0.10
        best = min(best, (seg(p, F, H), S + '_Forearm'), (seg(p, H, tip), S + '_Hand'))
    return best
# Which side each vertex below the elbow is on, by distance along the surface itself: seeds that are surely arm (on
# the forearm/hand bone line) and surely body (well away from it, or jeans), then every vertex takes the side of the
# nearer seed measured along the mesh's own edges. The whole fist ends up on the arm and the whole tee hem on the body,
# with the line between them in the patch where the scan fused hand and hip. (By rest-pose distance alone, parts of
# the fist sit farther from the bone line than parts of the tee hem: the fist was left behind and the hem torn off.)
import heapq
adj = [[] for _ in P]
for t in range(0, len(I), 3):
    a, b, c = I[t:t + 3]
    for u, v in ((a, b), (b, c), (c, a)):
        L = float(np.linalg.norm(np.array(P[u]) - np.array(P[v]))); adj[u].append((v, L)); adj[v].append((u, L))
REGION = lambda v: P[v][1] < ELBOW + 0.06
dist0 = {}; heap = []
for v, p in enumerate(P):
    if not REGION(v): continue
    dd, near = arm_dist(p); c = colour(UV[v])
    if dd < 0.022 and c != 'denim': seed = 'arm'
    elif dd > 0.075 or (c == 'denim' and dd > 0.04): seed = 'body'
    else: continue
    dist0[v] = (0.0, seed); heapq.heappush(heap, (0.0, v, seed))
while heap:
    dv, v, sd = heapq.heappop(heap)
    if dist0.get(v, (9e9,))[0] < dv: continue
    for u, L in adj[v]:
        if not REGION(u): continue
        nd = dv + L
        if nd < dist0.get(u, (9e9,))[0]: dist0[u] = (nd, sd); heapq.heappush(heap, (nd, u, sd))
side = {}; stats = {'arm': 0, 'body': 0, 'arm weights fixed': 0, 'body weights fixed': 0, 'fallback': 0}
for v, p in enumerate(P):
    if p[1] >= ELBOW or v not in dist0: continue
    s = dist0[v][1]; side[v] = s; stats[s] += 1
    names = [joints[a] for a in J[v]]
    if s == 'arm': keep = [w if (w > 0 and ARM(n)) else 0.0 for n, w in zip(names, W[v])]; fb = arm_dist(p)[1]
    else: keep = [0.0 if (w > 0 and (LOW_ARM(n) or (ARM(n) and p[1] < HIPS))) else w for n, w in zip(names, W[v])]; fb = 'Hip'
    if keep == list(W[v]): continue
    stats[s + ' weights fixed'] += 1
    if sum(keep) <= 1e-6:
        stats['fallback'] += 1; J[v] = [joints.index(fb), 0, 0, 0]; W[v] = [1.0, 0.0, 0.0, 0.0]; continue
    t = sum(keep); W[v] = [w / t for w in keep]
# split the triangles that still join an arm vertex to a body vertex
dup = {}; bridges = 0
for t in range(0, len(I), 3):
    tri = I[t:t + 3]; sides = [side.get(v) for v in tri]
    if 'arm' not in sides or 'body' not in sides: continue
    bridges += 1; body = [v for v in tri if side.get(v) == 'body']
    for c, v in enumerate(tri):
        if side.get(v) != 'arm': continue
        src = min(body, key=lambda b: sum((P[b][i] - P[v][i]) ** 2 for i in range(3)))
        if (v, src) not in dup:
            dup[(v, src)] = len(P); P.append(P[v]); NM.append(NM[v]); UV.append(UV[v]); J.append(list(J[src])); W.append(list(W[src]))
        I[t + c] = dup[(v, src)]
for k, n in stats.items(): print(f'{n:5d} {k}')
print(f'{bridges:5d} triangles joining a hand/forearm to the body split off the hand ({len(dup)} vertices added, {len(P)} now)')
assert len(P) < 65536, 'indices are 16-bit'

def rebuild():
    """the glb again with the longer vertex attributes and the new indices; every other byte copied as it was"""
    new = {at['POSITION']: (P, 'f'), at['NORMAL']: (NM, 'f'), at['TEXCOORD_0']: (UV, 'f'), at['JOINTS_0']: (J, 'B'), at['WEIGHTS_0']: (W, 'f'), pr['indices']: ([[x] for x in I], 'H')}
    byview = {j['accessors'][i]['bufferView']: (i, rows, f) for i, (rows, f) in new.items()}
    out = bytearray()
    for vi, bv in enumerate(j['bufferViews']):
        if vi in byview:
            i, rows, f = byview[vi]; a = j['accessors'][i]
            assert 'byteStride' not in bv and a.get('byteOffset', 0) == 0
            blob = b''.join(struct.pack('<%d%s' % (len(r), f), *r) for r in rows); a['count'] = len(rows)
        else:
            o = B0 + bv.get('byteOffset', 0); blob = d[o:o + bv['byteLength']]
        while len(out) % 4: out.append(0)
        bv['byteOffset'] = len(out); bv['byteLength'] = len(blob); out += blob
    while len(out) % 4: out.append(0)
    j['buffers'][0]['byteLength'] = len(out)
    js = json.dumps(j, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    return (struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<I4s', len(js), b'JSON') + js
            + struct.pack('<I4s', len(out), b'BIN\x00') + bytes(out))
if not dry:
    g = rebuild(); open(path, 'wb').write(g); print('wrote', path, len(g), 'bytes')
