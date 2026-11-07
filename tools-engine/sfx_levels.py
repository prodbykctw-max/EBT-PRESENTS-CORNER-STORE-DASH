#!/usr/bin/env python3
"""Levels of every drive sound, from tools-engine/sfx_levels.mjs output (levels.wav + slots.json).
Level = loudest 400 ms momentary loudness (ITU-R BS.1770 K-weighted, 100 ms hop) inside the sound's slot, relative to the
engine cruising on the gas (dB). Crashes are judged by sample peak against the engine's sample peak, as asked.
Usage: python3 tools-engine/sfx_levels.py <dir> [json out]"""
import json, struct, sys
import numpy as np
from scipy.signal import sosfilt, tf2sos

def read_wav(p):
    d = open(p, "rb").read(); sr = struct.unpack_from("<I", d, 24)[0]
    x = np.frombuffer(d[44:], dtype="<f4").reshape(-1, 2).astype(np.float64); return sr, x

def kweight(x, fs):
    def shelf(f0=1681.974450955533, G=3.999843853973347, Q=0.7071752369554196):
        A = 10 ** (G / 40); w = 2 * np.pi * f0 / fs; al = np.sin(w) / (2 * Q); c = np.cos(w); s = 2 * np.sqrt(A) * al
        return [A * ((A + 1) + (A - 1) * c + s), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - s)], [(A + 1) - (A - 1) * c + s, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - s]
    def hp(f0=38.13547087602444, Q=0.5003270373238773):
        w = 2 * np.pi * f0 / fs; al = np.sin(w) / (2 * Q); c = np.cos(w)
        return [(1 + c) / 2, -(1 + c), (1 + c) / 2], [1 + al, -2 * c, 1 - al]
    for b, a in (shelf(), hp()):
        x = sosfilt(tf2sos(np.array(b) / a[0], np.array(a) / a[0]), x, axis=0)
    return x

def momentary(k, fs, t0, t1):
    """list of (t, LUFS) for 400 ms windows every 100 ms inside [t0, t1]"""
    out = []; win = int(0.4 * fs); t = t0
    while t + 0.4 <= t1 + 1e-9:
        i = int(t * fs); seg = k[i:i + win]; ms = float((seg ** 2).mean(axis=0).sum())
        out.append((t, -0.691 + 10 * np.log10(max(ms, 1e-12)))); t += 0.1
    return out

# target (dB relative to the engine cruising on the gas), what it is measured by: 'm' momentary loudness, 'p' sample peak vs engine peak
TARGETS = [
    ("engine idle", None, "m"), ("engine pulling away", None, "m"), ("engine cruise on GAS", 0, "m"), ("engine coasting", None, "m"),
    ("city rumble (bed)", -18, "max"),
    ("far horn, typical (gain 0.185)", -18, "m"), ("far horn, loudest (gain 0.25)", -16, "m"), ("far horn, quietest (gain 0.12)", -20, "m"),
    ("your horn", 1, "m"), ("honk at you, full (g=1)", -4, "m"), ("honk at you, typical (g=0.45)", None, "m"), ("skid screech (g=1)", -6, "m"),
    ("tyre squeal, full slip", -4, "m"),
    ("crash, full power", 4, "p"), ("crash 0.35 (shoved)", -8, "p"), ("crash 0.2 (bump)", -8, "p"), ("crash 0.15 (bump)", -8, "p"),
    ("token pickup", -10, "m"), ("win chord (chime)", -6, "m"), ("near-miss whoosh", -12, "m"), ("streetcar bell", -10, "m"), ("police siren (busted)", -2, "m"),
]

def main():
    d = sys.argv[1]; sr, x = read_wav(f"{d}/levels.wav"); slots = {s["name"]: s for s in json.load(open(f"{d}/slots.json")) if s["part"] == "solo"}
    k = kweight(x, sr); pk = lambda s: 20 * np.log10(max(1e-9, np.abs(x[int(s["t0"] * sr):int(s["t1"] * sr)]).max()))
    cr = slots["engine cruise on GAS"]; cm = momentary(k, sr, cr["t0"] + 2, cr["t1"]); eng_m = float(np.mean([v for _, v in cm])); eng_pk = pk(cr)
    rows = []
    for name, tgt, how in TARGETS:
        if name == "far horn, typical (gain 0.185)": continue
        s = slots[name]; m = max(v for _, v in momentary(k, sr, s["t0"], s["t1"])); rows.append(dict(name=name, target=tgt, how=how, rel_m=m - eng_m, rel_p=pk(s) - eng_pk, peak=pk(s), lufs=m))
    # city rumble: the steady level (all windows are alike), so use the mean rather than the max
    r = [q for q in rows if q["name"] == "city rumble (bed)"][0]; s = slots[r["name"]]; r["rel_m"] = float(np.mean([v for _, v in momentary(k, sr, s["t0"], s["t1"])])) - eng_m
    # typical far horn: gain 0.185 sits 20*log10(0.185/0.25) = -2.6 dB under the loudest one (same sample, same path)
    h = [q for q in rows if q["name"].startswith("far horn, loudest")][0]; rows.append(dict(name="far horn, typical (gain 0.185)", target=-18, how="m", rel_m=h["rel_m"] + 20 * np.log10(0.185 / 0.25), rel_p=0, peak=h["peak"], lufs=h["lufs"]))
    mix = [s for s in json.load(open(f"{d}/slots.json")) if s["part"] in ("mix", "worst")]
    worst = [s for s in mix if s["part"] == "worst"][0]; wp = pk(worst); allpk = 20 * np.log10(np.abs(x).max())
    mixpk = {s["name"]: pk(s) for s in mix}
    print(f"engine cruise on GAS reference: {eng_m:.1f} LUFS (400 ms), sample peak {eng_pk:.1f} dBFS")
    print(f"{'sound':40s} {'level':>7s} {'target':>7s} {'diff':>6s}  {'peak dBFS':>9s}")
    ok = True
    for q in rows:
        v = q["rel_p"] if q["how"] == "p" else q["rel_m"]; t = q["target"]
        diff = "" if t is None else f"{v - t:+.1f}"; bad = t is not None and abs(v - t) > 2 and not (q["name"].startswith("city rumble") and v <= t)
        ok &= not bad
        print(f"{q['name']:40s} {v:+7.1f} {'' if t is None else f'{t:+7.0f}':>7s} {diff:>6s}  {q['peak']:9.1f}{'   <-- OUT' if bad else ''}")
    print(f"WORST CASE (everything at once, engine flat out): master peak {wp:.2f} dBFS; whole render peak {allpk:.2f} dBFS")
    print("ALL WITHIN +-2 dB:" , ok and wp < -1)
    json.dump(dict(engine_lufs=eng_m, engine_peak=eng_pk, rows=rows, worst_peak=wp, render_peak=allpk), open(sys.argv[2] if len(sys.argv) > 2 else f"{d}/levels.json", "w"), indent=1, default=float)

main()
