"""Export game-ready glTF from the drive scene:
  drive/cache/hero_raw.glb  the storefront row + corner sign (world space, glTF Y-up)
  (the player car is built by drive/tools/blender_car.py)
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

# player car lives in its own script now: drive/tools/blender_car.py -> drive/cache/car_raw.glb

bpy.ops.wm.save_mainfile()
print("exported", os.listdir(CACHE))
