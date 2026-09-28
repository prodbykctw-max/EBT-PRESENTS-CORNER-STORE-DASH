"""Bake the store's two characters into walk-cycle sprite sheets (3 rows: D = front, U = back, R = right side;
the game mirrors R for L) x FRAMES columns, CELL px square, transparent.

  player: the rigged Tripo character (C:/Users/Owner/Downloads/3d world character.glb) and its own baked
          walk animation (preset:biped:walk, 57 frames = one full stride cycle).
  bully:  the rigged bully (corner-store-dash-character/bully/bully_source.glb). It shipped with no walk (a
          single arms-out rest pose), so this script authors one on its rig: arms down at his sides with a
          swing, thighs / knees / feet, hip bob and a little torso counter-twist. Bone axes differ per rig,
          so every rotation axis is found by measurement (which local axis moves the hand down / the foot
          forward) instead of being guessed.

Root motion is cancelled by keeping the camera on the hips, so every cell is a walk in place, feet on the
same baseline. Renders cells at 2x; standalone/tools/compose_sheets.py (system Python + Pillow) downsamples and packs them.

Run (visible, in Blender's UI):  blender --python standalone/tools/bake_characters.py
Outputs: <CHAR_DIR>/renders2/<name>_<row>_<frame>.png
"""
import bpy, math, os, sys, base64, io, mathutils

REPO = r"C:\Users\Owner\Desktop\EBT_PRESENTS_CORNER_STORE_DASH"
CHAR_DIR = r"C:\Users\Owner\Desktop\corner-store-dash-character"
PLAYER_GLB = r"C:\Users\Owner\Downloads\3d world character.glb"
BULLY_GLB = CHAR_DIR + r"\bully\bully_source.glb"
FRAMES, CELL, SS = 8, 96, 2             # columns, output cell px, supersample
ELEV = math.radians(22)                 # camera elevation: matches the board's 3/4 top-down framing
V = mathutils.Vector

def fresh():
    # clear the scene (a factory reset breaks the glTF importer inside the UI session)
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for d in list(coll): coll.remove(d)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = CELL * SS
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.9, 0.9, 0.95, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    for rot, e in (((50, 0, -30), 3.2), ((60, 0, 150), 1.2)):
        L = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); L.data.energy = e
        L.rotation_euler = [math.radians(a) for a in rot]; sc.collection.objects.link(L)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); cam.data.type = "ORTHO"
    sc.collection.objects.link(cam); sc.camera = cam
    return sc, cam

def load(path):
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.name != "Icosphere" and len(o.data.polygons) > 200]
    for o in bpy.data.objects:
        if o.type == "MESH" and o not in meshes: o.hide_render = True
    for m in meshes:
        if len(m.data.polygons) > 150000:        # the Tripo scan is ~1.9M tris: plenty at 96 px after decimation
            d = m.modifiers.new("dec", "DECIMATE"); d.ratio = 120000 / len(m.data.polygons)
    return arm, meshes

def world_bbox(meshes):
    dg = bpy.context.evaluated_depsgraph_get(); lo = V((1e9,) * 3); hi = V((-1e9,) * 3)
    for m in meshes:
        ev = m.evaluated_get(dg)
        for c in ev.bound_box:
            p = ev.matrix_world @ V(c); lo = V(map(min, lo, p)); hi = V(map(max, hi, p))
    return lo, hi

def bone_head(arm, name):
    return arm.matrix_world @ arm.pose.bones[name].head

def bone_tail(arm, name):
    return arm.matrix_world @ arm.pose.bones[name].tail

def facing(arm, meshes):
    """the character's forward (world XY): the 'headfront' marker if the rig has one, else the side the toes point"""
    pb = arm.pose.bones
    if "headfront" in pb and "Head" in pb:
        f = bone_head(arm, "headfront") - bone_head(arm, "Head"); f.z = 0
        if f.length > 1e-4: return f.normalized()
    for toe, foot in (("LeftToeBase", "LeftFoot"), ("L_ToeBase", "L_Foot")):
        if toe in pb:
            f = bone_head(arm, toe) - bone_head(arm, foot); f.z = 0
            if f.length > 1e-4: return f.normalized()
    return V((0, -1, 0))

def rot(pb, axis, deg):
    """rotation about a bone-local axis ('X'/'Y'/'Z'), composed on top of its rest"""
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = mathutils.Quaternion(V({"X": (1, 0, 0), "Y": (0, 1, 0), "Z": (0, 0, 1)}[axis]), math.radians(deg))

def probe(arm, bone, tip, want, deg=30):
    """which local axis and sign moves `tip` (a bone name, its tail) most along world direction `want`"""
    pb = arm.pose.bones[bone]; best = None
    bpy.context.view_layer.update(); p0 = bone_tail(arm, tip)
    for ax in "XYZ":
        for sg in (1, -1):
            rot(pb, ax, sg * deg); bpy.context.view_layer.update()
            gain = (bone_tail(arm, tip) - p0).dot(want)
            if best is None or gain > best[0]: best = (gain, ax, sg)
    pb.rotation_quaternion = (1, 0, 0, 0); bpy.context.view_layer.update()
    return best[1], best[2]

def author_bully_walk(arm, fwd, N=24):
    """a walk cycle on the Mixamo-style rig, N frames per cycle (two steps)"""
    up = V((0, 0, 1)); side = fwd.cross(up)
    ax = {}
    for s in ("Left", "Right"):
        ax[s + "UpLeg"] = probe(arm, s + "UpLeg", s + "Foot", fwd)          # swing the leg forward
        ax[s + "Leg"] = probe(arm, s + "Leg", s + "Foot", -fwd)             # knee bends the shin back
        ax[s + "Arm"] = probe(arm, s + "Arm", s + "Hand", -up)              # lower the arm
    for s in ("Left", "Right"):
        ax[s + "Foot"] = probe(arm, s + "Foot", s + "ToeBase", up, 20)       # toe up
    # arm down first, then find the swing axis from that lowered pose
    drop = {}
    for s in ("Left", "Right"):
        a, sg = ax[s + "Arm"]; pb = arm.pose.bones[s + "Arm"]
        best = (1e9, 0)
        for d in range(20, 95, 5):                                           # lower until the hand is lowest
            rot(pb, a, sg * d); bpy.context.view_layer.update()
            z = bone_tail(arm, s + "Hand").z
            if z < best[0] - 1e-4: best = (z, d)
        drop[s] = best[1] - 6                                                # stop just short: arm hangs, doesn't clip the hip
        rot(pb, a, sg * drop[s]); bpy.context.view_layer.update()
    swing = {s: probe(arm, s + "ForeArm", s + "Hand", fwd, 20) for s in ("Left", "Right")}
    for s in ("Left", "Right"): arm.pose.bones[s + "Arm"].rotation_quaternion = (1, 0, 0, 0)
    print("bully axes", ax, "drop", drop, "swing(forearm)", swing)

    def q(axis, deg): return mathutils.Quaternion(V({"X": (1, 0, 0), "Y": (0, 1, 0), "Z": (0, 0, 1)}[axis]), math.radians(deg))
    act = bpy.data.actions.new("bully_walk"); arm.animation_data_create(); arm.animation_data.action = act
    for f in range(N + 1):
        p = 2 * math.pi * f / N
        for s, ph in (("Left", 0.0), ("Right", math.pi)):
            t = p + ph
            a, sg = ax[s + "UpLeg"]; pb = arm.pose.bones[s + "UpLeg"]; pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q(a, sg * 26 * math.sin(t)); pb.keyframe_insert("rotation_quaternion", frame=f + 1)
            a, sg = ax[s + "Leg"]; pb = arm.pose.bones[s + "Leg"]; pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q(a, sg * (6 + 42 * max(0.0, math.cos(t)) ** 1.5)); pb.keyframe_insert("rotation_quaternion", frame=f + 1)
            a, sg = ax[s + "Foot"]; pb = arm.pose.bones[s + "Foot"]; pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q(a, sg * 12 * math.sin(t + 0.6)); pb.keyframe_insert("rotation_quaternion", frame=f + 1)
            # arm: hangs down, swings opposite its leg; forearm bends a little on the forward swing
            a, sg = ax[s + "Arm"]; pb = arm.pose.bones[s + "Arm"]; pb.rotation_mode = "QUATERNION"
            fa, fs = swing[s]
            pb.rotation_quaternion = q(a, sg * drop[s]) @ q(fa, fs * -22 * math.sin(t)); pb.keyframe_insert("rotation_quaternion", frame=f + 1)
            pb = arm.pose.bones[s + "ForeArm"]; pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q(fa, fs * (14 + 12 * max(0.0, -math.sin(t)))); pb.keyframe_insert("rotation_quaternion", frame=f + 1)
    for fc in act.fcurves:
        for k in fc.keyframe_points: k.interpolation = "LINEAR"
    return act, N

def frame_camera(cam, arm, meshes, frames, dirs_fn):
    """ortho scale from the tallest/widest pose over the cycle, same for every cell"""
    sc = bpy.context.scene; size = 0
    for f in frames:
        sc.frame_set(f)
        lo, hi = world_bbox(meshes); size = max(size, hi.z - lo.z, (hi - lo).length * 0.62)
    cam.data.ortho_scale = size * 1.12
    return size

def bake(name, path, author=None):
    sc, cam = fresh()
    arm, meshes = load(path)
    fwd = facing(arm, meshes)
    if author:
        act, N = author(arm, fwd); start, end = 1, N + 1
    else:
        act = arm.animation_data.action; start, end = int(act.frame_range[0]), int(act.frame_range[1])
    span = end - start
    frames = [start + round(span * k / FRAMES) for k in range(FRAMES)]
    lo, hi = world_bbox(meshes)
    frame_camera(cam, arm, meshes, frames, None)
    hipname = "Hips" if "Hips" in arm.pose.bones else "Hip"
    # face the camera for D: the camera looks along +Y (from -Y); rotate the character so it faces -Y, etc.
    base = math.atan2(fwd.y, fwd.x)
    rows = {"D": -math.pi / 2, "U": math.pi / 2, "R": 0.0}                    # desired world facing angle
    tmp = os.path.join(CHAR_DIR, "renders2"); os.makedirs(tmp, exist_ok=True)
    root = arm
    for ri, (row, ang) in enumerate(rows.items()):
        root.rotation_mode = "XYZ"; root.rotation_euler.z = ang - base
        for ci, f in enumerate(frames):
            sc.frame_set(f); bpy.context.view_layer.update()
            h = arm.matrix_world @ arm.pose.bones[hipname].head
            # walk in place: camera follows the hips across the ground; feet stay on one baseline
            mid = lo.z + (hi.z - lo.z) * 0.5
            cam.location = V((h.x, h.y - 30 * math.cos(ELEV), mid + 30 * math.sin(ELEV)))
            cam.rotation_euler = (math.pi / 2 - ELEV, 0, 0)
            out = os.path.join(tmp, f"{name}_{row}_{ci}.png"); sc.render.filepath = out
            bpy.ops.render.render(write_still=True)
    print("rendered", name)

which = os.environ.get("CSD_BAKE", "player,bully").split(",")
if "bully" in which: bake("bully", BULLY_GLB, author_bully_walk)
if "player" in which: bake("player", PLAYER_GLB)
print("BAKE DONE")
