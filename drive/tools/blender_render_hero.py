"""Lit EEVEE look-dev renders of the hero row (sun + sky), from the game camera and from street level.
Run: python drive/tools/bl.py drive/tools/blender_render_hero.py
Writes drive/blender/hero_overhead.png and hero_street.png.
"""
import bpy, math, os

OUT = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH\drive\blender"
s = bpy.context.scene
s.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE_NEXT"
s.render.resolution_x, s.render.resolution_y = 1600, 900
s.view_settings.view_transform = "AgX"
s.view_settings.look = "AgX - Medium High Contrast"
s.view_settings.exposure = -0.9

# sky + sun: overcast-ish afternoon to match today's Atlanta weather (80% cloud)
world = s.world or bpy.data.worlds.new("World"); s.world = world
world.use_nodes = True; nt = world.node_tree; nt.nodes.clear()
bg = nt.nodes.new("ShaderNodeBackground"); out = nt.nodes.new("ShaderNodeOutputWorld")
try:
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sun_elevation, sky.sun_rotation = math.radians(38), math.radians(200)
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 0.22
except Exception:
    bg.inputs["Color"].default_value = (0.55, 0.62, 0.72, 1); bg.inputs["Strength"].default_value = 1.0
nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
sun = bpy.data.objects.get("sun")
sun.data.energy, sun.data.angle = 3.0, math.radians(8)   # soft-edged shadows for cloud cover
sun.rotation_euler = (math.radians(52), 0, math.radians(200))

def cam(name, loc, rot_deg, lens):
    ob = bpy.data.objects.get(name) or bpy.data.objects.new(name, bpy.data.cameras.new(name))
    if ob.name not in s.collection.objects: s.collection.objects.link(ob)
    ob.location, ob.rotation_euler = loc, [math.radians(a) for a in rot_deg]
    ob.data.lens, ob.data.clip_end = lens, 4000
    return ob

# The row faces north (world +y); the street is ~12 m north of the store origin.
shots = {
    "hero_overhead": cam("cam_hero_overhead", (6, 62, 58), (44, 0, 180), 30),   # GTA-style game camera
    "hero_street":   cam("cam_hero_street",   (-4, 15.5, 1.7), (90, 0, 180), 20),  # the intro's side view
}
for fname, ob in shots.items():
    s.camera = ob
    s.render.filepath = os.path.join(OUT, fname + ".png")
    bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_mainfile()
print("rendered", list(shots), "engine", s.render.engine)
