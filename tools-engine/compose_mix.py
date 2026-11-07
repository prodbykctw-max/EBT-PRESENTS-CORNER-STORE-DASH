#!/usr/bin/env python3
"""Compose the before/after sound video: the 15 s drive (BEFORE then AFTER, each with its own recorded sound and a caption of
what is happening), then the sampler (every sound once, BEFORE then AFTER for each, labelled; the engine cruising under it, as in
the game). Usage: compose_mix.py <work dir with mix/before mix/after lv/before lv/after> <out.mp4>"""
import json, os, struct, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W0, H0, BAR = 390, 844, 90
F = lambda sz, b=True: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if b else ""), sz)
R = sys.argv[1]; OUT = sys.argv[2]
SIDES = (("before", "BEFORE (live now)", (235, 235, 235)), ("after", "AFTER", (255, 214, 0)))

def read_wav(p, f32=False):
    d = open(p, "rb").read(); sr = struct.unpack_from("<I", d, 24)[0]
    x = np.frombuffer(d[44:], dtype="<f4" if f32 else "<i2").reshape(-1, 2).astype(np.float64)
    return sr, x if f32 else x / 32768
def write_wav(p, x, sr=44100):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2"); n = len(pcm)
    h = b"RIFF" + struct.pack("<I", 36 + n * 4) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 2, sr, sr * 4, 4, 16) + b"data" + struct.pack("<I", n * 4)
    open(p, "wb").write(h + pcm.tobytes())

def bar(c, title, col, label, lcol):
    d = ImageDraw.Draw(c); H = c.size[1]
    d.text((12, H - BAR + 8), title, font=F(22), fill=col)
    tw = d.textlength(label, font=F(15)); d.rounded_rectangle((12, H - BAR + 46, 12 + tw + 22, H - BAR + 74), 7, fill=lcol); d.text((23, H - BAR + 50), label, font=F(15), fill=(255, 255, 255))

# ---- 1. the drive
def labels(side):
    T = json.load(open(f"{R}/mix/{side}/trace.json")); inp = json.load(open(f"{R}/mix/before/inputs.json")); out = []
    log = T["log"]
    for k in range(900):
        t = k / 60; lab, col = None, None
        for l in log:   # sounds that came from the game itself in the last 0.9 s
            if 0 <= (k - l["k"]) / 60 < 0.9 and l["m"] in ("honkAt", "crash", "token", "air", "bell", "siren"):
                lab, col = {"honkAt": "A CAR HONKS AT YOU", "crash": "CRASH", "token": "TOKEN +25", "air": "NEAR MISS", "bell": "STREETCAR BELL", "siren": "SIREN"}[l["m"]], (190, 60, 60)
        if not lab and any(0 <= (k - l["k"]) / 60 < 0.7 and l["m"] == "horn" for l in log): lab, col = "YOUR HORN", (200, 120, 20)
        if not lab and any(e[1] in ("ArrowLeft", "ArrowRight") and e[0] == "down" and 0 <= (k - j) / 60 < 1.0 for j in range(max(0, k - 60), k + 1) for e in inp[j]["ev"]): lab, col = "LANE CHANGE", (90, 80, 200)
        if not lab:
            g = inp[k]["gas"]
            if g and (6.5 <= t < 6.9 or 7.6 <= t < 8.0): lab, col = "GAS TAP", (40, 170, 70)
            elif g: lab, col = "GAS ON", (40, 170, 70)
            elif t < 0.8: lab, col = "idle", (60, 60, 66)
            else: lab, col = "off the gas (coasting)", (60, 60, 66)
        out.append((lab, col))
    return out

os.makedirs(f"{R}/c", exist_ok=True)
k = 0
for side, title, tc in SIDES:
    for i, (lab, col) in enumerate(labels(side)):
        im = Image.open(f"{R}/mix/{side}/f{i:04d}.jpg").convert("RGB"); c = Image.new("RGB", (W0, H0 + BAR), (16, 16, 18)); c.paste(im, (0, 0))
        bar(c, title, tc, lab, col); c.save(f"{R}/c/d{k:04d}.png"); k += 1
drive_wav = np.concatenate([read_wav(f"{R}/mix/{s}/audio.wav")[1] for s, _, _ in SIDES]); write_wav(f"{R}/drive.wav", drive_wav)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "60", "-i", f"{R}/c/d%04d.png", "-i", f"{R}/drive.wav", "-vf", "scale=780:-2:flags=lanczos", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", "60", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-shortest", f"{R}/drive.mp4"], check=True)

# ---- 2. the sampler
PICK = [("engine cruising on GAS (reference)", "engine cruising on the GAS (the 0 dB reference)", 3.0), ("your HORN", "your HORN", 2.6), ("another car HONKS at you", "another car HONKS at you", 2.6), ("...and skids", "...and skids", 2.6),
        ("TYRES squeal (lane change)", "TYRES squeal (full slip)", 2.6), ("small BUMP (0.2)", "small BUMP", 2.6), ("SHOVED (0.35)", "SHOVED by the bully", 2.6), ("big CRASH", "big CRASH", 3.2),
        ("TOKEN pickup", "TOKEN pickup", 2.4), ("near-miss WHOOSH", "NEAR MISS whoosh", 2.4), ("streetcar BELL", "STREETCAR bell", 3.0), ("WIN chord (parked)", "WIN chord", 2.6), ("POLICE SIREN (busted)", "POLICE SIREN (busted)", 5.5)]
sl = {s: {x["name"]: x for x in json.load(open(f"{R}/lv/{s}/slots.json")) if x["part"] == "mix"} for s, _, _ in SIDES}
aud = {s: read_wav(f"{R}/lv/{s}/levels.wav", True)[1] for s, _, _ in SIDES}
lines, wavs, n = [], [], 0
def card(title, tc, label, sub):
    c = Image.new("RGB", (W0, H0 + BAR), (16, 16, 18)); d = ImageDraw.Draw(c)
    d.text((W0 // 2, 250), "SOUND TEST", font=F(15), fill=(120, 120, 128), anchor="mm")
    words, ln, rows = label.split(), "", []
    for w in words:
        if d.textlength((ln + " " + w).strip(), font=F(30)) > W0 - 40: rows.append(ln); ln = w
        else: ln = (ln + " " + w).strip()
    rows.append(ln)
    for j, r in enumerate(rows): d.text((W0 // 2, 330 + j * 42), r, font=F(30), fill=(255, 255, 255), anchor="mm")
    d.text((W0 // 2, 330 + len(rows) * 42 + 30), sub, font=F(14, False), fill=(150, 150, 158), anchor="mm")
    bar(c, title, tc, "sound only, in the game's mix", (60, 60, 66)); return c
for name, label, dur in PICK:
    for side, title, tc in SIDES:
        s = sl[side][name]; a = int((s["t0"] - 0.25) * 44100); seg = aud[side][a:a + int(dur * 44100)].copy()
        f = int(0.03 * 44100); seg[-f:] *= np.linspace(1, 0, f)[:, None]; wavs.append(seg)
        p = f"{R}/c/s{n:03d}.png"; card(title, tc, label, "engine cruising + city under it").save(p); lines += [f"file '{p}'", f"duration {dur}"]; n += 1
lines.append(f"file '{p}'")
open(f"{R}/samp.txt", "w").write("\n".join(lines)); write_wav(f"{R}/samp.wav", np.concatenate(wavs))
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", f"{R}/samp.txt", "-i", f"{R}/samp.wav", "-vf", "scale=780:-2:flags=lanczos,fps=60", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-shortest", f"{R}/samp.mp4"], check=True)

# ---- 3. join
open(f"{R}/join.txt", "w").write(f"file '{R}/drive.mp4'\nfile '{R}/samp.mp4'\n")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", f"{R}/join.txt", "-c", "copy", "-movflags", "+faststart", OUT], check=True)
print(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,nb_frames,duration", "-of", "compact", OUT], capture_output=True, text=True).stdout)
