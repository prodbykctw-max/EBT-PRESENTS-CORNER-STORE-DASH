"""Option B: KhronosGroup glTF-Sample-Assets CarConcept (CC-BY 4.0) -> cars/b.cars  (python3 build_b.py [out])
Licence plate (it carries the Khronos logos) is dropped; blank plates are added."""
import os, sys, re, numpy as np, time, math
import bpy, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *
from bpyutil import *
SRC = os.environ.get('CARCONCEPT_GLB', 'CarConcept.glb')   # curl -O https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb

MAT = {  # material -> (part, colour)
 'Paint 1 Carmine': (1, (255, 255, 255)), 'Paint 2 Carmine': (7, 0x101012), 'Brake': (7, 0xa01818), 'Brakelight': (5, 0xb01016),
 'Dashboard': (8, 0x151517), 'Disc': (6, 0x606468), 'Floormat': (8, 0x151516), 'Glass': (2, 0x070a0d), 'Hardware': (6, 0x7a7e82),
 'Headlight': (4, 0xf2efe6), 'Interior 1': (8, 0x1c1c1e), 'Interior 2': (8, 0x1c1c1e), 'Interior 3 Carmine': (8, 0x6b0b08),
 'Material_2': (8, 0x121214), 'Mechanical': (8, 0x2a2b2e), 'Mirror': (6, 0xc8ccd0), 'Panel Sides': (8, 0x161618), 'Rim1': (8, 0x1b1b1d),
 'Rim2': (6, 0xd2d6da), 'Signallight': (9, 0xffa030), 'Tireside': (3, 0x161616), 'Tiretread': (3, 0x111111),
}
def OUT(n): return os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'public', 'drive', 'cars', n + '.cars')

def ratio_for(name, lod):
    if name.startswith('Wheel') and 'Rim' in name: r = 0.06
    elif name.startswith('Wheel'): r = 0.10
    elif name == 'BodyWindshieldWipers': r = 0.01
    elif name.startswith('Interior'): r = 0.07
    elif name.startswith('Body') and 'Gasket' not in name and 'Handle' not in name and 'light' not in name.lower(): r = 0.14
    elif name.startswith('Mesh_'): r = 0.8
    else: r = 0.6
    return r * {0: 1.0, 1: 0.11, 2: 0.022}[lod]
def drop(name, mat, lod):
    if name == 'License Plate': return True
    if lod >= 1 and (name.startswith('Interior') or name in ('Engine', 'Axles') or name.startswith('BodyHoodInterior') or name == 'BodyHoodUnder' or name.startswith('BodyDoor') and 'Handle' in name): return True
    if lod == 2 and (name.startswith('WheelFront') and ('BrakePad' in name or 'BrakeDisc' in name) or 'BrakePad' in name or 'BrakeDisc' in name or 'Wipers' in name or 'Gasket' in name or 'Mirror' in name and 'Color' not in name): return True
    return False
CREASE = {0: 40, 1: 48, 2: 58}

def mapB(V):   # Blender (x, y fwd=-, z up) -> game (x, y up, z back), wheelbase centre at origin
    return np.stack([-V[:, 0], V[:, 2], V[:, 1] + 0.09], 1)

def main():
    t0 = time.time(); objs = import_glb(SRC)
    lods = {}
    for lod in (0, 1, 2):
        parts = []
        for o in objs:
            if o.name == 'License Plate': continue
            for mi, slot in enumerate(o.data.materials):
                mat = slot.name if slot else 'Material_2'
                if drop(o.name, mat, lod): continue
                part, colr = MAT.get(mat, (8, 0x161618))
                tag = 0
                if mat == 'Glass': tag = 1 if lod == 0 else 0
                # bmesh of just this material's faces, world space
                t = bmesh.new(); t.from_mesh(o.data); t.transform(o.matrix_world)
                t.faces.ensure_lookup_table()
                bmesh.ops.delete(t, geom=[f for f in t.faces if f.material_index != mi], context='FACES')
                if not len(t.faces): t.free(); continue
                bmesh.ops.triangulate(t, faces=t.faces[:]); bmesh.ops.remove_doubles(t, verts=t.verts[:], dist=1e-5)
                V, F = decimate_bm(t, min(1.0, ratio_for(o.name, lod) * (0.6 if mat == 'Glass' else 1.0) if mat != 'Glass' else 0.3 if lod == 0 else 0.1 if lod == 1 else 0.03)); t.free()
                if len(F) == 0: continue
                NV, NF, NN = crease_mesh(mapB(V), F, CREASE[lod])
                m = Mesh(NV, NF, NN); m.with_attrs(colr, part, tag); parts.append(m)
        lods[lod] = merge(parts)
        print('L%d' % lod, len(lods[lod].F), 'faces', round(time.time() - t0, 1))
    return lods

def sub(m, mask): return Mesh(m.V, m.F[mask], m.N, m.C[mask], m.P[mask], m.T[mask], m.AO)

def finish(lods, outp):
    from build_c import lightbar, sensor
    meshes = {}
    occ = sub(lods[0], (lods[0].T != 1) & (lods[0].P != 2))
    for lod in (0, 1, 2):
        m = lods[lod]
        plates = [box(0, 0.33, 2.0 - 0.08 + 0.0, 0.34, 0.16, 0.012, 0xdedfe0, 0)]
        m = merge([m] + plates) if lod < 2 else m
        m = bake_ao(m, occ, n_rays=12 if lod == 0 else 8, dist=1.2)
        if lod == 0: meshes['car.L0'] = sub(m, m.T != 1); meshes['car.L0g'] = sub(m, m.T == 1)
        else: meshes['car.L%d' % lod] = m
    roof_y = 1.15
    for lod in (0, 1, 2):
        meshes['police.L%d' % lod] = to_game(merge([lightbar(roof_y, -0.0)]))
        meshes['sensor.L%d' % lod] = to_game(merge([sensor(roof_y, 0.0, lod)]))
    sc = {'sedan': [0.80, 0.88, 1.0], 'suv': [0.88, 1.20, 1.09], 'police': [0.86, 1.12, 1.135], 'robotaxi': [0.88, 1.25, 1.08]}
    roles = {'sedan': {'body': 'car', 'addons': [], 'scale': sc['sedan']}, 'suv': {'body': 'car', 'addons': [], 'scale': sc['suv']},
             'police': {'body': 'car', 'addons': ['police'], 'scale': sc['police'], 'livery': 'police'},
             'robotaxi': {'body': 'car', 'addons': ['sensor'], 'scale': sc['robotaxi'], 'livery': 'robotaxi'}}
    vehicle = {r: [1.4 * v['scale'][2], 0.95 * v['scale'][0]] for r, v in roles.items()}
    raw, gz = write_cars(outp, meshes, roles, {'vehicle': vehicle, 'lod': [20, 56], 'name': 'B: Khronos CarConcept (CC-BY 4.0)', 'doubleL0': True})
    print('written', outp, raw, gz, {k: len(v.F) for k, v in meshes.items()})

if __name__ == '__main__':
    lods = main(); finish(lods, sys.argv[1] if len(sys.argv) > 1 else OUT('b'))
