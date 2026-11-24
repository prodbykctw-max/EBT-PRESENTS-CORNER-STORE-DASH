Night lighting proofs (realistic look). Run from this folder with a dev server on the branch (node scripts/serve.mjs <port>)
and NODE_PATH=$(npm root -g) for playwright:
  node cap.js <url> <out> [nofl|quick]   phone night captures (on foot start / 31 m / beside the car, driving straight / at signals),
                                         each relit to 18:15, 13:00, 16:55, 17:47; *_nome / _nohim / _noglow masks; then: python3 meas.py <out>
  FREEZE=1 node det.js <url> <out> "" 13:00 16:55 17:47   deterministic day frames (frozen clock, seeded random, audio on its own
                                         random): compare main vs branch, 0 pixels must differ
  FREEZE=1 node comic.js <url> <out>     comic look frames, same idea
  node flash.js <url> <out> <query>; python3 flashmeas.py <out>   60 frames at 20 fps, per-pixel swing cycles per second
  node rnd.js <url> <out.json>           call site of every shared Math.random draw up to the drive being ready
night_before_after.jpg: the before/after sheet.
