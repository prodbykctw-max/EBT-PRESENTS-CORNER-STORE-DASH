// Is the stick pipeline left/right symmetric? Feeds mirrored stick angles through steerStick + wishVelocity + camYawStep (roam.js) and prints the sum of each left/right pair (all must be 0).
// Usage: node tools-footctl/symmetry.mjs
import { steerStick, wishVelocity, camYawStep, angDiff } from '../public/drive/roam.js';
let worst = 0; const rows = [];
for (const deg of [1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 34, 40, 60, 90, 120, 150]) for (const len of [0.3, 1]) {
  const run = (sgn) => { const st = { on: false, a: 0 }, o = { x: 0, y: 0 }; let yaw = 0.7; const a = sgn * deg * Math.PI / 180, w = { x: 0, y: 0 };
    for (let i = 0; i < 120; i++) { steerStick(st, Math.sin(a) * len, -Math.cos(a) * len, 1 / 60, o); wishVelocity(o.x, o.y, yaw, 6.4, w); yaw = camYawStep(yaw, o.x, o.y, 1, 1 / 60); }
    return { head: angDiff(Math.atan2(w.y, w.x), yaw), dyaw: yaw - 0.7, ox: o.x }; };
  const R = run(1), L = run(-1), e = Math.abs(R.head + L.head) + Math.abs(R.dyaw + L.dyaw) + Math.abs(R.ox + L.ox); worst = Math.max(worst, e);
  if (len === 1) rows.push({ deg, headingFromCamera_right_deg: +(R.head * 180 / Math.PI).toFixed(2), camYaw_after_2s_right_deg: +(R.dyaw * 180 / Math.PI).toFixed(2), mirrorError: +e.toExponential(1) });
}
console.table(rows); console.log('worst mirror error', worst.toExponential(2));
