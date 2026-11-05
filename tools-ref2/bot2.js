// logic-only bot run: the QA autopilot drives (?qa&bot), the game is stepped with tick(1/60), the bot ticked every 3 ticks (50 ms)
return await p.evaluate(() => {
  const D = window.__drive, rep = window.__botReport; const t0 = Date.now();
  if (!rep) return { err: 'no bot report' };
  let n = 0; const hist = [[0, D.state]]; let last = D.state;
  while (n < 12000 && !['parked', 'late', 'busted'].includes(D.state)) { D.tick(1 / 60); if (n % 3 === 0) rep.tick(); n++; if (D.state !== last) { last = D.state; hist.push([+(n / 60).toFixed(1), D.state, Math.round(D.car.s)]); } }
  for (let i = 0; i < 30; i++) { D.tick(1 / 60); if (i % 3 === 0) rep.tick(); }
  const r = D.result;
  return { state: D.state, ticks: n, simSeconds: +(n / 60).toFixed(1), timeLeft: +D.time.toFixed(1), hits: rep.hits.length, hitList: rep.hits.slice(0, 5).map((h) => [h.hit, h.s]), errors: rep.errors, offroad: rep.offroad, stalls: rep.stalls, popIn: rep.popIn.length, popOut: rep.popOut.length, popOutList: rep.popOut.slice(0,5), teleports: rep.teleports.length, brakes: rep.brakes, honks: rep.honks, carS: Math.round(D.car.s), spot: D.spot.s, resHits: r.hits, hist, wallSec: (Date.now() - t0) / 1000 };
});
