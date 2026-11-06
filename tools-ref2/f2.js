// on foot, then the race strip: shots + layout numbers
const which = '@WHICH@', BR = which === 'branch';
const S = (name) => L.shot(p, `out/${which}_${name}.png`);
const R = (sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
const out = {};
await L.ticks(p, 90); await p.waitForTimeout(4000);
out.hintText = await p.evaluate(() => document.querySelector('.drive-hint').textContent);
out.hintFoot = await R('.drive-hint');
await S('foot_390b');
if (BR) {
  await p.setViewportSize({ width: 320, height: 568 }); await L.ticks(p, 5); await S('foot_320b'); out.hintFoot320 = await R('.drive-hint'); out.race320foot = { race: await R('.drive-race'), track: await R('.drive-race .track'), gap: await R('.drive-race .gap'), store: await R('.drive-dist') };
  await p.setViewportSize({ width: 390, height: 844 }); await L.ticks(p, 5);
}
await p.evaluate(() => { const F = window.__drive.foot; F.me.s = F.doorS; F.me.d = F.doorD; F.me.ps = F.me.s; F.me.pd = F.me.d; });
await L.ticks(p, 30); await L.ticks(p, 120);
out.state = await p.evaluate(() => window.__drive.state);
if (BR) {
  const lay = async (tag) => { out[tag] = { gapText: await p.evaluate(() => document.querySelector('.drive-race .gap').textContent), race: await R('.drive-race'), track: await R('.drive-race .track'), gap: await R('.drive-race .gap'), you: await R('.drive-race .you'), him: await R('.drive-race .him'), store: await R('.drive-dist'), speed: await R('.drive-speed'), tok: await R('.drive-tokens'), light: await R('.drive-light'), rhud: await R('.drive-rhud') }; };
  await p.evaluate(() => window.__drive.ui.setHint(''));
  await lay('race390'); await S('race_390');
  await p.evaluate(() => { const D = window.__drive; D.race.s = D.car.s - 3; }); await L.ticks(p, 12);
  await lay('tail390'); await S('tail_390');
  await p.setViewportSize({ width: 320, height: 568 }); await L.ticks(p, 6);
  await lay('tail320'); await S('tail_320');
  // width jitter check: record speed/store cell widths while the digits change
  out.jitter = await p.evaluate(async () => { const D = window.__drive, c = D.car, w = new Set(); for (const v of [0, 5, 9.9, 10, 25, 44.7]) { c.v = v; D.tick(1 / 60); w.add(Math.round(document.querySelector('.drive-speed').closest('.rb-cell').getBoundingClientRect().width) + '/' + Math.round(document.querySelector('.drive-race .track').getBoundingClientRect().width)); } return [...w]; });
  await p.setViewportSize({ width: 390, height: 844 }); await L.ticks(p, 6);
}
return out;
