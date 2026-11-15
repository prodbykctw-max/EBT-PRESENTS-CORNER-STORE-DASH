// summarise a net.mjs result: node tools-load/sum.mjs file.json [--list]
import fs from 'fs';
const j = JSON.parse(fs.readFileSync(process.argv[2]));
for (const r of j.results) {
  const q = r.reqs.filter((x) => !/^(blob|data):/.test(x.url) && !/open-meteo|forecast/.test(x.url));
  const wire = q.reduce((s, x) => s + (x.wire || 0), 0), pre = q.filter((x) => x.start < 0), post = q.filter((x) => x.start >= 0);
  const dupes = {}; for (const x of q) dupes[x.url] = (dupes[x.url] || 0) + 1;
  const dup = Object.entries(dupes).filter(([, n]) => n > 1);
  console.log(`${r.label}: tap->bar70 ${((r.t.bar70 - r.tapPerf) / 1000).toFixed(2)}s  tap->frame ${r.t.frame ? ((r.t.frame - r.tapPerf) / 1000).toFixed(1) + 's' : '-'}  requests ${q.length} (before tap ${pre.length}, after ${post.length})  wire ${(wire / 1e6).toFixed(2)} MB (before tap ${(pre.reduce((s, x) => s + (x.wire || 0), 0) / 1e6).toFixed(2)}, after ${(post.reduce((s, x) => s + (x.wire || 0), 0) / 1e6).toFixed(2)})  duplicates ${dup.length}`);
  if (process.argv.includes('--list')) for (const x of q) console.log(String(x.start).padStart(7), String(x.end).padStart(7), String(x.wire).padStart(8), x.status, x.enc || '-', x.cache || '', x.url.slice(0, 70));
  const m = Object.entries(r.t).filter(([k]) => /^bar/.test(k)); 
}
