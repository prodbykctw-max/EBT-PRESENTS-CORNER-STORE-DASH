#!/usr/bin/env python3
# python3 tools-store3d/flash_align.py <lightlooks.mjs flash_<look> dir>...: the 3D canvas frames (g###.png); each pair is lined up by the camera's scroll (best whole-pixel
# shift), then the largest change of mean brightness (0..255) over any 1/16 x 1/16 block, and over the whole overlap: what changes in the
# LIGHT, not what slides past because the camera follows the player.
import sys, glob, numpy as np
from PIL import Image
def L(f): a=np.asarray(Image.open(f).convert('RGB')).astype(np.float32); return 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
R=48
for d in sys.argv[1:]:
    fs=sorted(glob.glob(d+'/g*.png')); prev=None; worst=(0,None); worstF=0; ms=0
    for i,f in enumerate(fs):
        a=L(f); H,W=a.shape
        if prev is not None:
            best=None
            for dy in range(-R,R+1,2):
                for dx in range(-R,R+1,2):
                    A=a[R+dy:H-R+dy:3, R+dx:W-R+dx:3]; B=prev[R:H-R:3, R:W-R:3]; e=np.abs(A-B).mean()
                    if best is None or e<best[0]: best=(e,dy,dx)
            _,y0,x0=best
            for dy in range(y0-1,y0+2):
                for dx in range(x0-1,x0+2):
                    A=a[R+dy:H-R+dy, R+dx:W-R+dx]; B=prev[R:H-R, R:W-R]; e=np.abs(A-B).mean()
                    if e<=best[0]: best=(e,dy,dx)
            _,dy,dx=best; A=a[R+dy:H-R+dy, R+dx:W-R+dx]; B=prev[R:H-R, R:W-R]; h,w=A.shape; nb=16; bh,bw=h//nb,w//nb
            m=float(np.abs(A[:bh*nb,:bw*nb].reshape(nb,bh,nb,bw).mean((1,3))-B[:bh*nb,:bw*nb].reshape(nb,bh,nb,bw).mean((1,3))).max())
            worstF=max(worstF,abs(float(A.mean()-B.mean()))); ms=max(ms,abs(dy)+abs(dx))
            if m>worst[0]: worst=(m,(i,dy,dx))
        prev=a
    print(d.rstrip('/').split('/')[-1], f'frames {len(fs)}  largest block change after following the scroll: {worst[0]:.2f}/255 (frame, dy, dx {worst[1]})  largest whole-picture change: {worstF:.2f}/255  largest scroll {ms}px')
