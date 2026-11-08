import fs from 'fs';
// usage: node tools-bridge/clearance.mjs <repo root>  (no browser): ray-casts up from every street under a slab against the real freeway meshes (slab soffit and bent caps)
const root=(await import('path')).resolve(process.argv[2]||'.')+'/public/drive/';
const THREE=await import(root+'vendor/three.module.min.js');
const {makeGround}=await import(root+'city.js');const {RouteFrame}=await import(root+'runner.js');const {buildStreets}=await import(root+'roads.js');
const W=JSON.parse(fs.readFileSync(root+'world.json'));const ground=makeGround(W);const route=new RouteFrame(W,ground,200);
const st=buildStreets(W,ground,route,{});const fw=st.freeway;fw.group.updateMatrixWorld(true);
const kids=fw.group.children;const structure=kids.find(k=>k.name==='freeway_structure');const inst=kids.filter(k=>k.isInstancedMesh);
const ray=new THREE.Raycaster();ray.layers.enableAll();const up=new THREE.Vector3(0,1,0);
const hit=(x,y,z,objs)=>{ray.set(new THREE.Vector3(x,z,-y),up);ray.far=40;const h=ray.intersectObjects(objs,false);return h.length?h[0].distance:null;};
const rep=(name,pts)=>{let m=1e9,at;for(const [x,y,tag] of pts){const z=ground(x,y)+0.17+0.2;const hs=hit(x,y,z,[structure,inst[1]]);const hsoff=hit(x,y,z,[structure]);if(hs!==null&&hs+0.2<m){m=hs+0.2;at=[x.toFixed(0),y.toFixed(0),tag];}}console.log(name,'min clearance to anything (soffit or bent cap):',m.toFixed(2),at);};
const pts=[];for(let s=1000;s<=1100;s+=1)for(const dd of [-4,-2,0,2,4]){const q=route.at(s,dd);pts.push([q.x,q.y,'s'+s+' d'+dd]);}
rep('route s1000-1100',pts);
// every flat street crossing: sample streets
const DR=/^(primary|secondary|tertiary|residential|unclassified|living_street|trunk|motorway)(_link)?$|^service$/;
const ids=new Set(fw.pieces.map(r=>r.id));const sp=[];
W.roads.forEach((rd,id)=>{if(!DR.test(rd.cls)||ids.has(id))return;for(let i=0;i+1<rd.pts.length;i++){const [ax,ay]=rd.pts[i],[bx,by]=rd.pts[i+1],L=Math.hypot(bx-ax,by-ay);for(let t=0;t<L;t+=2)sp.push([ax+(bx-ax)*t/L,ay+(by-ay)*t/L,'road'+id+' '+rd.cls]);}});
rep('all streets under a slab',sp);
// streets with deck h>=5 only: filter by soffit hit distance < 12 -> fine
let n=0,low=0;for(const [x,y] of sp){const z=ground(x,y)+0.17+0.2;const h=hit(x,y,z,[structure,inst[1]]);if(h!==null&&h<12){n++;if(h+0.2<4.3)low++;}}console.log('street samples under a slab (2 m apart):',n,' of which < 4.3 m to the lowest part:',low);
const lows=new Map();for(const [x,y,tag] of sp){const z=ground(x,y)+0.17+0.2;const h=hit(x,y,z,[structure,inst[1]]);if(h!==null&&h+0.2<4.3){const k=tag;const o=lows.get(k)||{n:0,min:99,at:[x.toFixed(0),y.toFixed(0)]};o.n++;if(h+0.2<o.min){o.min=h+0.2;o.at=[x.toFixed(0),y.toFixed(0)];}lows.set(k,o);}}
console.log('streets still under 4.3 m:',JSON.stringify([...lows]));
