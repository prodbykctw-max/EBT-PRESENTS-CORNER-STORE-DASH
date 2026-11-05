const which = '@WHICH@'; const crypto = await import('node:crypto'); const fs = await import('node:fs');
await L.ticks(p, 200); await p.waitForTimeout(4000);
const spotS = await p.evaluate(() => window.__drive.spot.s);
const out = {};
for (const s of [120, 182, 600, 1056, Math.round(spotS - 30)]) {
  await L.place(p, { s, v: 0, settle: 90 });
  const url = await p.evaluate(() => window.__drive.snapshot(0.92));
  out['snap_' + s] = crypto.createHash('sha1').update(url).digest('hex');
  if (s === 182 || s === 600) { await L.shot(p, `out/v1_${which}${'@TAG@'}_${s}.png`); out['page_' + s] = crypto.createHash('sha1').update(fs.readFileSync(`out/v1_${which}${'@TAG@'}_${s}.png`)).digest('hex'); }
}
out.hudRoot = await p.evaluate(() => document.querySelector('.drive-root').className + ' | ' + document.querySelector('.drive-hud')?.outerHTML.length + ' | real=' + !!document.querySelector('.drive-rhud'));
fs.writeFileSync(`out/v1_${which}${'@TAG@'}.json`, JSON.stringify(out, null, 1));
return out;
