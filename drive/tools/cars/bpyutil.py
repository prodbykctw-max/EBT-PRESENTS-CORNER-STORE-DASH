import bpy, bmesh, numpy as np, sys
from carlib import *

def import_glb(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']

def world_bm(objs, weld=1e-5):
    """merge objects (world space, triangulated) into one bmesh, welded"""
    bm = bmesh.new()
    for o in objs:
        t = bmesh.new(); t.from_mesh(o.data); t.transform(o.matrix_world)
        bmesh.ops.triangulate(t, faces=t.faces[:])
        me = bpy.data.meshes.new('tmp'); t.to_mesh(me); t.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    if weld: bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=weld)
    return bm

def decimate_bm(bm, ratio, planar=False):
    """collapse-decimate a bmesh to ratio of its triangles, returns (V, F) numpy"""
    me = bpy.data.meshes.new('d'); bm.to_mesh(me)
    ob = bpy.data.objects.new('d', me); bpy.context.scene.collection.objects.link(ob)
    if ratio < 0.999:
        md = ob.modifiers.new('dec', 'DECIMATE'); md.decimate_type = 'COLLAPSE'; md.ratio = ratio; md.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg)
    m2 = bpy.data.meshes.new_from_object(ev)
    V = np.array([v.co[:] for v in m2.vertices], float)
    m2.calc_loop_triangles()
    F = np.array([t.vertices[:] for t in m2.loop_triangles], int).reshape(-1, 3)
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me); bpy.data.meshes.remove(m2)
    return V, F

def crease_mesh(V, F, angle_deg=38.0):
    """corner-normal mesh: per-face-corner normals averaged over adjacent faces within the crease angle -> Mesh with split verts"""
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    area = np.linalg.norm(fn, axis=1); fnu = fn / np.maximum(area, 1e-12)[:, None]
    nf = len(F); cosT = np.cos(np.radians(angle_deg))
    # faces per vertex
    from collections import defaultdict
    vf = defaultdict(list)
    for fi in range(nf):
        for c in range(3): vf[F[fi, c]].append(fi)
    NV = []; NN = []; NF = np.zeros((nf, 3), int); cache = {}
    for fi in range(nf):
        for c in range(3):
            v = F[fi, c]; adj = vf[v]
            sel = [a for a in adj if fnu[a] @ fnu[fi] >= cosT]
            n = (fnu[sel] * area[sel][:, None]).sum(0); n /= max(np.linalg.norm(n), 1e-12)
            key = (v, tuple(np.round(n, 3)))
            if key not in cache: cache[key] = len(NV); NV.append(V[v]); NN.append(n)
            NF[fi, c] = cache[key]
    return np.array(NV), NF, np.array(NN)

def to_gltf(V):
    """Blender (x right, y fwd, z up) -> three/glTF (x right, y up, z back)"""
    return np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1)
