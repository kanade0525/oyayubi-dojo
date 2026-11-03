#!/usr/bin/env node
/*
 * 筆字（assets/fonts/YujiSyuku-subset.woff2）に入れる字の一覧を作る。
 *
 * 書体は 8MB あるので、サイトで使う字（HTML と JS に書いてある字・ASCII・かな・全角記号）だけに絞って置いている。
 * 絞った字の一覧は assets/fonts/chars.txt。文言を足して一覧に無い字が出ると、その字だけ
 * ふつうのゴシックで出る（黙って混ざる）。tools/font.test.mjs がそれを落とす。
 *
 * 落ちたら作り直す（fonttools が要る。python3 -m pip install fonttools brotli）:
 *   node tools/font-chars.mjs > assets/fonts/chars.txt
 *   pyftsubset YujiSyuku-Regular.ttf --text-file=assets/fonts/chars.txt --flavor=woff2 \
 *     --layout-features='*' --output-file=assets/fonts/YujiSyuku-subset.woff2
 * 元の書体は https://github.com/google/fonts/tree/main/ofl/yujisyuku （SIL OFL 1.1。assets/fonts/OFL.txt）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

/** サイトに出うる字の集合 */
export function siteChars() {
  const files = ['index.html', 'game.html', 'keycheck.html'].map((f) => join(ROOT, f))
    .concat(walk(join(ROOT, 'assets/js')), walk(join(ROOT, 'assets/data')));
  const set = new Set();
  for (const f of files) for (const c of readFileSync(f, 'utf8')) set.add(c);
  // 打つ人が入れる字（ニックネーム・自由入力）に備えて、ASCII・ひらがな・カタカナ・全角記号は丸ごと
  const range = (a, b) => { for (let c = a; c <= b; c++) set.add(String.fromCodePoint(c)); };
  range(0x20, 0x7e); range(0x3000, 0x30ff); range(0xff01, 0xff5e);
  return new Set([...set].filter((c) => /\P{C}/u.test(c)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write([...siteChars()].sort().join('') + '\n');
}
