// 手元で見るためだけの静的サーバー。依存パッケージは使わない。
//   npm run dev  →  http://localhost:8000/
//
// ES モジュールは file:// では読めないので、直接 index.html を開いても動かない。

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { readHeaders } from './headers.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT) || 8000;

// Cloudflare Pages に置く _headers を、手元でも同じように付ける。
// ここで付けないと CSP は本番でしか効かず、破ったことに気づくのが公開後になる。
const HEADERS = readHeaders(ROOT);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';

  // ルートの外に出さない
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('403');
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...HEADERS,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 not found');
  }
});

server.listen(PORT, () => {
  console.log(`親指シフトタイピング道場  →  http://localhost:${PORT}/`);
});
