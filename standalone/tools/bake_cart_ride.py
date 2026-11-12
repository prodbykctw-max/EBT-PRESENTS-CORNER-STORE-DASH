"""Render the ending's art: the player character sitting in a shopping cart, arms up (victory).

  portrait: 3 frames (arms in a V / arms in and the body up / arms wide) from a front 3/4 view  -> portrait_0..2.png
  side:     4 frames of the side view with the wheels turning a quarter of their cross each     -> side_0..3.png
Then run compose_cart_ride.py on the output folder (it crops, packs and writes standalone/cartp.b64 / carts.b64).

Same look as the store sprites (bake_characters.py): EEVEE, Standard view transform, the same world light and two suns,
transparent background, no outline. The character is public/drive/character.glb (the Tripo model the store sprites were
baked from; that bake's own .glb lives only on the owner's laptop), posed on its rig by aiming each bone along a world
direction (aim()): thighs forward and up with the knees bent so the shoes poke out over the front rim, arms raised.
The cart is "Shopping Cart" by AdrianXY (CC BY 4.0, https://sketchfab.com/3d-models/shopping-cart-b96f896453b240ae804d0399f1faf027),
the .blend kept at standalone/tools/cart_src/source/COMP_Einkaufswagen.blend (10 MB, not in git: git-ignored locally;
download it from Sketchfab again if it is missing). Changes to the cart: scaled x4.7 to the character's size, chrome/silver
made non-metal steel (flat light made metal vanish), the 4 tyre+rim pieces split out so they can turn, the caster's thin side
plates hidden so the turning wheel shows, and a dark cross on each wheel face so the turn reads at small size.
Run: OUTDIR=<folder> P='{"knee_up":0.7,"calf_z":0.25,"seat":[0,-0.02,0.41]}' python3 standalone/tools/bake_cart_ride.py -- frames x
(`bpy` as a Python module; or in Blender: blender -b --python ... -- frames x). Modes: frames (both), portonly, sideonly, portrait <tag>, side <tag>.
"""
import bpy, math, mathutils, sys, os, json
V=mathutils.Vector
ARGS=sys.argv[sys.argv.index('--')+1:]
OUTDIR=os.environ.get("OUTDIR",".")
P=json.loads(os.environ.get("P","{}"))
REPO=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CART=os.path.join(REPO,"standalone","tools","cart_src","source","COMP_Einkaufswagen.blend")
CHAR=os.path.join(REPO,"public","drive","character.glb")
S=P.get("S",4.7)                    # cart scale
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene
sc.render.engine="BLENDER_EEVEE"; sc.render.film_transparent=True
sc.view_settings.view_transform="Standard"
w=bpy.data.worlds.new("w"); sc.world=w; w.use_nodes=True
w.node_tree.nodes["Background"].inputs["Color"].default_value=(0.9,0.9,0.95,1)
w.node_tree.nodes["Background"].inputs["Strength"].default_value=0.9
for rot,e in (((50,0,-30),3.2),((60,0,150),1.2)):
    L=bpy.data.objects.new("sun",bpy.data.lights.new("sun","SUN")); L.data.energy=e
    L.rotation_euler=[math.radians(a) for a in rot]; sc.collection.objects.link(L)
cam=bpy.data.objects.new("cam",bpy.data.cameras.new("cam")); cam.data.type="ORTHO"; sc.collection.objects.link(cam); sc.camera=cam

# ---- cart
bpy.ops.wm.append(filepath=CART+"/Object/Einkaufswagen",directory=CART+"/Object/",filename="Einkaufswagen")
cart=bpy.data.objects["Einkaufswagen"]
cart.scale=(S,S,S)
# wheels: split the 4 tyre+rim pieces (74 verts) so they can spin about X
bpy.context.view_layer.objects.active=cart; cart.select_set(True)
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT"); bpy.ops.mesh.separate(type="LOOSE"); bpy.ops.object.mode_set(mode="OBJECT")
wheels=[]
for o in list(bpy.data.objects):
    if o.type=="MESH" and o.name.startswith("Einkaufswagen") and len(o.data.vertices)==74:
        c=sum((V(v.co) for v in o.data.vertices),V())/74
        bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active=o
        sc.cursor.location=o.matrix_world@c; bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        o.rotation_mode="XYZ"; wheels.append(o)
print("wheels",len(wheels))
# the caster's thin side plates sit against the tyre and would hide the turning wheel: drop them from the render
for o in list(bpy.data.objects):
    if o.type=="MESH" and o.name.startswith("Einkaufswagen") and len(o.data.vertices) in (18,14):
        wc=o.matrix_world@(sum((V(v.co) for v in o.data.vertices),V())/len(o.data.vertices))
        if min((wc-w.matrix_world.translation).length for w in wheels)<0.06: o.hide_render=True
mk=bpy.data.materials.new("spoke"); mk.diffuse_color=(0.08,0.08,0.1,1); mk.use_nodes=True; mk.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value=(0.08,0.08,0.1,1)
for wh in wheels:
    cw=wh.matrix_world.translation.copy()
    for sx in (1,-1):
        for rz in (0,90):
            bpy.ops.mesh.primitive_cube_add(size=1,location=(cw.x+sx*0.0135,cw.y,cw.z))
            c=bpy.context.object; c.scale=(0.003,0.062,0.009); c.rotation_euler=(math.radians(rz),0,0)
            c.data.materials.append(mk); c.parent=wh; c.matrix_parent_inverse=wh.matrix_world.inverted()
# material look: chrome -> bright steel that reads on the pink card (non-metal so the flat world lights it)
for m in bpy.data.materials:
    if not m.use_nodes: continue
    b=m.node_tree.nodes.get("Principled BSDF")
    if b and m.name.startswith(("Chrome","Silver")):
        b.inputs["Metallic"].default_value=0.0; b.inputs["Roughness"].default_value=0.35
        b.inputs["Base Color"].default_value=(0.72,0.75,0.8,1)
# ---- character
bpy.ops.import_scene.gltf(filepath=CHAR)
arm=next(o for o in bpy.data.objects if o.type=="ARMATURE")
for o in bpy.data.objects:
    if o.type=="MESH" and o.name=="Icosphere": o.hide_render=True
arm.animation_data_clear()
pb=arm.pose.bones
for b in pb: b.rotation_mode="QUATERNION"; b.rotation_quaternion=(1,0,0,0); b.location=(0,0,0)
bpy.context.view_layer.update()
REST={b.name:(b.bone.matrix_local.copy()) for b in pb}
def head(n): return arm.matrix_world@pb[n].head
def tail(n): return arm.matrix_world@pb[n].tail
def aim(name,dirw,roll=None):
    """rotate pose bone so its head->tail points along world dir `dirw` (parents already posed)"""
    b=pb[name]; bpy.context.view_layer.update()
    cur=(tail(name)-head(name)).normalized(); d=V(dirw).normalized()
    q=cur.rotation_difference(d)
    m=b.matrix.copy(); loc=m.translation.copy()
    m3=q.to_matrix().to_4x4()@ (m.to_3x3().to_4x4())
    m3.translation=loc
    b.matrix=m3; bpy.context.view_layer.update()
def pose(spec):
    for n,d in spec: aim(n,d)

def build(frame):
    """frame: dict of angles for the arm pump + hip height"""
    for b in pb: b.rotation_quaternion=(1,0,0,0); b.location=(0,0,0)
    bpy.context.view_layer.update()
    pump=frame.get("pump",0.0)   # -1..1
    lean=frame.get("lean",0.0)
    # torso: slight lean back (chest out)
    sp=[("Spine01",(0,math.sin(math.radians(-lean)),1)),]
    # legs: thighs forward (-Y) and slightly up, splayed; calves hang down a bit
    kn=P.get("knee_up",0.25)
    for s,sx in (("L",1),("R",-1)):
        aim(s+"_Thigh",(0.18*sx,-1,kn))
        aim(s+"_Calf",(0.05*sx,-1,P.get("calf_z",-1.0)))
        aim(s+"_Foot",(0.0,-1,-0.25))
    for s,sx in (("L",1),("R",-1)):
        up=0.55+0.25*pump*(1 if s=="L" else -1)*0+0.0
        aim(s+"_Clavicle",(sx,0,0.25))
        ua=(sx*frame.get("arm_out",P.get("arm_out",0.55)), P.get("arm_fwd",-0.05), 1.0)
        aim(s+"_Upperarm",ua)
        sw=(1 if (s=="L") else -1)
        fa=(sx*frame.get("fore_out",P.get("fore_out",0.18)), P.get("fore_fwd",-0.25), 1.0)
        aim(s+"_Forearm",fa)
        aim(s+"_Hand",(sx*0.1,-0.2,1.0))
    bpy.context.view_layer.update()

def place_character(dx=0,dy=0,dz=0):
    """put the hips (thigh heads) into the basket"""
    hip=(head("L_Thigh")+head("R_Thigh"))/2
    # target: centre of basket floor, a little back of centre
    cb=P.get("seat",(0.0,0.02*S,0.0675*S+0.095))
    arm.location+=V((cb[0],cb[1],cb[2]))-hip
    arm.location+=V((dx,dy,dz))
    bpy.context.view_layer.update()

def allmeshes(): return [o for o in bpy.data.objects if o.type=="MESH" and not o.hide_render]
def bbox():
    dg=bpy.context.evaluated_depsgraph_get(); lo=V((1e9,)*3); hi=V((-1e9,)*3)
    for m in allmeshes():
        ev=m.evaluated_get(dg)
        for c in ev.bound_box:
            p=ev.matrix_world@V(c); lo=V(map(min,lo,p)); hi=V(map(max,hi,p))
    return lo,hi
def shoot(path,yaw,elev,res,scale=None,center=None):
    sc.render.resolution_x,sc.render.resolution_y=res
    lo,hi=bbox(); c=center or (lo+hi)/2
    d=V((math.sin(math.radians(yaw))*math.cos(math.radians(elev)),-math.cos(math.radians(yaw))*math.cos(math.radians(elev)),math.sin(math.radians(elev))))
    cam.location=c+d*30
    cam.rotation_euler=(math.pi/2-math.radians(elev),0,math.radians(yaw))
    cam.data.ortho_scale=scale or (max(hi.z-lo.z,hi.x-lo.x)*1.1 if yaw<45 else max(hi.y-lo.y,(hi.z-lo.z)*res[0]/res[1])*1.1)
    sc.render.filepath=path; bpy.ops.render.render(write_still=True)

mode=ARGS[0]
tag=ARGS[1]
if mode=="portrait":
    build({"pump":0}); place_character()
    shoot(f"{OUTDIR}/cart_portrait_{tag}.png",P.get("yaw",22),P.get("elev",14),(640,640),P.get("scale"))
elif mode=="side":
    build({"pump":0}); place_character()
    shoot(f"{OUTDIR}/cart_side_{tag}.png",90,6,(640,480),P.get("sscale"))

elif mode in("frames","sideonly","portonly"):
    # portrait bounce/pump: 3 frames (arms in V / arms straighter up + body bobs up / arms back out, body down)
    PF=[{"arm_out":1.0,"fore_out":0.5,"dz":0.0},{"arm_out":0.55,"fore_out":0.1,"dz":0.03},{"arm_out":1.5,"fore_out":1.0,"dz":-0.01}]
    for i,f in enumerate(PF if mode in("frames","portonly") else []):
        build(f); place_character(0,0,f["dz"])
        shoot(f"{OUTDIR}/portrait_{i}.png",P.get("yaw",22),P.get("elev",14),(768,768),1.55,V((0,0,0.6)))
    # side strip: wheels turn 4 steps (a quarter of the 4-spoke pattern is invisible, so step 0/20/40/60 deg) + tiny seat bob
    build(PF[0]); place_character()
    for i in range(4 if mode!="portonly" else 0):
        for wh in wheels: wh.rotation_euler.x=math.radians(-i*22.5*(4/4))
        shoot(f"{OUTDIR}/side_{i}.png",90,6,(640,640),1.2,V((0,-0.04,0.55)))
