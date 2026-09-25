"""Blockout of the drive world from drive/cache/world.json.
Run inside Blender:  python drive/tools/bl.py drive/tools/blender_blockout.py
Rebuilds the scene from scratch each run (idempotent), then saves drive/blender/auburn_blockout.blend.
"""
import bpy, bmesh, json, math, os

ROOT = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH\drive"
W = json.load(open(os.path.join(ROOT, "cache", "world.json"), encoding="utf-8"))
BRIDGE_DECK = 7.0  # metres of clearance per OSM layer

bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"

def coll(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or scene.collection).children.link(c)
    return c

def mat(name, rgb, rough=0.8):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m

M = {
    "ground": mat("ground", (0.20, 0.22, 0.18)),
    "bld": mat("building", (0.55, 0.53, 0.50)),
    "bld_est": mat("building_estimated", (0.62, 0.50, 0.42)),
    "sky": mat("skyline", (0.40, 0.44, 0.50)),
    "road": mat("road", (0.07, 0.07, 0.08), 0.6),
    "motorway": mat("motorway", (0.12, 0.11, 0.10), 0.6),
    "route": mat("route", (1.0, 0.08, 0.08), 0.4),
    "store": mat("store_marker", (1.0, 0.8, 0.0), 0.4),
}

def obj_from_bm(bm, name, collection, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob

# ---------- terrain ----------
E = W["elevation"]
c_ground = coll("Terrain")
bm = bmesh.new()
gx, gy = E["gx"], E["gy"]
vs = [bm.verts.new((E["x0"] + i * E["step"], E["y0"] + j * E["step"], E["z"][j * gx + i] - 0.3))
      for j in range(gy) for i in range(gx)]
for j in range(gy - 1):
    for i in range(gx - 1):
        a = j * gx + i
        bm.faces.new((vs[a], vs[a + 1], vs[a + gx + 1], vs[a + gx]))
obj_from_bm(bm, "terrain", c_ground, M["ground"]).data.polygons.foreach_set("use_smooth", [True] * ((gx - 1) * (gy - 1)))

# ---------- buildings (one object each: later passes need per-building facades/LOD) ----------
c_b = coll("Buildings")
c_play, c_sky = coll("Play", c_b), coll("Skyline", c_b)
for b in W["buildings"]:
    pts = b["pts"]
    if len(pts) < 3:
        continue
    area2 = sum(x * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * y for i, (x, y) in enumerate(pts))
    if area2 < 0:
        pts = pts[::-1]  # CCW so extruded normals face out
    bm = bmesh.new()
    z0 = b["base"] + (b.get("minH") or (b["h"] - 0.6 if b.get("canopy") else 0))
    try:
        f = bm.faces.new([bm.verts.new((x, y, z0)) for x, y in pts])
    except ValueError:
        bm.free(); continue
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top, vec=(0, 0, b["base"] + b["h"] - z0))
    bmesh.ops.reverse_faces(bm, faces=[f])
    m = M["sky"] if b["kind"] == "skyline" else M["bld_est"] if b.get("est") else M["bld"]
    ob = obj_from_bm(bm, (b.get("name") or f"bld_{b['id']}")[:60], c_sky if b["kind"] == "skyline" else c_play, m)
    ob["osm_id"], ob["height"], ob["estimated"] = b["id"], b["h"], bool(b.get("est"))

# ---------- roads (ribbons, merged per class) ----------
c_r = coll("Roads")
by_cls = {}
for rd in W["roads"]:
    by_cls.setdefault("motorway" if rd["cls"].startswith(("motorway", "trunk")) else rd["cls"], []).append(rd)
for cls, rds in by_cls.items():
    bm = bmesh.new()
    for rd in rds:
        p, hw = rd["pts"], rd["width"] / 2
        lift = 0.05 + (BRIDGE_DECK * (rd.get("layer") or 1) if rd.get("bridge") else 0) + (0.01 if cls == "motorway" else 0)
        left, right = [], []
        for i, (x, y, z) in enumerate(p):
            ax, ay = p[max(i - 1, 0)][:2]; bx, by = p[min(i + 1, len(p) - 1)][:2]
            dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1
            nx, ny = -dy / L, dx / L
            left.append(bm.verts.new((x + nx * hw, y + ny * hw, z + lift)))
            right.append(bm.verts.new((x - nx * hw, y - ny * hw, z + lift)))
        for i in range(len(p) - 1):
            bm.faces.new((right[i], right[i + 1], left[i + 1], left[i]))
    obj_from_bm(bm, f"roads_{cls}", c_r, M["motorway"] if cls == "motorway" else M["road"])

# ---------- route + store marker ----------
c_g = coll("Gameplay")
cu = bpy.data.curves.new("route", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 1.2
sp = cu.splines.new("POLY"); sp.points.add(len(W["route"]["pts"]) - 1)
for pt, (x, y, z) in zip(sp.points, W["route"]["pts"]):
    pt.co = (x, y, z + 1.0, 1)
cu.materials.append(M["route"])
c_g.objects.link(bpy.data.objects.new("route", cu))
bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
bmesh.ops.scale(bm, vec=(12, 6, 8), verts=bm.verts); bmesh.ops.translate(bm, vec=(0, 0, 4), verts=bm.verts)
obj_from_bm(bm, "STORE_marker", c_g, M["store"])
# hero storefront lots (placeholders until the real storefronts are built) + the Auburn Ave corner sign
for shop in W["shops"]:
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(shop["width"] - 0.4, 14, 7), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(shop["x"], 9, 3.5), verts=bm.verts)
    obj_from_bm(bm, "SHOP_" + shop["name"], c_g, M["store"] if "EBT" in shop["name"] else M["bld_est"])
sx, sy, _ = W["cornerSign"]["pos"]
bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.12, radius2=0.12, depth=4)
bmesh.ops.translate(bm, vec=(sx, sy + 6, 2), verts=bm.verts)
obj_from_bm(bm, "SIGN_Auburn_Ave_Hilliard_St", c_g, M["route"])

# ---------- light + camera (GTA-style overhead) ----------
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 4; sun.rotation_euler = (math.radians(40), math.radians(15), math.radians(-35))
scene.collection.objects.link(sun)
cam = bpy.data.objects.new("cam_overview", bpy.data.cameras.new("cam_overview"))
cam.data.type = "ORTHO"; cam.data.ortho_scale = 1900; cam.data.clip_end = 5000
cam.location = (-720, 250, 1500)
scene.collection.objects.link(cam); scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = 1600, 900

# viewports: solid + material colour, look through camera
for area in bpy.context.screen.areas if bpy.context.screen else []:
    if area.type == "VIEW_3D":
        sp3 = area.spaces[0]
        sp3.shading.type = "SOLID"; sp3.shading.color_type = "MATERIAL"
        sp3.clip_end = 10000
        sp3.region_3d.view_perspective = "CAMERA"

os.makedirs(os.path.join(ROOT, "blender"), exist_ok=True)
path = os.path.join(ROOT, "blender", "auburn_blockout.blend")
bpy.ops.wm.save_as_mainfile(filepath=path)
print(f"saved {path}: {len(c_play.objects)} play, {len(c_sky.objects)} skyline, {len(c_r.objects)} road meshes")
