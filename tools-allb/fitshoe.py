# fit MakeHuman shoes (mhclo) to the base mesh: python3 -I fitshoe.py <makehuman data dir> <shoe dir>
import sys, numpy as np
def load_base(D):
    V=[]; 
    for l in open(D+'3dobjs/base.obj'):
        if l.startswith('v '): V.append([float(x) for x in l.split()[1:4]])
    return np.array(V)           # decimetres, helper verts included
def load_mhclo(path):
    sc={}; rows=[]; mode=None; dele=set()
    for l in open(path):
        p=l.split()
        if not p or p[0]=='#': continue
        if p[0]=='verts': mode='v'; continue
        if p[0]=='delete_verts': mode='d'; continue
        if mode=='v':
            if len(p)==1 and p[0].lstrip('-').isdigit(): rows.append([float(p[0])]*3+[1,0,0,0,0,0])
            elif len(p)==9 and p[0].isdigit(): rows.append([float(x) for x in p[:9]])
        elif mode=='d':
            toks=l.split(); i=0
            while i<len(toks):
                if i+2<len(toks) and toks[i+1]=='-': dele.update(range(int(toks[i]),int(toks[i+2])+1)); i+=3
                else: dele.add(int(toks[i])); i+=1
        elif mode is None and p[0] in ('x_scale','y_scale','z_scale'): sc[p[0][0]]=(int(p[1]),int(p[2]),float(p[3]))
    return sc, np.array(rows), dele
def fit(Vb, sc, rows):
    s=np.array([abs(Vb[sc[a][0],i]-Vb[sc[a][1],i])/sc[a][2] for i,a in enumerate('xyz')])
    idx=rows[:,:3].astype(int); w=rows[:,3:6]; off=rows[:,6:9]*s
    return (Vb[idx]*w[:,:,None]).sum(1)+off
def load_obj_faces(path):
    F=[]
    for l in open(path):
        if l.startswith('f '): F.append([int(t.split('/')[0])-1 for t in l.split()[1:]])
    return np.array(F)
