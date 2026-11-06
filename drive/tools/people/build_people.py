#!/usr/bin/env python3
"""Option B pedestrians: MakeHuman (CC0) bodies, decimated, with a walk cycle baked into vertex-animation textures.

  python3 -I drive/tools/people/fetch_shoes.py --out <shoe dir>            (the three CC0 shoes, about 1 MB, see shoes.py)
  python3 -I drive/tools/people/build_people.py --mh <makehuman checkout>/makehuman/data --shoes <shoe dir> --out public/drive/people-real

Inputs (all CC0 1.0, https://github.com/makehumancommunity/makehuman, see public/drive/people-real/CREDITS.txt):
  3dobjs/base.obj                 the base mesh (group "body": 13378 quads, 13380 vertices; the other groups are fitting helpers and are not used)
  rigs/default.mhskel             joint definitions (a joint is the centroid of a vertex list)
  rigs/default_weights.mhw        skin weights for the 163-bone default rig
  targets/macrodetails/*.target   gender / ethnicity / age / muscle / weight shapes (vertex deltas)
plus the shoes (CC0 MakeHuman clothes; fit and skinned in shoes.py): a sneaker, a lace-up dress shoe and an ankle boot.
Needs numpy, scipy and bpy (Blender as a module: only for its Decimate modifier).

What it does
  1. blends body shapes (female, male; average, slim, heavy, old) from the macro targets, as MakeHuman does;
  2. decimates the average body once (Blender's collapse decimation, symmetric) to a near mesh (~2.6k triangles) and a far mesh (~650), so all
     the shapes share one topology; each decimated vertex takes its shape deltas and skin weights from its nearest source vertices;
  3. folds the 163-bone rig into 19 bones (pelvis, spine, chest, neck, head, clavicles, arms, legs, feet) and poses it with linear blend skinning:
     a standing pose (arms down, legs together, feet flat), 12 walk frames, a phone-in-hand pose and a hands-up pose;
  4. adds the parts a person may or may not wear (hair in several styles, cap, backpack, hood, skirt), fitted to each body's head and torso, and the three
     shoes (fitted to each body's feet, skinned to the same bones; the body's own feet under them are dropped);
  5. writes people2.json (what is where) and people2.bin: indices and per-vertex fields per level of detail, positions as float16 and normals
     as 8 bit per frame per variant (the "vertex animation texture" the vertex shader fetches from).
The walk is the same gait as people-a.js (hip, knee, ankle, arm swing, elbow, shoulder counter-rotation, head nod, lowest foot on the ground).
"""
import argparse, json, math, re, struct, sys
import numpy as np
from scipy.spatial import cKDTree

ap = argparse.ArgumentParser()
ap.add_argument('--mh', required=True, help='makehuman/data directory of a checkout')
ap.add_argument('--shoes', required=True, help='directory fetch_shoes.py wrote (shoes01, shoes02, toigo_ankle_boots_male)')
ap.add_argument('--out', required=True)
ap.add_argument('--near', type=int, default=2600, help='triangles of the near body (before the hair etc.)')
ap.add_argument('--far', type=int, default=640)
ap.add_argument('--frames', type=int, default=12)
ap.add_argument('--preview', default='', help='write a .npz of the final frames here (for the preview script)')
args = ap.parse_args()
D = args.mh.rstrip('/') + '/'
TAU = 2 * math.pi

# ---------------------------------------------------------------------------------------------- the base mesh
V = []
body_faces = []
cur = None
for line in open(D + '3dobjs/base.obj'):
    if line.startswith('v '):
        V.append([float(x) for x in line.split()[1:4]])
    elif line.startswith('g '):
        cur = line.split()[1]
    elif line.startswith('f ') and cur == 'body':
        body_faces.append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])
V = np.array(V) * 0.1            # decimetres -> metres
NB = 13380                       # the body group uses vertices 0..13379
body_faces = np.array(body_faces)
assert body_faces.max() == NB - 1
skel = json.load(open(D + 'rigs/default.mhskel'))
JOINTS = skel['joints']
W_RAW = json.load(open(D + 'rigs/default_weights.mhw'))['weights']


def target(name):
    d = np.zeros_like(V)
    for l in open(D + 'targets/macrodetails/' + name + '.target'):
        if l[0] in '#\n ':
            continue
        p = l.split()
        d[int(p[0])] = [float(x) * 0.1 for x in p[1:4]]
    return d


def tri(x):   # slider 0..1 -> (min, average, max) weights, as MakeHuman's macro modifiers do
    return {'min': max(0, 1 - 2 * x), 'average': 1 - abs(2 * x - 1), 'max': max(0, 2 * x - 1)}


_cache = {}
def tg(name):
    if name not in _cache:
        _cache[name] = target(name)
    return _cache[name]


def shape(g, eth, age, mu, wt):
    """macro shape deltas: gender 0 female .. 1 male, ethnicity (african, asian, caucasian), age 0 young .. 1 old, muscle, weight"""
    d = np.zeros_like(V)
    for gn, gv in (('female', 1 - g), ('male', g)):
        for an, av in (('young', 1 - age), ('old', age)):
            if gv * av <= 0:
                continue
            for e, ev in zip(('african', 'asian', 'caucasian'), eth):
                if ev > 0:
                    d += gv * av * ev * tg(f'{e}-{gn}-{an}')
            for mn, mv in tri(mu).items():
                for wn, wv in tri(wt).items():
                    w = gv * av * mv * wv
                    if w > 0:
                        d += w * tg(f'universal-{gn}-{an}-{mn}muscle-{wn}weight')
    return d


EVEN = (1 / 3, 1 / 3, 1 / 3)
# body variants. people-alt.js picks (female, male) x 3 body types: index = (male ? 1 : 0) + 2 * bodyType
VARIANTS = [
    ('female-average', shape(0, EVEN, 0, 0.5, 0.5)),
    ('male-average', shape(1, EVEN, 0, 0.5, 0.5)),
    ('female-slim', shape(0, (0.2, 0.6, 0.2), 0, 0.5, 0.12)),
    ('male-heavy', shape(1, (0.3, 0.1, 0.6), 0, 0.5, 0.9)),
    ('female-older', shape(0, (0.3, 0.2, 0.5), 0.8, 0.4, 0.65)),
    ('male-older', shape(1, (0.3, 0.2, 0.5), 0.8, 0.4, 0.6)),
]
NEUTRAL = shape(0.5, EVEN, 0, 0.5, 0.5)
NV = len(VARIANTS)
print('variants', [n for n, _ in VARIANTS])

# ---------------------------------------------------------------------------------------------- bones (19) and the skin weights folded into them
BONES = ['pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'clavR', 'upL', 'upR', 'foreL', 'foreR', 'handL', 'handR', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR']
BI = {n: i for i, n in enumerate(BONES)}
PARENT = {'pelvis': None, 'spine': 'pelvis', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'clavL': 'chest', 'clavR': 'chest', 'upL': 'clavL', 'upR': 'clavR', 'foreL': 'upL', 'foreR': 'upR', 'handL': 'foreL', 'handR': 'foreR',
          'thighL': 'pelvis', 'thighR': 'pelvis', 'shinL': 'thighL', 'shinR': 'thighR', 'footL': 'shinL', 'footR': 'shinR'}
PIVOT_JOINT = {'pelvis': None, 'spine': 'spine03____head', 'chest': 'spine02____head', 'neck': 'neck01____head', 'head': 'head____head',
               'clavL': 'clavicle.L____head', 'clavR': 'clavicle.R____head', 'upL': 'upperarm01.L____head', 'upR': 'upperarm01.R____head', 'foreL': 'lowerarm01.L____head', 'foreR': 'lowerarm01.R____head',
               'handL': 'wrist.L____head', 'handR': 'wrist.R____head', 'thighL': 'upperleg01.L____head', 'thighR': 'upperleg01.R____head', 'shinL': 'lowerleg01.L____head', 'shinR': 'lowerleg01.R____head',
               'footL': 'foot.L____head', 'footR': 'foot.R____head'}


def fold(name):
    """which of my 19 bones a MakeHuman bone belongs to (None: decide by where it is)"""
    side = 'L' if name.endswith('.L') else 'R' if name.endswith('.R') else ''
    b = re.sub(r'\.[LR]$', '', name)
    if b in ('root',) or b.startswith('pelvis') or b == 'spine05':
        return 'pelvis'
    if b in ('spine04', 'spine03'):
        return 'spine'
    if b in ('spine02', 'spine01') or b.startswith('breast'):
        return 'chest'
    if b.startswith('neck'):
        return 'neck'
    if b in ('head', 'jaw') or re.match(r'(eye|tongue|oculi|orbicularis|oris|risorius|temporalis|levator|special)', b):
        return 'head'
    if b.startswith('clavicle') or b.startswith('shoulder'):
        return 'clav' + side
    if b.startswith('upperarm'):
        return 'up' + side
    if b.startswith('lowerarm'):
        return 'fore' + side
    if b == 'wrist' or b.startswith('finger') or b.startswith('metacarpal'):
        return 'hand' + side
    if b.startswith('upperleg'):
        return 'thigh' + side
    if b.startswith('lowerleg'):
        return 'shin' + side
    if b == 'foot' or b.startswith('toe'):
        return 'foot' + side
    return None


SW = np.zeros((NB, len(BONES)))
unknown = []
for name, lst in W_RAW.items():
    f = fold(name)
    if f is None:
        unknown.append(name)
        continue
    for vi, w in lst:
        if vi < NB:
            SW[vi, BI[f]] += w
print('unmapped bones:', unknown)
tot = SW.sum(1, keepdims=True)
print('vertices without weights:', int((tot[:, 0] < 1e-6).sum()))
SW = SW / np.maximum(tot, 1e-9)


def joint(P, name):
    return P[JOINTS[name]].mean(0)


# ---------------------------------------------------------------------------------------------- decimate the neutral body once (Blender's Decimate modifier)
def decimate(tris_target):
    import bpy
    P = (V + NEUTRAL)[:NB]
    me = bpy.data.meshes.new('b')
    me.from_pydata(P.tolist(), [], body_faces.tolist())
    me.update()
    ob = bpy.data.objects.new('b', me)
    bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new('d', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = tris_target / (len(body_faces) * 2)
    m.use_symmetry = True
    m.symmetry_axis = 'X'
    m.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    mesh = ev.to_mesh()
    verts = np.array([v.co[:] for v in mesh.vertices])
    faces = np.array([p.vertices[:] for p in mesh.polygons])
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    assert faces.shape[1] == 3
    # drop vertices that no face uses
    used = np.unique(faces)
    remap = -np.ones(len(verts), int)
    remap[used] = np.arange(len(used))
    return verts[used], remap[faces]


def orient(verts, faces):
    """make the triangle winding point outwards (signed volume > 0)"""
    a, b, c = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    vol = np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6
    return faces if vol > 0 else faces[:, ::-1].copy()


import os as _os
sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))   # (python3 -I does not put the script's folder on the path)
import shoes as shoe_lib
SHOES, SHOE_GROUND, SHOE_HIDDEN = shoe_lib.build(args.shoes, [(V + d) * 10 for _, d in VARIANTS], (V + NEUTRAL) * 10, (V + NEUTRAL)[:NB], SW)
HIDDEN = np.zeros(len(V) + 1, bool)
HIDDEN[sorted(h for h in SHOE_HIDDEN if h < len(V))] = True
HIDE_BELOW = 0.10   # m above the soles: the body's own feet and ankles below this are inside the shoes


def drop_under_shoes(verts, faces, nb, wts):
    """remove the body vertices that every shoe hides (their nearest source vertices are in the shoes' delete lists) and are low enough to be inside a shoe"""
    gone = (HIDDEN[nb].sum(1) >= 3) & (verts[:, 1] - SHOE_GROUND < HIDE_BELOW)
    faces = faces[~gone[faces].any(1)]
    used = np.unique(faces)
    remap = -np.ones(len(verts), int)
    remap[used] = np.arange(len(used))
    print('  dropped', int(len(verts) - len(used)), 'body vertices under the shoes')
    return verts[used], remap[faces], nb[used], wts[used]


LODS = {}
for lod, ntri in (('near', args.near), ('far', args.far)):
    verts, faces = decimate(ntri)
    faces = orient(verts, faces)
    tree = cKDTree((V + NEUTRAL)[:NB])
    dist, nb = tree.query(verts, k=4)
    wts = 1 / (dist + 1e-4)
    wts /= wts.sum(1, keepdims=True)
    verts, faces, nb, wts = drop_under_shoes(verts, faces, nb, wts)
    LODS[lod] = dict(verts=verts, faces=faces, nb=nb, wts=wts)
    print(lod, 'body: ', len(verts), 'verts', len(faces), 'tris')


# ---------------------------------------------------------------------------------------------- the gait (the same as people-a.js)
def leg_angles(ph, amp):
    hip = 0.40 * amp * math.sin(ph)
    swing = max(0.0, -math.cos(ph - 0.45))
    knee = amp * (0.07 + 0.88 * swing ** 1.5)
    pitch = 0.65 * hip + 0.05 * amp
    return hip, knee, pitch - hip - knee


def Rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def Ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def Rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def minrot(u, v):
    """the smallest rotation taking direction u to direction v"""
    u = u / np.linalg.norm(u)
    v = v / np.linalg.norm(v)
    c = float(u @ v)
    if c > 1 - 1e-9:
        return np.eye(3)
    ax = np.cross(u, v)
    s = np.linalg.norm(ax)
    ax /= s
    K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
    return np.eye(3) + s * K + (1 - c) * (K @ K)


# the stand pose and the rig ------------------------------------------------------------------------------------------------------------
class Rig:
    """The 19-bone skeleton of one body (pivots at rest) and linear blend skinning with GLOBAL bone rotations: a bone's rotation is the stand
    pose's rotation, with a swing (a rotation about world axes) applied on top; a bone's pivot is carried by its parent."""
    def __init__(self, P):   # P: this body's source vertices at rest (MakeHuman's A pose)
        self.piv = {b: joint(P, PIVOT_JOINT[b]) if PIVOT_JOINT[b] else (joint(P, PIVOT_JOINT['thighL']) + joint(P, PIVOT_JOINT['thighR'])) / 2 for b in BONES}
        p = self.piv
        self.stand = {b: np.eye(3) for b in BONES}
        for side, sx in (('L', 1), ('R', -1)):
            # shoulders drop a little; the arms hang by the sides, slightly out, the hands a touch forward; the legs come together, the feet stay flat
            self.stand['clav' + side] = Rz(-sx * 0.10)
            self.stand['up' + side] = minrot(p['fore' + side] - p['up' + side], np.array([sx * 0.13, -1.0, -0.02]))
            self.stand['fore' + side] = minrot(p['hand' + side] - p['fore' + side], np.array([sx * 0.07, -1.0, 0.20]))
            self.stand['hand' + side] = self.stand['fore' + side]
            self.stand['thigh' + side] = minrot(p['shin' + side] - p['thigh' + side], np.array([-sx * 0.015, -1.0, 0.01]))
            self.stand['shin' + side] = minrot(p['foot' + side] - p['shin' + side], np.array([-sx * 0.010, -1.0, -0.03]))
            # (the foot keeps its rest orientation: flat on the ground)

    def posed(self, extra, shift):
        p, Rt, Pos = self.piv, {}, {}
        for b in BONES:   # parents come first
            Rt[b] = extra.get(b, np.eye(3)) @ self.stand[b]
            par = PARENT[b]
            Pos[b] = p[b] + shift if par is None else Pos[par] + Rt[par] @ (p[b] - p[par])
        return Rt, Pos

    def skin(self, X, W, extra, shift=np.zeros(3)):
        Rt, Pos = self.posed(extra, shift)
        out = np.zeros_like(X)
        for b in BONES:
            wb = W[:, BI[b]]
            m = wb > 1e-5
            if m.any():
                out[m] += wb[m, None] * (Pos[b] + (X[m] - self.piv[b]) @ Rt[b].T)
        return out


def gait_extra(ph, amp, pose=None):
    """the swing rotations of every bone for one gait phase (pose: 'phone' / 'startle' instead of the walk)"""
    psi = 0.10 * amp * math.sin(ph)
    hL, kL, aL = leg_angles(ph + math.pi, amp)    # +x leg (people-a.js: the leg at x < 0 has phase ph)
    hR, kR, aR = leg_angles(ph, amp)
    E = {'pelvis': Ry(-0.5 * psi), 'spine': Ry(0.25 * psi), 'chest': Ry(psi), 'neck': Ry(psi), 'head': Ry(0.15 * psi) @ Rx(0.03 * amp * math.sin(2 * ph)),
         'clavL': Ry(psi), 'clavR': Ry(psi)}
    for side, h, k, a in (('L', hL, kL, aL), ('R', hR, kR, aR)):
        E['thigh' + side] = Ry(-0.5 * psi) @ Rx(h)
        E['shin' + side] = Ry(-0.5 * psi) @ Rx(h + k)
        E['foot' + side] = Ry(-0.5 * psi) @ Rx(h + k + a)
    for side, sph in (('L', ph), ('R', ph + math.pi)):   # arms swing opposite the leg on their side
        s = math.sin(sph)
        sw, el = 0.30 * amp * s, -(0.12 + 0.30 * amp * (0.5 - 0.5 * s))
        if pose == 'startle':
            sw, el = -2.5, -0.35
        elif pose == 'phone' and side == 'R':
            sw, el = -0.55, -1.9
        E['up' + side] = Ry(psi) @ Rx(sw)
        E['fore' + side] = Ry(psi) @ Rx(sw + el)
        E['hand' + side] = E['fore' + side]
    return E


# ---------------------------------------------------------------------------------------------------------------------------------------
# the parts a person may or may not wear: people-a.js's own geometry (one source of truth), mapped onto each body's head and torso
import subprocess, os, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
SHELL = {}
for lod in (0, 1):
    out = subprocess.run(['node', os.path.join(HERE, 'export_shells.mjs'), str(lod)], capture_output=True, text=True, check=True).stdout
    SHELL[lod] = json.loads(out)
    print('shells lod', lod, ':', len(SHELL[lod]['pos']) // 3, 'verts', len(SHELL[lod]['idx']) // 3, 'tris')


def head_fit(Psrc, sw):
    """the body's head: its chin, top, half width, half depth, centre z (from the vertices the head bone owns)"""
    hv = Psrc[:NB][sw[:, BI['head']] > 0.5]
    top = hv[:, 1].max()
    front = hv[hv[:, 2] > hv[:, 2].mean()]
    chin = front[:, 1].min()
    mid = hv[(hv[:, 1] > chin + 0.06) & (hv[:, 1] < top - 0.03)]
    return dict(top=top, chin=chin, hx=(mid[:, 0].max() - mid[:, 0].min()) / 2, hz=(mid[:, 2].max() - mid[:, 2].min()) / 2, cz=(mid[:, 2].max() + mid[:, 2].min()) / 2, verts=hv)


def map_shell(sh, Psrc, sw, rig):
    """shell vertices (people-a.js model space) -> this body's rest space; plus each vertex's bone weights"""
    pos = np.array(sh['pos']).reshape(-1, 3)
    info = np.array(sh['info']).reshape(-1, 4)
    hd = head_fit(Psrc, sw)
    soles = Psrc[:NB, 1].min()
    H = Psrc[:NB, 1].max() - soles
    s = H / 1.74
    hh = hd['top'] - hd['chin']
    out = np.zeros_like(pos)
    wb = np.zeros((len(pos), len(BONES)))
    pel = rig.piv['pelvis']
    # torso widths for the skirt / pack / hood
    tv = Psrc[:NB][(sw[:, BI['pelvis']] + sw[:, BI['spine']] > 0.5)]
    hipw = np.abs(tv[np.abs(tv[:, 1] - pel[1]) < 0.04][:, 0]).max()
    cv = Psrc[:NB][sw[:, BI['chest']] > 0.5]
    shw = np.abs(cv[np.abs(cv[:, 1] - rig.piv['clavL'][1]) < 0.05][:, 0]).max()
    zc = pel[2]
    for i, (p, inf) in enumerate(zip(pos, info)):
        part = int(inf[1])
        if part == 6:   # the head: the model's head box -> this head
            out[i] = [p[0] * hd['hx'] / 0.082, hd['chin'] + (p[1] - 1.495) * hh / 0.25, hd['cz'] + (p[2] - 0.015) * hd['hz'] / 0.100]
            wb[i, BI['head']] = 1
        elif part == 5:   # skirt: hips
            out[i] = [p[0] * hipw / 0.178 * 1.05, soles + p[1] * s, zc + p[2] * s]
            seg = inf[2]
            side = 'thighL' if p[0] > 0 else 'thighR'
            wb[i, BI['pelvis']] = 1 - 0.5 * seg
            wb[i, BI[side]] = 0.5 * seg
        else:             # hood, backpack: the chest
            out[i] = [p[0] * shw / 0.20, soles + p[1] * s, zc + p[2] * s]
            wb[i, BI['chest']] = 1
    # a hair or cap vertex must not end up inside the skull: push it out to the head's own surface + a clearance
    hv = hd['verts']
    cz = hd['cz']
    ang = np.arctan2(hv[:, 0], hv[:, 2] - cz)
    rad = np.hypot(hv[:, 0], hv[:, 2] - cz)
    for i in range(len(out)):
        if int(info[i][0]) not in (1, 2) or int(info[i][1]) != 6:
            continue
        x, y, z = out[i]
        if y < hd['chin'] + 0.2 * hh or y > hd['top'] + 0.02:
            continue
        a, r = math.atan2(x, z - cz), math.hypot(x, z - cz)
        m = (np.abs(hv[:, 1] - y) < 0.008) & (np.abs(np.arctan2(np.sin(ang - a), np.cos(ang - a))) < 0.22)
        if m.any():
            rs = rad[m].max() + 0.004
            if r < rs and r > 1e-6:
                out[i, 0] = r and x * rs / r
                out[i, 2] = cz + (z - cz) * rs / r
    return out, info, wb


# ---------------------------------------------------------------------------------------------------------------------------------------
# build everything: per level of detail, per body: the stand pose, the walk frames, the phone and the hands-up pose
N = args.frames
FR = N + 3   # frames per body: 0 stand, 1..N walk, N+1 phone, N+2 startle
SRC = [V + d for _, d in VARIANTS]
NEUT_SRC = V + NEUTRAL


_ADJ = {}


def flatten_chest(Pb, F, SWd):
    """MakeHuman's body has nipples; under a painted-on shirt they show as bumps. Smooth the front of the chest (umbrella Laplacian on those vertices only)."""
    key = id(F)
    if key not in _ADJ:
        nb = [set() for _ in range(len(Pb))]
        for a, b, c in F:
            nb[a].update((b, c)); nb[b].update((a, c)); nb[c].update((a, b))
        _ADJ[key] = [np.array(sorted(x)) for x in nb]
    adj = _ADJ[key]
    y0, y1 = Pb[:, 1].min(), Pb[:, 1].max()
    fy = (Pb[:, 1] - y0) / (y1 - y0)
    torso = (SWd[:, [BI[b] for b in ('clavL', 'clavR', 'upL', 'upR', 'foreL', 'foreR', 'handL', 'handR')]].sum(1) < 0.15) & (Pb[:, 2] > 0.0)
    sel = np.where(torso & (fy > 0.66) & (fy < 0.80))[0]
    X = Pb.copy()
    for _ in range(5):
        Y = X.copy()
        for i in sel:
            Y[i] = X[i] * 0.4 + X[adj[i]].mean(0) * 0.6
        X = Y
    return X


def normals(X, F):
    n = np.zeros_like(X)
    a, b, c = X[F[:, 0]], X[F[:, 1]], X[F[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(n, F[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


rigs = [Rig(P) for P in SRC]
meta_variants = []
lod_out = []
for li, lod in enumerate(('near', 'far')):
    L = LODS[lod]
    nbody = len(L['verts'])
    SWd = (SW[L['nb']] * L['wts'][:, :, None]).sum(1)
    SWd /= np.maximum(SWd.sum(1, keepdims=True), 1e-9)
    frames_pos, frames_nor = [], []
    shell_faces = None
    SH = [(e, e[lod]) for e in SHOES if lod in e]   # the shoes drawn at this level of detail
    for vi, (vname, delta) in enumerate(VARIANTS):
        rig = rigs[vi]
        Pb = L['verts'] + ((delta - NEUTRAL)[L['nb']] * L['wts'][:, :, None]).sum(1)     # the decimated body, this shape
        Pb = flatten_chest(Pb, L['faces'], SWd)
        sp, sinfo, swb = map_shell(SHELL[li], SRC[vi], SW, rig)
        shoe_pos = np.vstack([d['pos'][vi] for _, d in SH])
        shoe_W = np.vstack([d['W'] for _, d in SH])
        X = np.vstack([Pb, sp, shoe_pos])
        W = np.vstack([SWd, swb, shoe_W])
        F = np.vstack([L['faces'], np.array(SHELL[li]['idx']).reshape(-1, 3) + nbody])
        nshell = len(sp)
        sf, off_v = [], nbody + nshell
        for _, d in SH:
            sf.append(d['faces'] + off_v)
            off_v += d['verts']
        F = np.vstack([F] + sf)
        gi = np.r_[0:nbody, nbody + nshell:len(X)]   # what stands on the ground: the body and the shoes
        shell_faces = F
        poses = [gait_extra(0, 0.0)] + [gait_extra(TAU * k / N, 1.0) for k in range(N)] + [gait_extra(0, 0.0, 'phone'), gait_extra(0, 0.0, 'startle')]
        # stand first: it defines the ground and the origin
        stand = rig.skin(X, W, poses[0])
        soles = stand[gi, 1].min()
        z0 = rig.posed(poses[0], 0)[1]['pelvis'][2]
        off = np.array([0.0, -soles, -z0])
        pos_f, nor_f = [], []
        for fi, ex in enumerate(poses):
            Pf = rig.skin(X, W, ex)
            if 1 <= fi <= N:   # the lowest part of the body is on the ground
                Pf = Pf + np.array([0.0, -Pf[gi, 1].min(), -z0])
            else:
                Pf = Pf + off
            pos_f.append(Pf)
            nor_f.append(normals(Pf, F))
        frames_pos.append(np.stack(pos_f))
        frames_nor.append(np.stack(nor_f))
        if li == 0:
            H = stand[:nbody, 1].max() - soles
            Rt, Pp = rig.posed(poses[0], 0)
            eyeL, eyeR = joint(SRC[vi], 'eye.L____head'), joint(SRC[vi], 'eye.R____head')
            mouth = (joint(SRC[vi], 'oris01____head') + joint(SRC[vi], 'oris02____head')) / 2
            hv = SRC[vi][:NB][SW[:, BI['head']] > 0.5]
            fz = hv[np.abs(hv[:, 1] - eyeL[1]) < 0.012][:, 2].max() - z0
            meta_variants.append(dict(name=vname, H=float(H), face=[float((eyeL[1] + off[1]) / H), float(abs(eyeL[0]) / H), float((mouth[1] + off[1]) / H), float(fz / H)],
                                      shoulderY=float(Pp['upL'][1] + off[1]), wristY=float(Pp['handL'][1] + off[1])))
    P = np.stack(frames_pos)    # [NV, FR, verts, 3]
    Nn = np.stack(frames_nor)
    # per-vertex fields (people-alt.js paint): arm / leg / hand / foot memberships, the position along the arm, and the accessory slot and bit
    nv = P.shape[2]
    reg = np.zeros((nv, 4))
    reg[:nbody, 0] = SWd[:, [BI[b] for b in ('clavL', 'clavR', 'upL', 'upR', 'foreL', 'foreR', 'handL', 'handR')]].sum(1)
    reg[:nbody, 1] = SWd[:, [BI[b] for b in ('thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR')]].sum(1)
    reg[:nbody, 2] = SWd[:, [BI['handL'], BI['handR']]].sum(1)
    reg[:nbody, 3] = SWd[:, [BI['footL'], BI['footR']]].sum(1)
    reg2 = np.zeros((nv, 4))
    mv = meta_variants[0]
    reg2[:nbody, 0] = np.clip((mv['shoulderY'] - P[0, 0, :nbody, 1]) / (mv['shoulderY'] - mv['wristY']), 0, 1)
    info = np.zeros((nv, 4))
    info[nbody:nbody + nshell] = sinfo * np.array([1, 0, 0, 1])   # slot and bit only
    # shoes: slot 6, the accessory bit of the shoe (people-alt.js BIT; the far level of detail has one shoe shape that everyone wears, bit 0), and for the paint
    # the height above the sole and the distance forward of the heel (metres) in reg2 y / z
    o = nbody + nshell
    for e, d in SH:
        info[o:o + d['verts']] = [6, 0, 0, e['bit'] if lod == 'near' else 0]
        reg2[o:o + d['verts'], 1] = d['h']
        reg2[o:o + d['verts'], 2] = d['f']
        o += d['verts']
    lod_out.append(dict(name=lod, nbody=nbody, nshell=nshell, nshoe=sum(d['tris'] for _, d in SH), verts=nv, faces=shell_faces, info=info, reg=reg, reg2=reg2, pos=P, nor=Nn))
    print(lod, 'total', nv, 'verts', len(shell_faces), 'tris (', nbody, 'body verts )')

# ---------------------------------------------------------------------------------------------------------------------------------------
# write
os.makedirs(args.out, exist_ok=True)
blob = bytearray()
def put(arr, dtype):
    global blob
    a = np.ascontiguousarray(arr.astype(dtype))
    while len(blob) % 4:
        blob += b'\0'
    off = len(blob)
    blob += a.tobytes()
    return dict(offset=off, length=a.nbytes, count=int(a.size))

TEX_W = 2048   # texels per texture row (WebGL2 guarantees at least 2048)
lods_meta = []
for L in lod_out:
    nv, nvar = L['verts'], NV
    t = 2 * nv                                  # one texel for a vertex's position, one for its normal
    rpf = -(-t // TEX_W)                        # texture rows per frame
    P, Nn = L['pos'], L['nor']                  # [variant, frame, vertex, 3]
    # the stand frame, absolute: float16 (position, normal) per vertex; every other frame as an 8-bit delta from it
    stand = np.zeros((nvar, rpf * TEX_W, 4), np.float16)
    stand[:, 0:t:2, :3] = P[:, 0]
    stand[:, 1:t:2, :3] = Nn[:, 0]
    stand[:, :, 3] = 1
    dP = P[:, 1:] - P[:, :1]
    dN = Nn[:, 1:] - Nn[:, :1]
    # two scales per body: the walk (a few tens of cm) and the two arm poses (up to a metre), so the walk keeps its resolution
    dmax = np.stack([np.abs(dP[:, :N]).reshape(nvar, -1).max(1), np.abs(dP[:, N:]).reshape(nvar, -1).max(1)], 1)   # [variant, (walk, pose)]
    sc = np.concatenate([np.repeat(dmax[:, :1], N, 1), np.repeat(dmax[:, 1:], 2, 1)], 1)                           # [variant, frame]
    anim = np.full((nvar, FR - 1, rpf * TEX_W, 4), 255, np.uint8)
    anim[:, :, 0:t:2, :3] = (np.round(dP / sc[:, :, None, None] * 127) + 128).clip(1, 255).astype(np.uint8)
    anim[:, :, 1:t:2, :3] = (np.round(dN / 2.0 * 127) + 128).clip(1, 255).astype(np.uint8)
    anim[:, :, t:, :3] = 128
    m = dict(name=L['name'], verts=nv, tris=len(L['faces']), nbody=L['nbody'], rowsPerFrame=rpf, texWidth=TEX_W, dmax=[[float(a), float(b)] for a, b in dmax])
    m['index'] = put(L['faces'].reshape(-1), np.uint16)
    m['info'] = put(L['info'], np.float32)
    m['reg'] = put(L['reg'], np.float32)
    m['reg2'] = put(L['reg2'][:, :3], np.float32)   # x: along the arm; y, z: shoes (height above the sole, distance forward of the heel)
    m['stand'] = put(stand.view(np.uint16), np.uint16)
    m['anim'] = put(anim, np.uint8)
    lods_meta.append(m)
meta = dict(version=2, source='MakeHuman base mesh, rig and macro targets (CC0 1.0), https://github.com/makehumancommunity/makehuman', frames=dict(walk=N, perVariant=FR, stand=0, phone=N + 1, startle=N + 2),
            variants=meta_variants, lods=lods_meta)
open(args.out.rstrip('/') + '/people2.json', 'w').write(json.dumps(meta, separators=(',', ':')))
open(args.out.rstrip('/') + '/people2.bin', 'wb').write(blob)
print('wrote', len(blob), 'bytes of people2.bin')
if args.preview:
    np.savez(args.preview, **{f'{L["name"]}_{k}': L[k] for L in lod_out for k in ('pos', 'nor', 'faces', 'info', 'reg')})
