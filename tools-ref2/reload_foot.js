const port = '@WHICH@' === 'main' ? 5732 : 5731;
await p.goto(`http://localhost:${port}/drive/index.html?qa&rs=@TAG@`, { timeout: 900000, waitUntil: 'commit' });
await p.waitForFunction(() => window.__drive && window.__drive.comic, null, { timeout: 2400000, polling: 500 });
await p.waitForFunction(() => !document.querySelector('.drive-loading'), null, { timeout: 2400000, polling: 500 });
await p.waitForTimeout(1500);
await p.evaluate(() => { const d = window.__drive; d.manual = true; window.__vt.start(); const t0 = d.tick; d.tick = (dt) => { window.__vt.add(dt * 1000); t0(dt); }; });
return 'loaded';
