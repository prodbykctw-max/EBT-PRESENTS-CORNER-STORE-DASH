"""Hero storefront row + Auburn Ave corner sign, built on top of the blockout scene.
Run after blender_blockout.py:  python drive/tools/bl.py drive/tools/blender_hero_row.py

Technique: each shop is a real box (brick sides, roof with parapet and rooftop units). The AI-painted
facade elevation is mapped to the front face, and the awning and sign board are modeled as geometry
that is UV-projected from the SAME front elevation. Paint and depth then line up exactly, and the row
reads in 3D from the overhead camera, not as a flat card.
"""
import bpy, bmesh, json, math, os

DRIVE = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH\drive"
W = json.load(open(os.path.join(DRIVE, "cache", "world.json"), encoding="utf-8"))
ART = os.path.join(DRIVE, "art")

# Everything below is built in the ROW frame: +x = viewer's right when facing the shops, -y = toward the street.
# A root empty rotates the finished row into the world (facing north = 180 deg about the store origin).
FACING = W["store"].get("facing", "south")
ROT = math.pi if FACING == "north" else 0.0
def to_world(x, y):
    c, s_ = math.cos(ROT), math.sin(ROT)
    return x * c - y * s_, x * s_ + y * c
def to_row(x, y):
    return to_world(x, y) if ROT in (0.0, math.pi) else None  # 180 deg is its own inverse

FRONT_Y = -4.0         # building line (m); the Auburn Ave curb is ~3.7 m further toward the street
DEPTH = 16.0
FAC_ASPECT = 1520 / 2688  # facade image h / w
SIGN_X, SIGN_Y = to_row(*W["cornerSign"]["pos"][:2])   # corner in the row frame
CURB_Y = SIGN_Y + 4.5

# Per-facade layout in normalized image coords (v measured from the TOP of the image).
LAYOUT = {
    "Susie's Hair Care":   dict(img="susies",    sign=(0.14, 0.27), awning=(0.29, 0.43, "slope"), roof_units=2),
    "Laundromat":          dict(img="laundry",   sign=(0.02, 0.28), awning=(0.30, 0.44, "slope"), roof_units=3),
    "EBT Corner Store":    dict(img="ebt_store", sign=(0.04, 0.27), awning=(0.28, 0.40, "slope"), roof_units=2),
    "JJ's Fish & Chicken": dict(img="jjs",       sign=(0.02, 0.32), awning=(0.34, 0.44, "band"),  roof_units=3),
}

# ---------- helpers ----------
E = W["elevation"]
def ground(x, y):  # takes ROW-frame coords
    x, y = to_world(x, y)
    fx = min(max((x - E["x0"]) / E["step"], 0), E["gx"] - 1.001)
    fy = min(max((y - E["y0"]) / E["step"], 0), E["gy"] - 1.001)
    i, j = int(fx), int(fy); u, v = fx - i, fy - j
    Z = lambda a, b: E["z"][b * E["gx"] + a]
    return (Z(i, j) * (1 - u) + Z(i + 1, j) * u) * (1 - v) + (Z(i, j + 1) * (1 - u) + Z(i + 1, j + 1) * u) * v

def get_coll(name):
    c = bpy.data.collections.get(name)
    if c:
        for ob in list(c.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
    else:
        c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c)
    return c

def img(path):
    return bpy.data.images.load(path, check_existing=True)

def pbr(name, pbr_id, scale, tint=None):
    """Tiling CC0 PBR material. Meshes carry metre-scale box UVs (see box_uv); `scale` = repeats per metre.
    Plain UV -> Mapping -> Image graph so the glTF exporter writes it as KHR_texture_transform."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    d = os.path.join(ART, "pbr", pbr_id)
    def tex(fn, non_color=False):
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(os.path.join(d, fn))
        if non_color: t.image.colorspace_settings.name = "Non-Color"
        nt.links.new(mp.outputs["Vector"], t.inputs["Vector"]); return t
    diff = tex("diff.jpg")
    if tint:
        mix = nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type = "MULTIPLY"; mix.inputs["Fac"].default_value = 1
        mix.inputs["Color2"].default_value = (*tint, 1)
        nt.links.new(diff.outputs["Color"], mix.inputs["Color1"]); nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        nt.links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex("rough.jpg", True).outputs["Color"], bsdf.inputs["Roughness"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(tex("nor.jpg", True).outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    m.diffuse_color = (0.5, 0.5, 0.5, 1)
    return m

def facade_mat(key):
    name = f"facade_{key}"
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(os.path.join(ART, "facades", key + ".jpg"))
    t.extension = "EXTEND"
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m

def flat(name, rgb, rough=0.7):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*rgb, 1)
    return m

def box_uv(bm, only_mat=None):
    """Metre-scale box-projection UVs (u, v in metres) for tiling materials."""
    uvl = bm.loops.layers.uv.active or bm.loops.layers.uv.new()
    for f in bm.faces:
        if only_mat is not None and f.material_index != only_mat:
            continue
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            l[uvl].uv = (c.x, c.y) if ax == 2 else (c.y, c.z) if ax == 0 else (c.x, c.z)

def finish(bm, name, coll, mats):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob)
    return ob

# ---------- clear the lots: drop OSM buildings that overlap the hero row ----------
x_min = min(s["x"] - s["width"] / 2 for s in W["shops"]) - 1
x_max = max(s["x"] + s["width"] / 2 for s in W["shops"]) + 1
removed = []
for ob in list(bpy.data.collections["Play"].objects):
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    cx, cy = to_row(sum(v.x for v in vs) / len(vs), sum(v.y for v in vs) / len(vs))
    if x_min - 4 < cx < x_max + 4 and FRONT_Y - 2 < cy < FRONT_Y + DEPTH + 6:
        removed.append(ob.name); bpy.data.objects.remove(ob, do_unlink=True)
for n in [o.name for o in bpy.data.objects if o.name.startswith(("SHOP_", "STORE_marker", "SIGN_"))]:
    bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)

C = get_coll("HeroRow")
M_BRICK = pbr("brick_red", "red_brick_03", 0.5)
M_ROOF = pbr("roof_concrete", "rough_concrete", 0.25, tint=(0.55, 0.55, 0.58))
M_WALK = pbr("sidewalk", "concrete_pavement", 0.4)
M_CAP = flat("parapet_cap", (0.32, 0.31, 0.30), 0.6)
M_UNIT = flat("rooftop_unit", (0.62, 0.63, 0.64), 0.35)
M_POLE = flat("sign_pole", (0.08, 0.09, 0.1), 0.4)
M_GREEN = flat("street_sign_green", (0.02, 0.28, 0.12), 0.3)
M_WHITE = flat("street_sign_white", (0.95, 0.95, 0.95), 0.3)

def add_quad(bm, uvl, pts, uvs):
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    for loop, uv in zip(f.loops, uvs): loop[uvl].uv = uv
    return f

for shop in W["shops"]:
    L = LAYOUT[shop["name"]]
    w = shop["width"]; H = w * FAC_ASPECT
    x0, x1 = shop["x"] - w / 2, shop["x"] + w / 2
    z0 = min(ground(x0, FRONT_Y), ground(x1, FRONT_Y))   # step the row down Auburn's slope
    zt = z0 + H
    U = lambda x: (x - x0) / w                             # facade projection: world → image uv
    V = lambda z: (z - z0) / H

    # body: front uses the facade (mat 0), everything else is brick (mat 1); roof is its own object
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new()
    yb = FRONT_Y + DEPTH
    front = add_quad(bm, uvl, [(x0, FRONT_Y, z0), (x1, FRONT_Y, z0), (x1, FRONT_Y, zt), (x0, FRONT_Y, zt)], [(0, 0), (1, 0), (1, 1), (0, 1)])
    front.material_index = 0
    for pts in ([(x1, FRONT_Y, z0 - 1), (x1, yb, z0 - 1), (x1, yb, zt), (x1, FRONT_Y, zt)],
                [(x0, yb, z0 - 1), (x0, FRONT_Y, z0 - 1), (x0, FRONT_Y, zt), (x0, yb, zt)],
                [(x1, yb, z0 - 1), (x0, yb, z0 - 1), (x0, yb, zt), (x1, yb, zt)]):
        add_quad(bm, uvl, pts, [(0, 0)] * 4).material_index = 1

    # sign board: a shallow box standing proud of the wall, painted by the same projection
    sv0, sv1 = L["sign"]; zs0, zs1 = zt - sv1 * H, zt - sv0 * H; d = 0.18
    sx0, sx1 = x0 + 0.02 * w, x1 - 0.02 * w
    add_quad(bm, uvl, [(sx0, FRONT_Y - d, zs0), (sx1, FRONT_Y - d, zs0), (sx1, FRONT_Y - d, zs1), (sx0, FRONT_Y - d, zs1)],
             [(U(sx0), V(zs0)), (U(sx1), V(zs0)), (U(sx1), V(zs1)), (U(sx0), V(zs1))])
    for (xa, za), (xb, zb) in (((sx0, zs1), (sx1, zs1)), ((sx1, zs0), (sx0, zs0))):  # top / bottom lips
        add_quad(bm, uvl, [(xa, FRONT_Y - d, za), (xb, FRONT_Y - d, zb), (xb, FRONT_Y, zb), (xa, FRONT_Y, za)],
                 [(U(xa), V(za)), (U(xb), V(zb)), (U(xb), V(zb)), (U(xa), V(za))])

    # awning: sloped fabric (projects 1.4 m) or a flat fascia band (JJ's)
    av0, av1, kind = L["awning"]; za0, za1 = zt - av1 * H, zt - av0 * H
    reach = 1.4 if kind == "slope" else 0.35
    ax0, ax1 = x0 + 0.01 * w, x1 - 0.01 * w
    ytop = FRONT_Y if kind == "slope" else FRONT_Y - reach
    add_quad(bm, uvl, [(ax0, FRONT_Y - reach, za0), (ax1, FRONT_Y - reach, za0), (ax1, ytop, za1), (ax0, ytop, za1)],
             [(U(ax0), V(za0)), (U(ax1), V(za0)), (U(ax1), V(za1)), (U(ax0), V(za1))])
    for xs, flip in ((ax0, False), (ax1, True)):  # end caps
        tri = [(xs, FRONT_Y, za1), (xs, FRONT_Y - reach, za0), (xs, FRONT_Y, za0)] if kind == "slope" else \
              [(xs, FRONT_Y, za1), (xs, FRONT_Y - reach, za1), (xs, FRONT_Y - reach, za0), (xs, FRONT_Y, za0)]
        f = bm.faces.new([bm.verts.new(p) for p in (tri[::-1] if flip else tri)])
        for loop in f.loops: loop[uvl].uv = (U(xs), V(za0 + 0.05))
    add_quad(bm, uvl, [(ax0, FRONT_Y, za0), (ax1, FRONT_Y, za0), (ax1, FRONT_Y - reach, za0), (ax0, FRONT_Y - reach, za0)],
             [(U(ax0), V(za0))] * 4)  # underside
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    bm.normal_update(); box_uv(bm, only_mat=1)
    ob = finish(bm, "HERO_" + shop["name"], C, [facade_mat(L["img"]), M_BRICK])
    ob["shop"] = shop["name"]

    # roof deck, parapet cap and rooftop units: this is what the overhead camera sees most
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(w - 0.6, DEPTH - 0.6, 0.1), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(shop["x"], FRONT_Y + DEPTH / 2, zt - 0.55), verts=bm.verts)
    bm.normal_update(); box_uv(bm)
    finish(bm, "ROOF_" + shop["name"], C, [M_ROOF])
    bm = bmesh.new()
    for cx, cy, sx, sy in ((shop["x"], FRONT_Y + 0.15, w, 0.3), (shop["x"], yb - 0.15, w, 0.3),
                           (x0 + 0.15, FRONT_Y + DEPTH / 2, 0.3, DEPTH), (x1 - 0.15, FRONT_Y + DEPTH / 2, 0.3, DEPTH)):
        r = bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=(sx, sy, 0.18), verts=r["verts"])
        bmesh.ops.translate(bm, vec=(cx, cy, zt + 0.09), verts=r["verts"])
    finish(bm, "PARAPET_" + shop["name"], C, [M_CAP])
    bm = bmesh.new()
    for k in range(L["roof_units"]):
        r = bmesh.ops.create_cube(bm, size=1)
        ux = shop["x"] + (k - (L["roof_units"] - 1) / 2) * 3.6
        bmesh.ops.scale(bm, vec=(2.2, 1.6, 1.1), verts=r["verts"])
        bmesh.ops.translate(bm, vec=(ux, FRONT_Y + DEPTH * (0.55 + 0.12 * (k % 2)), zt - 0.5 + 0.55), verts=r["verts"])
    finish(bm, "RTU_" + shop["name"], C, [M_UNIT])

# ---------- sidewalk with a proper curb ----------
bm = bmesh.new()
r = bmesh.ops.create_cube(bm, size=1)
sw_x0, sw_x1 = x_min - 3, SIGN_X + 1.5
zc = ground((sw_x0 + sw_x1) / 2, (CURB_Y + FRONT_Y) / 2)
bmesh.ops.scale(bm, vec=(sw_x1 - sw_x0, FRONT_Y - CURB_Y + 0.2, 0.6), verts=r["verts"])
bmesh.ops.translate(bm, vec=((sw_x0 + sw_x1) / 2, (CURB_Y + FRONT_Y) / 2, zc - 0.15), verts=r["verts"])
bm.normal_update(); box_uv(bm)
finish(bm, "SIDEWALK_hero", C, [M_WALK])

# ---------- the Auburn Ave / Hilliard St corner sign (kept from the intro) ----------
sx, sy = SIGN_X, CURB_Y + 0.6
zg = ground(sx, sy) + 0.15
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.05, radius2=0.05, depth=3.6)
bmesh.ops.translate(bm, vec=(sx, sy, zg + 1.8), verts=bm.verts)
finish(bm, "SIGN_pole", C, [M_POLE])

def blade(text, z, along_x):
    bm = bmesh.new(); r = bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(1.1, 0.03, 0.22) if along_x else (0.03, 1.1, 0.22), verts=r["verts"])
    bmesh.ops.translate(bm, vec=(sx, sy, z), verts=r["verts"])
    finish(bm, f"SIGN_{text.replace(' ', '_')}", C, [M_GREEN])
    for side in (1, -1):  # readable from both faces
        cu = bpy.data.curves.new(f"txt_{text}_{side}", "FONT"); cu.body = text
        cu.size, cu.align_x, cu.align_y, cu.extrude = 0.13, "CENTER", "CENTER", 0.002
        t = bpy.data.objects.new(f"SIGNTXT_{text.replace(' ', '_')}_{side}", cu); C.objects.link(t)
        t.data.materials.append(M_WHITE)
        if along_x:
            t.location = (sx, sy - 0.02 * side, z); t.rotation_euler = (math.radians(90), 0, 0 if side == 1 else math.pi)
        else:
            t.location = (sx + 0.02 * side, sy, z); t.rotation_euler = (math.radians(90), 0, math.radians(90) if side == 1 else -math.radians(90))
blade(W["cornerSign"]["text"][1], zg + 3.1, along_x=True)    # AUBURN AVE runs along the row
blade(W["cornerSign"]["text"][0], zg + 3.38, along_x=False)  # the cross street runs across it

root = bpy.data.objects.new("HeroRow_root", None); C.objects.link(root)
root.rotation_euler = (0, 0, ROT)
for ob in C.objects:
    if ob is not root:
        ob.parent = root

bpy.ops.wm.save_mainfile()
print(f"hero row: {len(W['shops'])} shops, removed {len(removed)} OSM lots: {removed}")
