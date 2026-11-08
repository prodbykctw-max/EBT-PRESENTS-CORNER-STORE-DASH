#!/usr/bin/env python3
"""Bakes the realistic animals (the dog and the pigeon) for the realistic look: public/drive/animals/animals.json + animals.bin + the three textures.

Sources (CC-BY 4.0, see public/drive/animals/CREDITS.txt), in drive/tools/animals/src/:
  pitbull.glb                 "PitBull" by Joseph AYYAD (Sketchfab)
  pigeon/source/Pigeon.glb    "Pigeon" by kenchoo (Sketchfab), based on "Pigeon #1" by NMC BC (Sketchfab)

Nothing is skinned at run time on the CPU: every pose is baked here into a bone-matrix texture (one row per frame, three texels per joint: the 3x4 matrix
of `outputSpace * jointWorld * inverseBind`, half floats) and animals.js skins each instance in the vertex shader from two frames of it.
Output space: metres, feet on y = 0, facing -z (the same way every prop of props.glb faces: World.render turns by `yaw - pi/2`).
Run:  python3 -I drive/tools/animals/build_animals.py          (numpy, Pillow, meshoptimizer)
"""
import io, json, os, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from glb import GLB, Rig, trs, slerp, quat_to_mat
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(HERE, 'src'); OUT = os.path.join(ROOT, 'public', 'drive', 'animals')
os.makedirs(OUT, exist_ok=True)

DOG_LEN = 1.24        # m, nose to tail tip: what the old props.glb dog measured (HAZARD_SCALE 1.5 is applied on top at run time, as before)
DOG_DROP = [2]         # pieces of pitbull.glb not drawn (filled in below once looked at)
PIG_LEN = 0.50        # m, beak to tail tip of the standing pigeon (the old prop_bird_sit was 0.46; species scale 2 is applied at run time, as before)

def f16(a): return np.asarray(a, np.float16)

class Blob:
    def __init__(self): self.b = bytearray(); self.meta = {}
    def add(self, name, arr):
        while len(self.b) % 4: self.b.append(0)
        arr = np.ascontiguousarray(arr); self.meta[name] = {'offset': len(self.b), 'length': arr.nbytes, 'count': int(arr.size)}
        self.b += arr.tobytes(); return self.meta[name]

def webp(im, path, q=80, size=None):
    if size and im.size != (size, size): im = im.resize((size, size), Image.LANCZOS)
    im.convert('RGB').save(path, 'WEBP', quality=q, method=6); return os.path.getsize(path)

# ------------------------------------------------------------------ skinned meshes
def read_pieces(g, rig, keep=None):
    pos, nor, uv, jn, wt, idx = [], [], [], [], [], []; base = 0
    for mi, m in enumerate(g.j['meshes']):
        if keep is not None and mi not in keep: continue
        pr = m['primitives'][0]; a = pr['attributes']
        P = g.acc(a['POSITION']); N = g.acc(a['NORMAL']); U = g.acc(a['TEXCOORD_0']); J = g.acc(a['JOINTS_0']).astype(np.int64); W = g.acc(a['WEIGHTS_0']).astype(np.float32)
        I = g.acc(pr['indices']).reshape(-1).astype(np.int64)
        W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
        pos.append(P); nor.append(N); uv.append(U); jn.append(J); wt.append(W); idx.append(I + base); base += len(P)
    return [np.concatenate(x) for x in (pos, nor, uv, jn, wt, idx)]

def frame_mats(rig, W, Tout):
    """(joints, 3, 4) matrices Tout * jointWorld * inverseBind"""
    S = rig.skin_mats(W)
    return np.einsum('ij,njk->nik', Tout, S)[:, :3, :]

def pack_frames(frames):
    """frames: (F, J, 3, 4) -> RGBA half-float texture rows: width J*3, height F (three texels per joint = the three rows of the matrix)"""
    F, J = frames.shape[:2]
    tex = np.zeros((F, J * 3, 4), np.float32)
    for r in range(3): tex[:, r::3, :] = frames[:, :, r, :]
    return f16(tex), J * 3

def skin_points(P, J, Wt, M):
    """P (N,3) rest positions, M (joints,3,4) -> posed positions"""
    Mv = np.einsum('nk,nkij->nij', Wt, M[J]); return np.einsum('nij,nj->ni', Mv, np.c_[P, np.ones(len(P))])

def simplify(P, N, U, Wt, I, target_tris, err=0.05):
    """meshoptimizer attribute-aware simplification (called through ctypes with explicit types: the wrapper's own call does not convert the float arguments);
    returns (kept vertex ids, new index list into them)"""
    import ctypes as C, meshoptimizer.simplifier as S
    f = S.lib.meshopt_simplifyWithAttributes
    f.restype = C.c_size_t
    f.argtypes = [C.c_void_p, C.c_void_p, C.c_size_t, C.c_void_p, C.c_size_t, C.c_size_t, C.c_void_p, C.c_size_t, C.c_void_p, C.c_size_t, C.c_void_p, C.c_size_t, C.c_float, C.c_uint, C.c_void_p]
    attrs = np.ascontiguousarray(np.c_[N, U, Wt], np.float32); w = np.array([0.5] * 3 + [0.6] * 2 + [0.3] * Wt.shape[1], np.float32)
    I32 = np.ascontiguousarray(I, np.uint32); Pf = np.ascontiguousarray(P, np.float32); out = np.zeros(len(I32), np.uint32)
    n = f(out.ctypes.data, I32.ctypes.data, len(I32), Pf.ctypes.data, len(Pf), 12, attrs.ctypes.data, attrs.shape[1] * 4, w.ctypes.data, len(w), None, int(target_tris * 3), err, 0, None)
    I2 = out[:n].astype(np.int64); keep, inv = np.unique(I2, return_inverse=True)
    print('    simplified', len(I) // 3, '->', n // 3, 'tris')
    return keep, inv

def write_mesh(blob, name, P, N, U, J, Wt, I):
    """P (n,3) f32, N (n,3), U (n,2), J (n,4) joint ids, Wt (n,4) weights, I indices; returns the blob entry"""
    n = len(P); assert n < 65536
    nb = np.zeros((n, 4), np.int8); nb[:, :3] = np.clip(np.round(N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9) * 127), -127, 127)
    wq = np.clip(np.round(Wt / np.maximum(Wt.sum(1, keepdims=True), 1e-9) * 255), 0, 255).astype(np.uint8)
    for i in np.where(wq.sum(1) != 255)[0]: wq[i, wq[i].argmax()] += np.uint8(255 - int(wq[i].sum())) if wq[i].sum() <= 255 else 0
    e = {'verts': n, 'tris': len(I) // 3}
    e['pos'] = blob.add(name + '.pos', P.astype(np.float32)); e['nor'] = blob.add(name + '.nor', nb)
    e['uv'] = blob.add(name + '.uv', U.astype(np.float32)); e['joint'] = blob.add(name + '.joint', J.astype(np.uint8))
    e['weight'] = blob.add(name + '.weight', wq); e['index'] = blob.add(name + '.index', I.astype(np.uint16))
    return e

def sample_clip(rig, clip, n, Tout, extra=None):
    """n evenly spaced frames over one loop of a source clip (the last key is the first: a loop), as (n, J, 3, 4)"""
    ch = rig.anims[clip]; T = max(c[0].max() for c in ch.values()); t0 = min(c[0].min() for c in ch.values())
    return np.stack([frame_mats(rig, rig.pose(clip, t0 + i * (T - t0) / n), Tout) for i in range(n)]), T - t0

# ------------------------------------------------------------------ the dog
def build_dog(blob, meta):
    g = GLB(os.path.join(SRC, 'pitbull.glb')); rig = Rig(g)
    keep = [i for i in range(len(g.j['meshes'])) if i not in DOG_DROP]
    P, N, U, J, Wt, I = read_pieces(g, rig, keep)
    # joint ids are positions in the skin's joint list: the same order the frames use
    # output space: scale to DOG_LEN metres, face -z, centre the body on the origin, feet on y = 0
    W0 = rig.pose('Armature.008|IDdle', 0.0); M0 = rig.skin_mats(W0); P0 = skin_points(P, J, Wt, M0[:, :3, :])
    lo, hi = P0.min(0), P0.max(0); s = DOG_LEN / (hi[2] - lo[2]); zc = (lo[2] + hi[2]) / 2
    Tout = np.diag([-s, s, -s, 1.0]); Tout[2, 3] = s * zc; Tout[1, 3] = -s * lo[1] * 0   # feet are at y = 0 in the source already
    print('dog: source extent', (hi - lo).round(3), 'scale', round(s, 4), '-> body', ((hi - lo) * s).round(3), 'm')
    import gait
    names = [rig.nodes[j]['name'] for j in rig.joints]
    tr = gait.Trot(rig, 'Armature.008|Walkl', names, s, None)
    # the ground: where the planted toe sits in the standing pose
    y0 = min(rig.pose('Armature.008|IDdle', 0.0)[tr.toe[k]][1, 3] for k in gait.LEGS)
    clips = {}; frames = []; start = 0
    for key, src, n in [('idle', 'IDdle', 40), ('sniff', 'Eat', 36)]:
        fr, dur = sample_clip(rig, 'Armature.008|' + src, n, Tout)
        clips[key] = {'start': start, 'n': n, 'dur': float(dur)}; frames.append(fr); start += n
    # the two gaits: a trot (diagonal legs together) from the Walkl clip, strides 1.6x and 3x the source's, front and back balanced so no foot skates
    for key, Ab, n in [('walk', 1.5, 36), ('run', 2.3, 36)]:
        Af = tr.balance(Ab); sp = tr.stance_speeds(Ab, Af); v = float(np.mean(list(sp.values())))
        ny = []; fr = []
        for i in range(n):
            W = tr.pose(i * tr.T / n, Ab, Af); ny.append(y0 - min(W[tr.toe[k]][1, 3] for k in gait.LEGS))   # lift or lower the body so the lowest foot is on the ground
        ny = np.array(ny); k3 = np.ones(3) / 3; ny = np.convolve(np.r_[ny[-1:], ny, ny[:1]], k3, 'valid')
        for i in range(n):
            T2 = Tout.copy(); T2[1, 3] += s * ny[i]
            fr.append(frame_mats(rig, tr.pose(i * tr.T / n, Ab, Af), T2))
        clips[key] = {'start': start, 'n': n, 'dur': float(tr.T), 'speed': v}; frames.append(np.stack(fr)); start += n
        print('  gait', key, 'back amp', Ab, 'front amp', round(Af, 2), 'stance speeds m/s', {k: round(x, 2) for k, x in sp.items()}, 'stride', round(v * tr.T, 2), 'm/cycle, body dy range', round(float(ny.min() * s), 3), round(float(ny.max() * s), 3))
    F = np.concatenate(frames)
    tex, tw = pack_frames(F); bt = blob.add('dog.bones', tex.view(np.uint16))
    nm = {'near': write_mesh(blob, 'dog.near', P, N, U, J, Wt, I)}
    meta['dog'] = {'mesh': nm, 'frames': {'count': int(F.shape[0]), 'width': tw, 'data': bt}, 'clips': clips, 'joints': int(F.shape[1]), 'length': DOG_LEN, 'scale': float(s)}
    albedo = Image.open(io.BytesIO(g.image(0)[0])); normal = Image.open(io.BytesIO(g.image(1)[0]))
    # the coat shader (animals.js FRAG_COAT): typical fur lightness (linear), the chroma below which a texel is fur, the lightness above which it is a white marking
    a = (np.asarray(albedo.convert('RGB').resize((512, 512)), np.float32) / 255.0); lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722]); chroma = lin.max(2) - lin.min(2)
    furpx = (chroma < 0.03) & (lum < 0.12); meta['dog']['fur'] = [round(float(np.median(lum[furpx])), 4), 0.03, 0.2]
    print('  fur lightness', meta['dog']['fur'], 'fur texels', round(float(furpx.mean()), 2), 'chroma p50/p90', np.percentile(chroma, [50, 90]).round(3))
    meta['dog']['textures'] = {'albedo': 'dog.webp', 'normal': 'dog_n.webp'}
    print('  dog.webp', webp(albedo, os.path.join(OUT, 'dog.webp'), 82, 2048), 'B   dog_n.webp', webp(normal, os.path.join(OUT, 'dog_n.webp'), 90, 1024), 'B')
    return F, P, J, Wt, rig

def main(only=None):
    blob = Blob(); meta = {'version': 1}
    dog = build_dog(blob, meta)
    if '--pigeon' in sys.argv or only == 'pigeon':
        import build_pigeon; build_pigeon.build(blob, meta, sys.modules[__name__])
    open(os.path.join(OUT, 'animals.bin'), 'wb').write(blob.b)
    json.dump(meta, open(os.path.join(OUT, 'animals.json'), 'w'), separators=(',', ':'))
    print('animals.bin', len(blob.b), 'B')
    return dog

if __name__ == '__main__': main()
