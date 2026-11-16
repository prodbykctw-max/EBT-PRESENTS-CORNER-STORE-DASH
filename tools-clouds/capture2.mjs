// More proof for the drifting title clouds (phone, iPhone 13 size at DSF 2):
//  1 real time: the clouds really move at CLOUD_SPEED css px a second with the page's own loop (no _seek), measured by cross-correlation
//  2 reduced motion: the clouds do not move (frames 16 s apart are identical) and equal the old sky's painted clouds (vs the previous build's page)
//  3 an animated sequence: viewport screenshots at 15 fps for 6 s (the card and the sign as they are), for the GIF
//  4 stop(): after the title stops, no frames are drawn
// usage: node capture2.mjs <outdir> <port>
import { chromium } from 'playwright-core';
import fs from 'fs';
const out = process.argv[2], port = process.argv[3] || 5495; fs.mkdirSync(out, { recursive: true });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; generic test client)' };
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const png = (n, d) => fs.writeFileSync(`${out}/${n}.png`, Buffer.from(d.split(',')[1], 'base64'));
const grab = (page) => page.evaluate(() => document.getElementById('titleScene').toDataURL('image/png'));
async function open(opts, file) {
  const ctx = await br.newContext({ ...phone, ...opts }); const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://localhost:${port}/${file}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.TitleScene && TitleScene._art, null, { timeout: 60000 }); return { ctx, page };
}
{ // 1 real time
  const { ctx, page } = await open({}, 'standalone.html'); await page.waitForTimeout(4500);   // assembly done
  const a = await page.evaluate(() => ({ T: TitleScene.T, d: document.getElementById('titleScene').toDataURL('image/png'), f: TitleScene.frames }));
  await page.waitForTimeout(3000);
  const b = await page.evaluate(() => ({ T: TitleScene.T, d: document.getElementById('titleScene').toDataURL('image/png'), f: TitleScene.frames }));
  png('rt_a', a.d); png('rt_b', b.d); fs.writeFileSync(`${out}/rt.json`, JSON.stringify({ Ta: a.T, Tb: b.T, fa: a.f, fb: b.f }));
  console.log('real time: scene clock', a.T.toFixed(2), '->', b.T.toFixed(2), 'frames drawn', a.f, '->', b.f);
  // 4 stop
  const st = await page.evaluate(async () => { TitleScene.stop(); const f0 = TitleScene.frames; await new Promise((r) => setTimeout(r, 600)); return { f0, f1: TitleScene.frames, running: TitleScene.running }; });
  console.log('after stop():', st); await ctx.close();
}
{ // 2 reduced motion, new build and previous build
  const { ctx, page } = await open({ reducedMotion: 'reduce' }, 'standalone.html');
  await page.waitForTimeout(800);
  const r = []; for (const t of [2.6, 18.6]) r.push(await page.evaluate((t) => { TitleScene._seek(t); TitleScene._sign('orig', true); return document.getElementById('titleScene').toDataURL('image/png'); }, t));
  png('red_new_0', r[0]); png('red_new_16', r[1]); await ctx.close();
  const o = await open({ reducedMotion: 'reduce' }, '_old_standalone.html'); await o.page.waitForTimeout(800);
  png('red_old', await o.page.evaluate(() => { TitleScene._seek(2.6); TitleScene._sign('orig', true); return document.getElementById('titleScene').toDataURL('image/png'); })); await o.ctx.close();
}
{ // 3 sequence
  const { ctx, page } = await open({}, 'standalone.html'); await page.waitForTimeout(4500);
  await page.evaluate(() => { TitleScene._seek(2.6); TitleScene._sign('orig', false); });
  for (let i = 0; i < 90; i++) { await page.evaluate((t) => { TitleScene._seek(t); }, 2.6 + i / 15); fs.writeFileSync(`${out}/seq_${String(i).padStart(3, '0')}.png`, await page.screenshot()); }
  await ctx.close();
}
await br.close();
