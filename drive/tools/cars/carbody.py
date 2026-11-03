"""Parametric street-car builder (option C). Lofted body with real panel gaps, wheel arches, glass, lamps, grille, mirrors,
handles, interior, wheels (tyre / rim / brake disc / caliper). Everything numpy; see carlib.py for the toolkit.
Build space: X length (nose +X), Y up, Z right. Origin at the middle of the wheelbase on the ground."""
import numpy as np, math
from scipy.interpolate import PchipInterpolator
from carlib import *

PAINT = (255, 255, 255)
def C(h): return col(h)

def pch(tab):
    xs, ys = zip(*tab)
    return PchipInterpolator(xs, ys, extrapolate=True) if len(tab) > 2 else (lambda x: np.interp(x, xs, ys))
def clampx(f, lo, hi):
    return lambda x: f(np.clip(x, lo, hi))

def hermite(P, tk, t):
    """P (...,K,2) key points, tk (K,) knots, t (...) -> (...,2); C1 cubic Hermite through the key points"""
    K = len(tk); tk = np.asarray(tk)
    i = np.clip(np.searchsorted(tk, t, side='right') - 1, 0, K - 2)
    t0 = tk[i]; t1 = tk[i + 1]; h = t1 - t0; s = (t - t0) / h
    def g(ix): return np.take_along_axis(P, np.clip(ix, 0, K - 1)[..., None, None], axis=-2)[..., 0, :]
    p0 = g(i); p1 = g(i + 1); pm = g(i - 1); pp = g(i + 2)
    tm = tk[np.clip(i - 1, 0, K - 1)]; tp = tk[np.clip(i + 2, 0, K - 1)]
    m0 = (p1 - pm) / (t1 - tm)[..., None]; m1 = (pp - p0) / (tp - t0)[..., None]
    s = s[..., None]; h = h[..., None]
    h00 = 2 * s ** 3 - 3 * s ** 2 + 1; h10 = s ** 3 - 2 * s ** 2 + s; h01 = -2 * s ** 3 + 3 * s ** 2; h11 = s ** 3 - s ** 2
    return h00 * p0 + h10 * h * m0 + h01 * p1 + h11 * h * m1

TK = [0, .08, .14, .20, .32, .42, .48, .52, .70, .80, .90, 1.0]
TBELT = 0.52      # t of the belt line (body / greenhouse)
TWIN = 0.70       # t of the top of the side glass

SPECS = {
 'sedan': dict(
    xr=-2.25, xf=2.25, wb=1.35, wz=0.77, rw=0.34, tw=0.215, rim=0.215,
    ytop=[(-2.25, .90), (-2.18, .99), (-1.9, 1.03), (-1.58, 1.02), (-0.85, 1.445), (-0.2, 1.47), (0.28, 1.44), (1.02, .97), (1.7, .90), (2.05, .80), (2.2, .70), (2.25, .62)],
    ybot=[(-2.25, .36), (-2.1, .27), (-1.7, .19), (-1.5, .17), (1.5, .17), (1.9, .19), (2.1, .24), (2.25, .30)],
    w=[(-2.25, .60), (-2.15, .74), (-1.95, .84), (-1.6, .88), (-1.0, .89), (1.3, .89), (1.8, .875), (2.05, .82), (2.2, .74), (2.25, .66)],
    belt=[(-2.25, 1.0), (-1.5, 1.03), (-0.9, 1.0), (0.6, .97), (1.0, .96), (2.25, .9)],
    wr=[(-1.7, .40), (-1.4, .50), (-0.9, .57), (-0.2, .60), (0.3, .58), (0.9, .49), (1.05, .45)],
    hood=(1.0, 2.02), trunk=(-2.0, -1.55), wind=(0.30, 1.0), rwin=(-1.58, -0.88), roof=(-0.88, 0.30),
    doors=(0.80, -0.14, -1.10), glass=(0.74, -1.12), bpil=(-0.20, -0.10),
    hl=(1.62, 2.25), tl=(-2.25, -2.05), mirror=(0.80, 0.97), hood_y=0.95),
 'suv': dict(
    xr=-2.37, xf=2.37, wb=1.42, wz=0.82, rw=0.37, tw=0.235, rim=0.235,
    ytop=[(-2.37, 1.12), (-2.33, 1.45), (-2.25, 1.68), (-1.4, 1.72), (-0.3, 1.74), (0.5, 1.73), (0.95, 1.50), (1.25, 1.14), (1.7, 1.06), (2.15, .98), (2.3, .86), (2.37, .72)],
    ybot=[(-2.37, .42), (-2.2, .32), (-1.8, .26), (-1.5, .23), (1.5, .23), (1.95, .25), (2.2, .31), (2.37, .38)],
    w=[(-2.37, .74), (-2.2, .90), (-1.8, .96), (-1.2, .975), (1.5, .975), (2.0, .95), (2.25, .88), (2.37, .76)],
    belt=[(-2.37, 1.18), (-1.5, 1.2), (-0.5, 1.17), (0.6, 1.13), (1.2, 1.12), (2.37, 1.0)],
    wr=[(-2.2, .68), (-1.8, .72), (-0.5, .75), (0.5, .74), (1.0, .66), (1.25, .55)],
    hood=(1.2, 2.2), trunk=(-2.37, -2.37), wind=(0.52, 1.18), rwin=(-2.35, -2.25), roof=(-2.25, 0.52),
    doors=(0.92, -0.04, -1.20), glass=(0.82, -2.18), bpil=(-0.10, 0.0),
    hl=(1.7, 2.37), tl=(-2.37, -2.2), mirror=(0.93, 1.12), hood_y=1.08),

 'cross': dict(
    xr=-2.35, xf=2.35, wb=1.43, wz=0.80, rw=0.35, tw=0.225, rim=0.225,
    ytop=[(-2.35, 1.05), (-2.3, 1.30), (-2.2, 1.50), (-1.7, 1.62), (-0.8, 1.65), (0.2, 1.64), (0.75, 1.46), (1.12, 1.07), (1.7, 1.0), (2.1, .92), (2.28, .80), (2.35, .68)],
    ybot=[(-2.35, .40), (-2.2, .30), (-1.8, .24), (-1.5, .21), (1.5, .21), (1.95, .23), (2.2, .29), (2.35, .36)],
    w=[(-2.35, .70), (-2.2, .88), (-1.8, .95), (-1.2, .975), (1.5, .975), (2.0, .95), (2.25, .88), (2.35, .74)],
    belt=[(-2.35, 1.10), (-1.5, 1.12), (-0.5, 1.10), (0.6, 1.06), (1.1, 1.04), (2.35, .95)],
    wr=[(-2.2, .62), (-1.8, .68), (-0.5, .72), (0.5, .70), (0.9, .62), (1.1, .50)],
    hood=(1.1, 2.2), trunk=(-2.35, -2.35), wind=(0.45, 1.1), rwin=(-2.3, -2.18), roof=(-2.18, 0.45),
    doors=(0.9, -0.05, -1.18), glass=(0.8, -2.1), bpil=(-0.10, 0.0),
    hl=(1.7, 2.35), tl=(-2.35, -2.2), mirror=(0.92, 1.1), hood_y=1.0),
}

class Body:
    def __init__(s, name, lod):
        s.name = name; s.lod = lod; p = SPECS[name]; s.p = p
        s.f_top = clampx(pch(p['ytop']), p['xr'], p['xf']); s.f_bot = clampx(pch(p['ybot']), p['xr'], p['xf'])
        s.f_w = clampx(pch(p['w']), p['xr'], p['xf']); s.f_belt = clampx(pch(p['belt']), p['xr'], p['xf'])
        s.f_wr = clampx(pch(p['wr']), p['xr'], p['xf'])

    # ---- the section: key points (right half) at stations x
    def keys(s, x):
        yt = s.f_top(x); yb = s.f_bot(x); w = s.f_w(x); be = np.minimum(s.f_belt(x), yt - 0.012)
        wr = s.f_wr(x); gh = np.clip((yt - s.f_belt(x)) / 0.10, 0, 1); gh = gh * gh * (3 - 2 * gh)
        ym = yb + 0.52 * (be - yb); wgb = w - 0.10
        z = np.zeros_like(x)
        k = [(z, yb), (0.70 * w, yb), (w - 0.07, yb + 0.03), (w, yb + 0.13), (w, ym), (w - 0.02, be - 0.12), (w - 0.06, be - 0.03), (wgb, be)]
        # greenhouse: edge of the side glass, roof corner, roof crown
        gw8 = wgb + (wr - wgb) * 0.80; gy8 = yt - 0.07
        k8 = (wgb * 0.80 + (gw8 - wgb * 0.80) * gh, yt - 0.012 + (gy8 - yt + 0.012) * gh)
        k9 = (wgb * 0.55 + (wr * 0.97 - wgb * 0.55) * gh, yt - 0.004 - 0.016 * gh)
        k10 = (wgb * 0.28 + (wr * 0.55 - wgb * 0.28) * gh, yt - 0.0005 - 0.003 * gh)
        k += [k8, k9, k10, (z, yt)]
        # P (...,K,2) as (z, y)
        return np.stack([np.stack([a, b], -1) for a, b in k], -2)

    def surf(s, X, T):
        """X, T arrays (same shape) -> right-half body surface points (x, y, z) with wheel-arch recess applied by the caller"""
        P = hermite(s.keys(X), TK, T)
        return np.stack([X, P[..., 1], P[..., 0]], -1)

    # ---- classification
    def wheel_xs(s): return (s.p['wb'], -s.p['wb'])

def arch_r(p): return p['rw'] + 0.07

def _dedupe(arr, gaps, mind):
    arr = np.unique(np.round(arr, 5)); keep = [arr[0]]
    for v in arr[1:]:
        if v - keep[-1] > mind or round(float(v), 5) in gaps or round(float(keep[-1]), 5) in gaps: keep.append(v)
    return np.array(keep)

PAINTC = (np.array(PAINT, np.uint8), 1, 0)

def lamp_cls(x, t, HL, TL, hbx, tbx):
    # front: dark glass lens with a bright strip (day running light / projector) along its upper edge, a chrome bezel round it
    if HL['x'][0] <= x <= HL['x'][1] and HL['t'][0] <= t <= HL['t'][1]:
        return (C(0xf1efe6), 4, 0) if t > HL['t'][1] - 0.035 else (C(0x0e1216), 2, 0)
    if hbx <= x <= HL['x'][1] + 0.012 and HL['t'][0] - 0.01 <= t <= HL['t'][1] + 0.01 and x > HL['x'][0] - 0.02: return (C(0x8d9298), 6, 0)
    if TL['x'][0] <= x <= TL['x'][1] and TL['t'][0] <= t <= TL['t'][1]: return (C(0xb01016), 5, 0)
    if TL['x'][0] - 0.012 <= x <= tbx and TL['t'][0] - 0.01 <= t <= TL['t'][1] + 0.01: return (C(0x1a1214), 8, 0)
    return None

def build_shell(B, lod):
    """right-half lofted shell + fascias with panel gaps, glass cells, wheel arches carved out. returns Mesh (right half only)"""
    p = B.p; xr, xf = p['xr'], p['xf']; fine = lod == 0
    gapw = 0.0065; GAPX = []; GAPT = []
    d_f, d_m, d_r = p['doors']; tb0 = 0.17
    if fine:
        for xg in (d_f, d_m, d_r): GAPX.append((xg, xg + gapw, tb0, TBELT - 0.004))
        GAPT += [(tb0, tb0 + 0.0035, d_r, d_f)]
        h0, h1 = p['hood']; tc = 0.60
        GAPX += [(h1 - gapw, h1, tc, 1.0), (h0, h0 + gapw, tc, 1.0)]; GAPT.append((tc, tc + 0.0035, h0, h1))
        if p['trunk'][0] != p['trunk'][1]:
            t0_, t1_ = p['trunk']; GAPX.append((t0_, t0_ + gapw, tc, 1.0)); GAPT.append((tc, tc + 0.0035, t0_, t1_))
    # lamp rectangles in (x, t) space: front lamp wraps the fender corner (side part here, fascia part below), tail lamp likewise
    HL = dict(x=(p['xf'] - 0.40, p['xf'] - 0.015), t=(0.37, 0.46)); TL = dict(x=(p['xr'] + 0.015, p['xr'] + 0.30), t=(0.405, 0.47))
    nx = {0: 38, 1: 12, 2: 5}[lod]; nt = {0: 30, 1: 10, 2: 6}[lod]
    xs = list(np.linspace(xr, xf, nx))
    xs += [d_f, d_m, d_r, p['glass'][0], p['glass'][1], p['hood'][0], p['hood'][1], p['wind'][0], p['wind'][1], p['rwin'][0], p['rwin'][1], p['bpil'][0], p['bpil'][1]]
    for g in GAPX: xs += [g[0], g[1]]
    for g in GAPT: xs += [g[2], g[3]]
    xs += [HL['x'][0], HL['x'][1], TL['x'][0], TL['x'][1], HL['x'][0] - 0.012, TL['x'][1] + 0.012]
    for xw in (p['wb'], -p['wb']):
        r = arch_r(p) + 0.03; xs += list(np.linspace(xw - r, xw + r, {0: 15, 1: 6, 2: 0}[lod]))
    if lod == 2: xs = [x for x in xs if True]
    us = _dedupe(np.clip(np.array(xs), xr, xf), set(round(g[0], 5) for g in GAPX) | set(round(g[1], 5) for g in GAPX), 0.012 if lod else 0.0045)
    ts = list(np.linspace(0, 1, nt)) + ([.08, .14, .20, .32, .42, .48, TBELT, .60, TWIN, .78, .88] if lod == 0 else [.14, .32, .48, TBELT, TWIN, .78] if lod == 1 else [TBELT, TWIN])
    for g in GAPT: ts += [g[0], g[1]]
    for g in GAPX: ts += [g[2], g[3]]
    ts += [HL['t'][0], HL['t'][1], TL['t'][0], TL['t'][1], HL['t'][0] - 0.01, HL['t'][1] + 0.01, TL['t'][0] - 0.01, TL['t'][1] + 0.01, HL['t'][1] - 0.035]
    vs = _dedupe(np.clip(np.array(ts), 0, 1), set(round(g[0], 5) for g in GAPT) | set(round(g[1], 5) for g in GAPT), 0.02 if lod else 0.0022)
    arch = [(p['wb'], p['rw']), (-p['wb'], p['rw'])]; ra = arch_r(p)
    EPS = 1e-6
    def in_gap(x, t):
        for (a, b, c, d) in GAPX:
            if a - EPS <= x <= b + EPS and c - EPS <= t <= d + EPS: return True
        for (c, d, a, b) in GAPT:
            if c - EPS <= t <= d + EPS and a - EPS <= x <= b + EPS: return True
        return False
    def inset_fn(X, Tt):
        out = np.zeros_like(X)
        for (a, b, c, d) in GAPX: out = np.where((X >= a - EPS) & (X <= b + EPS) & (Tt >= c - EPS) & (Tt <= d + EPS), 0.007, out)
        for (c, d, a, b) in GAPT: out = np.where((Tt >= c - EPS) & (Tt <= d + EPS) & (X >= a - EPS) & (X <= b + EPS), 0.007, out)
        return out
    x0g, x1g = p['glass'][1], p['glass'][0]
    def classify(x, t):
        if in_gap(x, t): return (C(0x070708), 8, 0)
        if t < 0.08: return (C(0x151517), 8, 0)
        if t < 0.145 and lod < 2: return (C(0x1c1d20), 8, 0)
        if TBELT + 0.006 < t < TWIN - 0.006:
            if x1g > x > x0g:
                if p['bpil'][0] < x < p['bpil'][1]: return (C(0x0a0a0c), 8, 0)
                return (C(0x070a0d), 2, 1)
            return (C(0x0d0d10), 8, 0) if (x0g - 0.1 < x < x1g + 0.12) else PAINTC
        if TBELT - 0.004 < t < TBELT + 0.006 and x0g < x < x1g: return (C(0x9aa3ab), 6, 0)
        if t >= TWIN - 0.006:
            wa, wb_ = p['wind']; ra_, rb_ = p['rwin']
            if (wa < x < wb_ or ra_ < x < rb_) and t > 0.755: return (C(0x070a0d), 2, 1)
            if (wa - 0.03 < x < wb_ + 0.03 or ra_ - 0.03 < x < rb_ + 0.03) and t > 0.72: return (C(0x0b0b0d), 8, 0)
        if lod < 2:
            c_ = lamp_cls(x, t, HL, TL, HL['x'][0] - 0.012, TL['x'][1] + 0.012)
            if c_: return c_
        return PAINTC
    m = grid(lambda U, V: B.surf(U, V), us, vs, classify=classify, inset=inset_fn, ref=(0, 0.7, 0))
    # ---- wheel arches: vertices inside the arch circle (side view) go onto the circle; faces wholly inside vanish
    nu, nv = len(us), len(vs)
    Tg = np.tile(vs, nu)
    inside = np.zeros(len(m.V), bool); V = m.V.copy()
    for xw, rw_ in (arch if lod < 2 else []):
        r = np.hypot(V[:, 0] - xw, V[:, 1] - rw_)
        ins = (r < ra) & (Tg > 0.0) & (Tg < 0.50)
        inside |= ins
        k = np.where(ins & (Tg >= 0.145), ra / np.maximum(r, 1e-6), 1.0)
        m.V[:, 0] = np.where(k != 1.0, xw + (V[:, 0] - xw) * k, m.V[:, 0]); m.V[:, 1] = np.where(k != 1.0, rw_ + (V[:, 1] - rw_) * k, m.V[:, 1])
    drop = inside[m.F].all(1)
    m.F = m.F[~drop]; m.C = m.C[~drop]; m.P = m.P[~drop]; m.T = m.T[~drop]
    parts = [m]
    # ---- fascias
    for end in (xf, xr):
        sgn = 1 if end > 0 else -1
        def f_cap(U, V, end=end, sgn=sgn):
            R = B.surf(np.full_like(V, end), V); yc = (B.f_top(end) + B.f_bot(end)) / 2
            Cc = np.stack([np.full_like(R[..., 0], end), np.full_like(R[..., 0], yc), np.zeros_like(R[..., 0])], -1)
            r = (1 - U)[..., None]; Pp = Cc + (R - Cc) * r
            Pp[..., 0] = end + sgn * (0.05 * (1 - r[..., 0] ** 2)); return Pp
        ss = np.unique(np.concatenate([np.linspace(0, 1, {0: 8, 1: 4, 2: 2}[lod]), [0.34]]))
        tv = _dedupe(np.concatenate([np.linspace(0, 1, {0: 34, 1: 10, 2: 6}[lod]), [.08, .14, .2, .32, .42, .48, .52, .37, .46, .405, .47, .43]]), set(), 0.004)
        def cls_cap(u, v, end=end):
            P = f_cap(np.array(u), np.array(v)); y = float(P[1]); z = float(P[2])
            if end > 0:
                if abs(z) < 0.50 and 0.40 < y < 0.64 and u > 0.05: return (C(0x0b0b0d), 8, 0)
                if abs(z) < 0.42 and 0.20 < y <= 0.40: return (C(0x08080a), 8, 0)
                if lod < 2 and 0.37 <= v <= 0.46 and u < 0.34: return (C(0xf1efe6), 4, 0) if v > 0.43 else (C(0x0e1216), 2, 0)
            else:
                if lod < 2 and 0.405 <= v <= 0.47 and u < 0.34: return (C(0xb01016), 5, 0)
                if y < 0.40: return (C(0x151517), 8, 0)
            return PAINTC
        parts.append(grid(f_cap, ss, tv, classify=cls_cap, ref=(0, 0.7, 0)))
    half = merge(parts)
    return half, (us, vs)

def lamp_extras(B, lod):  # (nothing yet)
    return []

# ------------------------------------------------------------------ wheels
def wheel(p, lod):
    rw, rr, tw = p['rw'], p['rim'], p['tw']; hw = tw / 2
    ring = {0: 28, 1: 16, 2: 8}[lod]
    parts = []
    tyre = [(rr - 0.012, -hw + 0.03), (rr + 0.02, -hw + 0.005), (rr + 0.075, -hw - 0.003), (rw - 0.035, -hw + 0.006), (rw - 0.007, -hw * 0.82), (rw, -hw * 0.5),
            (rw, hw * 0.5), (rw - 0.007, hw * 0.82), (rw - 0.035, hw - 0.006), (rr + 0.075, hw + 0.003), (rr + 0.02, hw - 0.005), (rr - 0.012, hw - 0.03)]
    if lod == 2: tyre = [(rr, -hw), (rw - 0.01, -hw * 0.9), (rw, -hw * 0.5), (rw, hw * 0.5), (rw - 0.01, hw * 0.9), (rr, hw)]
    parts.append(lathe(tyre, ring, 'z', 0x141414, 3))
    # rim: dark dish, bright lip, spokes, cap
    zf = hw - 0.035
    if lod == 0:
        parts.append(lathe([(0.01, zf - 0.005), (rr - 0.012, zf), (rr - 0.003, hw - 0.012), (rr - 0.003, -hw + 0.06), (0.01, -hw + 0.06)], 28, 'z', 0x1b1c1f, 8))
        lip = [(rr - 0.012 + 0.014 * math.cos(a), hw - 0.012 + 0.014 * math.sin(a)) for a in np.linspace(-0.6, math.pi * 0.9, 8)]
        parts.append(lathe(lip, 28, 'z', 0xb9bec3, 6))
        for k in range(5):
            a = k * 2 * math.pi / 5
            poly = np.array([(0.035, -0.021), (rr - 0.012, -0.030), (rr - 0.012, 0.030), (0.035, 0.021)])
            sp = prism(poly, zf - 0.004, zf + 0.022, 0xc3c8cc, 6)
            sp.xform(R('z', a)); parts.append(sp)
        parts.append(lathe([(0.0, zf + 0.03), (0.036, zf + 0.026), (0.046, zf + 0.012), (0.046, zf - 0.004)], 14, 'z', 0xb0b5ba, 6))
        for k in range(5):
            a = k * 2 * math.pi / 5 + math.pi / 5
            n_ = lathe([(0.0, 0.012), (0.009, 0.012), (0.009, 0.0)], 6, 'z', 0x9a9fa5, 6); n_.xform(T(0.075 * math.cos(a), 0.075 * math.sin(a), zf + 0.012)); parts.append(n_)
        # brake disc + caliper behind the spokes
        parts.append(lathe([(0.105, -hw + 0.09), (0.158, -hw + 0.09), (0.158, -hw + 0.112), (0.105, -hw + 0.112)], 24, 'z', 0x6a6e73, 6))
        cal = box(0, 0.115, -hw + 0.1, 0.09, 0.07, 0.07, 0x2b2e33, 8); cal.xform(R('z', 0.5)); parts.append(cal)
    elif lod == 1:
        parts.append(lathe([(0.01, zf), (rr - 0.003, hw - 0.012), (rr - 0.003, -hw + 0.06), (0.01, -hw + 0.06)], 16, 'z', 0x1b1c1f, 8))
        parts.append(lathe([(rr - 0.012, hw - 0.012), (rr, hw - 0.012), (rr, hw - 0.03)], 16, 'z', 0xb9bec3, 6))
        for k in range(5):
            a = k * 2 * math.pi / 5; sp = box(0.12, 0, zf + 0.008, rr - 0.05, 0.05, 0.03, 0xc3c8cc, 6); sp.xform(R('z', a)); parts.append(sp)
        parts.append(lathe([(0.105, -hw + 0.09), (0.158, -hw + 0.09), (0.158, -hw + 0.112), (0.105, -hw + 0.112)], 12, 'z', 0x6a6e73, 6))
    else:
        parts.append(lathe([(0.0, hw - 0.02), (rr, hw - 0.02)], 8, 'z', 0x9a9fa5, 6))
    return merge(parts)

# ------------------------------------------------------------------ details
def details(B, lod):
    """things bolted to the shell: mirrors, handles, plates, exhaust, grille bars, wipers, antenna. returns (right_half_parts, centre_parts)"""
    p = B.p; R_ = []; Cn = []
    d_f, d_m, d_r = p['doors']
    be = lambda x: float(np.minimum(B.f_belt(np.array(x)), B.f_top(np.array(x)) - 0.012))
    # mirror: housing (paint) + dark glass face
    mx, my, mz = p['mirror'][0] - 0.02, be(p['mirror'][0]) + 0.045, float(B.f_w(np.array(p['mirror'][0]))) + 0.03
    if lod >= 2:
        R_.append(box(mx, my, mz, 0.11, 0.07, 0.10, 0x101012, 8))
    else:
        h = lathe([(0.0, -0.5), (0.5, -0.45), (0.88, -0.2), (1.0, 0.0), (0.88, 0.25), (0.5, 0.4), (0.0, 0.45)], 14 if lod == 0 else 8, 'x', PAINT, 1)
        h.xform(S(0.17, 0.09, 0.07)); h.xform(R('y', 0.0)); h.xform(T(mx, my, mz + 0.03)); R_.append(h)
        R_.append(box(mx - 0.01, my - 0.035, mz - 0.05, 0.05, 0.03, 0.1, 0x151517, 8))          # stalk
        g = box(mx - 0.082, my, mz + 0.03, 0.006, 0.07, 0.115, 0x1a1c1f, 6); R_.append(g)       # mirror glass
    if lod == 0:
        for xx in (d_m + 0.11, d_r + 0.13):                                                         # door handles
            xx2 = xx; zw = float(B.f_w(np.array(xx2))) - 0.004; yh = be(xx2) - 0.095
            R_.append(box(xx2, yh, zw + 0.004, 0.13, 0.022, 0.016, 0xb4b9be, 6))
        # side marker / fender repeater skipped. wipers
        wa, wb_ = p['wind']; xw = wb_ - 0.04; yw = float(B.f_top(np.array(xw))) + 0.004
        for zz in (0.18, 0.62):
            wp = box(xw, yw + 0.006, zz, 0.01, 0.006, 0.42, 0x0c0c0e, 8)
            wp.xform(T(-xw, -(yw + 0.006), -zz)); wp.xform(R('x', 0.0)); wp.xform(T(xw, yw + 0.006, zz)); Cn.append(wp)
    # plates + exhaust + bumper lip
    xf, xr = p['xf'], p['xr']
    Cn.append(box(xf + 0.045, 0.46, 0.0, 0.012, 0.115, 0.30, 0xdedfe0, 0))
    Cn.append(box(xr - 0.052, 0.58 if True else 0.5, 0.0, 0.012, 0.115, 0.30, 0xdedfe0, 0))
    if lod < 2:
        for zz in (-0.62, 0.62):
            e = lathe([(0.0, 0.0), (0.04, 0.0), (0.04, 0.18), (0.034, 0.18), (0.034, 0.02)], 10, 'x', 0xb9bec3, 6); e.xform(T(xr + 0.0, 0.29, zz)); Cn.append(e)
        # grille bars + lower intake slats
        for k in range(5):
            Cn.append(box(xf + 0.03, 0.43 + k * 0.045, 0.0, 0.006, 0.012, 0.74, 0x3a3d42, 6))
        Cn.append(box(xf + 0.05, 0.505, 0.0, 0.012, 0.22, 0.012, 0x3a3d42, 6)) if lod == 0 else None
    return R_, Cn

# ------------------------------------------------------------------ interior (L0)
def interior(B, shell_xs):
    p = B.p; parts = []
    x_f, x_r = p['wind'][1] - 0.02, p['rwin'][0] + 0.04
    if p['trunk'][0] == p['trunk'][1]: x_r = p['xr'] + 0.35
    # a room: the shell of the greenhouse and the doors, flipped, a little inside
    us = np.linspace(x_r, x_f, 12); vs = np.array([.30, .36, .42, .48, .52, .58, .64, TWIN, .78, .86, .93, 1.0])
    def f(U, V): return B.surf(U, V) + np.array([0, -0.03, -0.045])
    def cls(x, t): return (C(0x8e8a83), 8, 2) if t > 0.70 else (C(0x25272a), 8, 2)
    r = grid(f, us, vs, classify=cls, ref=(0, 0.7, 0)); r.flip(); parts.append(r)
    ysill = float(B.f_bot(np.array(0.0))) + 0.13
    parts.append(box((x_f + x_r) / 2, ysill + 0.03, 0, x_f - x_r, 0.04, 1.5, 0x1f1d1b, 8, 2))          # floor
    parts.append(box(x_f + 0.01, 0.72, 0, 0.03, 0.5, 1.5, 0x1c1c1f, 8, 2))                               # firewall
    parts.append(box(x_r - 0.01, 0.74, 0, 0.03, 0.46, 1.5, 0x1c1c1f, 8, 2))                                 # rear bulkhead
    # dash, console, steering wheel
    dx0 = x_f - 0.38
    parts.append(box((dx0 + x_f) / 2, ysill + 0.40, 0, x_f - dx0 - 0.02, 0.17, 1.46, 0x1d1d20, 8, 2))
    parts.append(box(dx0 + 0.06, ysill + 0.52, 0, 0.18, 0.07, 1.4, 0x232326, 8, 2))
    parts.append(box(dx0 + 0.55, ysill + 0.14, 0, 0.9, 0.17, 0.2, 0x202023, 8, 2))
    sw = lathe([(0.19 - 0.016 + 0.016 * math.cos(a), 0.016 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 9)][:-1] + [(0.19 - 0.016 + 0.016, 0.0)], 20, 'x', 0x151517, 8)
    sw.xform(R('z', 0.45)); sw.xform(T(dx0 + 0.13, ysill + 0.58, -0.38)); parts.append(sw)
    parts.append(box(dx0 + 0.07, ysill + 0.52, -0.38, 0.12, 0.1, 0.12, 0x1c1c1f, 8, 2))
    # seats
    def seat(x, z, w=0.5):
        base = box(x, ysill + 0.10, z, 0.50, 0.12, w, 0x2f2b27, 8, 2)
        back = box(x - 0.2, ysill + 0.38, z, 0.12, 0.50, w, 0x2f2b27, 8, 2); back.xform(T(-(x - 0.2), -(ysill + 0.38), 0)); back.xform(R('z', 0.18)); back.xform(T(x - 0.2, ysill + 0.38, 0))
        head = box(x - 0.27, ysill + 0.70, z, 0.07, 0.17, 0.2, 0x2a2623, 8, 2)
        return [base, back, head]
    xs = (x_f + x_r) / 2
    for z in (-0.38, 0.38): parts += seat(xs + 0.28, z)
    rear_x = x_r + 0.33
    for z in (-0.4, 0.4): parts += seat(rear_x, z)
    return merge(parts)

def lamp_housing_and_misc(B, lod): return []

def build_car(name, lod, extra_roof=None):
    """-> dict of build-space Meshes: 'body' (opaque faces), 'glass' (L0 panes, tag 1)"""
    B = Body(name, lod); p = B.p
    half, (us, vs) = build_shell(B, lod)
    rparts = [half]
    # wheels + liners
    for xw in (p['wb'], -p['wb']):
        w = wheel(p, lod); w.xform(T(xw, p['rw'], p['wz'])); rparts.append(w)
        if lod < 1:
            ra = arch_r(p)
            liner = lathe([(ra, 0.90), (ra, 0.50), (0.0, 0.5)], 24 if lod == 0 else 12, 'z', 0x0a0a0b, 8, outward=False, start=-1.75, sweep=3.5); liner.xform(T(xw, p['rw'], 0)); rparts.append(liner)
    R_, Cn = details(B, lod)
    rparts += R_
    right = merge(rparts)
    full = right.mirror_z()
    cn = [full] + Cn
    if lod == 0: cn.append(interior(B, None))
    return cn, B
