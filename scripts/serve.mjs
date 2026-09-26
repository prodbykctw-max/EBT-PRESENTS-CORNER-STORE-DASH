/**
 * Zero-dependency static server for public/. Used by `npm run dev` so local
 * development never needs a network round-trip to npx.
 *
 *   node scripts/serve.mjs [port]
 *
 * If .certs/dev.key + .certs/dev.crt exist (a local self-signed cert), the same files are also served over
 * HTTPS on port+1, so phones that insist on HTTPS can test over Wi-Fi: https://<this PC's IP>:5174/
 */

import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
};

const handler = async (req, res) => {
  const urlPath = normalize(decodeURI(req.url.split('?')[0]));
  const file = join(ROOT, urlPath === '/' || urlPath === '\\' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404 not found');
  }
};

createServer(handler).listen(PORT, () => console.log(`Corner Store Dash -> http://localhost:${PORT}`));

const CERT = resolve(fileURLToPath(new URL('../.certs/', import.meta.url)));
if (existsSync(join(CERT, 'dev.key')) && existsSync(join(CERT, 'dev.crt'))) {
  const tls = { key: readFileSync(join(CERT, 'dev.key')), cert: readFileSync(join(CERT, 'dev.crt')) };
  createHttpsServer(tls, handler).listen(PORT + 1, () => console.log(`Corner Store Dash (HTTPS, self-signed) -> https://localhost:${PORT + 1}`));
}
