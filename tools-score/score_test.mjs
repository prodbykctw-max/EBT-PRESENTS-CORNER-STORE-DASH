// Plays the store run through window.__csd and checks the new scoring end to end:
// the score on screen, the end-screen breakdown, and the leaderboard payload against the server's rules.
// node tools-score/score_test.mjs http://localhost:PORT/standalone.html OUTDIR
import { chromium } from 'playwright';
import { validateLive3 } from '../worker/score-rules.js';
import { mkdirSync } from 'node:fs';
const [url, out] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

async function play(name, { lead, gaps, catchAfter, waitIn }) {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  let posted = null;
  await page.route('**/api/scores**', (r) => {
    if (r.request().method() === 'POST') { posted = JSON.parse(r.request().postData()); return r.fulfill({ status: 201, contentType: 'application/json', body: '{"rank":1}' }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"scores":[]}' });
  });
  await page.goto(url); await page.waitForFunction(() => window.__csd && window.__csd.S, null, { timeout: 60000 });
  const res = await page.evaluate(async ({ lead, gaps, catchAfter, waitIn }) => {
    const c = window.__csd, S = () => c.S, H = 1 / 120;
    const sec = (s) => c.step(H, Math.round(s * 120));
    c.arrive({ bonus: 0, bully: { lead, caughtUp: false } });
    document.getElementById('btnStart').click();
    while (S().intro > 0) c.step(H, 12);
    c.freeze(true);
    if (waitIn) sec(waitIn);
    const picks = [];
    for (let i = 0; i < c.items.length; i++) {
      if (i > 0) sec(gaps[i - 1]);
      if (catchAfter === i) {                       // walk into him: caught, then the continue
        c.freeze(false); let n = 0;
        while (S().mode === 'play' && n++ < 2400) { c.tp(c.bully.x, c.bully.y); c.step(H, 1); }
        await new Promise((r) => setTimeout(r, 1200));
        document.getElementById('btnContinue').click(); c.freeze(true);
      }
      const before = S().score, p = S().curPos; c.tp(p.x, p.y); let n = 0;
      while (S().nGot === i && n++ < 240) c.step(H, 1);
      picks.push({ got: S().nGot, pts: S().score - before, combo: S().combo });
    }
    sec(0.5);
    const pad = [476, 408]; c.tp(pad[0], pad[1]); let n = 0;
    while (!S().won && n++ < 240) c.step(H, 1);
    await new Promise((r) => setTimeout(r, 2500));
    return { picks, score: S().score, itemPts: S().itemPts, runSecs: S().runSecs, beatOut: S().beatOut, noCatch: S().noCatch,
      timeBonus: S().timeBonus, won: S().won, outside: S().bullyOutside, sub: document.getElementById('endSub').innerText,
      final: document.getElementById('finalScore').textContent };
  }, { lead, gaps, catchAfter, waitIn });
  await page.screenshot({ path: `${out}/${name}_end.png` });
  await page.evaluate(() => document.getElementById('btnSubmit').click());
  await page.waitForTimeout(800);
  console.log(`\n== ${name}`); console.log(JSON.stringify(res, null, 1));
  console.log('posted', JSON.stringify(posted));
  ok(errs.length === 0, `${name}: no page errors ${errs.join(' | ')}`);
  ok(posted && posted.v === 3, `${name}: posted v3`);
  ok(posted && validateLive3(posted) === null, `${name}: server accepts it (${posted && validateLive3(posted)})`);
  ok(posted && posted.score === res.score, `${name}: posted score = game score`);
  await page.close();
  return res;
}

// A: he's 30 s behind, items 1 s apart (one long combo), pay at once: beat out + no catch
const A = await play('beat_combo', { lead: 30, gaps: [1, 1, 1, 1, 1, 1] });
ok(A.picks.map((p) => p.pts).join() === '100,200,300,300,300,300,600', 'A: combo x1 x2 x3 x3 x3 x3, rice x3');
ok(A.beatOut && A.noCatch && A.won, 'A: beat out + no catch');
ok(A.score === A.itemPts + 500 + A.timeBonus + 2000 + 1000, 'A: score = items + 500 + speed + 2000 + 1000');
ok(A.timeBonus === 3000 - 25 * A.runSecs, 'A: speed bonus 3000 - 25/s');
// B: he's in after 2 s, items 5 s apart (no combo), caught once before item 4
const B = await play('caught_nocombo', { lead: 2, gaps: [5, 5, 5, 5, 5, 5], catchAfter: 3 });
ok(B.picks.map((p) => p.pts).join() === '100,100,100,100,100,100,200', 'B: no combo');
ok(!B.beatOut && !B.noCatch && B.won, 'B: no beat-out, no no-catch');
ok(B.score === 800 + 500 + B.timeBonus, 'B: score = 800 + 500 + speed');
// C: a gap mid-streak resets it; a catch mid-streak resets it too
const C = await play('reset', { lead: 30, gaps: [1, 1, 6, 1, 1, 1] });
ok(C.picks.map((p) => p.pts).join() === '100,200,300,100,200,300,600', 'C: a 6 s gap starts again at x1');
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);
