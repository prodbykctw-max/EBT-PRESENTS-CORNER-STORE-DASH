// when did the last real download (a response with a body > 2 KB) finish, relative to the START DRIVE tap?  node tools-load/lastdl.mjs file.json
import fs from 'fs';
const j = JSON.parse(fs.readFileSync(process.argv[2]));
for (const r of j.results) {
  const q = r.reqs.filter((x) => x.wire > 2048 && x.end != null && !/forecast|heads.png|icons/|favicon/.test(x.url));
  const last = q.reduce((a, x) => (x.end > a.end ? x : a), q[0]);
  const bytes = q.reduce((s, x) => s + x.wire, 0);
  console.log(`${r.label}: last big download ends ${last.end.toFixed(2)}s after the tap (${last.url}); big-file bytes ${(bytes / 1e6).toFixed(2)} MB in ${q.length} files; bar70 ${((r.t.bar70 - r.tapPerf) / 1000).toFixed(2)}s; first frame ${r.t.frame ? ((r.t.frame - r.tapPerf) / 1000).toFixed(1) : '-'}s`);
}
