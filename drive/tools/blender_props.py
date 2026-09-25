"""Street props for the drive: traffic, bus, people, cyclist, construction. Exported as ONE glb
(drive/cache/props_raw.glb) with one merged mesh per prop, each using a single vertex-coloured
material so the runtime can draw hundreds with InstancedMesh.
Convention: vertex colour pure WHITE = "tintable" (the runtime multiplies it by a per-instance colour:
car paint, shirt colour). Every other colour is fixed (glass, tyres, skin, stripes).
Axes: Blender Z-up, nose/facing = +Y, origin centred on the ground. Metres.
Run: python drive/tools/bl.py drive/tools/blender_props.py
"""
import bpy, bmesh, math, os, mathutils

CACHE = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH\drive\cache"
M = mathutils.Matrix

WHITE = (1, 1, 1)                 # tintable
GLASS = (0.04, 0.05, 0.07)
TYRE = (0.03, 0.03, 0.03)
RIM = (0.55, 0.56, 0.58)
LAMP = (1.0, 0.95, 0.8)
TAIL = (0.75, 0.04, 0.04)
TRIM = (0.06, 0.06, 0.07)
ORANGE = (1.0, 0.38, 0.02)
REFLECT = (0.97, 0.97, 0.97)     # just off pure white so it is NOT tinted
BLACK = (0.02, 0.02, 0.02)
CARDBOARD = (0.62, 0.47, 0.3)

coll = bpy.data.collections.get("Props") or bpy.data.collections.new("Props")
if coll.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(coll)
for o in list(coll.objects):
    bpy.data.objects.remove(o, do_unlink=True)

class Builder:
    """Accumulates coloured parts into one bmesh."""
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new("Col")
    def _paint(self, faces, rgb):
        for f in faces:
            for l in f.loops:
                l[self.col] = (*rgb, 1.0)
    def box(self, c, s, rgb, taper_top=1.0, rot=None):
        r = bmesh.ops.create_cube(self.bm, size=1)
        vs = r["verts"]
        bmesh.ops.scale(self.bm, vec=s, verts=vs)
        for v in vs:
            if v.co.z > 0 and taper_top != 1.0:
                v.co.x *= taper_top; v.co.y *= taper_top
        if rot:
            bmesh.ops.rotate(self.bm, verts=vs, cent=(0, 0, 0), matrix=rot)
        bmesh.ops.translate(self.bm, vec=c, verts=vs)
        self._paint({f for v in vs for f in v.link_faces}, rgb)
        return vs
    def cyl(self, c, r, depth, rgb, axis="Z", seg=12, r2=None):
        rot = {"Z": M.Identity(4), "X": M.Rotation(math.pi / 2, 4, "Y"), "Y": M.Rotation(math.pi / 2, 4, "X")}[axis]
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2,
                                    depth=depth, matrix=M.Translation(c) @ rot)
        self._paint({f for v in res["verts"] for f in v.link_faces}, rgb)
        return res["verts"]
    def profile(self, prof, half_w, rgb, taper=None, dy=0.0):
        """Side profile [(y, z)...] extruded across the width; taper(y, z) narrows it in plan (tumblehome)."""
        L = [self.bm.verts.new((-half_w, y + dy, z)) for y, z in prof]
        R = [self.bm.verts.new((half_w, y + dy, z)) for y, z in prof]
        faces = [self.bm.faces.new(L[::-1]), self.bm.faces.new(R)]
        for i in range(len(prof)):
            j = (i + 1) % len(prof)
            faces.append(self.bm.faces.new((L[i], L[j], R[j], R[i])))
        if taper:
            for v in L + R:
                v.co.x *= taper(v.co.y - dy, v.co.z)
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        self._paint(faces, rgb)
    def sphere(self, c, r, rgb, seg=8):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=6, radius=r, matrix=M.Translation(c))
        self._paint({f for v in res["verts"] for f in v.link_faces}, rgb)
    def finish(self, name, bevel=0.0):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update(); self.bm.to_mesh(me); self.bm.free()
        ob = bpy.data.objects.new(name, me); coll.objects.link(ob)
        m = bpy.data.materials.get("prop_vc") or bpy.data.materials.new("prop_vc")
        m.use_nodes = True
        nt = m.node_tree
        if not any(n.type == "VERTEX_COLOR" for n in nt.nodes):
            vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
            nt.links.new(vc.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
            nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.45
        me.materials.append(m)
        if bevel:
            b = ob.modifiers.new("bevel", "BEVEL"); b.width, b.segments, b.limit_method = bevel, 2, "ANGLE"
        for p in me.polygons: p.use_smooth = False
        return ob

def wheels(b, wb, track, r=0.33, front=None):
    ys = (-wb / 2, wb / 2) if front is None else front
    for y in ys:
        for sx in (-1, 1):
            b.cyl((sx * track / 2, y, r), r, 0.24, TYRE, axis="X", seg=14)
            b.cyl((sx * (track / 2 + 0.121), y, r), r * 0.62, 0.01, RIM, axis="X", seg=10)

# ---------------- traffic cars ----------------
# Same construction as the player's car (side profile extruded, tapered in plan, bevelled) so traffic and
# the hero car read as one world. Sizes are real: a mid-size sedan 4.55 m, a compact SUV 4.8 m.
def body_taper(nose, tail):
    def f(y, z):
        k = 1.0
        if y > nose: k *= 1 - (y - nose) * 0.12
        if y < tail: k *= 1 - (tail - y) * 0.12
        if z > 0.85: k *= 0.965
        return k
    return f

def sedan():
    b = Builder()
    body = [(-2.27, 0.34), (-2.3, 0.72), (-2.12, 0.92), (-1.35, 0.97), (-1.0, 0.98), (1.05, 0.96), (2.05, 0.86),
            (2.27, 0.74), (2.29, 0.5), (2.22, 0.33), (1.6, 0.28), (-1.6, 0.28)]
    b.profile(body, 0.9, WHITE, taper=body_taper(1.9, -1.9))
    green = [(-1.05, 0.96), (-0.5, 1.43), (0.42, 1.45), (1.05, 0.95)]            # raked screen + fastback glass
    b.profile(green, 0.74, GLASS, taper=lambda y, z: 0.84 if z > 1.2 else 1.0)
    b.profile([(-0.45, 1.44), (0.38, 1.46), (0.38, 1.49), (-0.45, 1.47)], 0.6, WHITE)   # roof skin
    for sx in (-0.58, 0.58):
        b.box((sx, 2.27, 0.66), (0.4, 0.05, 0.12), LAMP); b.box((sx, -2.29, 0.78), (0.42, 0.05, 0.12), TAIL)
    b.box((0, 2.3, 0.45), (1.2, 0.05, 0.12), TRIM)                                 # grille / bumper line
    wheels(b, 2.72, 1.6, r=0.32)
    return b.finish("prop_sedan", bevel=0.05)

def suv():
    b = Builder()
    body = [(-2.4, 0.42), (-2.42, 1.05), (-2.3, 1.18), (1.35, 1.16), (2.2, 1.05), (2.4, 0.9), (2.42, 0.55),
            (2.35, 0.4), (1.7, 0.36), (-1.7, 0.36)]
    b.profile(body, 0.96, WHITE, taper=body_taper(2.0, -2.1))
    green = [(-2.2, 1.16), (-2.15, 1.78), (0.75, 1.8), (1.35, 1.17)]               # tall, upright glasshouse
    b.profile(green, 0.9, GLASS, taper=lambda y, z: 0.93 if z > 1.4 else 1.0)
    b.profile([(-2.1, 1.79), (0.7, 1.81), (0.7, 1.86), (-2.1, 1.84)], 0.84, WHITE)
    for sx in (-0.72, 0.72):
        b.box((0.0, -1.0, 1.9), (0.05, 2.4, 0.05), (0.2, 0.2, 0.22))               # roof rails
        b.box((sx, 2.41, 0.92), (0.42, 0.05, 0.14), LAMP); b.box((sx, -2.42, 1.0), (0.26, 0.05, 0.32), TAIL)
    b.box((0, 2.44, 0.62), (1.3, 0.05, 0.2), TRIM)
    wheels(b, 2.85, 1.72, r=0.37)
    return b.finish("prop_suv", bevel=0.06)

def bus():
    # generic city transit bus (no real agency livery)
    b = Builder()
    L, Wd = 12.0, 2.55
    b.box((0, 0, 1.75), (Wd, L, 2.7), (0.93, 0.94, 0.95))           # white body (fixed)
    b.box((0, 0, 2.1), (Wd + 0.02, L - 0.6, 1.0), GLASS)            # window band
    b.box((0, 0, 1.05), (Wd + 0.03, L - 0.1, 0.35), WHITE)          # livery stripe (tinted: blue / red)
    b.box((0, 5.98, 1.6), (2.2, 0.06, 1.9), GLASS)                   # windscreen
    b.box((0, 0, 3.13), (2.2, 8.0, 0.2), (0.7, 0.72, 0.74))         # roof AC pods
    b.box((0, 5.9, 2.95), (1.6, 0.1, 0.28), (0.1, 0.1, 0.1))        # route sign
    for sx in (-0.9, 0.9):
        b.box((sx, 6.0, 0.7), (0.34, 0.05, 0.16), LAMP); b.box((sx, -6.0, 0.8), (0.3, 0.05, 0.3), TAIL)
    wheels(b, 0, 2.3, r=0.5, front=(3.9, -3.3))
    return b.finish("prop_bus", bevel=0.08)

# ---------------- construction ----------------
def cone():
    b = Builder()
    b.box((0, 0, 0.02), (0.42, 0.42, 0.04), BLACK)
    b.cyl((0, 0, 0.37), 0.16, 0.66, ORANGE, seg=12, r2=0.035)
    b.cyl((0, 0, 0.44), 0.113, 0.1, REFLECT, seg=12, r2=0.095)
    return b.finish("prop_cone")

def barricade():
    b = Builder()
    for sy in (-0.28, 0.28):                                          # A-frame legs
        for sx in (-0.8, 0.8):
            b.box((sx, sy * 0.6, 0.55), (0.06, 0.06, 1.1), (0.85, 0.85, 0.85), rot=M.Rotation(sy * 0.5, 4, "X"))
    for k in range(6):                                                # diagonal orange/white stripes
        b.box((-0.75 + k * 0.3, 0, 0.88), (0.3, 0.05, 0.26), ORANGE if k % 2 == 0 else REFLECT)
    b.box((0, 0, 0.42), (1.8, 0.05, 0.2), ORANGE)
    b.cyl((0.8, 0, 1.12), 0.07, 0.1, (1.0, 0.75, 0.1))                # amber lamp
    return b.finish("prop_barricade")

def work_sign():
    b = Builder()
    b.box((0, 0, 0.9), (0.06, 0.06, 1.8), (0.55, 0.56, 0.58))
    b.box((0, 0.04, 1.75), (0.9, 0.04, 0.9), ORANGE, rot=M.Rotation(math.pi / 4, 4, "Y"))
    b.box((0, 0.065, 1.75), (0.55, 0.02, 0.55), BLACK, rot=M.Rotation(math.pi / 4, 4, "Y"))   # glyph block
    return b.finish("prop_worksign")

# ---------------- people ----------------
def person(pose="walk", sign=False):
    b = Builder()
    skin = (0.36, 0.23, 0.15)
    stride = 0.18 if pose == "walk" else 0.0
    b.box((-0.1, stride, 0.43), (0.14, 0.16, 0.86), (0.12, 0.13, 0.18))   # legs (dark denim)
    b.box((0.1, -stride, 0.43), (0.14, 0.16, 0.86), (0.12, 0.13, 0.18))
    b.box((0, 0, 1.16), (0.44, 0.26, 0.62), WHITE)                        # shirt (tinted)
    b.box((-0.27, -stride, 1.12), (0.1, 0.12, 0.56), skin); b.box((0.27, stride, 1.12), (0.1, 0.12, 0.56), skin)
    b.sphere((0, 0, 1.62), 0.13, skin)
    b.box((0, 0.02, 1.72), (0.24, 0.24, 0.07), (0.08, 0.08, 0.1))         # cap / hair
    if sign:                                                              # cardboard sign held in front
        b.box((0, 0.26, 1.12), (0.62, 0.03, 0.42), CARDBOARD)
        b.box((0, 0.28, 1.14), (0.44, 0.01, 0.06), BLACK)
    return b.finish("prop_panhandler" if sign else f"prop_person_{pose}")

def cyclist():
    b = Builder()
    for y in (-0.52, 0.52):
        b.cyl((0, y, 0.34), 0.34, 0.05, TYRE, axis="X", seg=16)
    b.box((0, 0, 0.55), (0.05, 1.0, 0.05), (0.7, 0.1, 0.1), rot=M.Rotation(0.3, 4, "X"))
    b.box((0, -0.1, 0.62), (0.05, 0.05, 0.5), (0.7, 0.1, 0.1))
    b.box((0, 0.45, 0.95), (0.5, 0.04, 0.04), BLACK)                      # bars
    b.box((0, -0.05, 1.2), (0.4, 0.3, 0.55), WHITE, rot=M.Rotation(-0.45, 4, "X"))   # torso leaning in (tinted)
    b.box((-0.1, -0.12, 0.7), (0.12, 0.14, 0.6), (0.12, 0.13, 0.18)); b.box((0.1, 0.05, 0.7), (0.12, 0.14, 0.6), (0.12, 0.13, 0.18))
    b.sphere((0, 0.22, 1.5), 0.13, (0.36, 0.23, 0.15))
    b.box((0, 0.2, 1.6), (0.26, 0.32, 0.1), (0.9, 0.85, 0.1))             # helmet
    return b.finish("prop_cyclist")

objs = [sedan(), suv(), bus(), cone(), barricade(), work_sign(), person("walk"), person("stand"), person("stand", sign=True), cyclist()]
for i, o in enumerate(objs):
    o.location = (i * 16, 60, 0)   # spread out in the blend for inspection; export resets below

bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
saved = [o.location.copy() for o in objs]
for o in objs:
    o.location = (0, 0, 0)
bpy.ops.export_scene.gltf(filepath=os.path.join(CACHE, "props_raw.glb"), export_format="GLB", use_selection=True,
                          export_apply=True, export_yup=True, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                          export_materials="EXPORT", export_cameras=False, export_lights=False)
for o, p in zip(objs, saved):
    o.location = p
bpy.ops.wm.save_mainfile()
print("props:", [o.name for o in objs])
