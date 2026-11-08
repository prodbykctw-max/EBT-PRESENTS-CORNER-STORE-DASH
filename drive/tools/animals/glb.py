"""Minimal glTF 2.0 .glb reader for the animal bake (numpy only): accessors, nodes, skins, animations."""
import json, struct, numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}

class GLB:
    def __init__(self, path):
        d = open(path, 'rb').read()
        magic, ver, ln = struct.unpack('<4sII', d[:12]); assert magic == b'glTF'
        o = 12; self.bin = b''
        while o < ln:
            cl, ct = struct.unpack('<II', d[o:o + 8]); chunk = d[o + 8:o + 8 + cl]; o += 8 + cl
            if ct == 0x4E4F534A: self.j = json.loads(chunk)
            elif ct == 0x004E4942: self.bin = chunk
    def view(self, i):
        v = self.j['bufferViews'][i]; o = v.get('byteOffset', 0); return self.bin[o:o + v['byteLength']], v.get('byteStride')
    def acc(self, i):
        a = self.j['accessors'][i]; n = a['count']; nc = NC[a['type']]; dt = np.dtype(CT[a['componentType']])
        if 'bufferView' in a:
            raw, stride = self.view(a['bufferView']); o = a.get('byteOffset', 0); es = dt.itemsize * nc
            if stride and stride != es:
                out = np.empty((n, nc), dt)
                for k in range(n): out[k] = np.frombuffer(raw, dt, nc, o + k * stride)
            else: out = np.frombuffer(raw, dt, n * nc, o).reshape(n, nc).copy()
        else: out = np.zeros((n, nc), dt)
        if a.get('normalized'):
            out = out.astype(np.float32) / (np.iinfo(dt).max if dt.kind == 'u' else np.iinfo(dt).max)
            if dt.kind == 'i': out = np.maximum(out, -1)
        return out
    def image(self, i):
        im = self.j['images'][i]; raw, _ = self.view(im['bufferView']); return raw, im.get('mimeType')


def quat_to_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def trs(t, q, s):
    m = np.eye(4); m[:3, :3] = quat_to_mat(q) * np.asarray(s)[None, :]; m[:3, 3] = t; return m

def slerp(a, b, t):
    a = np.asarray(a, float); b = np.asarray(b, float); d = a @ b
    if d < 0: b = -b; d = -d
    if d > 0.9995: r = a + t * (b - a); return r / np.linalg.norm(r)
    th = np.arccos(d); return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)

class Rig:
    """node tree + skin + animations of a GLB, posed in numpy"""
    def __init__(self, g):
        self.g = g; j = g.j; self.nodes = j['nodes']; n = len(self.nodes)
        self.parent = [-1] * n
        for i, nd in enumerate(self.nodes):
            for c in nd.get('children', []): self.parent[c] = i
        self.skin = j['skins'][0]; self.joints = self.skin['joints']
        self.ibm = g.acc(self.skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1) if 'inverseBindMatrices' in self.skin else None
        self.anims = {}
        for a in j['animations']:
            ch = {}
            for c in a['channels']:
                s = a['samplers'][c['sampler']]; tg = c['target']
                ch[(tg['node'], tg['path'])] = (g.acc(s['input'])[:, 0], g.acc(s['output']), s.get('interpolation', 'LINEAR'))
            self.anims[a['name']] = ch
    def local(self, i):
        nd = self.nodes[i]
        if 'matrix' in nd: return np.array(nd['matrix']).reshape(4, 4).T
        return trs(nd.get('translation', [0, 0, 0]), nd.get('rotation', [0, 0, 0, 1]), nd.get('scale', [1, 1, 1]))
    def sample(self, ch, node, path, t, default):
        if (node, path) not in ch: return default
        ts, vs, interp = ch[(node, path)]
        if interp == 'CUBICSPLINE': vs = vs[1::3]
        if t <= ts[0]: return vs[0]
        if t >= ts[-1]: return vs[-1]
        k = int(np.searchsorted(ts, t) - 1); f = (t - ts[k]) / (ts[k + 1] - ts[k])
        if interp == 'STEP': return vs[k]
        return slerp(vs[k], vs[k + 1], f) if path == 'rotation' else vs[k] + (vs[k + 1] - vs[k]) * f
    def pose(self, name, t, override=None, tshift=None, qhook=None):
        """world matrices of every node at time t of clip `name` (override: {node: (t,q,s)} replaces the sampled local TRS)"""
        ch = self.anims.get(name, {}) if name else {}
        n = len(self.nodes); W = [None] * n
        def world(i):
            if W[i] is not None: return W[i]
            nd = self.nodes[i]
            if ch and any(k[0] == i for k in ch) and 'matrix' not in nd:
                ti = t
                if tshift and i in tshift:   # (a loop: the node reads the clip at its own, wrapped, time)
                    T = max(c[0].max() for c in ch.values()); ti = (t + tshift[i]) % T
                tt = self.sample(ch, i, 'translation', ti, nd.get('translation', [0, 0, 0]))
                qq = self.sample(ch, i, 'rotation', ti, nd.get('rotation', [0, 0, 0, 1]))
                if qhook and i in qhook: qq = qhook[i](qq)
                ss = self.sample(ch, i, 'scale', ti, nd.get('scale', [1, 1, 1]))
                L = trs(tt, qq, ss)
            else: L = self.local(i)
            if override and i in override: L = override[i](L)
            W[i] = (world(self.parent[i]) if self.parent[i] >= 0 else np.eye(4)) @ L
            return W[i]
        for i in range(n): world(i)
        return W
    def skin_mats(self, W, mesh_node_world=None):
        """per-joint skinning matrices (joint world * inverse bind), relative to the mesh node's world (identity glTF rule: skin ignores the mesh node)"""
        return np.stack([W[j] @ self.ibm[k] for k, j in enumerate(self.joints)])
