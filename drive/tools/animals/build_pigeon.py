"""The pigeon half of build_animals.py: the body of kenchoo's Pigeon (CC-BY 4.0) with a rig made here for what the model lacks, and two wings made here.

The source model is a standing pigeon with its wings folded INTO the body surface (the feathers are painted on a smooth body), a 55-joint chicken rig (legs, toes, tail,
chest, neck, head: no wing joints) and one clip that is an idle (a head bob and a foot lift). So:
  idle   the source clip, looped
  dip    one pose: the pigeon pecking (the body pitched over the feet and the neck folded down), made by turning joint subtrees of the source rig
  fly    24 frames: legs trailed back, wings out and beating (the wings are new geometry, below, skinned to four new joints: shoulder and wrist of each side)
  glide  one pose: wings out and slightly drooped
The wings are not in the body in `idle`/`dip` (their joints are scaled to nothing inside the body), so the standing bird is exactly the source model; in `fly` they have
grown out of the shoulders. Fading between two poses (animals.js blends matrices) grows them, which is how a bird takes off.
Wing surface: flat strips (leading coverts and trailing flight feathers) textured from the feather patches of the source texture.
"""
import os, io, numpy as np
from PIL import Image

D2R = np.pi / 180

def rotx_about(pivot, ang):
    """world-frame rotation about the x axis through `pivot`"""
    c, s = np.cos(ang), np.sin(ang); R = np.eye(4); R[1, 1] = c; R[1, 2] = -s; R[2, 1] = s; R[2, 2] = c
    T = np.eye(4); T[:3, 3] = pivot; Ti = np.eye(4); Ti[:3, 3] = -np.asarray(pivot)
    return T @ R @ Ti

def build(blob, meta, B):
    from glb import GLB, Rig
    SRC, OUT = B.SRC, B.OUT
    g = GLB(os.path.join(SRC, 'pigeon', 'source', 'Pigeon.glb')); rig = Rig(g)
    P, N, U, J, Wt, I = B.read_pieces(g, rig)
    nj = len(rig.joints); names = [rig.nodes[j]['name'] for j in rig.joints]
    jn = {n.replace('Chicken_', '').replace('SHJnt', ''): j for n, j in zip(names, rig.joints)}   # node ids by short name
    W0 = rig.pose(None, 0.0); M0 = rig.skin_mats(W0)[:, :3, :]; P0 = B.skin_points(P, J, Wt, M0)
    lo, hi = P0.min(0), P0.max(0); s = B.PIG_LEN / (hi[2] - lo[2]); zc = (lo[2] + hi[2]) / 2
    Tout = np.diag([-s, s, -s, 1.0]); Tout[2, 3] = s * zc
    print('pigeon: source extent', (hi - lo).round(3), 'scale', round(s, 4), '->', ((hi - lo) * s).round(3), 'm')
    kids = {}
    for i, p in enumerate(rig.parent):
        if p >= 0: kids.setdefault(p, []).append(i)
    def subtree(n): out = [n]; [out.extend(subtree(c)) for c in kids.get(n, [])]; return out
    pos = lambda W, n: W[n][:3, 3]

    # ---------------- poses of the source rig (world matrices of every node), then F = Tout * W * inverseBind
    def posed(clip=None, t=0.0, dip=0.0, fly=0.0):
        W = rig.pose(clip, t)
        if dip > 0:     # pecking: pitch the whole bird forward over its feet, then fold the neck down
            hip = (pos(W, jn['l_Leg_Hip']) + pos(W, jn['r_Leg_Hip'])) / 2
            body = [n for n in range(len(W)) if n not in set(subtree(jn['l_Leg_Hip']) + subtree(jn['r_Leg_Hip']))]
            R = rotx_about(hip, dip * 24 * D2R)
            for n in body: W[n] = R @ W[n]
            Rn = rotx_about(pos(W, jn['Neck_01_01']), dip * 62 * D2R)
            for n in subtree(jn['Neck_01_01']): W[n] = Rn @ W[n]
        if fly > 0:     # legs trailed back along the body, neck a little drawn in
            for side in 'lr':
                R = rotx_about(pos(W, jn[side + '_Leg_Hip']), fly * 78 * D2R)
                for n in subtree(jn[side + '_Leg_Hip']): W[n] = R @ W[n]
                R2 = rotx_about(pos(W, jn[side + '_Leg_Knee']), fly * 42 * D2R)
                for n in subtree(jn[side + '_Leg_Knee']): W[n] = R2 @ W[n]
        return W
    def body_F(W): return B.frame_mats(rig, W, Tout)

    # ---------------- the wings: new joints 0..3 = left inner, left outer, right inner, right outer
    SH = np.array([0.056, 0.208, -0.055])            # right shoulder (output space; left is x mirrored); the body is 0.136 wide here
    LEN, ROOT, TIP = 0.30, 0.20, 0.05               # shoulder to tip, chord at the root, chord at the tip
    NU, NV = 8, 4
    def wing_point(u, v):
        """position in the spread pose (right wing; leading edge v = 0, trailing edge v = 1): a broad paddle, narrowing to the tip, the trailing edge swept back"""
        x = SH[0] + 0.01 + LEN * u
        zle = SH[2] + 0.010 + 0.055 * u ** 2
        taper = 1.0 - 0.88 * max(0.0, min(1.0, (u - 0.5) / 0.5)) ** 1.7        # a pointed tip
        chord = ROOT * (1 - 0.2 * u) * taper
        z = zle + chord * v + 0.075 * u ** 2 * v
        y = SH[1] + 0.040 * u ** 1.4 - 0.028 * np.sin(np.pi * min(1, v * 1.05)) * (1 - 0.5 * u)   # a little dihedral and a cambered, domed top
        return np.array([x, y, z])
    # UV rectangles in the source texture (u, v in 0..1): coverts (leading half) and flight feathers (trailing half)
    UV_COV = (0.335, 0.180, 0.620, 0.450); UV_FLT = (0.030, 0.565, 0.370, 0.670)
    wv, wn, wu, wj, ww, wi = [], [], [], [], [], []
    for side in (+1, -1):
        for layer in (0, 1):                   # 0 = top, 1 = underside
            for band in (0, 1):                # 0 = coverts (v 0..0.5), 1 = flight feathers (v 0.5..1)
                base = len(wv)
                for iu in range(NU + 1):
                    for iv in range(NV // 2 + 1):
                        u = iu / NU; v = (band * NV // 2 + iv) / NV
                        p = wing_point(u, v).copy(); p[0] *= side
                        thick = 0.004 * (1 if layer == 0 else -1); p[1] += thick
                        wv.append(p)
                        uvr = UV_COV if band == 0 else UV_FLT
                        wu.append([uvr[0] + (uvr[2] - uvr[0]) * (iu / NU if band == 0 else (1 - iu / NU)), uvr[1] + (uvr[3] - uvr[1]) * (iv / (NV // 2))])
                        wo = 1.0 if u > 0.62 else 0.0 if u < 0.44 else (u - 0.44) / 0.18
                        ji = 0 if side > 0 else 2
                        wj.append([ji, ji + 1, 0, 0]); ww.append([1 - wo, wo, 0, 0]); wn.append([0, 1 if layer == 0 else -1, 0])
                for iu in range(NU):
                    for iv in range(NV // 2):
                        a = base + iu * (NV // 2 + 1) + iv; b = a + 1; c = a + (NV // 2 + 1); d = c + 1
                        tri = [(a, b, c), (b, d, c)]
                        flip = (side > 0) != (layer == 0)
                        for t in tri: wi.extend(t[::-1] if flip else t)
    wv = np.array(wv, np.float32); wi = np.array(wi, np.int64); wj = np.array(wj, np.int64); ww = np.array(ww, np.float32); wu = np.array(wu, np.float32)
    # smooth normals for the wings from their faces
    wn = np.zeros_like(wv)
    for k in range(0, len(wi), 3):
        a, b, c = wi[k:k + 3]; n = np.cross(wv[b] - wv[a], wv[c] - wv[a]); wn[[a, b, c]] += n
    wn /= np.maximum(np.linalg.norm(wn, axis=1, keepdims=True), 1e-9)
    print('  wings:', len(wv), 'verts', len(wi) // 3, 'tris')

    def wing_F(phi_in, phi_out, k):
        """four 3x4 matrices (L in, L out, R in, R out) for the wing joints: flap about the z axis through the shoulder, the outer part bending at the wrist"""
        out = []
        for side in (+1, -1):
            h = np.array([SH[0] * side, SH[1], SH[2]])
            def rz(ang, piv):
                c, sn = np.cos(ang), np.sin(ang); R = np.eye(4); R[0, 0] = c; R[0, 1] = -sn; R[1, 0] = sn; R[1, 1] = c
                T = np.eye(4); T[:3, 3] = piv; Ti = np.eye(4); Ti[:3, 3] = -piv; return T @ R @ Ti
            S = np.eye(4); S[0, 0] = S[1, 1] = S[2, 2] = max(k, 1e-3); Tn = np.eye(4); Tn[:3, 3] = h; Tm = np.eye(4); Tm[:3, 3] = -h
            Fin = Tn @ S @ Tm @ rz(side * phi_in, h)
            wr = np.array([(SH[0] + 0.01 + LEN * 0.5) * side, SH[1] + 0.02, SH[2] + 0.05])
            Fout = Tn @ S @ Tm @ rz(side * phi_in, h) @ rz(side * phi_out, wr)
            out += [Fin[:3], Fout[:3]]
        return np.stack(out)

    def frame(W, wing):   # (nj + 4, 3, 4)
        return np.concatenate([body_F(W), wing])
    hidden = wing_F(0, 0, 0.0)
    F = []; clips = {}
    def add(name, frames, dur):
        clips[name] = {'start': sum(len(f) for f in F), 'n': len(frames), 'dur': float(dur)}; F.append(np.stack(frames))
    # idle: the source clip's own loop
    ch = rig.anims['Animation']; T = max(c[0].max() for c in ch.values()); t0 = min(c[0].min() for c in ch.values()); NI = 36
    add('idle', [frame(posed('Animation', t0 + i * (T - t0) / NI), hidden) for i in range(NI)], T - t0)
    add('dip', [frame(posed('Animation', t0, dip=1.0), hidden)], 1.0)
    NF = 24
    fl = []
    for i in range(NF):
        u = i / NF; a = 2 * np.pi * u
        phi = (34 * np.sin(a) + 6) * D2R; phi2 = (30 * np.sin(a - 0.9) - 4) * D2R
        fl.append(frame(posed('Animation', t0, fly=1.0), wing_F(phi, phi2, 1.0)))
    add('fly', fl, 1.0)
    add('glide', [frame(posed('Animation', t0, fly=1.0), wing_F(-6 * D2R, -14 * D2R, 1.0))], 1.0)
    Fall = np.concatenate(F)
    tex, tw = B.pack_frames(Fall)
    bt = blob.add('pigeon.bones', tex.view(np.uint16))
    # ---------------- the mesh: body + wings (joint ids of the wings follow the body's)
    def mesh(Pb, Nb, Ub, Jb, Wb, Ib):
        n0 = len(Pb)
        Pa = np.concatenate([Pb, wv]); Na = np.concatenate([Nb, wn]); Ua = np.concatenate([Ub, wu])
        Ja = np.concatenate([Jb, wj + nj]); Wa = np.concatenate([Wb, ww]); Ia = np.concatenate([Ib, wi + n0])
        return Pa, Na, Ua, Ja, Wa, Ia
    # the body needs its source-space normals bound with the same matrices as its positions (the shader transforms both); the wings are already in output space
    # two levels of detail of the body: 3000 triangles for birds within 16 m (the smooth body loses nothing at that count: the texture carries the feathers), 900 beyond
    k1, i1 = B.simplify(P, N, U, Wt, I, 3000, 0.02)
    near = B.write_mesh(blob, 'pigeon.near', *mesh(P[k1], N[k1], U[k1], J[k1], Wt[k1], i1.reshape(-1)))
    keep, inv = B.simplify(P, N, U, Wt, I, 900, 0.08)
    far = B.write_mesh(blob, 'pigeon.far', *mesh(P[keep], N[keep], U[keep], J[keep], Wt[keep], inv.reshape(-1)))
    meta['pigeon'] = {'mesh': {'near': near, 'far': far}, 'frames': {'count': int(Fall.shape[0]), 'width': tw, 'data': bt}, 'clips': clips, 'joints': int(Fall.shape[1]), 'length': B.PIG_LEN, 'scale': float(s)}
    albedo = Image.open(io.BytesIO(g.image(0)[0]))   # (the GLB's own image: textures/Image_0_0.png is the same picture upside down)
    meta['pigeon']['textures'] = {'albedo': 'pigeon.webp'}
    print('  pigeon.webp', B.webp(albedo, os.path.join(OUT, 'pigeon.webp'), 85, 1024), 'B')
    return F, P, J, Wt, rig, Tout, nj, (wv, wi)
