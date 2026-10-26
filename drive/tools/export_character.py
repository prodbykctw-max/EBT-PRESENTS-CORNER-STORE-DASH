"""Export the store's character as the drive's on-foot model (public/drive/character.glb): you and, recoloured in the
shader (public/drive/people.js), the bully.

Source: the commercial's Blender scene (Kema's ebt_corner_store_scene.blend), which carries the rigged Tripo character
(the same one the store's sprite sheets were baked from, standalone/tools/bake_characters.py) and its walk
(preset:biped:walk, an in-place cycle). The scan is ~1.9M triangles: decimated to 16k for phones; its 4096 px texture
goes in as a 1024 px JPEG. Only the walk is exported; the run is made from it at load time (people.js makeRunClip), on
the sampled clip, so it always matches the rig. The model's own height in the file is MODEL_H (0.982); the game scales it.

Run headless with Blender 5.x (or the bpy module):  blender -b --python drive/tools/export_character.py -- <scene.blend> <out.glb>
"""
import bpy, sys, os
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC = argv[0] if argv else 'ebt_corner_store_scene.blend'
OUT = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'drive', 'character.glb')
bpy.ops.wm.open_mainfile(filepath=SRC)
arm = bpy.data.objects['Armature']
me = next(o for o in bpy.data.objects if o.name.startswith('tripo_node'))
for o in list(bpy.data.objects):
    if o not in (arm, me): bpy.data.objects.remove(o, do_unlink=True)
arm.location = (0, 0, 0); arm.rotation_euler = (0, 0, 0)
dec = me.modifiers.new('dec', 'DECIMATE'); dec.ratio = 16000 / len(me.data.polygons); dec.use_collapse_triangulate = True
me.modifiers.move(len(me.modifiers) - 1, 0)
bpy.context.view_layer.objects.active = me
with bpy.context.temp_override(object=me, active_object=me, selected_objects=[me]):
    bpy.ops.object.modifier_apply(modifier='dec')
img = next(n.image for n in me.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE')
img.scale(1024, 1024); img.file_format = 'JPEG'
walk = bpy.data.actions['preset:biped:walk']; walk.name = 'walk'; walk.use_fake_user = True
ad = arm.animation_data or arm.animation_data_create()
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
ad.action = None
tr = ad.nla_tracks.new(); tr.name = 'walk'; st = tr.strips.new('walk', 1, walk); st.name = 'walk'
bpy.context.scene.render.fps = 24
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_animations=True,
    export_animation_mode='NLA_TRACKS', export_skins=True, export_apply=False, export_image_format='JPEG',
    export_jpeg_quality=82, export_yup=True, export_texcoords=True, export_normals=True, export_force_sampling=True, export_frame_step=1)
print('polys', len(me.data.polygons), 'bytes', os.path.getsize(OUT))
