# Builds title_signtap.b64's picture: the corner-store sign (frame rect x300..744, y850..938 of the title_store layer) with the painted
# CORNER STORE letters replaced by TAP TO START, rebuilt from the sign's own painted glyphs in the same box. Run from standalone/:
#   OUT=/some/dir python3 tools/build_title_sign.py ["TAP TO START"]   (writes a PNG; base64 the lossless WebP of it into title_signtap.b64)
import base64,io,re, numpy as np, cv2, sys
from PIL import Image
import os; OUT=os.environ.get("OUT","/tmp/")
WORD=sys.argv[1] if len(sys.argv)>1 else "TAP TO START"
s=re.sub(r'^data:[^,]*,','',open("title_store.b64").read().strip())
im=np.array(Image.open(io.BytesIO(base64.b64decode(s))).convert("RGBA"))
X0,Y0,X1,Y1=300,850,744,938
F=im[Y0:Y1,X0:X1].copy(); rgb=F[...,:3].astype(np.float32)
lum=0.3*rgb[...,0]+0.59*rgb[...,1]+0.11*rgb[...,2]
inner=np.zeros(lum.shape,bool); inner[863-Y0:928-Y0, 309-X0:735-X0]=True
M=(lum<150)&inner
L=cv2.dilate(M.astype(np.uint8),np.ones((5,5),np.uint8))>0          # the letters and their soft edges
# ---- the face without letters: a smooth glow (low-frequency fill from the letter-free pixels) + the face's own grain
w=(~L).astype(np.float32)
lo=np.zeros_like(rgb)
for sig in (6,):
    num=cv2.GaussianBlur(rgb*w[...,None],(0,0),sig); den=cv2.GaussianBlur(w,(0,0),sig)[...,None]
    lo=num/np.maximum(den,1e-3)
# fill holes progressively larger so the 50 px tall letter band gets a glow from above, below and the gaps
for sig in (10,16,24):
    num=cv2.GaussianBlur(rgb*w[...,None],(0,0),sig); den=cv2.GaussianBlur(w,(0,0),sig)[...,None]
    est=num/np.maximum(den,1e-3); need=(den[...,0]<0.25)[...,None]; lo=np.where(need,est,lo)
hfsrc=rgb-cv2.GaussianBlur(rgb,(0,0),2.5)
okp=np.argwhere(inner&~L)
rng=np.random.default_rng(7)
clean=rgb.copy()
ys,xs=np.where(L)
pick=okp[rng.integers(len(okp),size=len(ys))]
clean[ys,xs]=lo[ys,xs]+hfsrc[pick[:,0],pick[:,1]]
clean=np.clip(clean,0,255)
cl=0.3*clean[...,0]+0.59*clean[...,1]+0.11*clean[...,2]
A=np.clip((cl-lum)/np.maximum(cl-30,1),0,1)*L
A[A<0.1]=0
col=(rgb-(1-A[...,None])*clean)/np.maximum(A[...,None],0.05)
col=np.where(A[...,None]>0.6,col,np.nan)                              # trust colour only where the letter is solid
def glyph(x,w):
    c=col[19:74,x-1:x+w+1].copy(); a=A[19:74,x-1:x+w+1].copy()
    # edge pixels: colour from the nearest solid letter pixel
    bad=np.isnan(c[...,0]); 
    if bad.any():
        src=np.where(~bad); d,ix=cv2.distanceTransformWithLabels(bad.astype(np.uint8),cv2.DIST_L2,3,labelType=cv2.DIST_LABEL_PIXEL)
        lab2xy={l:(y,x) for l,(y,x) in zip(ix[~bad],zip(*src))}
        for y,x in zip(*np.where(bad)):
            yy,xx=lab2xy.get(ix[y,x],(y,x)); c[y,x]=c[yy,xx] if not np.isnan(c[yy,xx,0]) else (60,20,5)
    return c,a
T=glyph(291,31); O=glyph(325,32); R=glyph(362,30); S=glyph(258,30); E=glyph(397,28); N=glyph(133,34); C=glyph(24,32)
cr=lambda a,b: list(range(a-19,b-19+1))
Pc,Pa=R[0].copy(),R[1].copy(); Pa[cr(51,51)[0]:,12:]=0
Ac,Aa=O[0].copy(),O[1].copy()
def fill(dc,da,sc,rows,cols,srows):
    for i,r in enumerate(rows):
        for c in cols: dc[r,c]=sc[srows[i%len(srows)],c]; da[r,c]=1.0
for i,r in enumerate(cr(42,49)):
    for c in range(12,22):
        src=O[0][cr(33,40)[i],3+(c-12)%7]; Ac[r,c]=src*(0.62 if r in (cr(42,42)[0],cr(49,49)[0]) else 1.0); Aa[r,c]=1.0
Aa[cr(50,50)[0]:,12:22]=0
fill(Ac,Aa,O[0],cr(59,70),range(1,12),cr(33,44)); fill(Ac,Aa,O[0],cr(59,70),range(22,33),cr(33,44))
Aa[cr(71,71)[0]:,:]=0
# soften the hard synthetic edges a touch (like the painted anti-aliasing)
Aa=np.maximum(cv2.GaussianBlur(Aa,(0,0),0.45)*(Aa>0), Aa*0)  
G={'T':T,'O':O,'R':R,'S':S,'E':E,'N':N,'C':C,'P':(Pc,Pa),'A':(Ac,Aa)}
def ext(g): cols=np.where(g[1].max(0)>0.3)[0]; return cols.min(),cols.max()
parts=[' ' if ch==' ' else (ch,)+ext(G[ch]) for ch in WORD]
def lay(space):
    x=0; out=[]; prev=None
    for p in parts:
        if p==' ': x+=space; prev=None; continue
        ch,a,b=p
        if prev is not None: x+= 3 if ('T' in (prev,ch)) else 5
        out.append((ch,x-a)); x+=b-a+1; prev=ch
    return out,x
_,w0=lay(0); n=WORD.count(' '); space=(397-w0)/max(n,1); out,wt=lay(space)
left=324-X0; top=19
acc_c=np.zeros_like(rgb); acc_a=np.zeros(rgb.shape[:2],np.float32)
for ch,xo in out:
    c,a=G[ch]; xi=int(round(left+xo)); h,w_=a.shape
    sa=acc_a[top:top+h,xi:xi+w_]; sc_=acc_c[top:top+h,xi:xi+w_]; m=a>sa; sa[m]=a[m]; sc_[m]=c[m]
a3=acc_a[...,None]; res=clean*(1-a3)+np.nan_to_num(acc_c)*a3
o=F.copy(); o[...,:3]=np.clip(res,0,255).astype(np.uint8)
name=WORD.replace(' ','_').lower()
Image.fromarray(o).save(OUT+f"sign_{name}.png")
cf=F.copy(); cf[...,:3]=clean.astype(np.uint8); Image.fromarray(cf).save(OUT+"sign_clean.png")
Image.fromarray(F).save(OUT+"sign_orig.png")
print(name,"space",round(space,1),"width",wt)
