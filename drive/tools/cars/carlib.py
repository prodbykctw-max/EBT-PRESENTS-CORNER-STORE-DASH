"""Mesh toolkit + .cars exporter for the car-look options (numpy only; bpy/mathutils optional for AO).

Build space: X = length (nose +X), Y = up, Z = right-hand side of the car (+Z = right).
Game space (exported): nose -Z, up +Y, right +X   ->  game = (z, y, -x).
Parts (real.js CAR_PARTS): 0 plain, 1 paint (white vertex = per-instance tint), 2 glass, 3 rubber, 4 headlamp,
5 tail lamp, 6 chrome/bright metal, 7 own-colour body paint, 8 satin trim, 9 light-bar lens.
Tags (per face): 0 body, 1 glass pane (separate transparent mesh at LOD0), 2 interior, 3 shadow-proxy-only.
"""
import numpy as np, json, struct, gzip, math

def col(h):
    if isinstance(h, (tuple, list, np.ndarray)): return np.array(h, np.uint8)
    if isinstance(h, str): h = int(h.lstrip('#'), 16)
    return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], np.uint8)

class Mesh:
    def __init__(s, V=None, F=None, N=None, C=None, P=None, T=None, AO=None):
        s.V = np.zeros((0, 3)) if V is None else np.asarray(V, float)
        s.F = np.zeros((0, 3), int) if F is None else np.asarray(F, int)
        s.N = N                                   # (n,3) per-vertex normals or None -> computed smooth/flat
        m = len(s.F)
        s.C = np.zeros((m, 3), np.uint8) if C is None else C
        s.P = np.zeros(m, np.uint8) if P is None else P
        s.T = np.zeros(m, np.uint8) if T is None else T
        s.AO = AO                                 # (n,) per-vertex baked ambient occlusion 0..1 or None

    def copy(s):
        return Mesh(s.V.copy(), s.F.copy(), None if s.N is None else s.N.copy(), s.C.copy(), s.P.copy(), s.T.copy(), None if s.AO is None else s.AO.copy())

    def with_attrs(s, color=None, part=None, tag=None):
        m = len(s.F)
        if color is not None: s.C = np.tile(col(color), (m, 1))
        if part is not None: s.P = np.full(m, part, np.uint8)
        if tag is not None: s.T = np.full(m, tag, np.uint8)
        return s

    def ensure_normals(s, flat=False):
        if s.N is not None: return
        V, F = s.V, s.F
        fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
        N = np.zeros_like(V)
        for k in range(3): np.add.at(N, F[:, k], fn)
        L = np.linalg.norm(N, axis=1, keepdims=True); L[L == 0] = 1
        s.N = N / L

    def xform(s, M):  # M 4x4
        s.V = s.V @ M[:3, :3].T + M[:3, 3]
        if s.N is not None:
            s.N = s.N @ np.linalg.inv(M[:3, :3])
            s.N /= np.maximum(np.linalg.norm(s.N, axis=1, keepdims=True), 1e-9)
        if np.linalg.det(M[:3, :3]) < 0: s.F = s.F[:, ::-1].copy()
        return s

    def flip(s):
        s.F = s.F[:, ::-1].copy()
        if s.N is not None: s.N = -s.N
        return s

    def mirror_z(s):  # mirror across z=0 (adds the copy)
        m = s.copy(); m.V[:, 2] *= -1
        if m.N is not None: m.N[:, 2] *= -1
        m.F = m.F[:, ::-1].copy()
        return merge([s, m])

def T(tx=0, ty=0, tz=0):
    M = np.eye(4); M[:3, 3] = (tx, ty, tz); return M
def S(sx=1, sy=None, sz=None):
    sy = sx if sy is None else sy; sz = sx if sz is None else sz
    return np.diag([sx, sy, sz, 1.0])
def R(axis, ang):
    c, s_ = math.cos(ang), math.sin(ang); M = np.eye(4)
    if axis == 'x': M[1, 1] = c; M[1, 2] = -s_; M[2, 1] = s_; M[2, 2] = c
    elif axis == 'y': M[0, 0] = c; M[0, 2] = s_; M[2, 0] = -s_; M[2, 2] = c
    else: M[0, 0] = c; M[0, 1] = -s_; M[1, 0] = s_; M[1, 1] = c
    return M

def merge(ms):
    ms = [m for m in ms if len(m.F)]
    if not ms: return Mesh()
    for m in ms: m.ensure_normals()
    off = np.cumsum([0] + [len(m.V) for m in ms])
    ao = None
    if any(m.AO is not None for m in ms):
        ao = np.concatenate([m.AO if m.AO is not None else np.ones(len(m.V)) for m in ms])
    return Mesh(np.concatenate([m.V for m in ms]), np.concatenate([m.F + o for m, o in zip(ms, off)]),
                np.concatenate([m.N for m in ms]), np.concatenate([m.C for m in ms]), np.concatenate([m.P for m in ms]),
                np.concatenate([m.T for m in ms]), ao)

# ------------------------------------------------------------------ primitives
def grid(f, us, vs, classify=None, inset=None, flip=False, closed_v=False, eps=1e-4, ref=None):
    """parametric surface f(u,v)->(...,3) sampled on the lines us x vs. classify(u,v)->(color(3), part, tag) per cell
    (cell centre); inset(u,v)->depth moves a vertex along -normal (panel gaps). Normals from finite differences."""
    us = np.asarray(us, float); vs = np.asarray(vs, float)
    U, Vv = np.meshgrid(us, vs, indexing='ij')
    P = f(U, Vv)
    du = (f(U + eps, Vv) - f(U - eps, Vv)); dv = (f(U, Vv + eps) - f(U, Vv - eps))
    N = np.cross(du, dv)
    L = np.linalg.norm(N, axis=-1, keepdims=True); L[L < 1e-12] = 1; N = N / L
    if flip: N = -N
    if inset is not None:
        d = inset(U, Vv); P = P - N * d[..., None]
    nu, nv = len(us), len(vs)
    idx = np.arange(nu * nv).reshape(nu, nv)
    a = idx[:-1, :-1].ravel(); b = idx[1:, :-1].ravel(); c = idx[1:, 1:].ravel(); d_ = idx[:-1, 1:].ravel()
    F = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d_], 1)]) if not flip else np.concatenate([np.stack([a, c, b], 1), np.stack([a, d_, c], 1)])
    ncell = len(a)
    C = np.zeros((ncell, 3), np.uint8); Pp = np.zeros(ncell, np.uint8); Tt = np.zeros(ncell, np.uint8)
    if classify is not None:
        um = (us[:-1] + us[1:]) / 2; vm = (vs[:-1] + vs[1:]) / 2
        k = 0
        for i in range(nu - 1):
            for j in range(nv - 1):
                c_, p_, t_ = classify(um[i], vm[j]); C[k] = c_; Pp[k] = p_; Tt[k] = t_; k += 1
    m = Mesh(P.reshape(-1, 3), F, N.reshape(-1, 3), np.concatenate([C, C]), np.concatenate([Pp, Pp]), np.concatenate([Tt, Tt]))
    if ref is not None:   # make normals (and winding) point away from the reference point on average
        if np.mean(np.sum((m.V - np.asarray(ref)) * m.N, axis=1)) < 0: m.N = -m.N; m.F = m.F[:, ::-1].copy()
    return m

def box(cx, cy, cz, sx, sy, sz, color=0x808080, part=0, tag=0, bevel=0.0):
    """axis-aligned box with its own (flat) normals; sx,sy,sz full sizes"""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [((1, 0, 0), (0, 1, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, -1), (0, 1, 0)),
             ((0, 1, 0), (0, 0, 1), (1, 0, 0)), ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
             ((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (0, 1, 0), (1, 0, 0))]
    V = []; F = []; N = []
    for n, a, b in faces:
        n = np.array(n, float); a = np.array(a, float); b = np.array(b, float)
        base = len(V)
        for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = n * np.array([hx, hy, hz]) + a * sa * np.array([hx, hy, hz]) + b * sb * np.array([hx, hy, hz])
            V.append(p + (cx, cy, cz)); N.append(n)
        F += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
    m = Mesh(np.array(V), np.array(F), np.array(N))
    # make winding outward
    fn = np.cross(m.V[m.F[:, 1]] - m.V[m.F[:, 0]], m.V[m.F[:, 2]] - m.V[m.F[:, 0]])
    ctr = m.V[m.F].mean(1) - (cx, cy, cz)
    bad = (fn * ctr).sum(1) < 0
    m.F[bad] = m.F[bad][:, ::-1]
    return m.with_attrs(color, part, tag)

def lathe(profile, n=24, axis='x', color=0x808080, part=0, tag=0, smooth=True, start=0.0, sweep=2 * math.pi, outward=True):
    """revolve (r, h) profile points about the +h axis, which is the axis `axis`; consecutive points form rings"""
    prof = np.asarray(profile, float); k = len(prof)
    th = start + np.linspace(0, sweep, n + 1)
    V = []; Nn = []
    # profile normals (2D, pointing to the right of travel)
    d = np.gradient(prof, axis=0); nr = np.stack([d[:, 1], -d[:, 0]], 1); nr /= np.maximum(np.linalg.norm(nr, axis=1, keepdims=True), 1e-9)
    if outward:
        imax = int(np.argmax(prof[:, 0] - 1e-6 * np.abs(prof[:, 1] - prof[:, 1].mean())))
        if nr[imax, 0] < 0: nr = -nr
    else:
        imax = int(np.argmax(prof[:, 0]))
        if nr[imax, 0] > 0: nr = -nr
    for i in range(k):
        r, h = prof[i]
        for t in th:
            V.append((h, r * math.cos(t), r * math.sin(t))); Nn.append((nr[i, 1], nr[i, 0] * math.cos(t), nr[i, 0] * math.sin(t)))
    V = np.array(V); Nn = np.array(Nn); W = n + 1
    F = []
    for i in range(k - 1):
        for j in range(n):
            a = i * W + j; b = a + 1; c = (i + 1) * W + j + 1; d_ = (i + 1) * W + j
            F += [(a, b, c), (a, c, d_)]
    m = Mesh(V, np.array(F), Nn)
    fn = np.cross(m.V[m.F[:, 1]] - m.V[m.F[:, 0]], m.V[m.F[:, 2]] - m.V[m.F[:, 0]])
    vn = m.N[m.F].mean(1)
    bad = (fn * vn).sum(1) < 0
    m.F[bad] = m.F[bad][:, ::-1]
    if not smooth: m.N = None; m.ensure_normals()
    if axis == 'y': m.xform(R('z', math.pi / 2))
    elif axis == 'z': m.xform(R('y', -math.pi / 2))
    return m.with_attrs(color, part, tag)

def prism(poly, y0, y1, color=0x808080, part=0, tag=0):
    """extrude a convex/simple 2D polygon (x,z) between heights y0,y1 (flat shaded)"""
    poly = np.asarray(poly, float); n = len(poly)
    V = []; F = []; N = []
    for y, ny in ((y1, 1), (y0, -1)):
        b = len(V)
        for p in poly: V.append((p[0], y, p[1])); N.append((0, ny, 0))
        for i in range(1, n - 1): F.append((b, b + i, b + i + 1) if ny > 0 else (b, b + i + 1, b + i))
    for i in range(n):
        a = poly[i]; c = poly[(i + 1) % n]; e = c - a; nn = np.array([e[1], 0, -e[0]]); nn /= max(np.linalg.norm(nn), 1e-9)
        b = len(V)
        V += [(a[0], y0, a[1]), (c[0], y0, c[1]), (c[0], y1, c[1]), (a[0], y1, a[1])]; N += [tuple(nn)] * 4
        F += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    m = Mesh(np.array(V), np.array(F), np.array(N))
    fn = np.cross(m.V[m.F[:, 1]] - m.V[m.F[:, 0]], m.V[m.F[:, 2]] - m.V[m.F[:, 0]])
    bad = (fn * m.N[m.F].mean(1)).sum(1) < 0
    m.F[bad] = m.F[bad][:, ::-1]
    return m.with_attrs(color, part, tag)

# ------------------------------------------------------------------ AO bake (mathutils BVH rays)
def bake_ao(m, occluder, n_rays=14, dist=1.4, seed=1):
    import bpy, mathutils
    from mathutils.bvhtree import BVHTree
    occluder.ensure_normals()
    bvh = BVHTree.FromPolygons([tuple(v) for v in occluder.V], [tuple(f) for f in occluder.F], epsilon=0.0)
    rng = np.random.default_rng(seed)
    m.ensure_normals()
    # hemisphere directions
    d = rng.normal(size=(n_rays, 3)); d /= np.linalg.norm(d, axis=1, keepdims=True)
    ao = np.ones(len(m.V))
    for i, (p, n) in enumerate(zip(m.V, m.N)):
        hit = 0.0
        for dd in d:
            dv = dd if dd @ n >= 0 else -dd
            dv = dv * 0.8 + n * 0.2; dv /= np.linalg.norm(dv)
            r = bvh.ray_cast(mathutils.Vector(p + n * 0.012), mathutils.Vector(dv), dist)
            if r[0] is not None: hit += 1 - (r[3] / dist) * 0.55 if False else (1.0 - 0.6 * (r[3] / dist))
        ao[i] = 1 - hit / n_rays
    m.AO = np.clip(ao, 0.12, 1.0)
    return m

# ------------------------------------------------------------------ export
def to_game(m):
    M = np.array([[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 0, 1.0]])
    return m.copy().xform(M)

def pack_mesh(m, ao_default=True):
    """expand per-face corners, weld identical (pos, normal, colour, part, ao) -> arrays"""
    m.ensure_normals()
    F = m.F
    ao = m.AO if m.AO is not None else np.ones(len(m.V))
    nq = np.clip(np.round(m.N * 127), -127, 127).astype(np.int8)
    aq = np.clip(np.round(ao * 255), 0, 255).astype(np.uint8)
    # corner keys
    ci = F.reshape(-1)
    face_of = np.repeat(np.arange(len(F)), 3)
    key = np.concatenate([ci[:, None].astype(np.int64), m.C[face_of].astype(np.int64), m.P[face_of][:, None].astype(np.int64)], 1)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    vi = uniq[:, 0]
    V = m.V[vi]; N = nq[vi]; C = uniq[:, 1:4].astype(np.uint8); P = uniq[:, 4].astype(np.uint8); A = aq[vi]
    I = inv.reshape(-1, 3).astype(np.int64)
    return V, N, C, P, A, I

def write_cars(path, meshes, roles, extra=None, gz=True):
    """meshes: name -> Mesh (already in GAME space). roles/extra go to the JSON header."""
    blobs = []; head = {'version': 1, 'meshes': {}, 'roles': roles}
    if extra: head.update(extra)
    off = 0
    def put(b):
        nonlocal off
        pad = (-len(b)) % 4; b = b + b'\0' * pad; o = off; blobs.append(b); off += len(b); return o
    for name, m in meshes.items():
        V, N, C, P, A, I = pack_mesh(m)
        lo = V.min(0); hi = V.max(0); ctr = (lo + hi) / 2; ext = np.maximum((hi - lo) / 2, 1e-6)
        q = np.clip(np.round((V - ctr) / ext * 32767), -32767, 32767).astype(np.int16)
        wide = len(V) > 65535
        info = {'n': int(len(V)), 'm': int(len(I) * 3), 'tris': int(len(I)), 'ctr': [float(x) for x in ctr], 'ext': [float(x) for x in ext], 'wide': wide}
        info['pos'] = put(q.tobytes()); info['nrm'] = put(N.tobytes()); info['col'] = put(C.tobytes())
        info['part'] = put(P.tobytes()); info['ao'] = put(A.tobytes())
        info['idx'] = put(I.astype(np.uint32 if wide else np.uint16).tobytes())
        head['meshes'][name] = info
    j = json.dumps(head, separators=(',', ':')).encode(); j += b' ' * ((-len(j)) % 4)
    data = b'CARS' + struct.pack('<I', len(j)) + j + b''.join(blobs)
    raw = len(data)
    if gz: data = gzip.compress(data, 9, mtime=0)
    open(path, 'wb').write(data)
    return raw, len(data)
