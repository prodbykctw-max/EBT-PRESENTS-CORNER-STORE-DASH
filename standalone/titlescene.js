/* ---------- the title screen's painted street (TitleScene) ------------------------------------------------------
   Behind the title card: a dusk street with the corner store on it, painted procedurally on canvas (gradients, soft
   brush blobs, grain, rim light; no image files) and baked ONCE per size into a few offscreen layers, back to front:
   sky, drifting clouds, far skyline, near skyline, left building, right building, the store front, sidewalk + street,
   the lamp post. Every frame is then only drawImage calls. Like Will Hill's title the layers FLY IN (staggered, about
   1.5 s) while the title card assembles on top, then idle: a slow parallax sway, clouds drifting, the sign flickering,
   the lamp glowing. A little gag plays on the street every ~10 s: the guy sprints across, the bully chases a beat
   later, the guy skids, an E.B.T card flips out of his pocket and spins down to the sidewalk, they run off the far side.
   The guy and the bully are the store's own sprite sheets (player.b64 / bully.b64) drawn the way drawSheet draws them.
   Rules it keeps: one canvas inside #ovTitle behind the card (z-index -1, so the card, text and buttons are untouched);
   its own seeded random (never Math.random: the drive shares that stream); no timers or RAF once #ovTitle is not
   showing or the tab is hidden (the loop simply is not rescheduled, and the layers are freed); prefers-reduced-motion
   = everything placed, one still frame, no loop at all, no gag; no GSAP needed (its own easing). A tap on the title
   during the intro calls settle() (csd.js), which puts every layer in place and cancels a running gag. */
var TitleScene=(function(){
"use strict";
var C={pink:"#E85D9E",mag:"#C2255C",gold:"#F5C518",cream:"#FFF3E0",coral:"#F08C4B",navy:"#1E2340",ink:"#0A0A0C"};
var SETTLED=1.75, GAG_FIRST=3.2, GAG_EVERY=9.5;           // seconds: layers all in place / first gag / gag period
var cv=null, g=null, host=null, L=null, raf=0, running=false, frames=0, seen=false, hold=false, rsz=0;
var VW=0, VH=0, Q=1, U=1, T=0, last=0, acc=0, sprites=null, reduced=false, noisePat=null, MG=14;
var gag={t:-1, next:0, dir:1, n:0, seg:null};

/* ---- little helpers ---- */
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function rng(seed){ var a=seed>>>0; return function(){ a=(a+0x6D2B79F5)|0; var t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
function hex(h){ return [parseInt(h.substr(1,2),16),parseInt(h.substr(3,2),16),parseInt(h.substr(5,2),16)]; }
function rgba(h,a){ var c=hex(h); return "rgba("+c[0]+","+c[1]+","+c[2]+","+a+")"; }
function mix(a,b,t){ var x=hex(a),y=hex(b); return "rgb("+Math.round(x[0]+(y[0]-x[0])*t)+","+Math.round(x[1]+(y[1]-x[1])*t)+","+Math.round(x[2]+(y[2]-x[2])*t)+")"; }
function eOut(u){ return 1-Math.pow(1-u,3); }
function eBack(u){ var c=1.5, v=u-1; return 1+(c+1)*v*v*v+c*v*v; }
function eInQ(u){ return u*u; }
function eOutSine(u){ return Math.sin(u*Math.PI/2); }
function mk(w,h){ var c=document.createElement("canvas"); c.width=Math.max(1,Math.ceil(w*Q)); c.height=Math.max(1,Math.ceil(h*Q)); var x=c.getContext("2d"); x.scale(Q,Q); return {c:c,x:x,w:w,h:h}; }
function grain(x,w,h,k){
  if(!noisePat){ var n=document.createElement("canvas"); n.width=n.height=96; var nx=n.getContext("2d"), id=nx.createImageData(96,96), r=rng(7);
    for(var i=0;i<id.data.length;i+=4){ var v=r()<0.5?255:0; id.data[i]=id.data[i+1]=id.data[i+2]=v; id.data[i+3]=Math.floor(r()*70); }
    nx.putImageData(id,0,0); noisePat=x.createPattern(n,"repeat"); }
  x.save(); x.globalCompositeOperation="source-atop"; x.globalAlpha=k; x.fillStyle=noisePat; x.fillRect(0,0,w,h); x.restore();
}
function blob(x,cx,cy,rx,ry,col,a){
  x.save(); x.translate(cx,cy); x.scale(1,ry/rx);
  var gr=x.createRadialGradient(0,0,0,0,0,rx); gr.addColorStop(0,rgba(col,a)); gr.addColorStop(1,rgba(col,0));
  x.fillStyle=gr; x.beginPath(); x.arc(0,0,rx,0,6.2832); x.fill(); x.restore();
}
function rr(x,px,py,w,h,r){ x.beginPath(); x.moveTo(px+r,py); x.arcTo(px+w,py,px+w,py+h,r); x.arcTo(px+w,py+h,px,py+h,r); x.arcTo(px,py+h,px,py,r); x.arcTo(px,py,px+w,py,r); x.closePath(); }
function vgrad(x,y0,y1,stops){ var gr=x.createLinearGradient(0,y0,0,y1); stops.forEach(function(s){ gr.addColorStop(s[0],s[1]); }); return gr; }


/* ---- ART: each layer is either the procedural canvas below or a painted image (WebP with alpha). ONE TABLE.
   To swap in art: add the base64 file (like player.b64), a `var TITLE_ART_SRC={sky:"data:image/webp;base64,%%TA_SKY%%",...}`
   line in shell2.html (+ build.mjs replace), and nothing else: a layer whose key is in TITLE_ART_SRC uses the image.
   w: "cover" = the layer's overscanned width (screen + sway margin) , "store" = G.sw * k (the store's width on screen)
   bottom: where the image's bottom edge sits: "vh" screen bottom, "gy" the ground line, "base" just under the skyline base.
   sky is cover-fit both ways (always fills the screen). Keys: sky, far, near, buildings (replaces left+right), store, street. */
var ART={
  sky:      {w:"cover", bottom:"vh"},
  far:      {w:"cover", bottom:"base"},
  near:     {w:"cover", bottom:"base"},
  buildings:{w:"cover", bottom:"gy"},
  store:    {w:"store", k:1.0, bottom:"gy"},
  street:   {w:"cover", bottom:"vh"}
};
var artImg={};
(function(){ var src=(typeof TITLE_ART_SRC!=="undefined")?TITLE_ART_SRC:null; if(!src) return;
  Object.keys(src).forEach(function(k){ if(!ART[k]||!src[k]) return; var im=new Image(); im.onload=function(){ artImg[k]=im; if(L&&host&&host.classList.contains("on")){ bake(); render(); } }; im.src=src[k]; }); })();
function artLayer(k,G,by){
  var im=artImg[k], d=ART[k]; if(!im||!d) return null;
  var w=d.w==="store"? G.sw*(d.k||1) : VW+2*MG, h=w*im.naturalHeight/im.naturalWidth;
  if(k==="sky"&&h<VH){ h=VH; w=h*im.naturalWidth/im.naturalHeight; }
  var bot=d.bottom==="vh"?VH:(d.bottom==="gy"?G.gy:by);
  var s=mk(w,h); s.x.drawImage(im,0,0,w,h);
  return {s:s, x:k==="store"?G.cx-w/2:(k==="sky"?(VW-w)/2:-MG), y:bot-h};
}

/* ---- layout (css px): the ground line gy is where the store and its neighbours stand ---- */
function geom(){
  var wide=VW>VH*1.05, gy=Math.round(VH*(wide?0.80:0.825));
  var sw=wide? Math.min(400,VW*0.3) : VW*0.66, cx=wide? VW*0.5+Math.min(VW*0.22,290) : VW*0.5;
  return { gy:gy, walk:Math.round(VH*(wide?0.07:0.062)), sw:sw, sh:sw*0.6, cx:cx, sx0:cx-sw/2, sx1:cx+sw/2, sunX:VW*(wide?0.34:0.7), sunY:VH*0.655 };
}

/* ---- the layers ---- */
function bakeSky(G){
  var s=mk(VW,VH), x=s.x, r=rng(11);
  x.fillStyle=vgrad(x,0,VH,[[0,"#12142b"],[.2,"#2a2358"],[.38,"#6d2a70"],[.5,"#B02467"],[.6,"#E85D9E"],[.69,"#F08C4B"],[.76,"#F5C518"],[.82,"#FFE08A"],[1,"#FFE08A"]]);
  x.fillRect(0,0,VW,VH);
  for(var i=0;i<70;i++){ var y=r()*VH*0.8, w=VW*(0.3+r()*0.7), x0=r()*VW-w*0.2, col=y<VH*0.4?(r()<0.5?C.navy:C.mag):(r()<0.5?C.coral:C.cream);
    blob(x,x0+w/2,y,w/2,3*U+r()*14*U,col,0.05+r()*0.05); }
  blob(x,G.sunX,G.sunY,VW*0.5,VW*0.5,C.gold,0.55);                    // the glow
  blob(x,G.sunX,G.sunY,VW*0.2,VW*0.2,C.cream,0.55);
  var sg=x.createRadialGradient(G.sunX,G.sunY,0,G.sunX,G.sunY,40*U); sg.addColorStop(0,"#FFF8E0"); sg.addColorStop(0.7,"#FFE08A"); sg.addColorStop(1,"#F5C518");
  x.fillStyle=sg; x.beginPath(); x.arc(G.sunX,G.sunY,40*U,0,6.2832); x.fill();
  for(var j=0;j<55;j++){ x.fillStyle="rgba(255,243,224,"+(0.25+r()*0.55)+")"; var sy=r()*VH*0.3; x.fillRect(r()*VW,sy,r()<0.2?1.6:1,r()<0.2?1.6:1); }
  grain(x,VW,VH,0.09);
  return s;
}
function bakeClouds(){
  var Wc=Math.round(VW*1.5), Hc=VH*0.55, s=mk(Wc,Hc), x=s.x, r=rng(23), cl=[];
  for(var i=0;i<10;i++){ var cw=(150+r()*280)*U, n=6+Math.floor(r()*4), cx=r()*Wc, cy=Hc*(0.12+0.8*Math.pow(r(),0.8)), b=[];
    for(var k=0;k<n;k++){ b.push({x:cx+(k/(n-1)-0.5)*cw+(r()-0.5)*20*U, y:cy+(r()-0.5)*8*U, rx:cw/3.2*(0.7+r()*0.6), ry:(7+r()*11)*U}); }
    cl.push(b); }
  [[C.navy,0.30,-3,0],[C.pink,0.42,0,0],[C.cream,0.40,5,-8],[C.gold,0.35,8,-10]].forEach(function(p){
    cl.forEach(function(b){ b.forEach(function(o){ [0,-Wc].forEach(function(wr){ blob(x,o.x+wr+p[3],o.y+p[2]*U/3,o.rx*(p[2]>3?0.7:1),o.ry*(p[2]>3?0.6:1),p[0],p[1]); }); }); }); });
  grain(x,Wc,Hc,0.05);
  return s;
}
function towers(x,w,baseY,hMax,seed,top,bot,win,rim){
  var r=rng(seed), px=-6*U;
  while(px<w){ var bw=(16+r()*36)*U, bh=hMax*(0.22+0.78*Math.pow(r(),1.5));
    x.fillStyle=vgrad(x,baseY-bh,baseY,[[0,top],[1,bot]]); x.fillRect(px,baseY-bh,bw,bh+2);
    if(r()<0.5){ var sw2=bw*(0.4+r()*0.3), sh2=(8+r()*18)*U; x.fillRect(px+(bw-sw2)/2,baseY-bh-sh2,sw2,sh2+1); }
    if(r()<0.2){ x.fillRect(px+bw/2-0.7,baseY-bh-26*U,1.4,26*U); }
    if(rim){ x.fillStyle=rim; x.fillRect(px,baseY-bh,bw,1.2); }
    for(var wy=baseY-bh+6*U; wy<baseY-6*U; wy+=7*U){ for(var wx=px+3*U; wx<px+bw-3*U; wx+=6*U){ if(r()<win){ x.fillStyle="rgba(255,214,110,"+(0.45+r()*0.5)+")"; x.fillRect(wx,wy,2.2*U,3*U); } } }
    px+=bw+r()*3*U; }
}
function bakeSkyline(G,near){
  var w=VW+2*MG, h=VH*(near?0.3:0.34), s=mk(w,h), x=s.x;
  towers(x,w,h,h*(near?0.7:0.85),near?41:37,near?"#3e2158":"#80317c",near?"#7c2c6e":"#d1508f",near?0.12:0.05,near?"rgba(245,197,24,0.55)":"rgba(255,224,150,0.35)");
  grain(x,w,h,0.08);
  return s;
}
function building(G,side,seed){
  var x0=side<0?-MG:G.sx1, x1=side<0?G.sx0:VW+MG, w=x1-x0, hh=VH*(side<0?0.46:0.36), s=mk(w,hh), x=s.x, r=rng(seed);
  x.fillStyle=side<0? vgrad(x,0,hh,[[0,"#3b2561"],[1,"#2a1c4a"]]) : vgrad(x,0,hh,[[0,"#4a2567"],[1,"#33204f"]]);
  x.fillRect(0,0,w,hh);
  for(var by=3;by<hh;by+=6*U){ x.fillStyle="rgba(10,6,24,0.16)"; x.fillRect(0,by,w,1); for(var bx=(Math.floor(by/(6*U))%2)*9*U;bx<w;bx+=18*U){ x.fillRect(bx,by,1,6*U); } }    // brick courses
  for(var q=0;q<40;q++){ x.fillStyle=r()<0.5?"rgba(232,93,158,0.07)":"rgba(10,6,24,0.10)"; x.fillRect(r()*w,r()*hh,(8+r()*26)*U,(3+r()*6)*U); }
  x.fillStyle="#1a1236"; x.fillRect(0,0,w,7*U);                                                                                      // roof cornice
  x.fillStyle="rgba(245,197,24,0.6)"; x.fillRect(0,7*U,w,1.4);
  var ww=20*U, wh=28*U, gx=38*U, gyv=44*U;
  for(var wy=22*U; wy<hh-30*U; wy+=gyv){ for(var wx=14*U; wx<w-ww; wx+=gx){
    var lit=r()<0.38; rr(x,wx,wy,ww,wh,2*U);
    x.fillStyle=lit? vgrad(x,wy,wy+wh,[[0,"#FFE08A"],[1,"#F08C4B"]]) : "#171635"; x.fill();
    x.strokeStyle="rgba(255,243,224,0.45)"; x.lineWidth=1.3; x.stroke();
    x.fillStyle="rgba(255,243,224,0.5)"; x.fillRect(wx-2*U,wy+wh,ww+4*U,2*U);                                                       // sill
    if(lit){ x.fillStyle="rgba(30,35,64,0.5)"; x.fillRect(wx+ww/2-0.6,wy,1.2,wh); } } }
  if(side<0){ x.strokeStyle="rgba(10,6,24,0.75)"; x.lineWidth=1.6; var fx=w-60*U;                                                    // a fire escape
    for(var fy=60*U; fy<hh-50*U; fy+=44*U){ x.strokeRect(fx,fy,34*U,3*U); x.beginPath(); x.moveTo(fx,fy+3*U); x.lineTo(fx+34*U,fy+44*U); x.stroke(); } }
  var edge=side<0? w-3 : 0;                                                                                                          // rim light on the edge nearest the sun
  x.fillStyle="rgba(255,200,110,0.30)"; x.fillRect(edge,0,3,hh);
  x.fillStyle=vgrad(x,hh*0.55,hh,[[0,"rgba(240,140,75,0)"],[1,"rgba(240,140,75,0.28)"]]); x.fillRect(0,hh*0.55,w,hh*0.45);          // sunset bounce near the street
  grain(x,w,hh,0.10);
  return {s:s, x:x0, y:G.gy-hh};
}
function bakeStore(G){
  var sw=G.sw, H=G.sh, ov=12*U, w=sw+2*ov, s=mk(w,H+4), x=s.x, r=rng(5), X=ov;
  var fs=Math.min(sw*0.115,36*U*1.2);
  x.fillStyle=vgrad(x,0,H,[[0,"#FFF3E0"],[1,"#F2B3C8"]]); rr(x,X,H*0.04,sw,H*0.96,2); x.fill();                                         // the wall
  x.fillStyle="rgba(120,40,100,0.18)"; x.fillRect(X+sw*0.62,H*0.04,sw*0.38,H*0.96);                                                 // side in shade
  for(var q=0;q<26;q++){ x.fillStyle=r()<0.5?"rgba(194,37,92,0.07)":"rgba(255,255,255,0.12)"; x.fillRect(X+r()*sw,H*0.3+r()*H*0.7,(10+r()*30)*U,(2+r()*4)*U); }
  x.fillStyle="#2a2150"; x.fillRect(X-4*U,0,sw+8*U,H*0.05);                                                                          // cornice
  x.fillStyle=C.gold; x.fillRect(X-4*U,H*0.05,sw+8*U,2);
  var sy=H*0.075, sh=H*0.2;                                                                                                          // sign board
  x.fillStyle=vgrad(x,sy,sy+sh,[[0,"#262a55"],[1,"#171a38"]]); rr(x,X+sw*0.04,sy,sw*0.92,sh,4*U); x.fill();
  x.strokeStyle=C.gold; x.lineWidth=2; x.stroke();
  for(var bl=0;bl<22;bl++){ var bx=X+sw*0.07+bl*(sw*0.86/21); x.fillStyle="rgba(255,224,150,0.9)"; x.beginPath(); x.arc(bx,sy+3.5,1.3,0,6.2832); x.arc(bx,sy+sh-3.5,1.3,0,6.2832); x.fill(); }
  x.font="900 "+fs+"px ui-monospace,'SF Mono',Menlo,Consolas,monospace"; x.textAlign="center"; x.textBaseline="middle";
  x.fillStyle=C.navy; x.fillText("CORNER STORE",X+sw/2+1.5,sy+sh/2+2); x.fillStyle=C.gold; x.fillText("CORNER STORE",X+sw/2,sy+sh/2+0.5);
  var ay=H*0.29, ah=H*0.13, st=sw/14;                                                                                                // striped awning with a scalloped edge
  for(var a=0;a<14;a++){ x.fillStyle=a%2?C.cream:C.mag; x.beginPath(); x.moveTo(X-6*U+a*(sw+12*U)/14,ay); x.lineTo(X-6*U+(a+1)*(sw+12*U)/14,ay);
    x.lineTo(X-6*U+(a+1)*(sw+12*U)/14,ay+ah); x.arc(X-6*U+(a+0.5)*(sw+12*U)/14,ay+ah,(sw+12*U)/28,0,3.1416); x.closePath(); x.fill(); }
  x.fillStyle=vgrad(x,ay,ay+ah,[[0,"rgba(30,20,60,0.35)"],[1,"rgba(255,200,120,0.12)"]]); x.fillRect(X-6*U,ay,sw+12*U,ah+st/2);
  x.fillStyle="rgba(20,10,40,0.28)"; x.fillRect(X,ay+ah+st/2,sw,6*U);                                                                // awning shadow
  var wx=X+sw*0.07, wy=H*0.5, ww=sw*0.54, wh=H*0.4;                                                                                  // display window, lit from inside
  x.fillStyle=vgrad(x,wy,wy+wh,[[0,"#FFE9A0"],[1,"#F08C4B"]]); rr(x,wx,wy,ww,wh,3); x.fill();
  var cols=["#E85D9E","#F5C518","#C2255C","#FFF3E0","#2F9E44","#F08C4B"];
  for(var sr=0;sr<3;sr++){ var shy=wy+wh*(0.3+sr*0.27); x.fillStyle="rgba(30,35,64,0.55)"; x.fillRect(wx,shy,ww,2);
    for(var p=wx+4*U;p<wx+ww-8*U;p+=(7+r()*5)*U){ var ph=(8+r()*10)*U; x.fillStyle=cols[Math.floor(r()*cols.length)]; x.fillRect(p,shy-ph,(5+r()*5)*U,ph); } }
  x.strokeStyle=C.navy; x.lineWidth=3; rr(x,wx,wy,ww,wh,3); x.stroke();
  x.fillStyle=vgrad(x,wy,wy+wh,[[0,"rgba(255,255,255,0.28)"],[0.4,"rgba(255,255,255,0)"]]); x.beginPath(); x.moveTo(wx+ww*0.55,wy); x.lineTo(wx+ww*0.8,wy); x.lineTo(wx+ww*0.45,wy+wh); x.lineTo(wx+ww*0.2,wy+wh); x.fill();   // glass sheen
  x.fillStyle="#2a2150"; x.fillRect(wx-3,wy+wh,ww+6,H-wy-wh);                                                                          // riser under the window
  var dx=X+sw*0.7, dw=sw*0.24, dy=wy;                                                                                                // door
  x.fillStyle=C.navy; rr(x,dx-3,dy-3,dw+6,H-dy+3,2); x.fill();
  x.fillStyle=vgrad(x,dy,H,[[0,"#FFD98A"],[1,"#E8884A"]]); x.fillRect(dx,dy,dw,H-dy);
  x.fillStyle=C.navy; x.fillRect(dx+dw/2-1,dy,2,H-dy); x.beginPath(); x.arc(dx+dw*0.38,dy+(H-dy)*0.55,2,0,6.2832); x.arc(dx+dw*0.62,dy+(H-dy)*0.55,2,0,6.2832); x.fill();
  rr(x,dx+dw*0.1,dy+(H-dy)*0.14,dw*0.8,(H-dy)*0.2,2); x.fillStyle=C.gold; x.fill(); x.strokeStyle=C.navy; x.lineWidth=1.5; x.stroke();       // the EBT sticker
  x.fillStyle=C.navy; x.font="900 "+Math.max(7,dw*0.26)+"px ui-monospace,Menlo,Consolas,monospace"; x.fillText("EBT",dx+dw/2,dy+(H-dy)*0.24+1);
  x.fillStyle="rgba(255,200,110,0.40)"; x.fillRect(X+sw-3,H*0.04,3,H*0.96);                                                          // rim light
  grain(x,w,H+4,0.07);
  return {s:s, x:G.cx-w/2, y:G.gy-H-2, sign:{x:X+sw*0.04,y:sy,w:sw*0.92,h:sh}, open:{x:wx+ww*0.12,y:wy-H*0.06,w:ww*0.4}};
}
function bakeStreet(G){
  var w=VW+2*MG, h=VH-G.gy, s=mk(w,h), x=s.x, wk=G.walk;
  x.fillStyle=vgrad(x,0,wk,[[0,"#d8b4c8"],[1,"#9a7498"]]); x.fillRect(0,0,w,wk);                                                       // sidewalk
  x.fillStyle="rgba(60,30,90,0.18)"; for(var sx=0;sx<w;sx+=64*U){ x.fillRect(sx,0,1.4,wk); } x.fillRect(0,wk*0.45,w,1.2);
  var r=rng(31); for(var q=0;q<60;q++){ x.fillStyle=r()<0.5?"rgba(255,243,224,0.12)":"rgba(40,20,70,0.10)"; x.fillRect(r()*w,r()*wk,(6+r()*20)*U,(1+r()*3)*U); }
  x.fillStyle="rgba(20,10,40,0.34)"; x.fillRect(0,0,w,5*U);                                                                           // shadow of the store at its foot
  x.fillStyle="#fff3e0"; x.fillRect(0,wk-3*U,w,3*U); x.fillStyle="rgba(255,243,224,0.55)"; x.fillRect(0,wk-3*U,w,1.2);                  // curb top
  x.fillStyle=C.navy; x.fillRect(0,wk,w,4*U);                                                                                          // curb face
  x.fillStyle=vgrad(x,wk+4*U,h,[[0,"#2a2540"],[1,"#12101d"]]); x.fillRect(0,wk+4*U,w,h-wk-4*U);                                         // road
  blob(x,w*0.55,wk+10*U,w*0.4,22*U,C.gold,0.20);                                                                                       // sunset on the asphalt
  blob(x,w*0.2,wk+8*U,w*0.25,16*U,C.pink,0.14);
  for(var q2=0;q2<80;q2++){ x.fillStyle=r()<0.5?"rgba(255,243,224,0.05)":"rgba(0,0,0,0.12)"; x.fillRect(r()*w,wk+6*U+r()*(h-wk-6*U),(4+r()*22)*U,(1+r()*2)*U); }
  var ly=wk+(h-wk)*0.62; x.fillStyle="rgba(245,197,24,0.8)"; for(var dxx=-20*U; dxx<w; dxx+=74*U){ x.fillRect(dxx,ly,40*U,3*U); }                // lane dashes
  grain(x,w,h,0.09);
  return {s:s, x:-MG, y:G.gy};
}
function bakeLamp(G){
  var ph=VH*0.34, w=60*U, s=mk(w,ph), x=s.x, px=14*U;
  x.fillStyle="#141028"; x.fillRect(px,10*U,4.5*U,ph-10*U); x.fillRect(px-4*U,ph-10*U,13*U,10*U);
  x.strokeStyle="#141028"; x.lineWidth=3.5*U; x.beginPath(); x.moveTo(px+2*U,16*U); x.quadraticCurveTo(px+2*U,2*U,px+26*U,6*U); x.stroke();
  x.fillStyle="#141028"; rr(x,px+18*U,5*U,18*U,7*U,3*U); x.fill();
  x.fillStyle="#FFF0B0"; x.fillRect(px+21*U,11*U,12*U,2.4*U);
  x.fillStyle="rgba(255,200,110,0.4)"; x.fillRect(px+4*U,10*U,1.2,ph-20*U);
  return {s:s, x:VW*0.07-px, y:G.gy+G.walk*0.74-ph, glow:{x:VW*0.07-px+px+27*U, y:G.gy+G.walk*0.74-ph+13*U}};
}
function bakeVignette(){
  var s=mk(VW,VH), x=s.x;
  x.fillStyle=vgrad(x,0,VH,[[0,"rgba(8,6,24,0.5)"],[0.22,"rgba(8,6,24,0)"],[0.8,"rgba(8,6,24,0)"],[1,"rgba(8,6,24,0.5)"]]); x.fillRect(0,0,VW,VH);
  return s;
}

/* ---- bake everything for this size ---- */
function measure(){
  VW=window.innerWidth||390; VH=window.innerHeight||780;
  Q=Math.min(window.devicePixelRatio||1,1.5); Q=Math.min(Q,Math.sqrt(1.5e6/(VW*VH))); Q=Math.max(Q,0.6);
  U=clamp(Math.min(VH,VW*1.8)/844,0.7,1.6); MG=Math.round(14*U);
  cv.width=Math.round(VW*Q); cv.height=Math.round(VH*Q); cv.style.width=VW+"px"; cv.style.height=VH+"px";
}
function bake(){
  noisePat=null;
  var G=geom(), sky=bakeSky(G), clouds=bakeClouds(), far=bakeSkyline(G,false), near=bakeSkyline(G,true), lb=building(G,-1,3), rb=building(G,1,9), store=bakeStore(G), st=bakeStreet(G), lamp=bakeLamp(G), vig=bakeVignette();
  var by=G.gy-VH*0.01;
  var by0=G.gy-VH*0.01;
  // each layer: where it is drawn, how it flies in (dx,dy from, t0..t1, easing, fades), and how it sways (ax,ay px, phase)
  L={G:G, sky:{s:sky, x:0, y:0, f:{t0:0,t1:0.55,fade:1,ease:eOut}},
    clouds:{s:clouds, x:0, y:VH*0.1, f:{t0:0.2,t1:0.9,fade:1,ease:eOut}, Wc:Math.round(VW*1.5)},
    far:{s:far, x:-MG, y:by-far.h+2, f:{t0:0.15,t1:0.8,dy:VH*0.22,fade:1,ease:eOut}, ax:2.2*U, ph:0.4},
    near:{s:near, x:-MG, y:by-near.h+2, f:{t0:0.3,t1:0.95,dy:VH*0.26,fade:1,ease:eOut}, ax:3.4*U, ph:1.3},
    lb:{s:lb.s, x:lb.x, y:lb.y, f:{t0:0.4,t1:1.05,dx:-VW*0.7,ease:eOut}, ax:2.6*U, ph:2.1},
    rb:{s:rb.s, x:rb.x, y:rb.y, f:{t0:0.5,t1:1.15,dx:VW*0.7,ease:eOut}, ax:2.6*U, ph:2.9},
    st:{s:st.s, x:st.x, y:st.y, f:{t0:0.55,t1:1.15,dy:VH*0.25,ease:eOut}},
    store:{s:store.s, x:store.x, y:store.y, f:{t0:0.8,t1:1.45,dy:VH*0.55,ease:eBack}, ax:1.6*U, ph:3.7, sign:store.sign, open:store.open},
    lamp:{s:lamp.s, x:lamp.x, y:lamp.y, f:{t0:1.1,t1:1.65,dy:-VH*0.5,ease:eBack}, glow:lamp.glow},
    vig:{s:vig, x:0, y:0, f:{t0:0.1,t1:0.8,fade:1,ease:eOut}}
  };
  [["sky","sky"],["far","far"],["near","near"],["store","store"],["street","st"]].forEach(function(p){ var a=artLayer(p[0],G,by0); if(a){ L[p[1]].s=a.s; L[p[1]].x=a.x; L[p[1]].y=a.y; } });
  var bl=artLayer("buildings",G,by0); if(bl){ L.lb.s=bl.s; L.lb.x=bl.x; L.lb.y=bl.y; L.rb=null; }
  if(artImg.store){ L.store.sign=null; }
}

/* ---- drawing ---- */
function lay(l){            // draws one layer at time T (fly-in, then sway); returns its offset
  var f=l.f, u=clamp((T-f.t0)/(f.t1-f.t0),0,1);
  if(u<=0) return null;
  var e=f.ease(u), sw=reduced?0:clamp((T-SETTLED+0.3)/1.2,0,1);
  var ox=(f.dx||0)*(1-e)+(l.ax||0)*sw*Math.sin(T*0.31+(l.ph||0)), oy=(f.dy||0)*(1-e);
  g.globalAlpha=f.fade? clamp(u*1.5,0,1) : 1;
  g.drawImage(l.s.c,l.x+ox,l.y+oy,l.s.w,l.s.h);
  g.globalAlpha=1;
  return {x:ox,y:oy,u:u};
}
function glowAt(cx,cy,r,col,a){ g.globalAlpha=1; var gr=g.createRadialGradient(cx,cy,0,cx,cy,r); gr.addColorStop(0,rgba(col,a)); gr.addColorStop(1,rgba(col,0)); g.fillStyle=gr; g.fillRect(cx-r,cy-r,2*r,2*r); }
function draw(){
  g.setTransform(Q,0,0,Q,0,0); g.globalCompositeOperation="source-over";
  var s=L.sky; lay(s);
  // clouds: one tile, drifting sideways and wrapping
  var c=L.clouds, cu=clamp((T-c.f.t0)/(c.f.t1-c.f.t0),0,1);
  if(cu>0){ var off=reduced?0:(T*5*U)%c.Wc; g.globalAlpha=clamp(cu*1.5,0,1); for(var k=-1;k<=1;k++){ var px=off+k*c.Wc; if(px>VW||px+c.Wc<0) continue; g.drawImage(c.s.c,px,c.y,c.s.w,c.s.h); } g.globalAlpha=1; }
  lay(L.far); lay(L.near); lay(L.lb); if(L.rb) lay(L.rb);
  var so=lay(L.store);
  if(so){ var st=L.store, up=clamp((T-1.5)/0.3,0,1), fl=0;                       // the sign lights up after the store lands, then flickers a little
    if(up>0){ fl= reduced? 0.14 : 0.13+0.05*Math.sin(T*9.3)*Math.sin(T*2.1)+(((T*0.43)%1)<0.025?-0.13:0); if(T<1.9&&!reduced) fl*= (Math.sin(T*70)>0?1:0.3); fl=Math.max(0,fl)*up; }
    var sg=st.sign; if(!sg) fl=0;
    var gx=L.store.x+so.x, gy2=L.store.y+so.y;
    if(fl>0&&sg){ g.globalCompositeOperation="lighter"; g.fillStyle=rgba(C.gold,fl); g.fillRect(gx+sg.x,gy2+sg.y,sg.w,sg.h); glowAt(gx+sg.x+sg.w/2,gy2+sg.y+sg.h/2,sg.w*0.7,C.gold,fl*1.2);
      var op=st.open, pl=reduced?0.8:0.65+0.35*Math.sin(T*3.1); glowAt(op.x+op.w/2,op.y+gy2-L.store.y+L.store.y,op.w*0.5,C.pink,0.0); g.globalCompositeOperation="source-over"; }
  }
  lay(L.st);
  var lo=lay(L.lamp);
  if(lo&&lo.u>0.95){ var lg=L.lamp.glow, lf=reduced?0.5:0.5+0.08*Math.sin(T*4.1)+0.04*Math.sin(T*13); g.globalCompositeOperation="lighter"; glowAt(lg.x+lo.x,lg.y+lo.y,74*U,C.gold,lf); g.globalCompositeOperation="source-over"; }
  drawGag();
  lay(L.vig);
}

/* ---- the gag on the street ---- */
function ok(img){ return img && img.complete && img.naturalWidth>0; }
function startGag(){
  var d=gag.dir=(gag.n++%2)?-1:1, G=L.G, disp=Math.round(clamp(78*U,56,110)), M=disp*1.2, vg=340*U;
  var F1=VW*0.44, skidD=VW*0.07, F2=F1+skidD, ta=(F1+M)/vg, tb=ta+0.45, tc=tb+0.3, dr=(VW+M-F2)/(vg*1.1);
  var Fs=F2-disp*1.5, b0=0.5, db=(Fs+M)/(vg*1.02), bgo=tc+0.2, bdr=dr*1.1;
  gag.seg={disp:disp,M:M,vg:vg,F1:F1,F2:F2,ta:ta,tb:tb,tc:tc,td:tc+dr,dr:dr,Fs:Fs,b0:b0,db:db,bgo:bgo,bdr:bdr,
    cardT:ta+0.08, cardD:0.85, end:Math.max(tc+dr,bgo+bdr)+0.2, foot:Math.round(G.gy+G.walk*0.9)};
  gag.seg.fade=gag.seg.cardT+gag.seg.cardD+1.8; gag.seg.end=Math.max(gag.seg.end,gag.seg.fade+0.5);
  gag.t=0;
}
function guyF(s,t){            // distance along his path, and what he is doing
  if(t<s.ta) return {f:-s.M+(s.F1+s.M)*(t/s.ta), m:"run"};
  if(t<s.tb){ var u=(t-s.ta)/(s.tb-s.ta); return {f:s.F1+(s.F2-s.F1)*(1-(1-u)*(1-u)), m:"skid", u:u}; }
  if(t<s.tc) return {f:s.F2, m:"stand"};
  var v=clamp((t-s.tc)/s.dr,0,1); return {f:s.F2+(VW+s.M-s.F2)*(0.45*v+0.55*v*v), m:"run"};
}
function bullyF(s,t){
  if(t<s.b0) return {f:-s.M-10, m:"gone"};
  if(t<s.b0+s.db){ var u=(t-s.b0)/s.db; return {f:-s.M+(s.Fs+s.M)*eOutSine(u), m:u>0.82?"stand":"run"}; }
  if(t<s.bgo) return {f:s.Fs, m:"stand"};
  var v=clamp((t-s.bgo)/s.bdr,0,1); return {f:s.Fs+(VW+s.M-s.Fs)*(0.45*v+0.55*v*v), m:"run"};
}
function sprite(img,cell,row,frame,flip,cx,foot,disp,base){
  var k=disp/base, dy=Math.round(foot+4*k-disp);
  g.fillStyle="rgba(10,8,24,0.33)"; g.beginPath(); g.ellipse(cx,foot+1,disp*0.27,disp*0.055,0,0,6.2832); g.fill();
  g.imageSmoothingEnabled=false;
  if(flip){ g.save(); g.translate(Math.round(cx+disp/2),dy); g.scale(-1,1); g.drawImage(img,frame*cell,row*cell,cell,cell,0,0,disp,disp); g.restore(); }
  else g.drawImage(img,frame*cell,row*cell,cell,cell,Math.round(cx-disp/2),dy,disp,disp);
  g.imageSmoothingEnabled=true;
}
function drawCard(cx,cy,w,rot,sx){
  g.save(); g.translate(cx,cy); g.rotate(rot); g.scale(Math.max(0.1,Math.abs(sx))*(sx<0?1:1),1);
  var h=w*0.62; rr(g,-w/2,-h/2,w,h,3); g.fillStyle=sx<0?C.mag:C.cream; g.fill(); g.lineWidth=1.6; g.strokeStyle=C.navy; g.stroke();
  if(sx>=0){ g.fillStyle=C.gold; g.fillRect(-w/2+2,-h/2+h*0.18,w-4,h*0.22); g.fillStyle=C.navy; g.font="900 "+Math.round(h*0.42)+"px ui-monospace,Menlo,Consolas,monospace"; g.textAlign="center"; g.textBaseline="middle"; g.fillText("E.B.T",0,h*0.2); }
  else { g.fillStyle=C.gold; g.fillRect(-w/2+2,-h*0.08,w-4,h*0.16); }
  g.restore();
}
function drawGag(){
  if(gag.t<0||!L||!seg()) return;
  var s=gag.seg, t=gag.t, d=gag.dir, W=VW, pimg=sprites&&sprites.player, bimg=sprites&&sprites.bully;
  var X=function(f){ return d>0? f : W-f; }, foot=s.foot, bdisp=Math.round(s.disp*1.14);
  var COLS=8, cyc=88*(s.disp/84);
  var gy=guyF(s,t), by=bullyF(s,t);
  // dust where he skids
  if(gy.m==="skid"||(t>s.tb&&t<s.tb+0.5)){ var du=clamp((t-s.ta)/0.9,0,1);
    for(var i=0;i<5;i++){ var px=X(s.F1+(s.F2-s.F1)*i/5-d*0)- d*(i*5*U)*0, a=(1-du)*0.5*(1-i/6), rad=(5+i*3.5)*U*(0.5+du);
      g.fillStyle="rgba(255,243,224,"+a+")"; g.beginPath(); g.arc(X(s.F1-6*U+ (s.F2-s.F1)*(i/4))-d*(i*6*U), foot-3*U-du*8*U*(i%2?1:0.5), rad, 0, 6.2832); g.fill(); } }
  var items=[];
  if(ok(pimg)){ items.push({y:foot, fn:function(){
    var row=gy.m==="run"?2:0, fr=gy.m==="run"?Math.floor(gy.f/cyc*COLS)%COLS:0; if(fr<0) fr+=COLS;
    var cx=X(gy.f);
    if(gy.m==="skid"){ g.save(); g.translate(cx,foot); g.rotate(-d*0.12*(1-gy.u)); g.translate(-cx,-foot); sprite(pimg,96,0,0,false,cx,foot,s.disp,84); g.restore(); }
    else sprite(pimg,96,row,fr,d<0,cx,foot,s.disp,84); }}); }
  if(ok(bimg)&&by.m!=="gone"){ items.push({y:foot+3, fn:function(){
    var run=by.m==="run", fr=run?Math.floor(by.f/cyc*COLS)%COLS:0; if(fr<0) fr+=COLS;
    sprite(bimg,96,run?2:0,fr,run&&d<0,X(by.f),foot+3,bdisp,96); }}); }
  items.sort(function(a,b){ return a.y-b.y; }).forEach(function(it){ it.fn(); });
  // the E.B.T card: out of his pocket, up, spinning, down to the sidewalk, a bounce, a twinkle, then gone
  var ct=t-s.cardT;
  if(ct>=0){
    var px0=X(s.F1+(s.F2-s.F1)*0.25), py0=foot-s.disp*0.32, lx=px0-d*s.disp*0.55, ly=foot+s.disp*0.06, w=s.disp*0.46, cx2, cy2, rot, sx, al=1;
    if(ct<s.cardD){ var u=ct/s.cardD; cx2=px0+(lx-px0)*u; cy2=py0+(ly-py0)*u*u-s.disp*0.62*4*u*(1-u); rot=u*Math.PI*2.4*d; sx=Math.cos(u*Math.PI*5); }
    else { var b=ct-s.cardD, hop=b<0.22? Math.sin(b/0.22*Math.PI)*s.disp*0.07 : 0; cx2=lx; cy2=ly-hop; rot=0.16*d; sx=1;
      if(b>0.2&&b<0.9){ var tw=Math.sin((b-0.2)/0.7*Math.PI); g.save(); g.globalCompositeOperation="lighter"; glowAt(lx,ly,w*(0.8+tw*0.7),C.gold,0.55*tw); g.restore(); }
      if(t>s.fade-0.5) al=clamp((s.fade-t)/0.5,0,1); }
    g.globalAlpha=al; drawCard(cx2,cy2,w,rot,sx); g.globalAlpha=1;
  }
  if(t>s.end){ gag.t=-1; gag.next=T+GAG_EVERY-s.end; }
}
function seg(){ return gag.seg; }

/* ---- the loop ---- */
function render(){ if(!L) return; draw(); frames++; }
function tick(ts){
  raf=0;
  if(!running) return;
  if(!host||!host.classList.contains("on")){ halt(); return; }       // the title is gone: nothing left running, layers freed
  if(document.hidden){ last=0; return; }                              // tab hidden: not rescheduled; visibilitychange restarts it
  var dt=last? Math.min(0.1,(ts-last)/1000) : 0.016; last=ts;
  var busy=T<SETTLED+0.3||gag.t>=0;
  acc+=dt;
  if(!busy && acc<0.03){ raf=requestAnimationFrame(tick); return; }  // idle: about 30 fps is plenty for a sway
  var step=acc; acc=0;
  if(!hold){
    T+=step;
    if(gag.t>=0) gag.t+=step;
    else if(T>=gag.next && L && sprites && ok(sprites.player) && ok(sprites.bully) && !reduced) startGag();
  }
  render();
  raf=requestAnimationFrame(tick);
}
function halt(){
  running=false; if(raf){ cancelAnimationFrame(raf); raf=0; }
  L=null; gag.t=-1; if(cv){ cv.width=1; cv.height=1; }
}
function onVis(){ if(!document.hidden&&running&&!raf){ last=0; acc=0; raf=requestAnimationFrame(tick); } }
function onResize(){
  if(!cv||!host||!L) return; clearTimeout(rsz);
  rsz=setTimeout(function(){ if(!L||!host.classList.contains("on")) return; measure(); bake(); if(gag.t>=0) gag.t=-1; g=cv.getContext("2d"); render(); },140);
}

/* ---- public ---- */
function start(o){
  host=document.getElementById("ovTitle"); if(!host) return;
  sprites=o&&o.sprites||sprites;
  reduced=!!(typeof matchMedia==="function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  if(!cv){
    cv=document.createElement("canvas"); cv.id="titleScene"; cv.setAttribute("aria-hidden","true");
    cv.style.cssText="position:fixed;left:0;top:0;z-index:-1;pointer-events:none;display:block";
    host.appendChild(cv);
    window.addEventListener("resize",onResize); document.addEventListener("visibilitychange",onVis);
  }
  if(raf){ cancelAnimationFrame(raf); raf=0; }
  var intro=!!(o&&o.intro)&&!reduced&&!seen;
  seen=true;
  measure(); bake(); g=cv.getContext("2d");
  T= intro? 0 : SETTLED+0.8; gag.t=-1; gag.next= T+(intro? GAG_FIRST : 2.2); acc=0; last=0; hold=false;
  running=!reduced;
  render();
  if(running) raf=requestAnimationFrame(tick);
}
function settle(){                      // a tap during the intro: every layer in place, no gag
  if(!L) return;
  if(T<SETTLED+0.8) T=SETTLED+0.8;
  gag.t=-1; gag.next=T+1.8; render();
}
return {
  start:start, settle:settle, stop:halt,
  get frames(){ return frames; }, get running(){ return running; }, get T(){ return T; },
  _seek:function(t,gt){ hold=true; T=t; gag.t=-1; if(gt!=null){ gag.next=1e9; if(gag.t<0) startGag(); gag.t=gt; } render(); }   // test hook
};
})();
