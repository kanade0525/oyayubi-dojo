// _headers（Cloudflare Pages の形式）を読む。
//
// dev-server と check の両方から使う。dev-server を直に import すると
// サーバーが立ってしまうので、読むところだけ切り出してある。
//
// 読むのは `/*` の段だけ。パスごとの出し分けはしていないので、それで足りる。

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_ROOT = resolve(import.meta.dirname, '..');

export function readHeaders(root = DEFAULT_ROOT) {
  const out = {};
  let src;
  try {
    src = readFileSync(join(root, '_headers'), 'utf8');
  } catch {
    return out; // 無ければ何も付けない
  }
  let inAll = false;
  for (const line of src.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inAll = line.trim() === '/*'; // 段の見出し
      continue;
    }
    if (!inAll) continue;
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
