import fs from 'fs';
const d=JSON.parse(fs.readFileSync(new URL('../osm/auburn.json', import.meta.url),'utf8'));
const N=new Map(d.elements.filter(e=>e.type=='node').map(n=>[n.id,n]));
const drive=/^(primary|secondary|tertiary|residential|unclassified|primary_link|secondary_link|tertiary_link|trunk|trunk_link|living_street)$/;
const W=d.elements.filter(e=>e.type=='way'&&e.tags&&drive.test(e.tags.highway||'')&&e.tags.access!=='private');
const m=(a,b)=>Math.hypot((a.lat-b.lat)*111000,(a.lon-b.lon)*92500);
const G=new Map();const add=(a,b,w)=>{if(!G.has(a))G.set(a,[]);G.get(a).push([b,m(N.get(a),N.get(b)),w])};
for(const w of W){const ow=w.tags.oneway;for(let i=0;i+1<w.nodes.length;i++){const a=w.nodes[i],b=w.nodes[i+1];if(!N.get(a)||!N.get(b))continue;if(ow!=='-1')add(a,b,w);if(ow!=='yes'&&ow!=='true'&&ow!=='1')add(b,a,w);if(ow==='-1')add(b,a,w)}}
const near=(lat,lon)=>{let best,bd=1e9;for(const id of G.keys()){const x=m(N.get(id),{lat,lon});if(x<bd){bd=x;best=id}}return best};
function path(s,t){const dist=new Map([[s,0]]),prev=new Map(),Q=[[0,s]];while(Q.length){Q.sort((a,b)=>a[0]-b[0]);const [dd,u]=Q.shift();if(u===t)break;if(dd>dist.get(u))continue;for(const [v,l,w] of G.get(u)||[]){const nd=dd+l;if(nd<(dist.get(v)??1e9)){dist.set(v,nd);prev.set(v,[u,w]);Q.push([nd,v])}}}
 const names=[];let u=t;while(prev.has(u)){const [p,w]=prev.get(u);const nm=w.tags.name||w.tags.highway;if(names[0]!==nm)names.unshift(nm);u=p}return [Math.round(dist.get(t)),names]}
const store=near(33.7556,-84.3772); // Auburn Ave between Fort St and Hilliard St
// oneway info for Auburn
console.log('Auburn oneway tags:',[...new Set(W.filter(w=>/^Auburn/.test(w.tags.name||'')).map(w=>w.tags.oneway||'no'))]);
const starts={
 'Centennial Olympic Park (Andrew Young Intl & Centennial Olympic Park Dr)':[33.7603,-84.3927],
 'Five Points (Peachtree & Marietta/Decatur)':[33.7538,-84.3905],
 'State Capitol (MLK Dr & Washington St)':[33.7490,-84.3880],
 'Georgia State / Decatur St & Piedmont':[33.7527,-84.3825],
 'Peachtree Center (Peachtree & Ellis)':[33.7597,-84.3870],
 'Freedom Pkwy / Boulevard & North Ave (Old 4th Ward from north)':[33.7657,-84.3718],
};
for(const [k,[la,lo]] of Object.entries(starts)){const [len,names]=path(near(la,lo),store);console.log(len+'m','|',k,'\n   ',names.join(' -> '))}
