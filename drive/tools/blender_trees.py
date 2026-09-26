"""Street and park trees for the drive, built like game trees are: a real bark trunk with branches, and a canopy of
leaf-cluster cards (drive/tools/make_leaf_atlas.py: 2×2 atlas of twigs composed from CC0 leaf scans). Light enough
to instance hundreds on a phone (~0.6–1k triangles a tree) and it reads as a real tree from the game camera.

Two shapes: tree_round (broad oak-like street tree, ~10 m) and tree_upright (columnar, ~8 m). Each is two meshes,
*_trunk (bark UVs) and *_leaves (atlas UVs; vertex colour R = height in the canopy 0..1 for wind, G = random).
Blender Z-up, origin at the base of the trunk. Exports drive/cache/trees_raw.glb (geometry + UVs only; the runtime
supplies the bark and leaf materials).
Run: python drive/tools/bl.py drive/tools/blender_trees.py
"""
import bpy, bmesh, math, os, random, mathutils

CACHE = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH\drive\cache"
V = mathutils.Vector
coll = bpy.data.collections.get("Trees") or bpy.data.collections.new("Trees")
if coll.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(coll)
for o in list(coll.objects):
    bpy.data.objects.remove(o, do_unlink=True)

def limb(bm, uv, a, b, r0, r1, seg=7):
    """a tapered cylinder from a to b with bark UVs (u around, v along, bark tiles every ~1.2 m)"""
    a, b = V(a), V(b); ax = (b - a).normalized()
    up = V((0, 0, 1)) if abs(ax.z) < 0.95 else V((1, 0, 0))
    n1 = ax.cross(up).normalized(); n2 = ax.cross(n1).normalized()
    L = (b - a).length
    rings = []
    for k, (c, r) in enumerate(((a, r0), (b, r1))):
        rings.append([bm.verts.new(c + (n1 * math.cos(t) + n2 * math.sin(t)) * r) for t in (i / seg * 2 * math.pi for i in range(seg + 1))])
    for i in range(seg):
        f = bm.faces.new((rings[0][i], rings[0][i + 1], rings[1][i + 1], rings[1][i]))
        for l, (u, v) in zip(f.loops, ((i / seg, 0), ((i + 1) / seg, 0), ((i + 1) / seg, L / 1.2), (i / seg, L / 1.2))):
            l[uv].uv = (u, v)

def build(name, height, trunk_h, trunk_r, crown_c, crown_r, cards, card_size, branches, seed):
    random.seed(seed)
    # ---- trunk + branches
    bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap")
    fork = V((0, 0, trunk_h))
    limb(bm, uv, (0, 0, 0), fork, trunk_r, trunk_r * 0.72, seg=9)
    tips = []
    for k in range(branches):
        ang = k / branches * 2 * math.pi + random.uniform(-0.3, 0.3)
        out = random.uniform(0.45, 0.8) * crown_r[0]
        tip = V((math.cos(ang) * out, math.sin(ang) * out, crown_c[2] + random.uniform(-0.4, 0.9) * crown_r[2] * 0.6))
        mid = fork + (tip - fork) * 0.45 + V((0, 0, 0.6))
        limb(bm, uv, fork, mid, trunk_r * 0.55, trunk_r * 0.38)
        limb(bm, uv, mid, tip, trunk_r * 0.38, trunk_r * 0.12)
        tips.append(tip)
    limb(bm, uv, fork, V((0, 0, crown_c[2] + crown_r[2] * 0.5)), trunk_r * 0.5, trunk_r * 0.1)
    me = bpy.data.meshes.new(name + "_trunk"); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob_t = bpy.data.objects.new(name + "_trunk", me); coll.objects.link(ob_t)

    # ---- canopy: cards on a shell of the crown, facing outward with random roll/tilt, each showing one twig tile
    bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); col = bm.loops.layers.color.new("Col")
    c = V(crown_c); zlo, zhi = c.z - crown_r[2], c.z + crown_r[2]
    for k in range(cards):
        # stratified points on the ellipsoid shell (a little inside, so the crown has depth)
        u = (k + random.random()) / cards; theta = math.acos(1 - 2 * u); phi = k * 2.399963 + random.uniform(-0.3, 0.3)
        shell = random.uniform(0.62, 1.0)
        dvec = V((math.sin(theta) * math.cos(phi), math.sin(theta) * math.sin(phi), math.cos(theta)))
        p = c + V((dvec.x * crown_r[0], dvec.y * crown_r[1], dvec.z * crown_r[2])) * shell
        nrm = V((dvec.x / crown_r[0], dvec.y / crown_r[1], dvec.z / crown_r[2])).normalized()
        nrm = (nrm + V((random.uniform(-.5, .5), random.uniform(-.5, .5), random.uniform(-.2, .5)))).normalized()
        # card axes: 'up' roughly along the twig (outward + up), 'side' across it
        tw = (nrm * 0.6 + V((0, 0, 0.8))).normalized()
        side = nrm.cross(tw).normalized(); up = side.cross(nrm).normalized()
        roll = random.uniform(-0.6, 0.6); up, side = (up * math.cos(roll) + side * math.sin(roll)), (side * math.cos(roll) - up * math.sin(roll))
        s = card_size * random.uniform(0.8, 1.2)
        base = p - up * s * 0.35
        corners = [base - side * s / 2, base + side * s / 2, base + side * s / 2 + up * s, base - side * s / 2 + up * s]
        vs = [bm.verts.new(q) for q in corners]
        f = bm.faces.new(vs)
        tile = random.randrange(4); tu, tv = (tile % 2) * 0.5, (tile // 2) * 0.5
        rnd = random.random()
        for l, (a, b) in zip(f.loops, ((0, 1), (1, 1), (1, 0), (0, 0))):
            l[uv].uv = (tu + a * 0.5, 1 - (tv + b * 0.5))
            h = (l.vert.co.z - zlo) / (zhi - zlo)
            l[col] = (max(0, min(1, h)), rnd, 0, 1)
    me = bpy.data.meshes.new(name + "_leaves"); bm.to_mesh(me); bm.free()
    ob_l = bpy.data.objects.new(name + "_leaves", me); coll.objects.link(ob_l)
    return [ob_t, ob_l]

objs = []
objs += build("tree_round", 10, trunk_h=2.6, trunk_r=0.24, crown_c=(0, 0, 6.3), crown_r=(3.6, 3.6, 2.9), cards=110, card_size=2.1, branches=5, seed=11)
objs += build("tree_upright", 8, trunk_h=2.0, trunk_r=0.17, crown_c=(0, 0, 5.1), crown_r=(1.9, 1.9, 3.0), cards=72, card_size=1.8, branches=4, seed=23)
for i, o in enumerate(objs): o.location = ((i // 2) * 12, 90, 0)

bpy.ops.object.select_all(action="DESELECT")
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
saved = [o.location.copy() for o in objs]
for o in objs: o.location = (0, 0, 0)
bpy.ops.export_scene.gltf(filepath=os.path.join(CACHE, "trees_raw.glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                          export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_materials="NONE", export_cameras=False, export_lights=False)
for o, p in zip(objs, saved): o.location = p
bpy.ops.wm.save_mainfile()
dg = bpy.context.evaluated_depsgraph_get()
print("trees:", [(o.name, len(o.evaluated_get(dg).data.loop_triangles)) for o in objs])
