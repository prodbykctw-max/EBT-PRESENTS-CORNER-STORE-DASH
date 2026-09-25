"""Cut the downloaded recordings into game-ready sound files in public/drive/sfx/.
Loops are WAV (MP3 encoder padding would put a gap in every loop); one-shots are mono MP3.
Sources (drive/ref/audio/, git-ignored) and licenses are listed in public/drive/sfx/CREDITS.txt.
Run: python drive/tools/build_sfx.py
"""
import os, subprocess, wave, struct, array

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "ref", "audio")
OUT = os.path.join(HERE, "..", "..", "public", "drive", "sfx")
FFMPEG = os.path.expanduser(r"~\AppData\Roaming\Python\Python314\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe")
os.makedirs(OUT, exist_ok=True)

def ff(*args):
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)

def norm(src, dst, peak_db=-1.0, extra="", rate=32000, mp3=True, start=None, dur=None):
    """Peak-normalise (two passes: measure, then gain) and encode mono."""
    cut = (["-ss", str(start)] if start is not None else []) + (["-t", str(dur)] if dur is not None else [])
    r = subprocess.run([FFMPEG, "-hide_banner", *cut, "-i", src, "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    mx = float(r.stderr.split("max_volume: ")[1].split(" dB")[0])
    af = f"volume={peak_db - mx}dB" + ("," + extra if extra else "")
    codec = ["-c:a", "libmp3lame", "-b:a", "96k"] if mp3 else ["-c:a", "pcm_s16le"]
    ff(*cut, "-i", src, "-ac", "1", "-ar", str(rate), "-af", af, *codec, dst)

def seamless(path, xfade_s=0.12):
    """Make a WAV loop seamless: crossfade its tail into its head (equal power), drop the tail."""
    with wave.open(path, "rb") as w:
        rate, n = w.getframerate(), w.getnframes(); data = array.array("h", w.readframes(n))
    x = int(rate * xfade_s)
    body = data[: n - x]
    for i in range(x):
        a = i / x
        body[i] = int(max(-32768, min(32767, data[n - x + i] * (1 - a) ** 0.5 + data[i] * a ** 0.5)))
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(body.tobytes())

S = lambda *p: os.path.join(SRC, *p)
O = lambda n: os.path.join(OUT, n)

# engine: on-throttle and off-throttle V8 loops (pitched by rpm at runtime)
norm(S("v8", "Acc_05570.wav"), O("engine_on.wav"), -3, mp3=False, rate=32000); seamless(O("engine_on.wav"), 0.08)
norm(S("v8", "Dec_05581.wav"), O("engine_off.wav"), -3, mp3=False, rate=32000); seamless(O("engine_off.wav"), 0.08)
# tyre squeal loop: 3 s from the middle of the 30 s take, made seamless
norm(S("bsb_0500.mp3"), O("squeal_loop.wav"), -3, mp3=False, rate=22050, start=8.0, dur=3.2); seamless(O("squeal_loop.wav"), 0.2)
# one-shots
norm(S("bsb_2370.mp3"), O("screech.mp3"), -1, extra="afade=t=out:st=1.6:d=0.5")
norm(S("bsb_0257.mp3"), O("horn.mp3"), -1)
norm(S("bsb_0258.mp3"), O("horn_far.mp3"), -6, extra="lowpass=f=2500")
norm(S("bsb_0339.mp3"), O("coin.mp3"), -2, extra="highpass=f=500")
for i, f in enumerate(["bfh1_metal_hit_02.ogg", "bfh1_metal_hit_04.ogg", "bfh1_metal_hit_06.ogg"], 1):
    norm(S("impacts", f), O(f"crash_metal_{i}.mp3"), -1)
norm(S("impacts", "bfh1_glass_breaking_01.ogg"), O("crash_glass.mp3"), -4)

total = 0
for f in sorted(os.listdir(OUT)):
    sz = os.path.getsize(O(f)); total += sz; print(f"{f:22s} {sz/1024:6.0f} KB")
print(f"sfx total {total/1024:.0f} KB")
