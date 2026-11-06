"""Shoes for the Option B pedestrians (imported by build_people.py).

Three CC0 MakeHuman shoes (see public/drive/people-real/CREDITS.txt, fetched by fetch_shoes.py), each a mesh for both feet that MakeHuman "fits" to its base
mesh through the .mhclo file (every shoe vertex is a barycentric point on a base-mesh triangle plus an offset). So a shoe can be fitted to any of the six
body shapes by evaluating the same recipe on that body's vertices. For the game each shoe is
  1. fitted to the neutral body, cut at a height (the two system shoes come with a long sock tube; the part above the cut is dropped),
  2. decimated once with Blender (collapse), to a few hundred triangles for both feet,
  3. moved to the six body shapes by taking, for every decimated vertex, the shape deltas of its nearest vertices of the full-resolution fit,
  4. skinned with the weights of the nearest body vertices (the same 19-bone rig as the body, so the shoe moves with the foot and the shaft with the shin).
Everything is returned as plain arrays; build_people.py bakes them into the vertex-animation textures with the rest of the person.
"""
import os, numpy as np
from scipy.spatial import cKDTree

# name, folder, obj file, accessory bit (people-alt.js BIT.sneaker / BIT.dress / BIT.boot), the height (m above the sole) the mesh is cut at, near triangles for both feet
SHOES = [
    ('sneaker', 'shoes02', 'shoes02', 1024, 0.15, 280),
    ('dress', 'shoes01', 'shoes01', 2048, 0.15, 300),
    ('boot', 'toigo_ankle_boots_male', 'boots_ankle_male', 4096, 9.0, 320),
]
FAR_TRIS = 70   # both feet, the far level of detail (every person's far shoe is the sneaker's shape)


def read_mhclo(path):
    sc, rows, mode, dele = {}, [], None, set()
    obj = None
    for l in open(path):
        p = l.split()
        if not p or p[0] == '#':
            continue
        if p[0] == 'verts':
            mode = 'v'
            continue
        if p[0] == 'delete_verts':
            mode = 'd'
            continue
        if p[0] == 'obj_file':
            obj = p[1]
        if mode == 'd':   # the base-mesh vertices this shoe hides ("a - b" is a range)
            i = 0
            while i < len(p):
                if i + 2 < len(p) and p[i + 1] == '-':
                    dele.update(range(int(p[i]), int(p[i + 2]) + 1))
                    i += 3
                else:
                    dele.add(int(p[i]))
                    i += 1
        elif mode == 'v':
            if len(p) == 1 and p[0].lstrip('-').isdigit():
                rows.append([float(p[0])] * 3 + [1, 0, 0, 0, 0, 0])
            elif len(p) == 9 and p[0].isdigit():
                rows.append([float(x) for x in p[:9]])
        elif mode is None and p[0] in ('x_scale', 'y_scale', 'z_scale'):
            sc[p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
    return sc, np.array(rows), dele


def fit(base_dm, sc, rows):
    """the shoe's vertices (metres) on a body whose base-mesh vertices (decimetres, helpers included) are base_dm"""
    s = np.array([abs(base_dm[sc[a][0], i] - base_dm[sc[a][1], i]) / sc[a][2] for i, a in enumerate('xyz')])
    idx = rows[:, :3].astype(int)
    return ((base_dm[idx] * rows[:, 3:6, None]).sum(1) + rows[:, 6:9] * s) * 0.1


def read_obj_faces(path):
    return np.array([[int(t.split('/')[0]) - 1 for t in l.split()[1:]] for l in open(path) if l.startswith('f ')])


def decimate(P, quads, tris, bpy):
    """Blender collapse decimation of a quad mesh to about `tris` triangles; returns (vertices, triangles) with the input's winding"""
    me = bpy.data.meshes.new('s')
    me.from_pydata(P.tolist(), [], quads.tolist())
    me.update()
    ob = bpy.data.objects.new('s', me)
    bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new('d', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = min(1.0, tris / (len(quads) * 2))
    m.use_collapse_triangulate = True
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = ev.to_mesh()
    verts = np.array([v.co[:] for v in mesh.vertices])
    faces = np.array([p.vertices[:] for p in mesh.polygons])
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    assert faces.shape[1] == 3
    used = np.unique(faces)
    remap = -np.ones(len(verts), int)
    remap[used] = np.arange(len(used))
    return verts[used], remap[faces]


def build(shoe_dir, base_dm_by_variant, neutral_dm, body_src_neutral, body_weights, near_far=(True, True)):
    """Returns (shoes, ground, hidden): for every shoe dict(name, bit, near=dict(faces, pos[variant], W, h, f), far=...); the y of the soles in the neutral body; and the base-mesh
    vertices that all three shoes hide (the body underneath is dropped).

    base_dm_by_variant: the base mesh (decimetres) for each body shape; neutral_dm: for the neutral body (the one the body was decimated from);
    body_src_neutral / body_weights: the neutral body's vertices (metres) and their 19-bone weights (for skinning the shoes)."""
    import bpy
    tree = cKDTree(body_src_neutral)
    out = []
    ground = None
    prepared = []
    hidden = None
    for name, folder, objname, bit, cut, ntri in SHOES:
        sc, rows, dele = read_mhclo(os.path.join(shoe_dir, folder, [f for f in os.listdir(os.path.join(shoe_dir, folder)) if f.endswith('.mhclo')][0]))
        quads = read_obj_faces(os.path.join(shoe_dir, folder, objname + '.obj'))
        Pn = fit(neutral_dm, sc, rows)
        low = Pn[:, 1].min()
        prepared.append((name, sc, rows, quads, Pn, low, bit, cut, ntri))
        hidden = dele if hidden is None else hidden & dele
    ground = min(p[5] for p in prepared)          # every shoe's sole goes to the lowest sole of the three
    for name, sc, rows, quads, Pn, low, bit, cut, ntri in prepared:
        shift = ground - low
        Pn = Pn + [0, shift, 0]
        keep = quads[(Pn[quads][:, :, 1] - ground <= cut + 1e-4).all(1)]   # drop what is above the cut (the system shoes' long sock tube)
        entry = dict(name=name, bit=bit, shift=shift, ground=ground)
        full_variants = [fit(b, sc, rows) + [0, shift, 0] for b in base_dm_by_variant]
        for lod, tris in (('near', ntri), ('far', FAR_TRIS if name == 'sneaker' else 0)):
            if not tris:
                continue
            cutl = cut if lod == 'near' else 0.12
            kq = quads[(Pn[quads][:, :, 1] - ground <= cutl + 1e-4).all(1)]
            V, F = decimate(Pn, kq, tris, bpy)
            tr = cKDTree(Pn)
            d, nb = tr.query(V, k=4)
            w = 1 / (d + 1e-4)
            w /= w.sum(1, keepdims=True)
            pos = [V + ((fv - Pn)[nb] * w[:, :, None]).sum(1) for fv in full_variants]
            # skin weights: the nearest body vertices of the neutral body
            dd, bi = tree.query(V, k=4)
            ww = 1 / (dd + 1e-3)
            ww /= ww.sum(1, keepdims=True)
            W = (body_weights[bi] * ww[:, :, None]).sum(1)
            W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
            # winding: outwards from the foot's own axis (the obj's winding survives the decimation, check it)
            c = np.zeros(3)
            ok = 0
            for side in (-1, 1):
                sel = np.where(np.sign(V[:, 0]) == side)[0]
                if not len(sel):
                    continue
                m = np.isin(F, sel).all(1)
                a, b, cc = V[F[m, 0]], V[F[m, 1]], V[F[m, 2]]
                nrm = np.cross(b - a, cc - a)
                cen = (a + b + cc) / 3
                ctr = V[sel].mean(0)
                ok += int(((nrm * (cen - ctr)).sum(1) > 0).sum() - ((nrm * (cen - ctr)).sum(1) < 0).sum())
            if ok < 0:
                F = F[:, ::-1].copy()
            # local coordinates for the paint: height above the sole and distance forward of the heel, per foot
            h = V[:, 1] - ground
            f = np.zeros(len(V))
            for side in (-1, 1):
                sel = np.sign(V[:, 0]) == side
                if sel.any():
                    f[sel] = V[sel, 2] - V[sel, 2].min()
            entry[lod] = dict(faces=F, pos=pos, W=W, h=h, f=f, verts=len(V), tris=len(F))
            print('shoe', name, lod, len(V), 'verts', len(F), 'tris; cut at', cutl, 'height range', round(h.min(), 3), round(h.max(), 3))
        out.append(entry)
    return out, ground, hidden
