// on foot: HUD at 390x844 and 320x568, then get in the car
const which = '@WHICH@';
await L.ticks(p, 90);
await p.waitForTimeout(4000);   // GSAP entrance finished
await L.shot(p, `out/${which}_foot_390.png`);
await p.setViewportSize({ width: 320, height: 568 }); await L.ticks(p, 5);
await L.shot(p, `out/${which}_foot_320.png`);
await p.setViewportSize({ width: 390, height: 844 }); await L.ticks(p, 5);
return 'ok';
