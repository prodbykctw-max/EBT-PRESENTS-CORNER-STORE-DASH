#!/usr/bin/env python3
"""Fetch the CC0 MakeHuman shoe assets the pedestrians wear, without downloading the multi-hundred-megabyte packs.

  python3 -I drive/tools/people/fetch_shoes.py --out <dir>        (then pass --shoes <dir> to build_people.py)

The packs are plain zip files on makehumancommunity.org; the server answers HTTP range requests, so only each pack's central directory and the few members
that are needed are read (about 1 MB in all):
  makehuman_system_assets_cc0.zip   clothes/shoes01 (lace-up dress shoe), clothes/shoes02 (sneaker)
  shoes01_cc0.zip                   clothes/toigo_ankle_boots_male (ankle boot, by Margaret Toigo)
The two system shoes' .mhclo headers say "This asset was explicitly released as CC0 in september 2020"; the boots' says "# license CC0" (author MRT).
Only the .obj and .mhclo of each shoe are read (the mesh and how it is fitted to MakeHuman's base mesh); the textures and the skin weights are not used: the shoes are
painted by the pedestrians' shader and skinned with the weights of the body they are fitted to. A generic User-Agent is sent.
"""
import argparse, json, os, struct, subprocess, zlib

PACKS = {
    'https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip': ['shoes01', 'shoes02'],
    'https://files2.makehumancommunity.org/asset_packs/shoes01/shoes01_cc0.zip': ['toigo_ankle_boots_male'],
}
UA = 'Mozilla/5.0 (X11; Linux x86_64)'


def curl(url, rng):
    r = subprocess.run(['curl', '-sS', '--fail', '-m', '120', '-A', UA, '-H', 'Range: bytes=' + rng, url], capture_output=True)
    if r.returncode:
        raise SystemExit(r.stderr.decode())
    return r.stdout


def central_directory(url):
    head = subprocess.run(['curl', '-sSI', '-m', '60', '-A', UA, url], capture_output=True, text=True).stdout
    size = int([l for l in head.splitlines() if l.lower().startswith('content-length')][-1].split(':')[1])
    tail_len = 400000
    tail = curl(url, f'{size - tail_len}-{size - 1}')
    i = tail.rfind(b'PK\x05\x06')
    n, cd_size, cd_off = struct.unpack('<HLL', tail[i + 10:i + 20])
    if cd_off < size - tail_len:
        tail = curl(url, f'{cd_off}-{size - 1}')
        base = cd_off
    else:
        base = size - tail_len
    p, out = cd_off - base, []
    while tail[p:p + 4] == b'PK\x01\x02':
        (_, _, _, _, comp, _, _, _, cs, us, nl, el, cl, _, _, _, off) = struct.unpack('<4sHHHHHHLLLHHHHHLL', tail[p:p + 46])
        out.append((tail[p + 46:p + 46 + nl].decode(), comp, cs, us, off))
        p += 46 + nl + el + cl
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    for url, names in PACKS.items():
        ents = central_directory(url)
        for name, comp, cs, us, off in ents:
            parts = name.split('/')
            if len(parts) != 3 or parts[0] != 'clothes' or parts[1] not in names or parts[2].rsplit('.', 1)[-1] not in ('obj', 'mhclo'):
                continue
            hdr = curl(url, f'{off}-{off + 29 + 1024 + cs}')
            nl, el = struct.unpack('<HH', hdr[26:30])
            data = hdr[30 + nl + el:30 + nl + el + cs]
            raw = zlib.decompress(data, -15) if comp == 8 else data
            assert len(raw) == us, name
            path = os.path.join(a.out, parts[1], parts[2])
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, 'wb').write(raw)
            print(path, us)
