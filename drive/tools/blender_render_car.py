"""Studio look-dev renders of the player car (own scene, so the city doesn't get in the way).
Run: python drive/tools/bl.py drive/tools/blender_render_car.py  → drive/blender/car_3q.png, car_top.png"""
import bpy, math, os
OUT = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH\drive\blender"
main = bpy.context.window.scene
sc = bpy.data.scenes.get("CarStudio") or bpy.data.scenes.new("CarStudio")
for c in list(sc.collection.children): sc.collection.children.unlink(c)
for o in list(sc.collection.objects): bpy.data.objects.remove(o, do_unlink=True)
sc.collection.children.link(bpy.data.collections["Car"])
sc.render.engine = "BLENDER_EEVEE"; sc.render.resolution_x, sc.render.resolution_y = 1200, 800
sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
w = bpy.data.worlds.get("studio") or bpy.data.worlds.new("studio"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.66, 1); w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
bpy.ops.mesh.primitive_plane_add(size=40); fl = bpy.context.active_object
bpy.context.scene.collection.objects.unlink(fl) if fl.name in bpy.context.scene.collection.objects else None
sc.collection.objects.link(fl); fl.location = (0, 1.5, 0)
sun = bpy.data.objects.new("car_sun", bpy.data.lights.new("car_sun", "SUN")); sun.data.energy = 3.5; sun.data.angle = math.radians(6)
sun.rotation_euler = (math.radians(50), 0, math.radians(140)); sc.collection.objects.link(sun)
def shot(name, loc, rot, lens):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name)); sc.collection.objects.link(cam)
    cam.location, cam.rotation_euler, cam.data.lens = loc, [math.radians(a) for a in rot], lens
    sc.camera = cam; sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True, scene=sc.name)
shot("car_3q", (5.2, 6.6, 2.2), (78, 0, 142), 50)
shot("car_top", (0, 1.5, 16), (0, 0, 0), 40)
bpy.data.scenes.remove(sc)
print("ok")
