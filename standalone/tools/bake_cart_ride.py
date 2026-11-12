"""Render the ending's art: the player character standing behind a shopping cart and pushing it (hands on the handle).

  portrait: 3 frames (a hop / a lean into the push / a lean back, hands on the handle all the time) from a front 3/4 view -> portrait_0..2.png
  side:     8 frames of the side view: he walks behind the cart (legs stepping), wheels turning, hands on the handle -> side_0..7.png
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
Run: OUTDIR=<folder> python3 standalone/tools/bake_cart_ride.py -- frames x
(`bpy` as a Python module; or in Blender: blender -b --python ... -- frames x). Modes: frames (both), portonly, sideonly. The arms are solved by a two-bone IK onto the handle every frame; the legs are posed by aiming thigh / calf bones.
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

body=next(o for o in bpy.data.objects if o.type=="MESH" and o.name.startswith("tripo"))
# The scan joins each hand to the hip pocket (the hand's vertices also follow the thigh twist bones, the pocket's follow the hand),
# so with the arm up on the handle skin stretches into shards. Re-split by weight: a vertex that is mostly forearm/hand follows
# only the arm; one that is mostly body drops its forearm/hand weights.
_vg={g.index:g for g in body.vertex_groups}
_low=lambda n: ("Forearm" in n) or ("Hand" in n)
for v in body.data.vertices:
    gs=[(_vg[x.group],x.weight) for x in v.groups]
    aw=sum(w for g,w in gs if _low(g.name)); tot=sum(w for g,w in gs) or 1.0
    for g,w in gs:
        if (aw/tot>=0.5 and not _low(g.name)) or (aw/tot<0.5 and _low(g.name)): g.remove([v.index])
REST=[v.co.copy() for v in body.data.vertices]
def _top(v):
    return max(((_vg[x.group].name,x.weight) for x in v.groups),key=lambda t:t[1],default=("",0))[0]
ARMV=[_low(_top(v)) for v in body.data.vertices]      # which vertices follow the forearm / hand
frozen=[None]
def freeze():
    """The scan joins each hand to the hip pocket by a few thin triangles; with the arm up on the handle they stretch into skin
    shards. Bake the posed mesh and drop every triangle whose edges stretched to more than 1.7x their rest length, near the hands."""
    import bmesh
    if frozen[0]: bpy.data.objects.remove(frozen[0],do_unlink=True); frozen[0]=None
    bpy.context.view_layer.update(); dg=bpy.context.evaluated_depsgraph_get()
    me=bpy.data.meshes.new_from_object(body.evaluated_get(dg))
    bm=bmesh.new(); bm.from_mesh(me)
    def ln(f,pos): return max((pos(a)-pos(b)).length for a,b in ((f.verts[0],f.verts[1]),(f.verts[1],f.verts[2]),(f.verts[2],f.verts[0])))
    rat=[] if True else sorted(((ln(f,lambda v:v.co),ln(f,lambda v:REST[v.index])) for f in bm.faces),key=lambda t:-t[0]/(t[1]+1e-6))[:6]
    kill=[] if os.environ.get("NOFREEZE") else [f for f in bm.faces if len({ARMV[v.index] for v in f.verts})>1 and ln(f,lambda v:v.co)>1.5*ln(f,lambda v:REST[v.index])+0.006]
    bmesh.ops.delete(bm,geom=kill,context="FACES_ONLY"); bm.to_mesh(me); bm.free()
    ob=bpy.data.objects.new("frozen",me); ob.matrix_world=body.matrix_world.copy(); bpy.context.scene.collection.objects.link(ob)
    body.hide_render=True; frozen[0]=ob
    print("stretched triangles dropped:",len(kill))
def head(n): return arm.matrix_world@pb[n].head
def tail(n): return arm.matrix_world@pb[n].tail
def aim(name,dirw):
    """rotate pose bone so its head->tail points along world dir (parents already posed)"""
    b=pb[name]; bpy.context.view_layer.update()
    cur=(tail(name)-head(name)).normalized(); d=V(dirw).normalized()
    q=cur.rotation_difference(d)
    m=b.matrix.copy(); loc=m.translation.copy()
    m3=q.to_matrix().to_4x4()@(m.to_3x3().to_4x4()); m3.translation=loc
    b.matrix=m3; bpy.context.view_layer.update()
L1=(head("L_Upperarm")-tail("L_Upperarm")).length; L2=(head("L_Forearm")-tail("L_Forearm")).length   # measured at rest
# the handle (cart-local grip bar: x +-0.0376, y 0.038..0.058, z 0.124..0.135), in world
GRIP_Y=0.048*S; GRIP_Z=0.1295*S; GRIP_X=P.get("grip_x",0.125)
def arm_ik(side,sx):
    """shoulder -> elbow -> wrist on the grip: law of cosines, elbow pushed down and out"""
    aim(side+"_Clavicle",(sx,0,0.15))
    Sh=head(side+"_Upperarm"); T=V((sx*GRIP_X,GRIP_Y+P.get("wrist_back",0.06),GRIP_Z+0.01+frame_dz))
    v=T-Sh; d=min(v.length,L1+L2-0.004); u=v.normalized()
    a=(L1*L1-L2*L2+d*d)/(2*d); h=math.sqrt(max(L1*L1-a*a,0))
    pole=V((sx*0.6,0.0,-1.0)); pole=(pole-u*pole.dot(u)).normalized()
    E=Sh+u*a+pole*h
    aim(side+"_Upperarm",E-Sh); aim(side+"_Forearm",T-E)
    fa=(T-E).normalized(); aim(side+"_Hand",(fa.x,fa.y,fa.z-0.1))      # the fist carries on along the forearm, wrapped a little over the bar
    return T
frame_dz=0.0
def build(f):
    """f: dict: phase (walk 0..1, None = standing), lean (deg), hop (m), tuck (0..1), dy (body y shift)"""
    global frame_dz
    for b in pb: b.rotation_quaternion=(1,0,0,0); b.location=(0,0,0)
    arm.location=(0,0,0); bpy.context.view_layer.update()
    ph=f.get("phase"); lean=math.radians(f.get("lean",8)); hop=f.get("hop",0.0); tuck=f.get("tuck",0.0)
    # torso leans into the push (forward = -Y), head stays up
    ld=(0,-math.sin(lean),math.cos(lean))
    aim("Spine01",ld); aim("Spine02",(0,-math.sin(lean*0.9),math.cos(lean*0.9))); aim("NeckTwist01",(0,-math.sin(lean*0.3),1)); aim("NeckTwist02",(0,0.0,1)); aim("Head",(0,0.12,1))
    # --- legs: a calm walk. Hips stay at one height; each ankle follows a planted-then-swing path and a two-bone IK bends the
    # knee (forward), so the stance foot is flat on the ground, the swing foot lifts a few cm, and nothing crosses or crouches.
    HIP_Z=P.get("hip_z",0.382); STEP=P.get("step",0.07); LIFT=P.get("lift",0.04); ANK=P.get("ank",0.02)
    arm.location.z=HIP_Z-0.42; bpy.context.view_layer.update()
    sh=(head("L_Upperarm")+head("R_Upperarm"))/2
    arm.location.y+=GRIP_Y+P.get("reach",0.31)+f.get("dy",0.0)-sh.y
    arm.location.z+=hop; bpy.context.view_layer.update()
    for s_,sx,off in (("L",1,0.0),("R",-1,0.5)):
        Hp=head(s_+"_Thigh"); l1=(head(s_+"_Thigh")-tail(s_+"_Thigh")).length; l2=(head(s_+"_Calf")-tail(s_+"_Calf")).length
        if ph is None:
            fwd=0.035*sx; lift=0.0                       # standing: one foot a touch ahead of the other
        else:
            p=(ph+off)%1.0
            if p<0.6: fwd=STEP-2*STEP*(p/0.6); lift=0.0           # stance: the foot is planted and slides back under the body
            else:
                q=(p-0.6)/0.4; fwd=-STEP+2*STEP*(0.5-0.5*math.cos(math.pi*q)); lift=LIFT*math.sin(math.pi*q)   # swing: forward, a small lift
        A=V((Hp.x,Hp.y-fwd,ANK+lift+hop*0.85*(0 if tuck==0 else 1)+tuck*0.10))
        if tuck: A.y+=0.05
        v=A-Hp; d=min(v.length,l1+l2-0.003); u=v.normalized()
        aa=(l1*l1-l2*l2+d*d)/(2*d); hh=math.sqrt(max(l1*l1-aa*aa,0))
        pole=V((0.08*sx,-1.0,0.0)); pole=(pole-u*pole.dot(u)).normalized()
        K=Hp+u*aa+pole*hh
        aim(s_+"_Thigh",K-Hp); aim(s_+"_Calf",A-K)
        pitch=-0.05-(0.9*lift/LIFT*0.25 if lift else 0)      # flat when planted, toe dips a little in the swing
        aim(s_+"_Foot",(0.0,-1.0,pitch))
    frame_dz=0.0
    arm_ik("L",1); arm_ik("R",-1)
def bbox_lo():
    dg=bpy.context.evaluated_depsgraph_get(); lo=1e9
    for m in bpy.data.objects:
        if m.type=="MESH" and m.name!="Icosphere" and not m.name.startswith("Einkaufswagen") and not m.name.startswith("Cube"):
            ev=m.evaluated_get(dg)
            for c in ev.bound_box: lo=min(lo,(ev.matrix_world@V(c)).z)
    return lo

def allmeshes(): return [o for o in bpy.data.objects if o.type=="MESH" and not o.hide_render]
def bbox():
    dg=bpy.context.evaluated_depsgraph_get(); lo=V((1e9,)*3); hi=V((-1e9,)*3)
    for m in allmeshes():
        ev=m.evaluated_get(dg)
        for c in ev.bound_box:
            p=ev.matrix_world@V(c); lo=V(map(min,lo,p)); hi=V(map(max,hi,p))
    return lo,hi
def shoot(path,yaw,elev,res,scale,center):
    freeze()
    sc.render.resolution_x,sc.render.resolution_y=res
    d=V((math.sin(math.radians(yaw))*math.cos(math.radians(elev)),-math.cos(math.radians(yaw))*math.cos(math.radians(elev)),math.sin(math.radians(elev))))
    cam.location=center+d*30
    cam.rotation_euler=(math.pi/2-math.radians(elev),0,math.radians(yaw))
    cam.data.ortho_scale=scale
    sc.render.filepath=path; bpy.ops.render.render(write_still=True)
def spin(deg):
    for wh in wheels: wh.rotation_euler.x=math.radians(deg)      # + about X = rolling toward -Y (forward)

mode=ARGS[0]; os.makedirs(OUTDIR,exist_ok=True)
if mode in ("frames","portonly"):
    PF=[{"lean":10,"hop":0.0},{"lean":4,"hop":0.07,"tuck":0.45},{"lean":-3,"hop":0.0,"dy":0.02}]
    for i,f in enumerate(PF):
        build(f); spin(i*33.75)
        shoot(f"{OUTDIR}/portrait_{i}.png",P.get("yaw",28),P.get("elev",20),(768,768),1.6,V((0,0.1,0.55)))
if mode in ("frames","sideonly"):
    for i in range(8):
        build({"phase":i/8,"lean":10}); spin(i*33.75)
        shoot(f"{OUTDIR}/side_{i}.png",90,5,(768,576),1.6,V((0,0.12,0.5)))
if mode=="contact":     # close looks at the hands on the handle: side, back, from above
    build({"phase":0.2,"lean":10}); spin(0)
    shoot(f"{OUTDIR}/contact_side.png",90,5,(640,640),0.5,V((0,GRIP_Y,GRIP_Z)))
    shoot(f"{OUTDIR}/contact_back.png",180,10,(640,640),0.6,V((0,GRIP_Y,GRIP_Z)))
    shoot(f"{OUTDIR}/contact_top.png",160,60,(640,640),0.6,V((0,GRIP_Y,GRIP_Z)))
if mode=="try":         # one portrait + one side frame, to look at a pose quickly
    build({"lean":10,"hop":0.0}); spin(0)
    shoot(f"{OUTDIR}/try_portrait.png",P.get("yaw",28),P.get("elev",20),(768,768),1.6,V((0,0.1,0.55)))
    build({"phase":0.2,"lean":10}); spin(0)
    shoot(f"{OUTDIR}/try_side.png",90,5,(768,576),1.6,V((0,0.12,0.5)))
