"""Export game-ready glTF from the drive scene:
  drive/cache/hero_raw.glb  the storefront row + corner sign (world space, glTF Y-up)
  drive/cache/car_raw.glb   the player car (origin = rear-axle centre on the ground, nose toward +Y in Blender)
Then run drive/tools/optimize_assets.mjs to meshopt/webp them into public/drive/.
Run: python drive/tools/bl.py drive/tools/blender_export.py
"""
import bpy, bmesh, math, os

CACHE = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH\drive\cache"

def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

def export(path, objs):
    select_only(objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_image_format="JPEG", export_image_quality=92,
                              export_materials="EXPORT", export_cameras=False, export_lights=False)

# ---------- hero row: bake parenting + turn sign text into meshes on a throwaway copy ----------
src = [o for o in bpy.data.collections["HeroRow"].objects if o.type in {"MESH", "FONT"}]
tmp = bpy.data.collections.new("_export_tmp"); bpy.context.scene.collection.children.link(tmp)
copies = []
for o in src:
    c = o.copy()
    c.data = o.data.copy()
    c.parent = None
    c.matrix_world = o.matrix_world.copy()
    tmp.objects.link(c)
    copies.append(c)
for c in [c for c in copies if c.type == "FONT"]:
    select_only([c]); bpy.ops.object.convert(target="MESH")
export(os.path.join(CACHE, "hero_raw.glb"), [bpy.data.objects[c.name] for c in copies])
for c in list(tmp.objects):
    bpy.data.objects.remove(c, do_unlink=True)
bpy.data.collections.remove(tmp)

# ---------- player car: Challenger-INSPIRED muscle coupe (our own design + badge; no Dodge marks) ----------
# Proportions of a modern American muscle coupe: 5.0 m long, 1.95 m wide, 2.95 m wheelbase, long hood with a
# scoop, short deck, low greenhouse, quad round headlamps, full-width tail bar, twin stripes. Origin = rear axle.
import mathutils
def mat(name, rgb, rough, metal=0.0, coat=0.0, emit=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if "Coat Weight" in b.inputs: b.inputs["Coat Weight"].default_value = coat
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1); b.inputs["Emission Strength"].default_value = emit
    return m

cc = bpy.data.collections.get("Car") or bpy.data.collections.new("Car")
if cc.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(cc)
for o in list(cc.objects):
    bpy.data.objects.remove(o, do_unlink=True)

PAINT = mat("car_paint", (0.20, 0.03, 0.30), 0.22, 0.55, coat=1.0)   # deep plum: pops against grey streets
STRIPE = mat("car_stripe", (0.015, 0.015, 0.018), 0.55)
GLASS = mat("car_glass", (0.015, 0.02, 0.03), 0.05, 0.3)
TRIM = mat("car_trim", (0.02, 0.02, 0.02), 0.4)
TYRE = mat("car_tyre", (0.025, 0.025, 0.025), 0.9)
RIM = mat("car_rim", (0.55, 0.56, 0.58), 0.25, 1.0)
LAMP = mat("car_lamp", (1.0, 0.97, 0.9), 0.1, emit=2.0)
TAIL = mat("car_tail", (0.9, 0.02, 0.02), 0.3, emit=3.0)

W2 = 1.95 / 2
def extrude_profile(bm, prof, half_w, taper=None):
    """Side profile (y, z) extruded across the car's width; taper(y) narrows the nose/tail in plan."""
    L = [bm.verts.new((-half_w, y, z)) for y, z in prof]
    R = [bm.verts.new((half_w, y, z)) for y, z in prof]
    n = len(prof)
    bm.faces.new(L[::-1]); bm.faces.new(R)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((L[i], L[j], R[j], R[i]))
    if taper:
        for v in L + R:
            v.co.x *= taper(v.co.y, v.co.z)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

def piece(name, build, material, bevel=0.0, seg=3, smooth=True):
    bm = bmesh.new(); build(bm)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me); cc.objects.link(ob)
    if bevel:
        m = ob.modifiers.new("bevel", "BEVEL"); m.width, m.segments, m.limit_method = bevel, seg, "ANGLE"
    for p in me.polygons: p.use_smooth = smooth
    return ob

# body side profile, rear bumper → deck → (cabin sits on top) → hood → nose → underside
BODY = [(-1.02, 0.34), (-1.05, 0.72), (-0.98, 0.93), (-0.55, 1.0), (0.35, 1.02), (1.55, 1.02), (2.4, 0.98),
        (3.55, 0.92), (3.98, 0.84), (4.02, 0.62), (3.98, 0.34), (3.3, 0.3), (-0.4, 0.3)]
def body_taper(y, z):
    t = 1.0
    if y > 3.4: t *= 1 - (y - 3.4) * 0.09      # squared-off but slightly narrower nose
    if y < -0.7: t *= 1 - (-0.7 - y) * 0.12
    if z > 0.9: t *= 0.97                      # tumblehome
    return t
GREEN = [(0.05, 0.99), (0.55, 1.36), (1.25, 1.40), (1.75, 1.0)]  # long, fast rear glass; raked screen
def cabin(bm):
    extrude_profile(bm, GREEN, W2 * 0.8, taper=lambda y, z: 0.86 if z > 1.2 else 1.0)
def scoop(bm):
    r = bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(0.55, 0.9, 0.09), verts=r["verts"])
    bmesh.ops.translate(bm, vec=(0, 2.75, 1.0), verts=r["verts"])
    for v in r["verts"]:
        if v.co.y < 2.7 and v.co.z > 1.0: v.co.z += 0.03
def stripes(bm):
    # twin racing stripes over hood, roof and deck, riding just above the paint
    for sx in (-0.2, 0.2):
        for y0, y1, z0, z1 in ((1.8, 3.9, 1.0, 0.925), (0.6, 1.2, 1.405, 1.415), (-0.95, 0.05, 0.95, 1.025)):
            a = bm.verts.new((sx - 0.12, y0, z0 + 0.012)); b = bm.verts.new((sx + 0.12, y0, z0 + 0.012))
            c = bm.verts.new((sx + 0.12, y1, z1 + 0.012)); d = bm.verts.new((sx - 0.12, y1, z1 + 0.012))
            bm.faces.new((a, b, c, d))
def grille(bm):
    r = bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(1.55, 0.06, 0.26), verts=r["verts"]); bmesh.ops.translate(bm, vec=(0, 4.01, 0.7), verts=r["verts"])
def lamps(bm):
    for sx in (-0.72, -0.5, 0.5, 0.72):  # quad round headlamps set into the grille
        bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.085, radius2=0.085, depth=0.06,
                              matrix=mathutils.Matrix.Translation((sx, 4.04, 0.7)) @ mathutils.Matrix.Rotation(math.pi / 2, 4, "X"))
def tail(bm):
    r = bmesh.ops.create_cube(bm, size=1)   # full-width tail bar
    bmesh.ops.scale(bm, vec=(1.7, 0.05, 0.1), verts=r["verts"]); bmesh.ops.translate(bm, vec=(0, -1.05, 0.8), verts=r["verts"])

parts = [
    piece("car_body", lambda bm: extrude_profile(bm, BODY, W2, taper=body_taper), PAINT, bevel=0.07),
    piece("car_glass", cabin, GLASS, bevel=0.05),
    piece("car_scoop", scoop, PAINT, bevel=0.03),
    piece("car_stripes", stripes, STRIPE, smooth=False),
    piece("car_grille", grille, TRIM, bevel=0.02),
    piece("car_lamps", lamps, LAMP),
    piece("car_tail", tail, TAIL, bevel=0.02),
]
for sx in (-1, 1):
    for wy in (0.0, 2.95):
        def wheel(bm, sx=sx, wy=wy):
            M = mathutils.Matrix.Translation((sx * (W2 - 0.12), wy, 0.36)) @ mathutils.Matrix.Rotation(math.pi / 2, 4, "Y")
            bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.36, radius2=0.36, depth=0.28, matrix=M)
        parts.append(piece(f"car_tyre_{'L' if sx < 0 else 'R'}{'F' if wy else 'B'}", wheel, TYRE))
        def rim(bm, sx=sx, wy=wy):
            M = mathutils.Matrix.Translation((sx * (W2 - 0.12 + 0.145), wy, 0.36)) @ mathutils.Matrix.Rotation(math.pi / 2, 4, "Y")
            bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.25, radius2=0.25, depth=0.012, matrix=M)
        parts.append(piece(f"car_rim_{'L' if sx < 0 else 'R'}{'F' if wy else 'B'}", rim, RIM))
car_objs = parts
for o in car_objs:
    o.location = (0, 0, 0)
export(os.path.join(CACHE, "car_raw.glb"), car_objs)

bpy.ops.wm.save_mainfile()
print("exported", os.listdir(CACHE))
