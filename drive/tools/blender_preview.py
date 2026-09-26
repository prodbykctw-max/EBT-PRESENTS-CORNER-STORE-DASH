"""Fast Workbench preview renders of the open drive scene.
Run: python drive/tools/bl.py drive/tools/blender_preview.py
Writes drive/blender/preview_overview.png and preview_finish.png.
"""
import bpy, math, os

OUT = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH\drive\blender"
s = bpy.context.scene
s.render.engine = "BLENDER_WORKBENCH"
sh = s.display.shading
sh.light, sh.color_type = "STUDIO", "MATERIAL"
sh.show_shadows = sh.show_cavity = True
sh.show_xray = False

def cam(name, loc, rot_deg, lens=None, ortho=None):
    ob = bpy.data.objects.get(name)
    if not ob:
        ob = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        s.collection.objects.link(ob)
    ob.location, ob.rotation_euler = loc, [math.radians(a) for a in rot_deg]
    ob.data.clip_end = 5000
    if ortho:
        ob.data.type, ob.data.ortho_scale = "ORTHO", ortho
    else:
        ob.data.type, ob.data.lens = "PERSP", lens
    return ob

shots = {
    "preview_overview": cam("cam_overview", (-720, 250, 1500), (0, 0, 0), ortho=1900),
    # GTA-style: high, tilted, looking up Auburn Ave toward the store and the Connector underpass
    "preview_finish": cam("cam_gta", (-330, -140, 210), (52, 0, -62), lens=28),
}
for fname, ob in shots.items():
    s.camera = ob
    s.render.filepath = os.path.join(OUT, fname + ".png")
    bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_mainfile()
print("rendered", list(shots))
