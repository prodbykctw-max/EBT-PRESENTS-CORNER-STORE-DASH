# python3 -I tools-store3d/items/retouch_pantry.py <long_life_food dir (Poly Haven 1k glTF)> <out dir>
# Poly Haven's "Long Life Food" (CC0) shares one texture atlas between a milk carton, a can of beans, a can of tomatoes and a tin
# of sardines. The store uses only the milk carton and the beans, so this keeps the parts of the atlas their UVs touch (every other
# texel becomes flat grey: the tomato and sardine labels never ship) and paints out the made-up brand marks: the "Pecina's" ribbon
# and cow badge on the carton's two printed faces the side panel's small print that names it, and the "Pezor's BEST BEANS" starburst on the can (no brand names or logos in the
# game). Writes <out>/pantry_diff.png, pantry_nor.png, pantry_arm.png at 1024 (build_items.mjs resizes them).
import json, struct, sys, os
import numpy as np, cv2
src, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
g = json.load(open(os.path.join(src, 'long_life_food_1k.gltf'))); bin_ = open(os.path.join(src, g['buffers'][0]['uri']), 'rb').read()
def acc(i):
    a = g['accessors'][i]; v = g['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]
    return np.frombuffer(bin_, dtype=dt, count=a['count'] * n, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, n) if n > 1 else np.frombuffer(bin_, dtype=dt, count=a['count'], offset=v.get('byteOffset', 0) + a.get('byteOffset', 0))
S = 1024; mask = np.zeros((S, S), np.uint8)
for node in g['nodes']:
    if node['name'] not in ('long_life_food_milk', 'long_life_food_beans'): continue
    for p in g['meshes'][node['mesh']]['primitives']:
        uv = acc(p['attributes']['TEXCOORD_0']) * S; idx = acc(p['indices']).reshape(-1, 3)
        for t in idx: cv2.fillPoly(mask, [np.round(uv[t]).astype(np.int32)], 255)
mask = cv2.dilate(mask, np.ones((9, 9), np.uint8))
diff = cv2.imread(os.path.join(src, 'textures/long_life_food_diff_1k.jpg'))
# the brand marks, in atlas pixels (x0, y0, x1, y1): read off the 1k diffuse
marks = [(26, 430, 186, 561), (356, 430, 516, 561), (208, 458, 332, 508), (676, 160, 862, 345)]
hole = np.zeros((S, S), np.uint8)
for x0, y0, x1, y1 in marks: hole[y0:y1, x0:x1] = 255
# inpaint all three from their surroundings: the carton's badges sit on plain white paper, the can's starburst on the banner and the
# bean-pattern background (seen from the store's overhead camera at ~25 px, a soft patch reads as part of the print)
for x0, y0, x1, y1 in marks[:3]:   # the carton: plain paper colour (median of the white around the badge), feathered into the print
    ring = diff[y0 - 8:y1 + 8, x0 - 8:x1 + 8].reshape(-1, 3); paper = np.median(ring[ring.astype(int).sum(1) > 600], axis=0)
    a = np.zeros((S, S), np.float32); a[y0:y1, x0:x1] = 1; a = cv2.GaussianBlur(a, (0, 0), 3)[..., None]
    diff = (diff * (1 - a) + paper * a).astype(np.uint8)
x0, y0, x1, y1 = marks[3]; h2 = np.zeros((S, S), np.uint8); h2[y0:y1, x0:x1] = 255
diff = cv2.inpaint(diff, h2, 11, cv2.INPAINT_TELEA)
grey = np.array([128, 128, 128], np.uint8)
diff[mask == 0] = grey; cv2.imwrite(os.path.join(out, 'pantry_diff.png'), diff)
nor = cv2.imread(os.path.join(src, 'textures/long_life_food_nor_gl_1k.jpg')); nor[mask == 0] = (255, 128, 128)   # BGR of a flat normal (128,128,255)
nor[hole > 0] = cv2.GaussianBlur(nor, (0, 0), 6)[hole > 0]
cv2.imwrite(os.path.join(out, 'pantry_nor.png'), nor)
arm = cv2.imread(os.path.join(src, 'textures/long_life_food_arm_1k.jpg')); arm[mask == 0] = (0, 200, 255); cv2.imwrite(os.path.join(out, 'pantry_arm.png'), arm)
print('kept texels', int((mask > 0).sum()), 'of', S * S)
