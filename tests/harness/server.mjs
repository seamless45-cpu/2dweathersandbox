// Tiny static file server for the harness builds.
//   ROOT=... PORT=8123 node server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.ROOT;
const PORT = parseInt(process.env.PORT || '8123');
const TYPES = { '.html' : 'text/html', '.js' : 'text/javascript', '.mjs' : 'text/javascript', '.css' : 'text/css', '.png' : 'image/png', '.glsl' : 'text/plain', '.vert' : 'text/plain', '.frag' : 'text/plain', '.json' : 'application/json', '.ico' : 'image/x-icon' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, url == '/' ? '/index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found: ' + url); }
  res.writeHead(200, { 'Content-Type' : TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control' : 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '0.0.0.0', () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}/index.html`));
