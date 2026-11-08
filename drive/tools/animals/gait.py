"""A trot made from the PitBull's own Walkl clip. The source Run clip curls the hind legs into hooks (checked against the source played in three.js: it is the source, not the
bake) and the source Walkl is a short shuffle (about 0.25 m of foot travel a cycle) whose front and back feet disagree. So the walk is re-timed into a diagonal trot (each leg
chain reads the clip at its own time offset so the legs move in diagonal pairs) and each leg's swing is scaled about its own mean (A) to give the stride a trot has; the
front and back scales are tuned so that front and back feet slide back at the same speed (no skating), and the body is lowered or lifted each frame so the planted foot is on the ground."""
import numpy as np

LEGS = {'bR': ['backRump_R_02', 'backHip_R_03', 'backKnee_R_04', 'backAnkle_R_00', 'backToes_R_05'],
        'bL': ['backRump_L_038', 'backHip_L_039', 'backKnee_L_040', 'backAnkle_L_041', 'backToes_L_042'],
        'fR': ['frontRump_R_017', 'frontHip_R_018', 'frontKnee_R_019', 'frontAnkle_R_020', 'frontToes_R_021'],
        'fL': ['frontRump_L_033', 'frontHip_L_034', 'frontKnee_L_035', 'frontAnkle_L_036', 'frontToes_L_037']}

def qmul(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])
def qconj(a): return np.array([-a[0], -a[1], -a[2], a[3]])
def qpow(q, k):
    q = q / np.linalg.norm(q)
    if q[3] < 0: q = -q
    ang = 2 * np.arccos(min(1.0, q[3])); s = np.sin(ang / 2)
    if s < 1e-7: return np.array([0, 0, 0, 1.0])
    ax = q[:3] / s; a2 = ang * k; return np.r_[ax * np.sin(a2 / 2), np.cos(a2 / 2)]

class Trot:
    def __init__(self, rig, clip, names, sc, tog):
        self.rig, self.clip, self.sc = rig, clip, sc; self.low = tog if tog is not None else 0.0
        self.idx = {n: rig.joints[names.index(n)] for c in LEGS.values() for n in c}      # node ids
        self.toe = {k: rig.joints[names.index(v[-1])] for k, v in LEGS.items()}
        ch = rig.anims[clip]; self.T = max(c[0].max() for c in ch.values())
        # mean rotation of every leg joint over the loop
        self.mean = {}
        for k, chain in LEGS.items():
            for n in chain:
                node = self.idx[n]; qs = []
                for i in range(48):
                    q = rig.sample(ch, node, 'rotation', i * self.T / 48, [0, 0, 0, 1]); qs.append(q if (not qs or q @ qs[0] >= 0) else -q)
                m = np.mean(qs, 0); self.mean[n] = m / np.linalg.norm(m)
        # the phase of each foot (fundamental of its fore-aft travel), then the shift that puts the legs in diagonal pairs
        ph = {}
        for k in LEGS:
            z = np.array([rig.pose(clip, i * self.T / 48)[self.toe[k]][2, 3] for i in range(48)])
            f = np.fft.rfft(z - z.mean())[1]; ph[k] = np.angle(f)
        base = ph['bR']; tgt = {'bR': base, 'fL': base, 'bL': base + np.pi, 'fR': base + np.pi}
        self.shift = {k: ((tgt[k] - ph[k]) / (2 * np.pi) * self.T) % self.T for k in LEGS}
        self.ph = ph
    def hooks(self, Ab, Af):
        tsh, qh = {}, {}
        for k, chain in LEGS.items():
            A = Ab if k[0] == 'b' else Af
            for j, n in enumerate(chain):
                node = self.idx[n]; tsh[node] = self.shift[k]; m = self.mean[n]
                Aj = A if j < 2 else 1 + (A - 1) * (self.low if j == 2 else self.low * 0.6)   # the stride comes from the hip: the knee, ankle and toes swing less (scaled as hard they fold the lower leg into a hook)
                qh[node] = (lambda q, m=m, A=Aj: qmul(m, qpow(qmul(qconj(m), q / np.linalg.norm(q)), A)))
        return tsh, qh
    def pose(self, t, Ab, Af):
        tsh, qh = self.hooks(Ab, Af)
        return self.rig.pose(self.clip, t, tshift=tsh, qhook=qh)

    def feet(self, Ab, Af, n=36):
        """toe positions (metres, source scale) per frame: {leg: (n, 3)}"""
        out = {k: [] for k in LEGS}
        for i in range(n):
            W = self.pose(i * self.T / n, Ab, Af)
            for k in LEGS: out[k].append(W[self.toe[k]][:3, 3] * self.sc)
        return {k: np.array(v) for k, v in out.items()}
    def stance_speeds(self, Ab, Af, n=36):
        """mean speed (m/s) at which each planted foot slides back relative to the body (the body's ground speed when the foot does not skate)"""
        n_ = n; F = self.feet(Ab, Af, n); out = {}
        for k, a in F.items():
            y, z = a[:, 1], a[:, 2]; st = y < y.min() + 0.012; m = st[:-1] & st[1:]
            out[k] = float(-np.mean((z[1:] - z[:-1])[m]) * n_ / self.T) if m.any() else 0.0
        return out
    def balance(self, Ab):
        """the front scale that makes the front feet slide back as fast as the back ones"""
        lo, hi = 0.5 * Ab, 2.5 * Ab
        for _ in range(18):
            mid = (lo + hi) / 2; s = self.stance_speeds(Ab, mid); f = (s['fR'] + s['fL']) / 2; b = (s['bR'] + s['bL']) / 2
            if f > b: hi = mid
            else: lo = mid
        return (lo + hi) / 2

    def balance_back(self, Af):
        """the back scale that makes the back feet slide back as fast as the front ones, for a front scale held where the shoulder stays closed"""
        lo, hi = 0.5 * Af, 2.5 * Af
        for _ in range(18):
            mid = (lo + hi) / 2; s = self.stance_speeds(mid, Af); f = (s['fR'] + s['fL']) / 2; b = (s['bR'] + s['bL']) / 2
            if b > f: hi = mid
            else: lo = mid
        return (lo + hi) / 2
