/*
 * tools/serve.mjs - local server that serves this repo at /toolsDame/, the way
 * GitHub Pages does. For the owner's own computer only.
 * Serves: phase 0 test ("the site opens on Pages and locally").
 * Must not change: listens on this computer only (127.0.0.1); serves files of
 * this repo only; sends no file whose name starts with a dot. No packages.
 *
 * Run:  node tools/serve.mjs          then open http://127.0.0.1:8080/toolsDame/
 *       node tools/serve.mjs 9000     to use another port
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PREFIX = '/toolsDame/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

// transform and seen are for tests only: transform(path, text) => text is applied
// to text files; seen(address) is told every request.
export function start(port = 8080, transform = null, seen = null) {
  const server = createServer(async (req, res) => {
    try {
      if (seen) { seen(req.url); }   // tests only: every address asked for
      if (req.method !== 'GET' && req.method !== 'HEAD') { return send(res, 405, TYPES['.txt'], 'Only GET.'); }
      const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      if (path === '/' || path === PREFIX.slice(0, -1)) {
        res.writeHead(302, { Location: PREFIX });
        return res.end();
      }
      if (!path.startsWith(PREFIX)) { return send(res, 404, TYPES['.txt'], 'Not found. The site is at ' + PREFIX); }

      let rel = path.slice(PREFIX.length);
      if (rel === '' || rel.endsWith('/')) { rel += 'index.html'; }
      const file = normalize(join(ROOT, rel));
      const hidden = rel.split('/').some((part) => part.startsWith('.'));
      if (hidden || !file.startsWith(ROOT + sep)) { return send(res, 404, TYPES['.txt'], 'Not found.'); }

      const info = await stat(file).catch(() => null);
      if (!info || !info.isFile()) { return send(res, 404, TYPES['.txt'], 'Not found.'); }
      const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
      let body = await readFile(file);
      if (transform && /^(text|application\/json)/.test(type)) { body = transform(rel, body.toString('utf8')); }
      send(res, 200, type, req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      send(res, 400, TYPES['.txt'], 'Bad request.');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.argv[2]) || 8080;
  await start(port);
  console.log('DAME is open at http://127.0.0.1:' + port + PREFIX + '   (Ctrl+C to stop)');
}
