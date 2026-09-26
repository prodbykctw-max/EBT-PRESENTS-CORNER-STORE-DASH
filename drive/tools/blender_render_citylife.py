"""Look-dev render of the city-life props (police car, robotaxi, dogs, pigeons, water seller + cooler, panhandler),
with sample tints applied as the runtime would. Run after blender_props.py:
python drive/tools/bl.py drive/tools/blender_render_citylife.py -> drive/blender/citylife.png"""
import bpy, math, os, bmesh
OUT = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH\drive\blender"
sc = bpy.data.scenes.get("LifeStudio") or bpy.data.scenes.new("LifeStudio")
for o in list(sc.collection.objects): bpy.data.objects.remove(o, do_unlink=True)

def tinted(src, rgb):
    """copy of a prop mesh with its pure-white (tintable) vertex colours multiplied, like propMaterial()"""
    me = bpy.data.objects[src].data.copy()
    col = me.color_attributes[0]
    for d in col.data:
        c = d.color
        if min(c[0], c[1], c[2]) > 0.985: d.color = (*rgb, 1)
    return me

layout = [("prop_police", None, (-3.2, 0, 0), 0.5 + math.pi), ("prop_robotaxi", None, (3.2, 0, 0), -0.5 + math.pi),
          ("prop_dog_a", (0.55, 0.38, 0.22), (-1.2, 4.5, 0), 1.2), ("prop_dog_b", (0.12, 0.1, 0.09), (0.2, 5.0, 0), 2.2),
          ("prop_seller", (0.85, 0.15, 0.12), (2.0, 5.2, 0), 2.8), ("prop_cooler", None, (2.9, 5.7, 0), 0.3),
          ("prop_panhandler", (0.25, 0.4, 0.6), (-2.8, 5.4, 0), 3.0),
          ("prop_bird_up", (0.55, 0.57, 0.62), (-0.6, 3.2, 2.2), 1.9), ("prop_bird_down", (0.4, 0.42, 0.48), (0.4, 3.6, 2.5), 2.0)]
for name, tint, loc, rz in layout:
    me = tinted(name, tint) if tint else bpy.data.objects[name].data
    o = bpy.data.objects.new("ld_" + name, me); o.location = loc; o.rotation_euler = (0, 0, rz); sc.collection.objects.link(o)
    if name.startswith("prop_bird"): o.scale = (2.2, 2.2, 2.2)
sc.render.engine = "BLENDER_EEVEE"; sc.render.resolution_x, sc.render.resolution_y = 1400, 800
sc.view_settings.view_transform = "AgX"
w = bpy.data.worlds.get("studio") or bpy.data.worlds.new("studio"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.66, 1); w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
fl = bpy.data.objects.new("floor", bpy.data.meshes.new("floor")); sc.collection.objects.link(fl)
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40); bm.to_mesh(fl.data); bm.free()
sun = bpy.data.objects.new("s", bpy.data.lights.new("s", "SUN")); sun.data.energy = 3.5; sun.rotation_euler = (math.radians(45), 0, math.radians(140)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam)
cam.location, cam.rotation_euler, cam.data.lens = (0, -11, 6.5), (math.radians(66), 0, 0), 32
sc.camera = cam; sc.render.filepath = os.path.join(OUT, "citylife.png")
bpy.ops.render.render(write_still=True, scene=sc.name)
bpy.data.scenes.remove(sc)
print("ok")
