"""Look-dev render of the streetcar as the game assembles it: cab end + middle + mirrored cab end.
Run after blender_props.py: python drive/tools/bl.py drive/tools/blender_render_tram.py -> drive/blender/tram_3q.png"""
import bpy, math, os
OUT = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH\drive\blender"
sc = bpy.data.scenes.get("TramStudio") or bpy.data.scenes.new("TramStudio")
for o in list(sc.collection.objects): bpy.data.objects.remove(o, do_unlink=True)
end, mid = bpy.data.objects["prop_tram_end"], bpy.data.objects["prop_tram_mid"]
for name, src, y, rz in (("f", end, 7.9, 0), ("m", mid, 0, 0), ("r", end, -7.9, math.pi)):
    o = bpy.data.objects.new("tram_" + name, src.data); o.location = (0, y, 0); o.rotation_euler = (0, 0, rz); sc.collection.objects.link(o)
sc.render.engine = "BLENDER_EEVEE"; sc.render.resolution_x, sc.render.resolution_y = 1400, 700
sc.view_settings.view_transform = "AgX"
w = bpy.data.worlds.get("studio") or bpy.data.worlds.new("studio"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.66, 1); w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
fl = bpy.data.objects.new("floor", bpy.data.meshes.new("floor")); sc.collection.objects.link(fl)
import bmesh; bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40); bm.to_mesh(fl.data); bm.free()
sun = bpy.data.objects.new("s", bpy.data.lights.new("s", "SUN")); sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), 0, math.radians(140)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam)
cam.location, cam.rotation_euler, cam.data.lens = (15, 22, 5.5), (math.radians(80), 0, math.radians(146)), 40
sc.camera = cam; sc.render.filepath = os.path.join(OUT, "tram_3q.png")
bpy.ops.render.render(write_still=True, scene=sc.name)
bpy.data.scenes.remove(sc)
print("ok")
