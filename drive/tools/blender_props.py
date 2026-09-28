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
CONE_RED = (1.0, 0.2, 0.0)          # deeper red-orange: reads against the yellow centre line, not just grey asphalt

def cone():
    """a tall highway-style cone, a little bigger than a street cone so it reads from the high chase camera and
    on a phone: wide black base, red-orange body, two broad white reflective collars (the white and the black
    are what separate it from the yellow line)"""
    b = Builder()
    b.box((0, 0, 0.03), (0.56, 0.56, 0.06), BLACK)
    b.cyl((0, 0, 0.5), 0.22, 0.9, CONE_RED, seg=14, r2=0.045)
    # collars sit just proud of the body: radius follows the taper at their heights
    b.cyl((0, 0, 0.62), 0.152, 0.14, REFLECT, seg=14, r2=0.13)
    b.cyl((0, 0, 0.36), 0.2, 0.12, REFLECT, seg=14, r2=0.182)
    b.cyl((0, 0, 0.96), 0.05, 0.04, BLACK, seg=10, r2=0.045)
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

# ---------------- streetscape ----------------
BARK = (0.24, 0.17, 0.11); STEEL = (0.3, 0.32, 0.34); GALV = (0.62, 0.64, 0.66); SIGNAL_Y = (0.9, 0.72, 0.1)
def tree(kind):
    """Street tree. Canopy is WHITE (tinted per instance: season/variety greens); trunk fixed bark."""
    b = Builder()
    b.cyl((0, 0, 1.4), 0.16, 2.8, BARK, seg=8, r2=0.11)
    if kind == "round":      # oak / elm: a clustered, lumpy crown
        for (x, y, z, r) in ((0, 0, 4.2, 2.3), (1.2, 0.5, 3.7, 1.6), (-1.1, -0.6, 3.8, 1.7), (0.3, -1.2, 4.6, 1.5), (-0.4, 1.1, 4.9, 1.4)):
            res = bmesh.ops.create_icosphere(b.bm, subdivisions=1, radius=r, matrix=M.Translation((x, y, z)))
            b._paint({f for v in res["verts"] for f in v.link_faces}, WHITE)
    else:                    # upright (e.g. Bradford pear): tall teardrop
        res = bmesh.ops.create_icosphere(b.bm, subdivisions=1, radius=1.5, matrix=M.Translation((0, 0, 4.3)) @ M.Scale(1.9, 4, (0, 0, 1)))
        b._paint({f for v in res["verts"] for f in v.link_faces}, WHITE)
    return b.finish(f"prop_tree_{kind}")

def street_lamp():
    """Cobra-head street light: tapered pole, arm reaching over the road (+Y), luminaire."""
    b = Builder()
    b.cyl((0, 0, 4.5), 0.13, 9.0, GALV, seg=10, r2=0.08)
    b.box((0, 1.1, 8.85), (0.08, 2.3, 0.08), GALV, rot=M.Rotation(-0.12, 4, "X"))
    b.box((0, 2.3, 8.7), (0.36, 0.75, 0.16), GALV)
    b.box((0, 2.3, 8.6), (0.28, 0.55, 0.03), (1.0, 0.96, 0.85))
    b.cyl((0, 0, 0.3), 0.2, 0.6, STEEL, seg=10)
    return b.finish("prop_lamp")

def signal_mast():
    """Traffic signal: pole at the corner, mast arm over the road (+Y); heads face -X (oncoming traffic when
    the runtime maps local +X to the direction of travel)."""
    b = Builder()
    b.cyl((0, 0, 3.6), 0.17, 7.2, STEEL, seg=10, r2=0.13)
    b.box((0, 3.3, 6.6), (0.12, 6.6, 0.12), STEEL)
    for y in (2.4, 4.6, 6.3):
        b.box((0, y, 6.05), (0.4, 0.3, 1.05), SIGNAL_Y)
        for k, c in enumerate(((0.9, 0.1, 0.05), (1.0, 0.75, 0.05), (0.1, 0.85, 0.3))):
            b.cyl((-0.21, y, 6.4 - k * 0.33), 0.1, 0.03, c, axis="X", seg=10)
    b.box((-0.16, 0, 3.0), (0.35, 0.35, 0.5), SIGNAL_Y)  # pedestrian head
    return b.finish("prop_signal")

def bench():
    b = Builder()
    b.box((0, 0, 0.45), (1.8, 0.45, 0.06), (0.35, 0.22, 0.12))
    b.box((0, -0.22, 0.75), (1.8, 0.05, 0.4), (0.35, 0.22, 0.12))
    for x in (-0.75, 0.75): b.box((x, 0, 0.22), (0.06, 0.45, 0.45), BLACK)
    return b.finish("prop_bench")

def trash_can():
    b = Builder()
    b.cyl((0, 0, 0.48), 0.3, 0.96, (0.1, 0.22, 0.14), seg=12)
    b.cyl((0, 0, 1.0), 0.33, 0.08, BLACK, seg=12)
    return b.finish("prop_bin")

def hydrant():
    b = Builder()
    b.cyl((0, 0, 0.35), 0.13, 0.7, (0.82, 0.12, 0.08), seg=10)
    b.sphere((0, 0, 0.72), 0.14, (0.82, 0.12, 0.08))
    b.cyl((0, 0, 0.45), 0.06, 0.4, (0.82, 0.12, 0.08), axis="X", seg=8)
    return b.finish("prop_hydrant")

def shelter():
    b = Builder()
    for x in (-1.8, 1.8): b.box((x, 0, 1.2), (0.08, 1.4, 2.4), GALV)
    b.box((0, -0.65, 1.3), (3.6, 0.04, 2.0), (0.55, 0.65, 0.72))       # back glass
    b.box((0, 0, 2.5), (4.0, 1.7, 0.12), (0.25, 0.27, 0.3))           # roof
    b.box((0, -0.35, 0.5), (2.6, 0.4, 0.06), (0.35, 0.22, 0.12))
    return b.finish("prop_shelter")

# ---------------- Atlanta Streetcar (a generic low-floor, 3-section car in the spirit of the Siemens S70:
# white body, deep-teal skirt, dark window band, roof pantograph; no operator logos) ----------------
TRAM_WHITE = (0.94, 0.95, 0.96)       # off-white so it's never tinted
TRAM_TEAL = (0.0, 0.36, 0.52)
TRAM_DOOR = (0.8, 0.83, 0.86)
BELLOWS = (0.05, 0.05, 0.06)

def tram_body(b, y0, y1, doors, nose=False):
    """one section's shell from y0 to y1 (a cab nose at +Y if nose): white upper, teal skirt, window band, doors"""
    W2 = 1.325                                                          # 2.65 m wide
    if nose:   # side profile with a raked, rounded cab front
        prof = [(y0, 0.32), (y1 - 0.5, 0.32), (y1 - 0.08, 0.7), (y1, 1.35), (y1 - 0.12, 2.75), (y1 - 0.45, 3.25), (y0, 3.25)]
        b.profile(prof, W2, TRAM_WHITE)
        b.box((0, y1 - 0.2, 2.0), (2.3, 0.3, 1.2), GLASS, rot=M.Rotation(-0.25, 4, "X"))   # raked windscreen
        for sx in (-0.85, 0.85):
            b.box((sx, y1 - 0.02, 0.95), (0.32, 0.06, 0.14), LAMP)                # headlamps
            b.box((sx, y1 - 0.03, 0.72), (0.28, 0.05, 0.1), TAIL)                 # tail lamps (bidirectional car)
        b.box((0, y1 - 0.25, 2.95), (1.4, 0.08, 0.26), BLACK)                     # destination sign
        yb = y1 - 0.5
    else:
        b.box((0, (y0 + y1) / 2, 1.785), (2 * W2, y1 - y0, 2.93), TRAM_WHITE)
        yb = y1
    b.box((0, (y0 + yb) / 2, 0.52), (2 * W2 + 0.02, yb - y0, 0.4), TRAM_TEAL)     # teal skirt
    b.box((0, (y0 + yb) / 2, 1.95), (2 * W2 + 0.02, yb - y0 - 0.6, 1.15), GLASS)  # window band
    b.box((0, (y0 + yb) / 2, 1.3), (2 * W2 + 0.025, yb - y0, 0.06), TRAM_TEAL)    # pinstripe under the windows
    for yd in doors:                                                              # double doors, both sides
        for sx in (-W2 - 0.015, W2 + 0.015):
            b.box((sx, yd, 1.45), (0.03, 1.3, 2.25), TRAM_DOOR)
            b.box((sx * 1.001, yd, 1.9), (0.035, 1.1, 0.9), GLASS)
    b.box((0, (y0 + yb) / 2, 0.2), (2.3, yb - y0 - 0.4, 0.3), BLACK)              # underframe / truck skirt
    b.box((0, (y0 + y1) / 2, 3.35), (1.6, (y1 - y0) * 0.55, 0.22), (0.72, 0.74, 0.76))   # roof equipment

def tram_end():
    # 9.0 m cab section, cab at +Y; the runtime mirrors it for the rear end
    b = Builder()
    tram_body(b, -4.5, 4.5, doors=(-2.2, 1.4), nose=True)
    b.box((0, -4.55, 1.8), (2.4, 0.1, 2.9), BELLOWS)                              # articulation bellows
    return b.finish("prop_tram_end", bevel=0.05)

def tram_mid():
    # 6.8 m middle section with the pantograph
    b = Builder()
    tram_body(b, -3.4, 3.4, doors=(0.0,))
    for a in (0.55, -0.55):                                                       # pantograph: a folded diamond
        b.box((0, a * 0.9, 3.85), (0.06, 1.4, 0.06), (0.2, 0.2, 0.22), rot=M.Rotation(0.5 if a > 0 else -0.5, 4, "X"))
    b.box((0, 0, 4.2), (1.7, 0.1, 0.06), (0.2, 0.2, 0.22))                        # collector head
    b.box((0, 0, 3.52), (1.0, 1.2, 0.1), (0.25, 0.25, 0.27))                      # base frame
    return b.finish("prop_tram_mid", bevel=0.05)

# ---------------- city life (no logos, lettering or insignia on any of it) ----------------
INK = (0.035, 0.035, 0.04)            # police black
CHROME = (0.7, 0.71, 0.73)
PEARL = (0.95, 0.955, 0.96)           # just off pure white: never tinted
SENSOR = (0.09, 0.09, 0.1)
BOTTLE = (0.62, 0.8, 0.95)
CAP = (0.1, 0.35, 0.85)

def police():
    """a full-size police interceptor sedan in plain black-and-white: black nose, tail and lower body, white doors
    and roof, a light bar (red / blue), push bar and a spotlight. Nothing written on it."""
    b = Builder()
    body = [(-2.5, 0.36), (-2.53, 0.76), (-2.33, 0.97), (-1.45, 1.02), (-1.08, 1.03), (1.1, 1.01), (2.2, 0.9),
            (2.45, 0.77), (2.48, 0.52), (2.4, 0.35), (1.7, 0.3), (-1.7, 0.3)]
    b.profile(body, 0.95, INK, taper=body_taper(2.05, -2.05))
    # the white door panels, a skin just proud of the black body
    b.profile([(-1.35, 0.42), (-1.35, 1.0), (1.12, 1.0), (1.12, 0.42)], 0.962, PEARL, taper=body_taper(2.05, -2.05))
    green = [(-1.12, 1.01), (-0.55, 1.5), (0.45, 1.52), (1.1, 1.0)]
    b.profile(green, 0.78, GLASS, taper=lambda y, z: 0.84 if z > 1.25 else 1.0)
    b.profile([(-0.5, 1.51), (0.42, 1.53), (0.42, 1.56), (-0.5, 1.54)], 0.64, PEARL)            # white roof
    # light bar: black base, red lamps driver side, blue passenger side, a clear centre
    b.box((0, -0.05, 1.6), (1.3, 0.3, 0.07), INK)
    b.box((-0.36, -0.05, 1.68), (0.56, 0.26, 0.1), (0.85, 0.05, 0.05))
    b.box((0.36, -0.05, 1.68), (0.56, 0.26, 0.1), (0.05, 0.2, 0.95))
    b.box((0, -0.05, 1.68), (0.14, 0.26, 0.1), (0.9, 0.9, 0.9))
    b.cyl((-0.86, 0.9, 1.08), 0.07, 0.12, CHROME, axis="Y", seg=10)                         # A-pillar spotlight
    b.box((0, 2.56, 0.55), (1.5, 0.12, 0.34), INK)                                           # push bar
    for sx in (-0.5, 0.5): b.box((sx, 2.52, 0.55), (0.08, 0.12, 0.5), INK)
    for sx in (-0.6, 0.6):
        b.box((sx, 2.47, 0.7), (0.42, 0.05, 0.12), LAMP); b.box((sx, -2.52, 0.82), (0.44, 0.05, 0.13), TAIL)
    wheels(b, 2.95, 1.64, r=0.34)
    return b.finish("prop_police", bevel=0.05)

def robotaxi():
    """a white self-driving electric crossover: short nose, fastback roof, the spinning lidar dome on a roof
    pod, sensor pods on the front fenders and rear corners, radar blocks in the bumpers. No branding."""
    b = Builder()
    body = [(-2.3, 0.42), (-2.34, 0.98), (-2.15, 1.12), (1.2, 1.1), (2.05, 0.92), (2.3, 0.78), (2.33, 0.5),
            (2.25, 0.38), (1.6, 0.34), (-1.6, 0.34)]
    b.profile(body, 0.97, PEARL, taper=body_taper(1.95, -1.95))
    green = [(-2.1, 1.1), (-1.65, 1.5), (0.35, 1.58), (1.25, 1.1)]
    b.profile(green, 0.86, GLASS, taper=lambda y, z: 0.86 if z > 1.35 else 1.0)
    b.profile([(-1.55, 1.52), (0.3, 1.6), (0.3, 1.63), (-1.55, 1.55)], 0.78, PEARL)
    b.box((0, -0.35, 1.7), (0.72, 1.1, 0.14), PEARL)                                         # roof sensor pod
    b.cyl((0, -0.1, 1.8), 0.17, 0.07, SENSOR, seg=16)                                        # lidar base
    b.cyl((0, -0.1, 1.9), 0.12, 0.14, (0.16, 0.17, 0.19), seg=16, r2=0.1)                     # lidar dome
    b.sphere((0, -0.1, 1.97), 0.1, SENSOR, seg=12)
    for sx in (-1, 1):
        b.cyl((sx * 1.0, 1.35, 1.02), 0.1, 0.2, SENSOR, seg=12)                                # fender pods
        b.cyl((sx * 0.9, -2.05, 1.2), 0.08, 0.16, SENSOR, seg=12)                              # rear corner pods
        b.box((sx * 0.62, 2.3, 0.72), (0.4, 0.05, 0.08), LAMP); b.box((sx * 0.7, -2.35, 0.95), (0.4, 0.05, 0.08), TAIL)
    b.box((0, 2.35, 0.5), (0.5, 0.05, 0.14), SENSOR)                                         # front radar
    b.box((0, 2.34, 0.62), (1.2, 0.04, 0.05), TRIM)
    wheels(b, 2.99, 1.66, r=0.36)
    return b.finish("prop_robotaxi", bevel=0.06)

def dog(step):
    """a medium street dog, ~0.55 m at the shoulder. Coat is WHITE (tinted per dog). step ±1: the trot's two
    diagonal-pair poses (the runtime alternates them)."""
    b = Builder()
    coat, dark = WHITE, (0.05, 0.04, 0.035)
    b.box((0, 0, 0.5), (0.24, 0.66, 0.24), coat, taper_top=0.92)                    # body
    b.box((0, 0.28, 0.54), (0.26, 0.2, 0.26), coat)                                 # chest
    b.box((0, 0.42, 0.66), (0.13, 0.14, 0.2), coat, rot=M.Rotation(-0.6, 4, "X"))    # neck
    b.box((0, 0.5, 0.76), (0.17, 0.2, 0.16), coat)                                  # head
    b.box((0, 0.64, 0.73), (0.1, 0.14, 0.09), coat)                                 # muzzle
    b.box((0, 0.715, 0.75), (0.05, 0.02, 0.04), dark)                               # nose
    for sx in (-1, 1):
        b.box((sx * 0.065, 0.46, 0.87), (0.05, 0.03, 0.09), coat, rot=M.Rotation(sx * 0.3, 4, "Y"))   # ears
        b.box((sx * 0.07, 0.585, 0.79), (0.02, 0.01, 0.02), dark)                   # eyes
    b.box((0, -0.38, 0.62), (0.05, 0.3, 0.05), coat, rot=M.Rotation(0.7, 4, "X"))    # tail, carried up
    for (sx, sy, k) in ((-1, 0.24, 1), (1, 0.24, -1), (-1, -0.24, -1), (1, -0.24, 1)):   # diagonal pairs swing together
        a = 0.38 * step * k
        v = b.box((0, 0, 0), (0.07, 0.07, 0.42), coat)
        bmesh.ops.translate(b.bm, vec=(0, 0, -0.21), verts=v)                         # hang from the hip
        bmesh.ops.rotate(b.bm, verts=v, cent=(0, 0, 0), matrix=M.Rotation(a, 4, "X"))
        bmesh.ops.translate(b.bm, vec=(sx * 0.08, sy, 0.44), verts=v)
    return b.finish("prop_dog_" + ("a" if step > 0 else "b"))

def bird(up):
    """a pigeon (plumage WHITE: tinted grey / slate / dark). up: wings raised or on the downstroke."""
    b = Builder()
    b.cyl((0, 0, 0), 0.075, 0.3, WHITE, axis="Y", seg=8, r2=0.045)                  # body, tapering to the tail
    b.sphere((0, 0.18, 0.03), 0.05, WHITE, seg=8)
    b.box((0, 0.235, 0.02), (0.02, 0.04, 0.015), (0.35, 0.3, 0.3))                  # beak
    b.box((0, -0.2, 0), (0.12, 0.1, 0.015), WHITE)                                   # tail fan
    a = 0.55 if up else -0.35
    for sx in (-1, 1):
        v = [b.bm.verts.new(q) for q in ((sx * 0.04, 0.09, 0), (sx * 0.2, 0.07, 0), (sx * 0.34, -0.02, 0), (sx * 0.2, -0.09, 0), (sx * 0.04, -0.08, 0))]
        f = b.bm.faces.new(v if sx < 0 else v[::-1]); b._paint([f], WHITE)          # broad pigeon wing
        bmesh.ops.rotate(b.bm, verts=v, cent=(sx * 0.03, 0, 0), matrix=M.Rotation(sx * a, 4, "Y"))
    return b.finish("prop_bird_" + ("up" if up else "down"))

def bird_sit():
    """a pigeon on the ground: body tilted up at the chest, wings folded along the back, little legs"""
    b = Builder()
    v = b.cyl((0, 0, 0.13), 0.07, 0.28, WHITE, axis="Y", seg=8, r2=0.04)
    bmesh.ops.rotate(b.bm, verts=v, cent=(0, 0, 0.13), matrix=M.Rotation(0.3, 4, "X"))
    b.sphere((0, 0.15, 0.22), 0.048, WHITE, seg=8)
    b.box((0, 0.2, 0.215), (0.02, 0.04, 0.015), (0.35, 0.3, 0.3))
    for sx in (-1, 1):
        b.box((sx * 0.06, -0.03, 0.15), (0.03, 0.22, 0.06), WHITE, rot=M.Rotation(0.3, 4, "X"))   # folded wings
        b.box((sx * 0.025, 0.02, 0.03), (0.012, 0.012, 0.06), (0.75, 0.35, 0.35))                  # pink legs
    b.box((0, -0.19, 0.08), (0.08, 0.1, 0.012), WHITE, rot=M.Rotation(0.3, 4, "X"))               # tail
    return b.finish("prop_bird_sit")

def crow(pose):
    """an American crow (also drawn, smaller and tinted, as a grackle): heavier body, big beak, fan tail,
    long fingered wings. pose: "up" / "down" (flight) or "sit". Plumage WHITE: tinted near-black per bird."""
    b = Builder()
    beak = (0.05, 0.05, 0.055)
    if pose == "sit":
        v = b.cyl((0, 0, 0.17), 0.085, 0.36, WHITE, axis="Y", seg=8, r2=0.05)
        bmesh.ops.rotate(b.bm, verts=v, cent=(0, 0, 0.17), matrix=M.Rotation(0.35, 4, "X"))
        b.sphere((0, 0.19, 0.29), 0.06, WHITE, seg=8)
        b.box((0, 0.265, 0.28), (0.03, 0.08, 0.03), beak)
        for sx in (-1, 1):
            b.box((sx * 0.075, -0.05, 0.19), (0.035, 0.3, 0.08), WHITE, rot=M.Rotation(0.35, 4, "X"))
            b.box((sx * 0.03, 0.02, 0.04), (0.014, 0.014, 0.08), beak)
        b.box((0, -0.25, 0.09), (0.12, 0.14, 0.014), WHITE, rot=M.Rotation(0.35, 4, "X"))
        return b.finish("prop_crow_sit")
    b.cyl((0, 0, 0), 0.085, 0.38, WHITE, axis="Y", seg=8, r2=0.05)
    b.sphere((0, 0.22, 0.02), 0.06, WHITE, seg=8)
    b.box((0, 0.3, 0.01), (0.03, 0.08, 0.03), beak)
    b.box((0, -0.27, 0), (0.16, 0.16, 0.014), WHITE)                                # fan tail
    a = 0.5 if pose == "up" else -0.3
    for sx in (-1, 1):
        v = [b.bm.verts.new(q) for q in ((sx * 0.05, 0.1, 0), (sx * 0.26, 0.09, 0), (sx * 0.46, 0.02, 0), (sx * 0.48, -0.06, 0), (sx * 0.26, -0.1, 0), (sx * 0.05, -0.09, 0))]
        f = b.bm.faces.new(v if sx < 0 else v[::-1]); b._paint([f], WHITE)          # broad, square-ended wing
        bmesh.ops.rotate(b.bm, verts=v, cent=(sx * 0.04, 0, 0), matrix=M.Rotation(sx * a, 4, "Y"))
    return b.finish("prop_crow_" + pose)

def seller():
    """a boy selling cold water at the light: t-shirt (WHITE, tinted), shorts, sneakers; one bottle held up to
    the drivers, a plastic-wrapped case of bottles on his other arm"""
    b = Builder()
    skin = (0.2, 0.12, 0.08)
    s = 0.86
    for sx in (-0.09, 0.09):
        b.box((sx * s, 0, 0.3 * s), (0.12 * s, 0.14 * s, 0.6 * s), skin)                  # legs
        b.box((sx * s, 0.03, 0.04), (0.13 * s, 0.26 * s, 0.08), (0.92, 0.92, 0.9))        # sneakers
        b.box((sx * s, 0, 0.62 * s), (0.17 * s, 0.2 * s, 0.34 * s), (0.1, 0.12, 0.2))     # basketball shorts
    b.box((0, 0, 1.12 * s), (0.44 * s, 0.25 * s, 0.62 * s), WHITE)                        # t-shirt
    b.sphere((0, 0, 1.6 * s), 0.13 * s, skin)
    b.box((0, 0.0, 1.71 * s), (0.25 * s, 0.25 * s, 0.06), (0.05, 0.04, 0.04))             # short hair
    # right arm raised, bottle in hand
    b.box((0.27 * s, 0.05, 1.52 * s), (0.1 * s, 0.1 * s, 0.56 * s), skin, rot=M.Rotation(-0.25, 4, "X"))
    b.cyl((0.27 * s, 0.13, 1.93 * s), 0.035, 0.22, BOTTLE, seg=8)
    b.cyl((0.27 * s, 0.13, 1.93 * s + 0.12), 0.018, 0.03, CAP, seg=8)
    # left forearm forward under a case of water
    b.box((-0.27 * s, 0.1, 1.05 * s), (0.1 * s, 0.3 * s, 0.1 * s), skin)
    b.box((-0.24 * s, 0.22, 1.2 * s), (0.28, 0.2, 0.22), BOTTLE)
    for i in range(3):
        for j in range(2): b.cyl((-0.24 * s - 0.09 + i * 0.09, 0.17 + j * 0.1, 1.2 * s + 0.12), 0.02, 0.03, CAP, seg=6)
    return b.finish("prop_seller")

def cooler():
    """the sellers' cooler on the corner, with a case of water on the lid"""
    b = Builder()
    b.box((0, 0, 0.22), (0.7, 0.42, 0.4), (0.12, 0.3, 0.7))
    b.box((0, 0, 0.44), (0.72, 0.44, 0.06), (0.93, 0.93, 0.9))
    b.box((0.1, 0, 0.58), (0.4, 0.27, 0.22), BOTTLE)
    for i in range(4):
        for j in range(3): b.cyl((-0.05 + i * 0.1, -0.09 + j * 0.09, 0.7), 0.02, 0.03, CAP, seg=6)
    return b.finish("prop_cooler")

objs = [sedan(), suv(), bus(), cone(), barricade(), work_sign(), person("walk"), person("stand"), person("stand", sign=True), cyclist(),
        tree("round"), tree("upright"), street_lamp(), signal_mast(), bench(), trash_can(), hydrant(), shelter(), tram_end(), tram_mid(),
        police(), robotaxi(), dog(1), dog(-1), bird(True), bird(False), bird_sit(), crow("up"), crow("down"), crow("sit"), seller(), cooler()]
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
