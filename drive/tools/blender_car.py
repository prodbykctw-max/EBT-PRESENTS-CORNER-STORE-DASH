"""Player car: import the "Crimson Demon X" concept model (user-supplied, dimensioned to the production Challenger
SRT Demon: 5.02 m long, 2.95 m wheelbase, no badges) and make it game-ready for phones.

Source: drive/ref/car/crimson_5m_game.glb (see drive/ref/car/README.md). That file faces -Y with its origin at the
body centre; the game wants the nose toward +Y and the origin on the rear-axle centre (runtime REAR_AXLE = 1.45).
Keeps the FL/FR/RL/RR *_STEER / *_SPIN wheel pivots so the runtime can roll and steer the wheels.
Output: drive/cache/car_raw.glb  (then: node drive/tools/optimize_assets.mjs)
Run: python drive/tools/bl.py drive/tools/blender_car.py
"""
import bpy, math, os

ROOT = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH"
SRC = os.path.join(ROOT, "drive", "ref", "car", "crimson_5m_game.glb")
OUT = os.path.join(ROOT, "drive", "cache", "car_raw.glb")

# collapse-decimation per material family: keep the painted shell's silhouette, thin out what a
# top-down camera at ~20 m can't resolve (glass tessellation, wheel internals, tread grooves)
KEEP = {"01": 0.6, "02": 0.45, "03": 0.35, "04": 0.4, "05": 0.25, "06": 0.4, "07": 0.4}
MIN_TRIS = 400   # small parts (lamps, markers, calipers) stay as authored

coll = bpy.data.collections.get("Car") or bpy.data.collections.new("Car")
if coll.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(coll)
for o in list(coll.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[coll.name]
bpy.ops.import_scene.gltf(filepath=SRC)

objs = list(coll.objects)
root = next(o for o in objs if o.name.startswith("VEHICLE_ROOT") and o.type == "EMPTY")
rear = next(o for o in objs if o.name.startswith("RL_STEER") and o.type == "EMPTY").matrix_world.translation.y
# turn the car round (nose to +Y) and slide it so the rear axle lands on the origin
root.rotation_mode = "XYZ"
root.rotation_euler = (0, 0, math.pi)
root.location = (0, rear, 0)

dg = bpy.context.evaluated_depsgraph_get()
before = after = 0
for o in objs:
    if o.type != "MESH": continue
    n = len(o.evaluated_get(dg).data.loop_triangles); before += n
    fam = (o.data.materials[0].name[:2] if o.data.materials else "")
    if n >= MIN_TRIS and fam in KEEP:
        m = o.modifiers.new("decimate", "DECIMATE"); m.ratio = KEEP[fam]; m.use_collapse_triangulate = True
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
for o in objs:
    if o.type == "MESH": after += len(o.evaluated_get(dg).data.loop_triangles)

bpy.ops.object.select_all(action="DESELECT")
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                          export_materials="EXPORT", export_cameras=False, export_lights=False,
                          export_texcoords=False)   # solid-colour PBR materials: UVs are dead weight
bpy.ops.wm.save_mainfile()
xs = [o.matrix_world @ v.co for o in objs if o.type == "MESH" for v in o.data.vertices]
r = lambda a: round(a, 3)
print("car tris", before, "->", after, "| rear axle was y", r(rear),
      "| bounds y", r(min(v.y for v in xs)), r(max(v.y for v in xs)), "x", r(min(v.x for v in xs)), r(max(v.x for v in xs)),
      "z", r(min(v.z for v in xs)), r(max(v.z for v in xs)))
