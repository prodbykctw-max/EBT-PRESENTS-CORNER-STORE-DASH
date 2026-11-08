// usage: node tools-bridge/measure.mjs <repo root>  (no browser) — builds the streets in node, measures clearance + piers independently
import fs from 'fs';
const root=(await import('path')).resolve(process.argv[2]||'.')+'/public/drive/';
const {makeGround}=await import(root+'city.js');
const {LEVEL,deckTop}=await import(root+'levels.js');
const {RouteFrame}=await import(root+'runner.js');
const {buildStreets}=await import(root+'roads.js');
const W=JSON.parse(fs.readFileSync(root+'world.json'));
const ground=makeGround(W);const route=new RouteFrame(W,ground,200);
const st=buildStreets(W,ground,route,{});
const fw=st.freeway;
console.log('stats',JSON.stringify(fw.stats),'pieces',fw.pieces.length,'columns',fw.piers?fw.piers.length/2:'(n/a)');
const DRIVABLE = /^(primary|secondary|tertiary|residential|unclassified|living_street|trunk|motorway)(_link)?$|^service$/;
// flat streets, independent of the build: raw OSM polylines (not elevated) + the route
const elevIds=new Set(fw.pieces.map(r=>r.id));
const flat=[];W.roads.forEach((rd,id)=>{if(!DRIVABLE.test(rd.cls)||rd.pts.length<2||elevIds.has(id))return;flat.push({id,cls:rd.cls,hw:rd.width/2,p:rd.pts});});
const rp=[];for(let s=0;s<=route.length;s+=1){const q=route.at(s);rp.push([q.x,q.y]);}
flat.push({id:'route',cls:'route',hw:null,p:rp});
const segD=(x,y,ax,ay,bx,by)=>{const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-ax-t*dx,y-ay-t*dy);};
const distPoly=(x,y,p)=>{let m=1e9;for(let i=0;i+1<p.length;i++)m=Math.min(m,segD(x,y,p[i][0],p[i][1],p[i+1][0],p[i+1][1]));return m;};
const nrm=(p)=>p.map((_,i)=>{const a=p[Math.max(0,i-1)],b=p[Math.min(p.length-1,i+1)];let dx=b[0]-a[0],dy=b[1]-a[1];const L=Math.hypot(dx,dy)||1;return[-dy/L,dx/L];});
let piers=[];
if(fw.piers){for(let k=0;k<fw.piers.length;k+=2)piers.push({x:fw.piers[k],y:fw.piers[k+1]});}
let onRoad=0;const list=[];
for(const pr of piers){let hit=null;for(const f of flat){const d=distPoly(pr.x,pr.y,f.p);const hw=f.hw??route.hw(route.project(pr.x,pr.y).s);if(d<hw+0.6){hit=f.id+':'+f.cls;break;}}
 if(hit){onRoad++;list.push(`${pr.x.toFixed(0)},${pr.y.toFixed(0)} on ${hit}`);}}
console.log('columns',piers.length,'on a street surface:',onRoad,list.join(' | '));
// clearance
const res=new Map();let worst=1e9, worstCap=1e9;
for(const f of flat){for(let i=0;i+1<f.p.length;i++){const [ax,ay]=f.p[i],[bx,by]=f.p[i+1],L=Math.hypot(bx-ax,by-ay);
 for(let t=0;t<L;t+=1.5){const x=ax+(bx-ax)*t/L,y=ay+(by-ay)*t/L;
  for(const e of fw.pieces){const q=e.p;let best=null;for(let k=0;k+1<q.length;k++){if(q[k][3]<=1.7)continue;const d=segD(x,y,q[k][0],q[k][1],q[k+1][0],q[k+1][1]);if(d<e.width/2&&(!best||d<best.d))best={d,k};}
   if(!best)continue;const A=e.p[best.k];
   const soffit=deckTop(ground,x,y,A[3])+e.lift-1.3, road=ground(x,y)+LEVEL.ROAD;const clr=soffit-road;
   const key=f.id+'|'+e.id;const o=res.get(key)||{street:f.id,cls:f.cls,deck:e.id,dcls:e.cls,min:1e9,at:null};if(clr<o.min){o.min=clr;o.at=[x,y,A[3]];}res.set(key,o);}}}}
const rows=[...res.values()].filter(o=>o.at[2]>=3).sort((a,b)=>a.min-b.min);
console.log('crossings (h>=3):',rows.length,' lowest 12:');
for(const o of rows.slice(0,12))console.log(`${o.street} (${o.cls}) under deck ${o.deck} (${o.dcls}) minClear ${o.min.toFixed(2)} at ${o.at.map(v=>v.toFixed(0))}`);
const rt=rows.filter(o=>o.street==='route');console.log('ROUTE crossings:',rt.map(o=>`${o.deck}:${o.min.toFixed(2)}`).join(' '));
// span check: max gap between consecutive columns of a deck handled in stats
console.log('deckLift at route s=1056:', ground.deckLift?ground.deckLift(-65.3,12.2).toFixed(2):'n/a');
