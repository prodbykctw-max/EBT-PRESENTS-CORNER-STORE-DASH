import sys, glob, numpy as np
from PIL import Image
d=sys.argv[1]; fs=sorted(glob.glob(d+'/f*.png'))
S=np.stack([np.asarray(Image.open(f).convert('RGB')).astype(float)@[0.2126,0.7152,0.0722] for f in fs])  # T,H,W
T=len(S); fps=20.0
# hysteresis cycle count per pixel: a cycle = a rise of >=A followed by a fall of >=A
A=20.0
lo=S[0].copy(); hi=S[0].copy(); state=np.zeros(S[0].shape,int); swings=np.zeros(S[0].shape,int)
for t in range(1,T):
    x=S[t]
    up=(x-lo>=A)&(state<=0); dn=(hi-x>=A)&(state>=0)
    swings+=up|dn
    state=np.where(up,1,np.where(dn,-1,state))
    lo=np.where(up|(x<lo),x,lo); hi=np.where(dn|(x>hi),x,hi)
    lo=np.where(dn,x,lo); hi=np.where(up,x,hi)
cyc=swings/2.0/(T/fps)
print(d,'frames',T,'max swing-cycles/s',cyc.max(),'pixels >1 cycle/s:',int((cyc>1).sum()),'pixels >0.5:',int((cyc>0.5).sum()),
      'frame mean range',S.mean((1,2)).min().round(1),S.mean((1,2)).max().round(1),'max frame-to-frame mean change',np.abs(np.diff(S.mean((1,2)))).max().round(2))
m=(cyc>1); Image.fromarray((np.clip(cyc/2,0,1)*255).astype(np.uint8)).save(d+'_cyc.png')
