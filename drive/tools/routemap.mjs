import fs from 'fs';
const d=JSON.parse(fs.readFileSync(new URL('../osm/auburn.json', import.meta.url),'utf8'));
const N=new Map(d.elements.filter(e=>e.type=='node').map(n=>[n.id,n]));
const B={s:33.7515,n:33.7625,w:-84.3960,e:-84.3740};const S=1400/((B.e-B.w)*92500);
const X=lo=>((lo-B.w)*92500*S).toFixed(1),Y=la=>((B.n-la)*111000*S).toFixed(1);
const H=Math.round((B.n-B.s)*111000*S);
const pts=w=>w.nodes.map(id=>N.get(id)).filter(Boolean).map(n=>X(n.lon)+','+Y(n.lat)).join(' ');
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${H}" viewBox="0 0 1400 ${H}" font-family="Arial"><rect width="100%" height="100%" fill="#1b1d22"/>`;
const ways=d.elements.filter(e=>e.type=='way'&&e.tags);
for(const w of ways)if(w.tags.building)svg+=`<polygon points="${pts(w)}" fill="#3a3f4a" stroke="#4a505c" stroke-width="0.5"/>`;
const rw={motorway:9,trunk:8,primary:7,secondary:6,tertiary:5,residential:4,motorway_link:4,primary_link:4,secondary_link:4,unclassified:4};
for(const w of ways){const s=rw[w.tags.highway];if(s)svg+=`<polyline points="${pts(w)}" fill="none" stroke="${/motorway/.test(w.tags.highway)?'#8a6d3b':'#6b717d'}" stroke-width="${s}" stroke-linecap="round"/>`}
// route: Centennial Olympic Park Dr -> Luckie St -> Auburn Ave to store (recomputed)
const drive=/^(primary|secondary|tertiary|residential|unclassified|primary_link|secondary_link|tertiary_link|trunk|trunk_link|living_street)$/;
const m=(a,b)=>Math.hypot((a.lat-b.lat)*111000,(a.lon-b.lon)*92500);const G=new Map();const add=(a,b)=>{if(!G.has(a))G.set(a,[]);G.get(a).push([b,m(N.get(a),N.get(b))])};
for(const w of ways){if(!drive.test(w.tags.highway||''))continue;const ow=w.tags.oneway;for(let i=0;i+1<w.nodes.length;i++){const a=w.nodes[i],b=w.nodes[i+1];if(!N.get(a)||!N.get(b))continue;if(ow!=='-1')add(a,b);if(!['yes','true','1'].includes(ow))add(b,a);if(ow==='-1')add(b,a)}}
const near=(la,lo)=>{let b,bd=1e9;for(const id of G.keys()){const x=m(N.get(id),{lat:la,lon:lo});if(x<bd){bd=x;b=id}}return b};
const s=near(33.7603,-84.3927),t=near(33.7556,-84.3772);const dist=new Map([[s,0]]),prev=new Map(),Q=[[0,s]];
while(Q.length){Q.sort((a,b)=>a[0]-b[0]);const [dd,u]=Q.shift();if(u===t)break;for(const [v,l] of G.get(u)||[]){if(dd+l<(dist.get(v)??1e9)){dist.set(v,dd+l);prev.set(v,u);Q.push([dd+l,v])}}}
const rp=[];let u=t;while(u){rp.unshift(N.get(u));u=prev.get(u)}
svg+=`<polyline points="${rp.map(n=>X(n.lon)+','+Y(n.lat)).join(' ')}" fill="none" stroke="#ff3b3b" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`;
const pin=(la,lo,txt,c,dy=-14)=>svg+=`<circle cx="${X(lo)}" cy="${Y(la)}" r="8" fill="${c}" stroke="#fff" stroke-width="2"/><text x="${X(lo)}" y="${+Y(la)+dy}" fill="#fff" font-size="17" font-weight="bold" text-anchor="middle" stroke="#1b1d22" stroke-width="4" paint-order="stroke">${txt}</text>`;
pin(rp[0].lat,rp[0].lon,'START · Centennial Olympic Park','#3bd16f');
pin(33.7556,-84.3772,'EBT CORNER STORE + JJ\'s','#ffcc00',28);
for(const [n,la,lo] of [['Apex Museum',33.75543,-84.38310],['Big Bethel AME',33.75586,-84.38047],['John Lewis Mural',33.75537,-84.38050],['Ebenezer Baptist',33.75514,-84.37421],['Five Points',33.7538,-84.3905],['Peachtree St',33.7575,-84.3870]])pin(la,lo,n,'#5aa0ff',n=='John Lewis Mural'?30:-14);
svg+=`<text x="20" y="${H-50}" fill="#fff" font-size="22" font-weight="bold">Route: ${Math.round(dist.get(t))} m · Centennial Olympic Park Dr → Luckie St → Auburn Ave (full length, under the Connector)</text><text x="20" y="${H-22}" fill="#aab" font-size="16">Gray = real OSM streets · brown = I-75/85 Downtown Connector · map data © OpenStreetMap contributors</text></svg>`;
fs.writeFileSync(new URL('../route_v1.svg', import.meta.url),svg);console.log('ok',Math.round(dist.get(t)),H);
