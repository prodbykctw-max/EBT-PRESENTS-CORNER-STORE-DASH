await L.ticks(p, 300); await p.waitForTimeout(12000); await L.ticks(p, 30); await p.waitForTimeout(3000);
const o = await p.evaluate(() => [...document.querySelectorAll('.drive-rbar > *, .drive-row2 > *')].map((e) => +getComputedStyle(e).opacity));
await L.shot(p, 'out/@WHICH@_foot_390b.png');
return o;
