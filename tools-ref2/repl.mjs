// a persistent browser: POST /open?which=&q=&w=&h=&touch= boots a page; POST /run runs async code (p, L) => ...
import http from 'node:http'; import * as L from './lib.mjs';
let cur = null;
const AF = Object.getPrototypeOf(async function () {}).constructor;
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x'); const q = Object.fromEntries(u.searchParams);
  const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  try {
    if (u.pathname === '/open') {
      if (cur) { await cur.b.close().catch(() => {}); cur = null; }
      const t0 = Date.now();
      cur = await L.open({ which: q.which, q: q.q, w: +q.w || 390, h: +q.h || 844, touch: q.touch !== '0', live: q.live === '1' });
      return send(200, { ok: true, boot: (Date.now() - t0) / 1000 });
    }
    if (u.pathname === '/goto') { const t0 = Date.now(); await L.load(cur.p, q.which, q.q, q.live === '1'); return send(200, { ok: true, boot: (Date.now() - t0) / 1000 }); }
    if (u.pathname === '/run') { const out = await new AF('p', 'L', 'b', body)(cur.p, L, cur.b); return send(200, { ok: true, out }); }
    if (u.pathname === '/close') { if (cur) await cur.b.close().catch(() => {}); cur = null; send(200, { ok: true }); setTimeout(() => process.exit(0), 100); return; }
  } catch (e) { send(500, { ok: false, err: String(e.stack || e).slice(0, 2000) }); }
}).listen(5790);
