/* ============================================================
   CORNER STORE DASH — standalone EBT game
   The uploaded mockup IS the board: collision + nav are derived
   from its pixels at load (floor = light, obstacles = dark).
   ============================================================ */
"use strict";

var API_BASE = ""; // ← set to deployed Worker URL for the global leaderboard. Empty = local session scores.

var IW=853, IH=1844;          // board image dimensions
var MC=4, MW=Math.ceil(IW/MC), MH=Math.ceil(IH/MC);   // mask cells (4px)
var GC=16, GW=Math.ceil(IW/GC), GH=Math.ceil(IH/GC);  // nav cells (16px)

var PAL={pink:"#E85D9E",magenta:"#C2255C",gold:"#F5C518",cream:"#FFF3E0",coral:"#F08C4B",navy:"#1E2340"};

var ITEMS=[
 {id:"APPLE",       x:395,y:972, rows:[160], pts:100, icon:"APPLE"},
 {id:"CHIPS",       x:395,y:790, rows:[188], pts:100, icon:"CHIPS"},
 {id:"CHICKEN",     x:530,y:858, rows:[215], pts:100, icon:"CHICKEN"},
 {id:"LEMONADE",    x:395,y:608, rows:[243], pts:100, icon:"LEMONADE"},
 {id:"BREAD",       x:410,y:440, rows:[271], pts:100, icon:"BREAD"},
 {id:"MILK",        x:480,y:320, rows:[299], pts:100, icon:"MILK"},
 {id:"RICE & BEANS",x:530,y:292, rows:[327,355], pts:200, icon:"BEANS"}
];
var PADS=[[402,390,430,465],[402,550,430,635],[402,728,430,812]];
var SPAWN_P={x:415,y:1380}, SPAWN_B={x:650,y:320};
var PSPEED=260, B_IDLE=90, B_BASE=205, B_PER_ITEM=8, B_CAP=253;
var CATCH_R=30, PICK_R=36;
var BULLY_LINES=["HEY! YOU!","GIMME THAT!","GET BACK HERE!","THOSE ARE MINE!"];

/* ---------- state ---------- */
var S={mode:"boot",score:0,got:{},nGot:0,active:false,t:0,runT:0,muted:false,line:0};

/* ---------- haptics ----------------------------------------------------
   Every touch the player makes answers back. Patterns are deliberately
   short — a tick you feel and don't notice — except the three moments that
   should land in your hand: bagging an item, the list going complete, and
   getting caught.
   Independent of the mute button on purpose: mute is about not making noise
   in public, which is exactly when you still want the feel. iOS Safari does
   not implement the Vibration API, so this is a no-op there and the game is
   built to be complete without it. */
var HAPTICS = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
var hapLast = 0;
function haptic(pattern, minGapMs){
  if(!HAPTICS) return;
  var now = (typeof performance !== "undefined" ? performance.now() : Date.now());
  if(minGapMs && now - hapLast < minGapMs) return;
  hapLast = now;
  try{ navigator.vibrate(pattern); }catch(e){}
}
var HAP = {
  tap:      12,                    // any button
  turn:     16,                    // d-pad / joystick changes direction
  pick:     [0,22,45,22],          // item bagged
  listDone: [0,30,55,30,55,60],    // checkout just unlocked
  alert:    [0,45,70,45],          // the bully clocks you
  near:     9,                     // he is right behind you (throttled)
  caught:   [0,110,70,180],        // run over
  win:      [0,45,60,45,60,150]
};
var player=null, bully=null, bubbles=[];
var board=null, bctx=null, view=null, vctx=null;
var walk=null, field=null, nav=null;   // Uint8Array masks
var scale=1;

/* ---------- mask build ----------
   Collision geometry is measured, not guessed: a per-pixel floor
   classifier (bright + not blue-dominant, so it correctly rejects
   the storefront's blue window glass) traces natural shelf
   silhouettes, clipped against an accurately measured left/right
   wall-boundary curve (CLIP_L/CLIP_R, one sample per 4px mask row,
   read directly off the artwork — see /areas/corner-store-dash.md
   for how these were derived) so the aisles run their full true
   width instead of the old guessed wall-seal rectangles. A short
   list of explicit rects covers flat-colored props the classifier
   can't read correctly (signs, the mat, cart corrals). ---------- */
var CLIP_CY0=73;
var CLIP_L=[109,109,109,108,109,109,109,108,108,106,106,106,105,105,104,104,104,104,104,101,96,92,87,83,81,80,80,80,80,80,79,79,78,77,77,77,77,77,76,76,75,75,74,74,73,73,73,72,72,71,71,70,70,70,69,69,69,69,68,68,68,67,67,66,66,66,65,64,64,63,63,63,63,62,62,62,64,64,64,63,62,60,59,59,59,59,59,59,59,59,59,58,58,57,56,56,56,56,56,55,55,57,56,56,55,54,51,54,53,53,52,52,49,49,49,49,48,48,47,47,47,47,46,46,45,45,47,46,46,46,46,44,45,46,46,45,45,43,41,41,42,42,42,42,42,43,44,43,42,41,39,38,38,37,37,37,37,37,37,36,36,36,35,35,35,35,35,35,35,34,34,34,33,32,32,31,30,31,32,32,32,32,31,30,30,30,30,30,29,27,27,27,27,26,26,25,24,23,24,24,24,24,24,23,23,24,23,22,22,20,19,19,20,20,20,19,18,17,17,18,17,17,16,15,14,14,15,15,14,14,13,12,12,13,13,13,12,11,9,9,10,9,9,9,7,7,7,8,8,8,8,7,5,5,7,7,6,6,5,2,2,3,4,4,6,7,7,10,12,13,14,15,15,15,14,14,13,13,13,13,12,12,12,11,11,11,10,10,10,9,9,8,8,8,7,7,6,6,6,6,6,7,8,9,10,12,13,13,14,14,11,10,9];
var CLIP_R=[760,762,763,765,765,765,766,766,767,768,767,767,767,767,770,775,780,786,791,795,797,800,805,808,810,813,814,814,816,818,820,823,828,832,835,839,841,841,841,841,840,840,840,840,841,841,832,818,804,789,775,769,769,769,769,769,769,769,769,769,771,772,774,776,776,778,779,780,781,784,785,787,789,790,791,785,769,743,717,691,672,662,658,658,658,665,672,690,703,716,725,731,732,732,733,733,733,734,735,734,732,732,734,733,733,733,733,732,732,732,732,732,732,732,732,732,732,733,733,733,733,734,734,739,749,766,783,800,813,821,822,824,825,827,828,830,831,833,834,836,835,828,820,812,804,797,797,797,797,796,796,796,796,796,796,796,799,808,817,826,835,841,841,841,841,841,841,841,836,824,812,799,786,779,780,780,782,782,783,783,784,786,790,793,797,799,800,800,801,801,802,802,803,803,804,804,805,805,806,806,806,807,807,807,808,808,809,809,810,810,811,811,812,813,813,813,814,814,813,813,813,814,814,816,818,818,817,818,818,819,820,822,821,821,821,822,822,824,825,825,824,825,825,825,827,828,828,827,828,828,828,830,832,832,833,833,834,834,835,836,836,836,836,837,837,837,839,839,838,839,839,840,840,842,842,843,843,844,844,845,845,846,846,846,847,847,848,848,849,849,850,850,851,851,852,852,852,852,852,852,852,852,852,852,852,852,852,852,852,852,852,852,852];
function buildMasks(imgCanvas){
  var ctx=imgCanvas.getContext("2d");
  var data=ctx.getImageData(0,0,IW,IH).data;
  walk=new Uint8Array(MW*MH);
  function floorish(x,y){
    if(x<0||y<0||x>=IW||y>=IH) return 0;
    var i=(y*IW+x)*4, r=data[i],g=data[i+1],b=data[i+2];
    return ((r+g+b)/3>150 && b<r+40) ? 1 : 0;
  }
  for(var cy=0;cy<MH;cy++)for(var cx=0;cx<MW;cx++){
    var bx=cx*MC, by=cy*MC;
    var n=floorish(bx+1,by+1)+floorish(bx+3,by+1)+floorish(bx+1,by+3)+floorish(bx+3,by+3);
    walk[cy*MW+cx]=n>=3?1:0;
  }
  function setRect(x0,y0,x1,y1,v){
    for(var y=Math.max(0,y0/MC|0);y<Math.min(MH,Math.ceil(y1/MC));y++)
      for(var x=Math.max(0,x0/MC|0);x<Math.min(MW,Math.ceil(x1/MC));x++) walk[y*MW+x]=v;
  }
  setRect(0,0,IW,95,0);
  // accurate outer-wall clip, one measured row per mask cell
  for(var i=0;i<CLIP_L.length;i++){
    var cyy=CLIP_CY0+i; if(cyy>=MH) break;
    var loCell=Math.max(0,(CLIP_L[i]-1)/MC|0), hiCell=Math.min(MW,(CLIP_R[i]/MC|0)+2);
    for(var x3=0;x3<loCell;x3++) walk[cyy*MW+x3]=0;
    for(var x4=hiCell;x4<MW;x4++) walk[cyy*MW+x4]=0;
  }
  setRect(0,1540,IW,IH,0);
  // --- SIGNAGE IS AN OVERLAY, NOT A WALL ---------------------------------
  // Each aisle unit is a pink header banner sitting ON TOP of the shelf. In
  // top-down terms the banner is drawn over the floor BEHIND the shelf, so
  // it must be walkable — otherwise every horizontal lane is silently
  // narrowed by ~35px and some pinch shut entirely. The color classifier
  // can't know this (pink isn't floor-colored), so the banner strips are
  // measured off the art and forced walkable here. Same for the ENTRANCE
  // sign and the corner planter: flat props you walk past, not obstacles.
  // Only real furniture (shelf bodies, counters, cart corrals) blocks.
  var BANNERS=[[136,108,372,148],[497,108,741,148],[506,327,714,363],[127,352,391,387],
               [511,508,714,543],[115,531,391,565],[506,682,716,717],[95,721,382,756],
               [481,912,724,945],[72,918,391,951],[60,1095,388,1129],[456,1100,738,1133],
               [48,1285,376,1318],[449,1285,747,1320]];
  for(var bi=0;bi<BANNERS.length;bi++){ var bn=BANNERS[bi]; setRect(bn[0],bn[1],bn[2],bn[3],1); }
  setRect(728,575,800,845,1);   // ENTRANCE sign — overlay
  setRect(752,272,786,402,1);   // corner planter — overlay
  // entry / welcome mat / doorway: fully open floor, only the cart corrals block.
  // The band stops at y=1610 where the storefront floor actually ends. It used
  // to run to 1650, which opened a ~30px strip of pavement BELOW the corrals —
  // outside the store, shorter than the sprite, and the thing that made the
  // welcome mat feel like it grabbed you.
  setRect(14,1470,840,1610,1);
  setRect(18,1478,215,1610,0); setRect(588,1478,808,1610,0);   // cart corrals
  setRect(0,1610,IW,IH,0);
  // Top-left lane: the strip between the left wall and the Dairy shelf is real
  // floor, but a few small props sitting on it broke the color run into
  // fragments, so the flood fill dropped the whole lane and the top-left corner
  // was sealed. Props are overlays (see the ground rule above) — open the lane.
  setRect(108,100,138,300,1);
  setRect(0,0,10,IH,0); setRect(IW-8,0,IW,IH,0);
  // light despeckle: fill single-cell pits only (classifier + wall clip already leave a clean edge)
  var w2=new Uint8Array(walk);
  for(var y2=1;y2<MH-1;y2++)for(var x2=1;x2<MW-1;x2++){
    if(walk[y2*MW+x2]) continue;
    var s=0;
    for(var dy=-1;dy<=1;dy++)for(var dx=-1;dx<=1;dx++){ if(dx||dy) s+=walk[(y2+dy)*MW+x2+dx]; }
    if(s>=7) w2[y2*MW+x2]=1;
  }
  walk=w2;
  // playfield = flood from player spawn
  field=new Uint8Array(MW*MH);
  var q=[((SPAWN_P.y/MC|0)*MW+(SPAWN_P.x/MC|0))];
  field[q[0]]=1;
  while(q.length){
    var c=q.pop(), cx2=c%MW, cy2=(c/MW)|0;
    var nb=[c-1,c+1,c-MW,c+MW];
    for(var i=0;i<4;i++){
      var n2=nb[i];
      if(n2<0||n2>=MW*MH) continue;
      if(i===0&&cx2===0) continue; if(i===1&&cx2===MW-1) continue;
      if(!walk[n2]||field[n2]) continue;
      field[n2]=1; q.push(n2);
    }
  }
  // nav grid (16px): cell ok only if the actor box fits at its center
  nav=new Uint8Array(GW*GH);
  for(var gy=0;gy<GH;gy++)for(var gx=0;gx<GW;gx++){
    nav[gy*GW+gx]=boxFree(gx*GC+GC/2, gy*GC+GC/2)?1:0;
  }
}
function fieldAt(x,y){
  var cx=x/MC|0, cy=y/MC|0;
  if(cx<0||cy<0||cx>=MW||cy>=MH) return 0;
  return field[cy*MW+cx];
}
/* Collision box. Narrowed from +-9 to +-7 (and the head sample from -6 to -5)
   after the report that the top corners and the entry mat felt sticky: the
   store is drawn in perspective, so the lanes along the top-left and top-right
   walls taper to ~24px, and an 18px-wide box left barely 3px of slack there —
   enough to look walkable and feel jammed. 14px keeps the sprite honest
   against real furniture while giving the tapered corners room to breathe. */
function boxFree(x,y){
  return fieldAt(x-7,y)&&fieldAt(x+7,y)&&fieldAt(x-7,y-5)&&fieldAt(x+7,y-5)&&fieldAt(x,y+3);
}
function snapToField(x,y){
  if(boxFree(x,y)) return {x:x,y:y};
  for(var r=4;r<=120;r+=4){
    for(var a=0;a<16;a++){
      var t=a/16*6.2832, nx=Math.round(x+Math.cos(t)*r), ny=Math.round(y+Math.sin(t)*r);
      if(boxFree(nx,ny)) return {x:nx,y:ny};
    }
  }
  return {x:x,y:y};
}

/* ---------- BFS path (nav grid) ---------- */
var bfsPrev=new Int32Array(GW*GH), bfsMark=new Int32Array(GW*GH), bfsGen=0, bfsQ=new Int32Array(GW*GH);
function findPath(x0,y0,x1,y1){
  var s=((y0/GC|0)*GW+(x0/GC|0)), t=((y1/GC|0)*GW+(x1/GC|0));
  if(!nav[s]||!nav[t]) { // snap endpoints to nearest nav cell
    s=nearNav(x0,y0); t=nearNav(x1,y1);
    if(s<0||t<0) return null;
  }
  bfsGen++;
  var head=0, tail=0;
  bfsQ[tail++]=s; bfsMark[s]=bfsGen; bfsPrev[s]=-1;
  while(head<tail){
    var c=bfsQ[head++];
    if(c===t) break;
    var cx=c%GW, cy=(c/GW)|0;
    var nb=[c-1,c+1,c-GW,c+GW];
    for(var i=0;i<4;i++){
      if(i===0&&cx===0) continue; if(i===1&&cx===GW-1) continue;
      var n=nb[i];
      if(n<0||n>=GW*GH||!nav[n]||bfsMark[n]===bfsGen) continue;
      bfsMark[n]=bfsGen; bfsPrev[n]=c; bfsQ[tail++]=n;
    }
  }
  if(bfsMark[t]!==bfsGen) return null;
  var path=[], c2=t;
  while(c2!==-1){ path.push(c2); c2=bfsPrev[c2]; }
  path.reverse();
  return path;
}
function nearNav(x,y){
  var gx=x/GC|0, gy=y/GC|0;
  for(var r=0;r<=6;r++)for(var dy=-r;dy<=r;dy++)for(var dx=-r;dx<=r;dx++){
    var nx=gx+dx, ny=gy+dy;
    if(nx<0||ny<0||nx>=GW||ny>=GH) continue;
    if(nav[ny*GW+nx]) return ny*GW+nx;
  }
  return -1;
}
function los(x0,y0,x1,y1){
  var dx=x1-x0, dy=y1-y0, d=Math.sqrt(dx*dx+dy*dy), steps=Math.max(1,d/8|0);
  for(var i=1;i<=steps;i++){
    if(!boxFree(x0+dx*i/steps, y0+dy*i/steps)) return false;
  }
  return true;
}

/* ---------- movement ---------- */
function nudgeY(nx,y){
  for(var k=3;k<=15;k+=3){
    if(boxFree(nx,y-k)) return -1;
    if(boxFree(nx,y+k)) return 1;
  }
  return 0;
}
function nudgeX(x,ny){
  for(var k=3;k<=15;k+=3){
    if(boxFree(x-k,ny)) return -1;
    if(boxFree(x+k,ny)) return 1;
  }
  return 0;
}
function moveEntity(e,dt){
  var dx=e.vx*dt, dy=e.vy*dt;
  var steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/3));
  var sdx=dx/steps, sdy=dy/steps;
  var mag=Math.sqrt(sdx*sdx+sdy*sdy);
  for(var i=0;i<steps;i++){
    if(boxFree(e.x+sdx,e.y+sdy)){ e.x+=sdx; e.y+=sdy; continue; }
    // full-speed wall slide: pour the whole step into whichever axis is free
    var tryY = Math.abs(sdy)>=Math.abs(sdx);
    var slid=false;
    for(var t2=0;t2<2 && !slid;t2++){
      if(tryY && sdy){
        var fy=e.y+(sdy>0?mag:-mag);
        if(boxFree(e.x,fy)){ e.y=fy; slid=true; }
      } else if(!tryY && sdx){
        var fx=e.x+(sdx>0?mag:-mag);
        if(boxFree(fx,e.y)){ e.x=fx; slid=true; }
      }
      tryY=!tryY;
    }
    if(slid) continue;
    // both axes blocked: corner-assist nudges around the lip
    if(sdx){
      var nx=e.x+sdx, ny1=nudgeY(nx,e.y);
      if(ny1){
        var yy=e.y+ny1*(mag+1.2);
        if(boxFree(e.x,yy)){ e.y=yy; if(boxFree(nx,e.y)){ e.x=nx; } continue; }
      }
    }
    if(sdy){
      var ny=e.y+sdy, nx1=nudgeX(e.x,ny);
      if(nx1){
        var xx=e.x+nx1*(mag+1.2);
        if(boxFree(xx,e.y)){ e.x=xx; if(boxFree(e.x,ny)){ e.y=ny; } }
      }
    }
  }
  if(dx||dy){
    e.anim+=dt*(Math.abs(e.vx)+Math.abs(e.vy))/60;
    if(Math.abs(e.vx)>Math.abs(e.vy)) e.face=e.vx>0?"R":"L";
    else if(e.vy) e.face=e.vy>0?"D":"U";
  }
}

/* ---------- bully AI ---------- */
function updateBully(dt){
  var b=bully;
  b.repath-=dt;
  if(b.noLos>0) b.noLos-=dt;
  var speed = S.active ? Math.min(B_CAP, B_BASE + B_PER_ITEM*S.nGot) : B_IDLE;
  var tx,ty;
  if(!S.active){
    if(!b.wander || b.repath<=0){
      b.repath=1.8+Math.random();
      var ang=Math.random()*6.2832, r=60+Math.random()*90;
      var p=snapToField(Math.round(SPAWN_B.x+Math.cos(ang)*r), Math.round(SPAWN_B.y+Math.sin(ang)*r));
      b.wander=p;
    }
    tx=b.wander.x; ty=b.wander.y;
    if(Math.abs(tx-b.x)<6&&Math.abs(ty-b.y)<6){ b.vx=0;b.vy=0; return; }
  } else if(!(b.noLos>0) && los(b.x,b.y,player.x,player.y)){
    tx=player.x; ty=player.y; b.path=null;
  } else {
    if(b.repath<=0||!b.path||b.pi>=b.path.length){
      b.repath=0.4;
      b.path=findPath(b.x,b.y,player.x,player.y); b.pi=1;
    }
    if(b.path&&b.pi<b.path.length){
      var c=b.path[b.pi]; tx=(c%GW)*GC+GC/2; ty=((c/GW)|0)*GC+GC/2;
      if(Math.abs(tx-b.x)<12&&Math.abs(ty-b.y)<12) b.pi++;
    } else { tx=player.x; ty=player.y; }
  }
  var ddx=tx-b.x, ddy=ty-b.y, d=Math.sqrt(ddx*ddx+ddy*ddy)||1;
  b.vx=ddx/d*speed; b.vy=ddy/d*speed;
  var px0=b.x, py0=b.y;
  moveEntity(b,dt);
  // stuck watchdog: wedged on a corner → skip waypoint + force repath
  if(S.active){
    if(Math.abs(b.x-px0)+Math.abs(b.y-py0) < speed*dt*0.15){
      b.stuck=(b.stuck||0)+dt;
      if(b.stuck>0.4){
        b.stuck=0; b.noLos=1.0;
        var side=[[0,-8],[0,8],[-8,0],[8,0]];
        for(var si=0;si<4;si++){
          var nx2=b.x+side[si][0], ny2=b.y+side[si][1];
          if(boxFree(nx2,ny2)){ b.x=nx2; b.y=ny2; break; }
        }
        b.repath=0; b.path=null;
      }
    } else b.stuck=0;
  }
  // taunt bubbles when hunting nearby
  if(S.active){
    b.taunt-=dt;
    var pd=Math.hypot(player.x-b.x,player.y-b.y);
    if(b.taunt<=0&&pd<300){
      bubble(b.x,b.y-92,BULLY_LINES[S.line++%BULLY_LINES.length],1.1);
      b.taunt=3.5;
    }
    if(pd<CATCH_R){ caught(); }
  }
}

/* ---------- flow ---------- */
function addScore(n){ S.score+=n; }
function bubble(x,y,text,ttl){ bubbles.push({x:x,y:y,text:text,ttl:ttl||1.2,max:ttl||1.2}); }
function collect(it){
  S.got[it.id]=1; S.nGot++; addScore(it.pts);
  bubble(it.sx,it.sy-40,"+"+it.pts+" "+it.id,1.2);
  sfx.pick(); haptic(HAP.pick);
  if(!S.active){ S.active=true; bubble(bully.x,bully.y-92,"HEY! MY SNACKS!",1.4); sfx.alert(); haptic(HAP.alert); }
  if(S.nGot===ITEMS.length){ bubble(player.x,player.y-96,"CHECKOUT! →",1.6); sfx.register(); haptic(HAP.listDone); }
}
function caught(){
  if(S.mode!=="play") return;
  S.mode="end"; sfx.death(); haptic(HAP.caught);
  bubble(bully.x,bully.y-92,"GOTCHA!",1.6);
  setTimeout(function(){ endScreen(false); },900);
}
function useContinue(){
  S.continues--;
  player.x=SPAWN_P.x; player.y=SPAWN_P.y; player.vx=0; player.vy=0;
  bully.x=SPAWN_B.x; bully.y=SPAWN_B.y; bully.vx=0; bully.vy=0;
  bully.path=null; bully.pi=0; bully.stuck=0; bully.noLos=0; bully.taunt=2.5; bully.repath=0;
  hide("ovEnd"); S.mode="play"; last=0;
}
function goMenu(){
  hide("ovEnd"); hide("ovPause"); hide("ovHow");
  S.mode="title"; show("ovTitle");
}
function togglePause(){
  if(S.mode==="play"){ S.mode="paused"; show("ovPause"); }
  else if(S.mode==="paused"){ hide("ovPause"); S.mode="play"; last=0; }
}
function winCheck(){
  if(S.nGot<ITEMS.length){
    for(var h=0;h<PADS.length;h++){
      var ph=PADS[h];
      if(player.x>ph[0]-6&&player.x<ph[2]+6&&player.y>ph[1]-6&&player.y<ph[3]+6){
        if(S.t-(S.padHint||-9)>2){ S.padHint=S.t; bubble(player.x,player.y-96,"FINISH THE LIST!",1.4); }
      }
    }
    return;
  }
  for(var i=0;i<PADS.length;i++){
    var p=PADS[i];
    if(player.x>p[0]-6&&player.x<p[2]+6&&player.y>p[1]-6&&player.y<p[3]+6){
      S.mode="end";
      var timeBonus=Math.max(0,1500-Math.floor(S.runT)*15);
      addScore(500+timeBonus);
      S.timeBonus=timeBonus;
      sfx.win(); haptic(HAP.win);
      setTimeout(function(){ endScreen(true); },500);
      return;
    }
  }
}
function endScreen(won){
  var canCont = !won && S.continues>0;
  el("endTitle").textContent = won? "YOU MADE IT OUT!" : (canCont? "CAUGHT!" : "THE BULLY GOT YOU!");
  el("endTitle").style.color = won? PAL.gold : PAL.coral;
  el("endSub").textContent = won
    ? "ITEMS 800 · CHECKOUT 500 · SPEED BONUS +"+(S.timeBonus||0)
    : (canCont? "1 CONTINUE LEFT — ITEMS KEPT" : "ITEMS: "+S.nGot+" / "+ITEMS.length);
  el("finalScore").textContent=String(S.score).padStart(6,"0");
  el("lbList").innerHTML=""; el("lbNote").textContent="";
  el("btnContinue").style.display = canCont? "" : "none";
  el("submitRow").style.display = canCont? "none" : "";
  el("btnAgain").style.display = canCont? "none" : "";
  show("ovEnd");
}
function startRun(){
  hide("ovEnd"); hide("ovTitle"); hide("ovHow");
  S.mode="play"; S.score=0; S.got={}; S.nGot=0; S.active=false; S.runT=0; S.timeBonus=0; S.line=0; S.continues=1; S.padHint=-9;
  player={x:SPAWN_P.x,y:SPAWN_P.y,vx:0,vy:0,face:"U",anim:0};
  bully={x:SPAWN_B.x,y:SPAWN_B.y,vx:0,vy:0,face:"D",anim:0,repath:0,path:null,pi:0,taunt:2,wander:null};
  bubbles=[];
  try{ ac().resume(); }catch(e){}
  startMusic();
}

/* ---------- input ---------- */
var keys={u:0,d:0,l:0,r:0}, drag=null, padDir=null;
function inputVec(){
  if(S.testVec) return S.testVec;
  var x=(keys.r?1:0)-(keys.l?1:0), y=(keys.d?1:0)-(keys.u?1:0);
  if(padDir){ x=padDir.x; y=padDir.y; }
  if(drag&&drag.on){ x=drag.x; y=drag.y; }
  var m=Math.hypot(x,y);
  if(m>1){ x/=m; y/=m; }
  return {x:x,y:y};
}
document.addEventListener("keydown",function(ev){
  var k=ev.key;
  if(k==="p"||k==="P"||k==="Escape"){ togglePause(); return; }
  if(k==="ArrowUp"||k==="w"||k==="W"){keys.u=1;ev.preventDefault();}
  if(k==="ArrowDown"||k==="s"||k==="S"){keys.d=1;ev.preventDefault();}
  if(k==="ArrowLeft"||k==="a"||k==="A"){keys.l=1;ev.preventDefault();}
  if(k==="ArrowRight"||k==="d"||k==="D"){keys.r=1;ev.preventDefault();}
});
document.addEventListener("keyup",function(ev){
  var k=ev.key;
  if(k==="ArrowUp"||k==="w"||k==="W")keys.u=0;
  if(k==="ArrowDown"||k==="s"||k==="S")keys.d=0;
  if(k==="ArrowLeft"||k==="a"||k==="A")keys.l=0;
  if(k==="ArrowRight"||k==="d"||k==="D")keys.r=0;
});
function bindTouch(){
  var c=view;
  c.addEventListener("touchstart",function(ev){
    var t=ev.touches[0];
    drag={on:false,ax:t.clientX,ay:t.clientY,cx:t.clientX,cy:t.clientY,x:0,y:0,id:t.identifier};
  },{passive:true});
  c.addEventListener("touchmove",function(ev){
    if(!drag) return;
    var t=ev.touches[0];
    drag.cx=t.clientX; drag.cy=t.clientY;
    var dx=drag.cx-drag.ax, dy=drag.cy-drag.ay, m=Math.hypot(dx,dy);
    if(m>44){ drag.ax=drag.cx-dx/m*44; drag.ay=drag.cy-dy/m*44; dx=drag.cx-drag.ax; dy=drag.cy-drag.ay; m=44; }
    if(m>10){
      var q=(Math.abs(dx)>Math.abs(dy)) ? (dx>0?"R":"L") : (dy>0?"D":"U");
      if(!drag.on || drag.q!==q){ drag.q=q; haptic(HAP.turn,60); }
      drag.on=true; drag.x=dx/m; drag.y=dy/m;
    }
    else drag.on=false;
  },{passive:true});
  c.addEventListener("touchend",function(){ drag=null; },{passive:true});
  c.addEventListener("touchcancel",function(){ drag=null; },{passive:true});
  // d-pad: container-level tracking so sliding between arrows re-aims instantly
  var padMap={padU:[0,-1],padD:[0,1],padL:[-1,0],padR:[1,0]};
  var box=el("dpadBox");
  function aim(ev){
    var t=ev.touches[0];
    if(!t){ padDir=null; return; }
    var elm=document.elementFromPoint(t.clientX,t.clientY);
    var d=elm&&padMap[elm.id];
    if(d && (!padDir || padDir.x!==d[0] || padDir.y!==d[1])) haptic(HAP.turn);
    padDir=d?{x:d[0],y:d[1]}:padDir;
    ev.preventDefault();
  }
  box.addEventListener("touchstart",aim,{passive:false});
  box.addEventListener("touchmove",aim,{passive:false});
  box.addEventListener("touchend",function(ev){ padDir=null; ev.preventDefault(); },{passive:false});
  box.addEventListener("touchcancel",function(){ padDir=null; });
  Object.keys(padMap).forEach(function(id){
    var b=el(id);
    b.addEventListener("mousedown",function(){ haptic(HAP.turn); padDir={x:padMap[id][0],y:padMap[id][1]}; });
    b.addEventListener("mouseup",function(){ padDir=null; });
    b.addEventListener("mouseleave",function(){ if(padDir) padDir=null; });
  });
}

/* ---------- sprites ---------- */
function drawGridPx(g,rows,pal,ox,oy,sc,flip){
  var w=rows[0].length;
  for(var y=0;y<rows.length;y++){
    var r=rows[y];
    for(var x=0;x<r.length;x++){
      var c=r[x]; if(c==="."){continue;}
      var col=pal[c]; if(!col) continue;
      var px=flip? (w-1-x):x;
      g.fillStyle=col; g.fillRect(ox+px*sc,oy+y*sc,sc,sc);
    }
  }
}
var P_PAL={k:"#14100E",s:"#7A4E2B",w:"#F2F0EA",t:"#D8D4CC",p:"#23283E",h:"#101010"};
var B_PAL={c:"#181820",s:"#8A5A32",r:"#A62633",m:"#7E1C28",p:"#2C2118",h:"#0E0E0E",e:"#FFFFFF",k:"#14100E"};
var SP={
 pD:[ "....kkkkkkk....","...kkkkkkkkk...","...kkkkkkkkk...","...kssssssnk...".replace("n","s"),
      "...ksskssksk...","...kssssssk....","....ssssss.....","...wwwwwwww....",
      "..wwwwwwwwww...","..wwwtwwtwww...","..wwwwwwwwww...","..twwwwwwwwt...",
      "..s.wwwwww.s...","....wwwwww.....","....pppppp.....","....pppppp.....",
      "....pp..pp.....","....pp..pp.....","....hh..hh....."],
 pU:[ "....kkkkkkk....","...kkkkkkkkk...","...kkkkkkkkk...","...kkkkkkkkk...",
      "...kkkkkkkkk...","...kkkkkkkk....","....kkkkkk.....","...wwwwwwww....",
      "..wwwwwwwwww...","..wwwwwwwwww...","..wwwwwwwwww...","..twwwwwwwwt...",
      "..s.wwwwww.s...","....wwwwww.....","....pppppp.....","....pppppp.....",
      "....pp..pp.....","....pp..pp.....","....hh..hh....."],
 pR:[ "....kkkkkkk....","...kkkkkkkkk...","...kkkkkkkkk...","....ksssssk....",
      "....ksskssk....","....kssssss....","....ssssss.....","...wwwwwww.....",
      "..wwwwwwwww....","..wwwwwwwww....","..wwwwwwwwws...","..twwwwwwww....",
      "....wwwwww.....","....wwwwww.....","....pppppp.....","....pppppp.....",
      "....pp..pp.....","....pp..pp.....","....hh..hh....."],
 bD:[ "....ccccccccc....","...ccccccccccc...","...ccccccccccc...","...cssssssssc....",
      "...cseskksesc....".replace(/e/g,"s"),"...kssksskssk....","...kssskksssk....","....ssssssss.....",
      "...rrrrrrrrrr....","..rrrrrrrrrrrr...","..rrmrrrrrrmrr...","..rrrrrrrrrrrr...",
      "..srrrrrrrrrrs...","..s.rrrrrrrr.s...","....rrrrrrrr.....","....pppppppp.....",
      "....ppp..ppp.....","....ppp..ppp.....","....hhh..hhh....."],
 bR:[ "....ccccccccc....","...ccccccccccc...","...ccccccccccc...","....cssssssc.....",
      "....csskkssc.....","....kssssssk.....","....ssssssss.....","...rrrrrrrrr.....",
      "..rrrrrrrrrrr....","..rrrrrrrrrrrs...","..rrrrrrrrrrr....","..mrrrrrrrrrr....",
      "..s.rrrrrrrr.....","....rrrrrrrr.....","....pppppppp.....","....pppppppp.....",
      "....ppp..ppp.....","....ppp..ppp.....","....hhh..hhh....."]
};
function drawActor(g,e,isBully){
  var sc=3, flip=(e.face==="L");
  var rows = isBully ? (e.face==="D"||e.face==="U" ? SP.bD : SP.bR)
                     : (e.face==="U" ? SP.pU : (e.face==="D" ? SP.pD : SP.pR));
  var pal=isBully?B_PAL:P_PAL;
  var w=rows[0].length*sc, h=rows.length*sc;
  var ox=Math.round(e.x-w/2), oy=Math.round(e.y-h+4);
  var step=Math.floor(e.anim*3)%2;
  // shadow
  g.fillStyle="rgba(20,16,20,0.25)";
  g.fillRect(Math.round(e.x-w/2+4), Math.round(e.y-2), w-8, 6);
  if(step&&(e.vx||e.vy)){
    // simple leg swap: shift bottom 4 rows 1px
    drawGridPx(g,rows.slice(0,rows.length-4),pal,ox,oy,sc,flip);
    drawGridPx(g,rows.slice(rows.length-4),pal,ox+ (flip?-sc:sc), oy+(rows.length-4)*sc, sc, flip);
  } else {
    drawGridPx(g,rows,pal,ox,oy,sc,flip);
  }
}
var ICONS={
 APPLE:[".rrr.","rrrrr","rrrrr",".rrr.","..g.."],
 CHIPS:["yyyyy","yryry","yyyyy","yryry","yyyyy"],
 CHICKEN:["..bb.",".bbbb","bbbb.","wb...","w...."],
 LEMONADE:[".yy..","yyyy.","yyyy.","yyyy.",".yy.."],
 BREAD:[".ooo.","ooooo","ooooo","ooooo","....."],
 MILK:[".www.","wwwww","wbwbw","wwwww","wwwww"],
 RICE:[".www.","wwwww","wrwrw","wwwww",".www."],
 BEANS:[".mmm.","mmmmm","mrmrm","mmmmm",".mmm."]
};
var ICON_PAL={r:"#D0342C",g:"#2F9E44",y:"#F5C518",b:"#B4763B",w:"#F5F2EA",o:"#C98235",m:"#8A2A2A"};

/* ---------- render ---------- */
function draw(){
  var g=vctx;
  g.imageSmoothingEnabled=false;
  g.drawImage(board,0,0);
  // score
  g.font="bold 30px ui-monospace,Menlo,monospace";
  g.fillStyle=PAL.gold;
  g.fillText(String(S.score).padStart(4,"0"), 118, 42);
  // list checkmarks
  for(var i=0;i<ITEMS.length;i++){
    var it=ITEMS[i];
    if(S.got[it.id]){
      for(var rI=0;rI<it.rows.length;rI++){
        var ry=it.rows[rI];
        g.strokeStyle="#3ADB76"; g.lineWidth=3;
        g.beginPath(); g.moveTo(12,ry); g.lineTo(92,ry); g.stroke();
        g.fillStyle="#3ADB76"; g.font="bold 20px ui-monospace,monospace";
        g.fillText("\u2713", 95, ry+7);
      }
    }
  }
  if(S.mode==="play"||S.mode==="end"){
    // item pickups
    var t=S.t;
    for(var j=0;j<ITEMS.length;j++){
      var it2=ITEMS[j];
      if(S.got[it2.id]) continue;
      var pulse=1+0.15*Math.sin(t*5+j);
      g.fillStyle="rgba(245,197,24,0.28)";
      g.beginPath(); g.arc(it2.sx,it2.sy,20*pulse,0,6.2832); g.fill();
      g.fillStyle="rgba(245,197,24,0.9)";
      g.beginPath(); g.arc(it2.sx,it2.sy,14,0,6.2832); g.fill();
      drawGridPx(g,ICONS[it2.icon||it2.id],ICON_PAL,it2.sx-7,it2.sy-8,3,false);
      g.font="bold 17px ui-monospace,monospace";
      g.fillStyle="#FFFFFF"; g.strokeStyle=PAL.navy; g.lineWidth=4;
      var tw=g.measureText(it2.id).width;
      g.strokeText(it2.id,it2.sx-tw/2,it2.sy-26);
      g.fillText(it2.id,it2.sx-tw/2,it2.sy-26);
    }
    // checkout pads
    if(S.nGot===ITEMS.length){
      for(var p3=0;p3<PADS.length;p3++){
        var pd=PADS[p3], on=Math.floor(S.t*3)%2===0;
        g.fillStyle=on?"rgba(58,219,118,0.5)":"rgba(58,219,118,0.28)";
        g.fillRect(pd[0],pd[1],pd[2]-pd[0],pd[3]-pd[1]);
        g.strokeStyle="#3ADB76"; g.lineWidth=3;
        g.strokeRect(pd[0],pd[1],pd[2]-pd[0],pd[3]-pd[1]);
      }
      g.font="bold 20px ui-monospace,monospace";
      g.fillStyle="#3ADB76";
      g.fillText("PAY \u2192", 340, 470);
    }
    // actors: draw upper first for overlap
    var actors=[player,bully].sort(function(a,b){return a.y-b.y;});
    for(var a2=0;a2<actors.length;a2++) drawActor(g,actors[a2],actors[a2]===bully);
    // joystick indicator while dragging
    if(drag&&drag.on&&S.mode==="play"){
      var rc=view.getBoundingClientRect();
      var jx=(drag.ax-rc.left)/scale, jy=(drag.ay-rc.top)/scale;
      g.globalAlpha=0.4;
      g.strokeStyle=PAL.gold; g.lineWidth=4;
      g.beginPath(); g.arc(jx,jy,34,0,6.2832); g.stroke();
      g.fillStyle=PAL.gold;
      g.beginPath(); g.arc(jx+drag.x*26,jy+drag.y*26,14,0,6.2832); g.fill();
      g.globalAlpha=1;
    }
    // bubbles
    for(var b2=0;b2<bubbles.length;b2++){
      var bb=bubbles[b2], al=Math.min(1,bb.ttl/0.25);
      g.globalAlpha=al;
      g.font="bold 22px ui-monospace,monospace";
      var w2=g.measureText(bb.text).width+16;
      var bx=bb.x-w2/2, by=bb.y-((1-bb.ttl/bb.max)*14);
      g.fillStyle="#FFFFFF"; g.fillRect(bx,by-24,w2,32);
      g.fillStyle=PAL.navy; g.fillText(bb.text,bx+8,by);
      g.globalAlpha=1;
    }
  }
}

/* ---------- audio ---------- */
var AC=null, musicTimer=null, mStep=0;
function ac(){ if(!AC){ AC=new (window.AudioContext||window.webkitAudioContext)(); } return AC; }
function tone(f0,f1,dur,type,gain,when){
  if(S.muted) return;
  try{
    var a=ac(),o=a.createOscillator(),g=a.createGain(),t0=a.currentTime+(when||0);
    o.type=type||"square"; o.frequency.setValueAtTime(f0,t0);
    if(f1) o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t0+dur);
    g.gain.setValueAtTime(gain||0.08,t0);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0+dur+0.02);
  }catch(e){}
}
var sfx={
  pick:function(){ tone(880,1320,0.1,"square",0.08); },
  alert:function(){ tone(220,440,0.18,"sawtooth",0.1); tone(220,440,0.18,"sawtooth",0.08,0.2); },
  register:function(){ tone(1200,0,0.06,"square",0.09); tone(1600,0,0.1,"square",0.09,0.08); },
  death:function(){ tone(500,55,0.85,"sawtooth",0.1); },
  win:function(){ [0,4,7,12,16].forEach(function(s,i){ tone(392*Math.pow(2,s/12),0,0.12,"square",0.08,i*0.09); }); },
  start:function(){ tone(392,0,0.1,"square",0.06); tone(523,0,0.12,"square",0.06,0.12); }
};
var BASS=[0,0,3,5,0,0,7,5], BASS_HOT=[12,10,8,7,12,10,7,5], ROOT=98;
function startMusic(){
  if(musicTimer) return;
  musicTimer=setInterval(function(){
    if(S.mode!=="play") return;
    var hot = bully && player && Math.hypot(player.x-bully.x,player.y-bully.y)<280 && S.active;
    // he is on you: a low pulse in the hand, throttled so it reads as tension
    // rather than a buzz. Deliberately outside the mute check.
    if(hot && Math.hypot(player.x-bully.x,player.y-bully.y)<190) haptic(HAP.near,620);
    if(S.muted) return;
    var pat=hot?BASS_HOT:BASS, st=pat[mStep%pat.length];
    tone(ROOT*Math.pow(2,st/12),0,hot?0.09:0.12,"triangle",0.05);
    if(mStep%4===0) tone(ROOT*2*Math.pow(2,st/12),0,0.05,"square",0.02);
    mStep++;
  },170);
}

/* ---------- leaderboard ---------- */
var localLB=[], LETTERS="ABCDEFGHIJKLMNOPQRSTUVWXYZ", initials=["E","B","T"];
function cycleInit(slot,delta){
  var i=(LETTERS.indexOf(initials[slot])+delta+26)%26;
  initials[slot]=LETTERS[i]; el("init"+slot).textContent=initials[slot];
}
function renderBoard(rows,mine,note){
  var html="";
  rows.slice(0,10).forEach(function(r,i){
    var hl=(mine&&r.initials===mine.initials&&r.score===mine.score)?' class="me"':'';
    html+="<li"+hl+"><span>"+(i+1)+". "+r.initials+"</span><span>"+String(r.score).padStart(6,"0")+"</span></li>";
  });
  el("lbList").innerHTML=html||"<li><span>NO SCORES YET</span><span>------</span></li>";
  el("lbNote").textContent=note||"";
}
function submitScore(){
  var entry={initials:initials.join(""),score:S.score,level_reached:1};
  el("submitRow").style.display="none";
  if(!API_BASE){
    localLB.push(entry); localLB.sort(function(a,b){return b.score-a.score;});
    renderBoard(localLB,entry,"LOCAL SESSION SCORES \u2014 set API_BASE for the global board");
    return;
  }
  fetch(API_BASE+"/api/score",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(entry)})
    .then(function(r){return r.json();})
    .then(function(d){ renderBoard(d.top||[],entry,d.rank?"YOU RANKED #"+d.rank:""); })
    .catch(function(){
      localLB.push(entry); localLB.sort(function(a,b){return b.score-a.score;});
      renderBoard(localLB,entry,"OFFLINE \u2014 LOCAL SCORES");
    });
}

/* ---------- boot / loop ---------- */
function el(id){ return document.getElementById(id); }
function show(id){ el(id).classList.add("on"); }
function hide(id){ el(id).classList.remove("on"); }
function fit(){
  var vw=window.innerWidth||390, vh=window.innerHeight||780;
  scale=Math.min(vw/IW, vh/IH);
  view.style.width=Math.floor(IW*scale)+"px";
  view.style.height=Math.floor(IH*scale)+"px";
}
var last=0;
function update(dt){
  if(S.mode==="play"){
    S.t+=dt; S.runT+=dt;
    var v=inputVec();
    player.vx=v.x*PSPEED; player.vy=v.y*PSPEED;
    moveEntity(player,dt);
    for(var i=0;i<ITEMS.length;i++){
      var it=ITEMS[i];
      if(!S.got[it.id] && Math.hypot(player.x-it.sx,player.y-it.sy)<PICK_R) collect(it);
    }
    winCheck();
    if(!S.freezeBully) updateBully(dt);
    for(var b3=bubbles.length-1;b3>=0;b3--){ bubbles[b3].ttl-=dt; if(bubbles[b3].ttl<=0) bubbles.splice(b3,1); }
  } else {
    S.t+=dt;
    for(var b4=bubbles.length-1;b4>=0;b4--){ bubbles[b4].ttl-=dt; if(bubbles[b4].ttl<=0) bubbles.splice(b4,1); }
  }
}
function loop(ts){
  requestAnimationFrame(loop);
  if(!last) last=ts;
  var dt=Math.min(0.05,(ts-last)/1000); last=ts;
  update(dt);
  if(S.mode!=="boot") draw();
}
function init(){
  view=el("view"); vctx=view.getContext("2d");
  view.width=IW; view.height=IH;
  var img=new Image();
  img.onload=function(){
    board=document.createElement("canvas"); board.width=IW; board.height=IH;
    board.getContext("2d").drawImage(img,0,0);
    buildMasks(board);
    var sp=snapToField(SPAWN_P.x,SPAWN_P.y); SPAWN_P=sp;
    var sb=snapToField(SPAWN_B.x,SPAWN_B.y); SPAWN_B=sb;
    ITEMS.forEach(function(it){ var s2=snapToField(it.x,it.y); it.sx=s2.x; it.sy=s2.y; });
    player={x:SPAWN_P.x,y:SPAWN_P.y,vx:0,vy:0,face:"U",anim:0};
    bully={x:SPAWN_B.x,y:SPAWN_B.y,vx:0,vy:0,face:"D",anim:0,repath:0,path:null,pi:0,taunt:2,wander:null};
    S.mode="title"; show("ovTitle");
    el("loading").style.display="none";
  };
  img.src=BOARD_SRC;
  fit();
  window.addEventListener("resize",fit);
  setTimeout(fit,300); setTimeout(fit,1000);
  el("btnTitle").addEventListener("click",function(){ hide("ovTitle"); show("ovHow"); });
  el("btnStart").addEventListener("click",function(){ sfx.start(); startRun(); });
  el("btnAgain").addEventListener("click",startRun);
  el("btnContinue").addEventListener("click",useContinue);
  el("btnMenu").addEventListener("click",goMenu);
  el("btnPause").addEventListener("click",function(ev){ ev.stopPropagation(); togglePause(); });
  el("btnMenu2").addEventListener("click",function(ev){ ev.stopPropagation(); goMenu(); });
  el("btnSubmit").addEventListener("click",submitScore);
  // one delegated tick for every button; the d-pad has its own turn haptic
  document.addEventListener("pointerdown",function(ev){
    var t=ev.target;
    if(t&&t.tagName==="BUTTON"&&!(t.closest&&t.closest(".dpad"))) haptic(HAP.tap);
  },{passive:true});
  el("btnMute").addEventListener("click",function(){ S.muted=!S.muted; el("btnMute").textContent=S.muted?"\uD83D\uDD07":"\uD83D\uDD0A"; });
  [0,1,2].forEach(function(s){
    el("up"+s).addEventListener("click",function(){cycleInit(s,1);});
    el("dn"+s).addEventListener("click",function(){cycleInit(s,-1);});
  });
  document.addEventListener("visibilitychange",function(){
    if(document.hidden&&S.mode==="play"){ S.mode="paused"; show("ovPause"); }
  });
  el("ovPause").addEventListener("click",function(){ hide("ovPause"); if(S.mode==="paused"){S.mode="play"; last=0;} });
  bindTouch();
  requestAnimationFrame(loop);
}
window.__csd={ get S(){return S;}, get player(){return player;}, get bully(){return bully;}, get items(){return ITEMS;},
  fieldAt:function(x,y){return fieldAt(x,y);}, boxFree:function(x,y){return boxFree(x,y);},
  path:function(){ var p=findPath(bully.x,bully.y,player.x,player.y); return p?p.length:-1; },
  step:function(dt,n){ n=n||1; for(var i=0;i<n;i++) update(dt); draw(); },
  tp:function(x,y){ var s=snapToField(x,y); player.x=s.x; player.y=s.y; return [s.x,s.y]; },
  freeze:function(v){ S.freezeBully=!!v; },
  setInput:function(x,y){ S.testVec=(x===null)?null:{x:x,y:y}; } };
if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",init); } else { init(); }
