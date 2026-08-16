#!/usr/bin/env node
/*
 * npm run check
 *
 * 依存パッケージゼロの総合検査。`~/development/typing-engineer` の tools/check.mjs の流儀を引き継ぐ。
 *
 * この検査の芯にある考えは「緑が何も意味していない状態を作らない」こと。
 * 検査は、通ったときより空振りしたときの方が危ない。落ちないから誰も気づかず、
 * そのまま何年も走り続ける。だからこのファイルは次の三つを守る。
 *
 *   1. まだ無いものは飛ばさず落とす。「未実装」と書いて落とす。
 *      並行実装の途中なので落ちて当たり前だが、何が残っているかは常に一覧で見える。
 *   2. 検査そのものを、わざと壊した入力で検査する（下の「検算の検算」）。
 *      配列データの検算が実は何も見ていなかった、という事故を防ぐ。
 *   3. 単体テストは件数まで見る。0 件成功は成功ではない。
 *
 * CONTRACT.md との照合も双方向でやる。契約書と実装は必ず片方だけ先に動く。
 * 「契約に書いてあるファイルが無い」だけでなく「あるファイルが契約に載っていない」も落とす。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const fails = [];
const ng = (where, msg) => fails.push(`${where}: ${msg}`);
const todo = (what) => fails.push(`未実装: ${what}`);

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has = (p) => existsSync(join(ROOT, p));

// ---------------------------------------------------------------- 1. CONTRACT.md と実在ファイル
//
// 担当表はこの企画の唯一の地図で、ここが古くなると衝突が起きる。
// 表とディスクを両方向で突き合わせる。

const contract = has('CONTRACT.md') ? read('CONTRACT.md') : null;
if (!contract) {
  ng('CONTRACT', 'CONTRACT.md が無い。この検査は全部そこを基準にしている');
}

/** 担当表に載っているパス → 担当名 */
const owners = new Map();
if (contract) {
  const section = contract.match(/^##\s*担当ファイル[^\n]*\n([\s\S]*?)(?=^##\s)/m);
  if (!section) {
    ng('CONTRACT', '「## 担当ファイル」の節が見つからない');
  } else {
    for (const line of section[1].split('\n')) {
      const row = line.match(/^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/);
      if (!row) continue;
      if (row[1] === '担当' || /^[\s-]+$/.test(row[1])) continue;
      for (const m of row[2].matchAll(/`([^`]+)`/g)) owners.set(m[1], row[1]);
    }
    if (!owners.size) ng('CONTRACT', '担当表からファイルが一つも読み取れない（表の書式が変わった？）');
  }
}

for (const [path, who] of owners) {
  if (!has(path)) todo(`${path}（担当: ${who}）`);
}

// 逆方向。ディスクにあって表に無いものは、誰の持ち物か分からない
const LISTED_DIRS = ['assets/js', 'assets/css', 'assets/data'];
const strayCandidates = [];
for (const dir of LISTED_DIRS) {
  if (!has(dir)) continue;
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name.startsWith('.')) continue;
    strayCandidates.push(`${dir}/${name}`);
  }
}
if (has('.')) {
  for (const name of readdirSync(ROOT)) {
    if (name.endsWith('.html')) strayCandidates.push(name);
  }
}
for (const path of strayCandidates) {
  // `tools/` のように末尾スラッシュで丸ごと預けている書き方も拾う
  const covered = [...owners.keys()].some((k) => k === path || (k.endsWith('/') && path.startsWith(k)));
  if (!covered) ng('CONTRACT', `${path} が担当表に載っていない（誰の持ち物か分からない）`);
}

// ---------------------------------------------------------------- 2. CONTRACT.md と単体テストの契約
//
// nicola.js の result と options は全担当が依存する。CONTRACT.md を直したのに
// テストを直し忘れると、契約が二つに割れる。片方だけ動いたら落とす。

const TEST_FILE = 'tools/nicola.test.mjs';
if (!has(TEST_FILE)) {
  ng('テスト', `${TEST_FILE} が無い。状態機械の契約がどこにも書かれていない`);
} else if (contract) {
  const testSrc = read(TEST_FILE);

  /** テスト側が export している一覧を、実行せずに読む（import すると node:test が走ってしまう） */
  const listInTest = (name) => {
    const m = testSrc.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
  };

  /** CONTRACT.md の js ブロックから、先頭 2 スペース字下げの鍵名を拾う */
  const keysInBlock = (src) => [...src.matchAll(/^\s{2}(\w+)[,:]/gm)].map((m) => m[1]);

  const resultBlock = contract.match(/`onOutput` に渡る `result` の形[\s\S]*?```js\n([\s\S]*?)```/);
  const optionBlock = contract.match(/\/\/ options\n\{\n([\s\S]*?)\n\}/);

  for (const [what, block, listed] of [
    ['result', resultBlock && keysInBlock(resultBlock[1]), listInTest('RESULT_KEYS')],
    ['options', optionBlock && keysInBlock(optionBlock[1]), listInTest('OPTION_KEYS')],
  ]) {
    if (!block) {
      ng('CONTRACT', `${what} の形が CONTRACT.md から読み取れない`);
      continue;
    }
    if (!listed) {
      ng('テスト', `${TEST_FILE} が ${what.toUpperCase()}_KEYS を export していない（照合できない）`);
      continue;
    }
    for (const k of block) {
      if (!listed.includes(k)) ng('契約のズレ', `CONTRACT.md の ${what}.${k} をテストが見ていない`);
    }
    for (const k of listed) {
      if (!block.includes(k)) ng('契約のズレ', `テストが要求する ${what}.${k} が CONTRACT.md に無い`);
    }
  }

  // 状態遷移表の 25 マスを踏んでいるか。テスト名に S1〜S5 が出ているかで粗く数える。
  // 厳密な網羅は機械には判定できないが、「まるごと消えた」は捕まえられる
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5']) {
    const hits = (testSrc.match(new RegExp(`'[^']*${s}[^']*'`, 'g')) || []).length;
    if (hits < 4) ng('テスト', `${s} に触れているテストが少なすぎる（${hits} 箇所）`);
  }
  for (const p of ['処理A', '処理B', '処理C', '処理D']) {
    if (!testSrc.includes(p)) ng('テスト', `${p} の検査が無い`);
  }
}

// ---------------------------------------------------------------- 3. 配列データ（nicola.json）の検算
//
// NICOLA の同時打けん面には規則がある。規格 5.3 の原文は
//   「左領域のキーに対して，親指右を，右領域のキーに対して，親指左を同時打けんすると，
//     配列図で各キーの中央に記されている図形文字が選択される。
//     この打けん方式は，主として，濁音又は半濁音の入力に用いる。」
// つまり【交差シフトが濁音】で、同側シフトは別のかな。
// （CONTRACT.md の用語の節は逆に書いてあるが、同じ CONTRACT.md の result の例
//  ―― KeyH（右領域）× 親指左 → shiftKind:'cross' で kana:'ば' ―― は交差＝濁音で整合している）
//
// この規則を機械で確かめるのは、配列データの写し間違いが練習の意味を丸ごと壊すから。
// 「じ」が同側面に入っていても画面は普通に動く。落ちるのは学習者の指だけになる。

const SEION_TO_DAKUON = new Map(Object.entries({
  か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご',
  さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ',
  た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど',
  は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ',
  う: 'ゔ',
}));
const DAKUON = new Set(SEION_TO_DAKUON.values());

// 半濁音は濁音と扱いが違う。規格 5.3 は「半濁音の入力の場合，シフトキーを押下している
// とき，半濁音に対応する清音が割り当てられているキーを押下することによって，半濁音の
// 図形文字を選択してもよい」と書くだけで、面の位置を決めていない。
// 実際の NICOLA は ぱぴぷぺぽ を、清音とは何の関係も無いキー（ら・、・い・め・ね）の
// 交差面に置いている。だから「無シフト面の半濁音になっているか」では検算できない。
// 見るのは (a) 同側面に来ていないこと (b) 五つとも交差面のどこかで打てること の二つ。
const HANDAKUON = new Set(['ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ']);

/**
 * 正規化済みエントリ [{ code, side, none, same, cross }] を検算する。
 * requireAll は「濁音が一つも欠けていないか」まで見るかどうか。
 * 下の「検算の検算」では部分データを食わせるので切れるようにしてある。
 */
function verifyKana(entries, { requireAll = true } = {}) {
  const out = [];
  const seenDakuon = new Set();
  const seenHandakuon = new Set();
  const seenCode = new Set();

  for (const e of entries) {
    const at = e.code; // 呼び出し側がファイル名を前に付ける
    if (seenCode.has(e.code)) out.push(`${at}: code が重複している`);
    seenCode.add(e.code);
    if (e.side !== 'left' && e.side !== 'right') {
      out.push(`${at}: side が "${e.side}"（left か right でなければ同側／交差を決められない）`);
    }

    // (1) 同側シフトは濁音・半濁音であってはならない ─ ここが規則の核
    if (e.same != null && (DAKUON.has(e.same) || HANDAKUON.has(e.same))) {
      out.push(`${at}: 同側シフト面が濁音「${e.same}」。NICOLA では濁音は交差シフト面`);
    }
    // (2) 同側シフトは無シフトと別のかな
    if (e.same != null && e.same === e.none) {
      out.push(`${at}: 同側シフト面が無シフト面と同じ「${e.same}」`);
    }

    // (3) 無シフトが濁点の付く清音なら、交差面はその濁音でなければならない
    const expect = SEION_TO_DAKUON.get(e.none);
    if (expect) {
      if (e.cross == null) out.push(`${at}: 無シフト「${e.none}」に対する交差シフト面（「${expect}」）が無い`);
      else if (e.cross !== expect) out.push(`${at}: 交差シフト面が「${e.cross}」。「${e.none}」の濁音は「${expect}」`);
    }
    // (4) 交差面が濁音なら、無シフト面はその清音でなければならない（逆向きの照合）。
    //     この向きが要るのは、(3) だけだと「濁音を関係の無いキーに置いた」を見逃すから
    if (e.cross != null && DAKUON.has(e.cross)) {
      if (SEION_TO_DAKUON.get(e.none) !== e.cross) {
        out.push(`${at}: 交差シフト面「${e.cross}」に対して無シフト面が「${e.none}」。清音と対応していない`);
      }
      seenDakuon.add(e.cross);
    }
    if (e.cross != null && HANDAKUON.has(e.cross)) seenHandakuon.add(e.cross);
  }

  // (5) 取りこぼし。一つでも打てないかながあると、その字を含む課題が作れない
  if (requireAll) {
    const missing = [...DAKUON].filter((k) => !seenDakuon.has(k));
    if (missing.length) out.push(`交差シフトで打てない濁音がある: ${missing.join(' ')}`);
    const missingH = [...HANDAKUON].filter((k) => !seenHandakuon.has(k));
    if (missingH.length) out.push(`交差シフトで打てない半濁音がある: ${missingH.join(' ')}`);
  }
  return out;
}

/**
 * 配列表をエントリ配列に均す。
 * 配列データの形はコア担当が決めるので、ありそうな書き方を何通りか受ける。
 * どれにも当てはまらなければ、黙って通さずに落とす（形が分からない＝検算していない）。
 *
 * いま実際に来るのは
 *   { hand: 'left', none: 'か', left: 'え', right: 'が' }
 * という形。left / right は「どちらの親指を沈めたか」で、同側／交差ではない。
 * hand と突き合わせて初めて決まる（hand === 沈めた親指 なら同側）。
 * この読み替えを間違えると、検算は通るのに意味が裏返る。ここが一番危ない所なので、
 * 下の「検算の検算」で左右両方の hand について読み替えを確かめている。
 */
function normalizeLayout(json) {
  const NONE = ['none', 'plain', 'normal', 'single', 'unshifted', 'base', 'kana'];
  const SAME = ['same', 'sameShift', 'sameSide'];
  const CROSS = ['cross', 'crossShift', 'crossSide'];
  const pick = (o, names) => {
    for (const n of names) if (n in o) return o[n] === '' ? null : o[n];
    return undefined;
  };

  // キー表がどこにぶら下がっていても拾う
  const table =
    (json && typeof json === 'object' && !Array.isArray(json) &&
      (json.keys || json.layout || json.table || json.map)) ||
    json;
  if (!table || typeof table !== 'object') return null;

  const rows = Array.isArray(table)
    ? table.map((v) => [v?.code ?? v?.key, v])
    : Object.entries(table);

  const entries = [];
  for (const [code, v] of rows) {
    if (!v || typeof v !== 'object' || !code) continue;
    let none = pick(v, NONE);
    let same = pick(v, SAME);
    let cross = pick(v, CROSS);
    const side = v.side ?? v.hand ?? v.region ?? null;

    // 同側／交差ではなく、左親指／右親指で持っている形。side から読み替える
    if (same === undefined && cross === undefined && ('left' in v || 'right' in v)) {
      if (side !== 'left' && side !== 'right') return null; // 読み替えの根拠が無い
      same = (side === 'left' ? v.left : v.right) || null;
      cross = (side === 'left' ? v.right : v.left) || null;
    }
    if (none === undefined || same === undefined || cross === undefined) continue;
    entries.push({ code: String(code), side, none: none || null, same: same || null, cross: cross || null });
  }
  return entries.length ? entries : null;
}

// ---- 検算の検算。壊した入力を必ず捕まえられることを、毎回その場で確かめる。
//      ここが空振りしていると、上の verifyKana は「所見ゼロ」を返し続けて緑になる。

{
  const sane = [
    { code: 'KeyT', side: 'left', none: 'さ', same: 'れ', cross: 'ざ' },
    { code: 'KeyD', side: 'left', none: 'し', same: 'あ', cross: 'じ' },
    { code: 'KeyH', side: 'right', none: 'は', same: 'ぱ', cross: 'ば' },
    { code: 'KeyM', side: 'right', none: 'そ', same: 'ぬ', cross: 'ぞ' },
  ];
  // ↑ KeyH の same に半濁音を置いてある＝これは「壊れた例」。正常例は下で作り直す
  const good = sane.map((e) => (e.code === 'KeyH' ? { ...e, same: 'ゆ' } : e));

  const selfTests = [
    ['正常な例で所見が出ない', good, 0],
    ['同側面に濁音', good.map((e) => (e.code === 'KeyD' ? { ...e, same: 'じ' } : e)), 1],
    ['同側面に半濁音', sane, 1],
    ['交差面が濁音でない', good.map((e) => (e.code === 'KeyD' ? { ...e, cross: 'ぢ' } : e)), 1],
    ['交差面が空', good.map((e) => (e.code === 'KeyD' ? { ...e, cross: null } : e)), 1],
    ['同側面が無シフトと同じ', good.map((e) => (e.code === 'KeyT' ? { ...e, same: 'さ' } : e)), 1],
    ['side が無い', good.map((e) => (e.code === 'KeyT' ? { ...e, side: null } : e)), 1],
    ['code の重複', [...good, { ...good[0] }], 1],
  ];
  for (const [name, data, least] of selfTests) {
    const found = verifyKana(data, { requireAll: false });
    if (found.length < least) ng('検算の検算', `「${name}」を捕まえられていない（検算が空振りしている）`);
    if (least === 0 && found.length) ng('検算の検算', `正常なデータに所見が出た: ${found.join(' / ')}`);
  }
  // 取りこぼし検査そのものも、効いていることを確かめる
  const short = verifyKana(good, { requireAll: true });
  for (const what of ['打てない濁音', '打てない半濁音']) {
    if (!short.some((s) => s.includes(what))) ng('検算の検算', `「${what}」の検査が効いていない`);
  }

  // 左右の読み替え。ここを取り違えると検算は通るのに意味が裏返るので、
  // hand と親指の組み合わせ 4 通りが正しく同側／交差に割れることを直に確かめる。
  //   左手のキー × 左親指 = 同側（別のかな） / 左手のキー × 右親指 = 交差（濁音）
  const raw = {
    keys: {
      KeyW: { hand: 'left', none: 'か', left: 'え', right: 'が' }, //  交差＝右親指
      KeyH: { hand: 'right', none: 'は', left: 'ば', right: 'み' }, // 交差＝左親指
    },
  };
  const got = normalizeLayout(raw);
  const want = [
    { code: 'KeyW', side: 'left', none: 'か', same: 'え', cross: 'が' },
    { code: 'KeyH', side: 'right', none: 'は', same: 'み', cross: 'ば' },
  ];
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    ng('検算の検算', `hand と親指の読み替えが違う\n      得: ${JSON.stringify(got)}\n      期: ${JSON.stringify(want)}`);
  }
  // 読み替えを逆にしたデータは、必ず所見が出なければならない
  const flipped = normalizeLayout({
    keys: { KeyW: { hand: 'left', none: 'か', left: 'が', right: 'え' } },
  });
  if (!verifyKana(flipped, { requireAll: false }).length) {
    ng('検算の検算', '同側と交差を入れ替えたデータを素通ししている');
  }
}

// ---- 本番のデータ

// 配列表は JSON ではなく JS モジュール。fetch を使わずに import で読めるので、
// CSP の connect-src を 'none' のまま保てる（理由は assets/data/nicola.js の冒頭に書いてある）。
// こちらは JSON.parse ではなく import で受ける。
const LAYOUT_SRC = 'assets/data/nicola.js';
const LAYOUT_API = 'assets/js/layout.js';

if (!has(LAYOUT_SRC)) {
  // 担当表からも同じ指摘が出るので、そちらに理由を書き足すだけにする（同じ話を二度出さない）
  const at = fails.findIndex((f) => f.startsWith('未実装: ') && f.includes(LAYOUT_SRC));
  const why = '配列データが無いので、同側＝別のかな／交差＝濁音 の検算ができない';
  if (at >= 0) fails[at] += ` ─ ${why}`;
  else todo(`${LAYOUT_SRC} ─ ${why}`);
} else {
  let layout = null;
  try {
    const mod = await import(pathToFileURL(join(ROOT, LAYOUT_SRC)).href);
    // 名前は決め打ちにしない。配列表らしい export をひとつ拾う
    layout = mod.NICOLA ?? mod.default ?? Object.values(mod).find((v) => v && typeof v === 'object' && v.keys);
    if (!layout) ng('配列', `${LAYOUT_SRC} が配列表を export していない（keys を持つ object が要る）`);
  } catch (e) {
    ng('配列', `${LAYOUT_SRC} を import できない: ${e.message}`);
  }

  if (layout) {
    const entries = normalizeLayout(layout);
    if (!entries) {
      ng(
        '配列',
        `${LAYOUT_SRC} の形が分からず検算できなかった。` +
          'tools/check.mjs の normalizeLayout に形を教えること（形が分からないまま通すと、検算していないのに緑になる）'
      );
    } else {
      for (const s of verifyKana(entries)) ng('配列', `${LAYOUT_SRC} ${s}`);
      console.log(`配列 ${entries.length} キーを検算`);
    }

    // 親指キーの割り当て。左右に同じ code が入ると、その打鍵は同側とも交差とも決まらない
    const tk = layout.thumbKeys;
    if (!tk?.left?.length || !tk?.right?.length) {
      ng('配列', `${LAYOUT_SRC} の thumbKeys に左右どちらかの割り当てが無い`);
    } else {
      for (const code of tk.left) {
        if (tk.right.includes(code)) ng('配列', `親指キー ${code} が左右どちらにも入っている（同側／交差を決められない）`);
      }
      // 文字キーと親指キーが重なると、その文字は永久に打てなくなる
      for (const code of [...tk.left, ...tk.right]) {
        if (layout.keys?.[code]) ng('配列', `${code} が親指キーと文字キーを兼ねている`);
      }
    }
  }

  // 著作権表示。KeyLogicKit 由来のデータは MIT で、表示の保持が条件
  if (!/(MIT|Copyright|license|licence)/i.test(read(LAYOUT_SRC))) {
    ng('配列', `${LAYOUT_SRC} に由来と著作権表示が無い（MIT は表示の保持が条件）`);
  }

  // 配列表を読む窓口が、実際にこのデータを返しているか。
  // データだけ直しても loadLayout が別のものを返していたら画面は変わらない
  if (has(LAYOUT_API) && layout) {
    try {
      const api = await import(pathToFileURL(join(ROOT, LAYOUT_API)).href);
      if (typeof api.loadLayout !== 'function') ng('配列', `${LAYOUT_API} が loadLayout を export していない`);
      else if (api.loadLayout() !== layout) ng('配列', `loadLayout() が ${LAYOUT_SRC} の配列表を返していない`);

      // lookup は未知のキーでも投げないこと。打ち間違いは普通に起きる
      if (typeof api.lookup === 'function') {
        for (const [what, args] of [
          ['未知の code', [layout, 'F13', null]],
          ['空の配列表', [{}, 'KeyF', 'left']],
          ['配列表が null', [null, 'KeyF', 'left']],
        ]) {
          try {
            if (api.lookup(...args) !== null) ng('配列', `lookup: ${what} に null 以外を返した`);
          } catch (e) {
            ng('配列', `lookup: ${what} で例外を投げた（CONTRACT.md では null を返す約束）: ${e.message}`);
          }
        }
      }
    } catch (e) {
      ng('配列', `${LAYOUT_API} を import できない: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------- 4. 流儀
//
// CONTRACT.md の「プロジェクトの流儀」を、書いてあるだけの決まりから
// 落とせる不変条件に変える。まだ無いファイルには何も言わない（3 で報告済み）。

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

const sources = [
  ...walkFiles(join(ROOT, 'assets')),
  ...readdirSync(ROOT).filter((n) => n.endsWith('.html')).map((n) => join(ROOT, n)),
].filter((p) => /\.(js|html|css)$/.test(p));

for (const p of sources) {
  const at = `流儀 ${relative(ROOT, p)}`;
  const src = readFileSync(p, 'utf8');

  // innerHTML を使わない（CSP 整合と XSS 配慮）
  if (/\.innerHTML\s*=/.test(src)) ng(at, 'innerHTML への代入がある。textContent / replaceChildren を使う');

  // CDN を引かない。connect-src 'none' の下では黙って死ぬ
  for (const m of src.matchAll(/(?:src|href)=["']https?:\/\/([^"'/]+)/g)) {
    ng(at, `外部ホスト ${m[1]} を参照している（依存パッケージゼロ・CDN 無しの約束）`);
  }
  if (/\bimport\s*\(?\s*["']https?:\/\//.test(src)) ng(at, '外部 URL から import している');

  // localStorage は全アクセスを try/catch。記録できなくても遊べることが要件
  if (/localStorage/.test(src)) {
    for (const m of src.matchAll(/["'](oyayubi-dojo:[^"']*)["']/g)) {
      if (!/^oyayubi-dojo:[\w-]+:v\d+$/.test(m[1])) ng(at, `保存キー "${m[1]}" が oyayubi-dojo:*:v1 の形でない`);
    }
    if (!/try\s*\{/.test(src)) ng(at, 'localStorage を触るのに try/catch が一つも無い');
  }

  // 各ファイルの冒頭に「何か・なぜこの方針か」を置く
  if (p.endsWith('.js') && !/^\s*(\/\*|\/\/)/.test(src)) ng(at, '冒頭に「何のファイルか」の説明が無い');
}

// ---------------------------------------------------------------- 4.5 参照先の実在
//
// ブラウザを起こさなくても分かる種類の壊れ方。<script src> や import の行き先が
// 無いと、画面は真っ白になるだけで何のエラーも表に出ない。
// 描画の検査より先にここで捕まえた方が、原因が一行で分かる。

const htmlFiles = readdirSync(ROOT).filter((n) => n.endsWith('.html'));
for (const name of htmlFiles) {
  for (const m of read(name).matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|data:|mailto:|#|\/\/)/.test(url)) continue;
    if (!has(url.split(/[?#]/)[0])) ng('参照', `${name} が読む ${url} が無い（画面が真っ白になる）`);
  }
}
for (const p of sources.filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(p, 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    if (!existsSync(resolve(dirname(p), m[1]))) {
      ng('参照', `${relative(ROOT, p)} の import "${m[1]}" が解決できない`);
    }
  }
}

// ---------------------------------------------------------------- 5. 単体テスト
//
// 走らせるだけでなく件数を見る。ファイル名の規約から外れて一本も拾われていない、
// という空振りは「成功 0 件・失敗 0 件」で緑になる。それが一番まずい。

// 引数はディレクトリではなく glob。Node 23 で --test の位置引数からディレクトリ探索が
// 外れ、24 では `node --test tools/` は「tools というファイルを実行」と解釈されて
// MODULE_NOT_FOUND になる。しかも終了コードは 0 なので、気づかないと素通りする
const TEST_GLOB = 'tools/**/*.test.mjs';

if (has('tools')) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', TEST_GLOB], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  const tap = `${r.stdout || ''}${r.stderr || ''}`;
  const pass = Number(tap.match(/^# pass (\d+)/m)?.[1] ?? -1);
  const fail = Number(tap.match(/^# fail (\d+)/m)?.[1] ?? -1);

  if (pass < 0 || fail < 0) {
    ng('単体テスト', `TAP の集計を読めなかった。テストを起動できていない疑い\n${indent(tap.slice(-2000))}`);
  } else if (pass + fail === 0) {
    ng('単体テスト', 'テストが一本も拾われていない（node --test の対象は *.test.mjs）');
  } else if (fail > 0) {
    ng('単体テスト', `${pass + fail} 本中 ${fail} 本が落ちた\n${indent(failLines(tap))}`);
  } else {
    console.log(`単体テスト ${pass} 本が通った`);
  }
}

function indent(s) {
  return s.split('\n').map((l) => `      ${l}`).join('\n');
}

/**
 * TAP から、落ちたテストの名前と理由を抜く。
 * 理由でまとめてから出す。実装が丸ごと無いときは同じ理由が何十本も並び、
 * 全部並べると本当の失敗がその中に埋もれて読めなくなる。
 */
function failLines(tap) {
  const lines = tap.split('\n');
  const byReason = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*not ok \d+ - (.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    let reason = '(理由が読めない)';
    for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
      if (/^\s*(not )?ok \d+/.test(lines[j])) break;
      const why = lines[j].match(/^\s*error:\s*(.*)$/);
      if (!why) continue;
      // error: |- で始まる複数行の書き方も拾う
      if (why[1].trim() === "'|-'" || why[1].trim() === '|-') {
        const body = [];
        for (let k = j + 1; k < Math.min(j + 12, lines.length); k++) {
          if (/^\s*(code|failureType|stack|at):/.test(lines[k]) || /^\s*\.\.\.\s*$/.test(lines[k])) break;
          body.push(lines[k].trim());
        }
        reason = body.join(' ').trim() || reason;
      } else {
        reason = why[1].replace(/^'|'$/g, '').trim();
      }
      break;
    }
    // まとめ役の suite（「N subtests failed」）は中身が下に出るので落とす
    if (/subtests? failed/.test(reason)) continue;
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push(name);
  }

  const out = [];
  for (const [reason, names] of byReason) {
    out.push(reason.split('\n')[0]);
    for (const n of names.slice(0, 5)) out.push(`    ✗ ${n}`);
    if (names.length > 5) out.push(`    …ほか ${names.length - 5} 本、同じ理由`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- 6. 描画
//
// 画面ができるまでは出番が無い。ただし「Chrome が見つからないから飛ばした」を
// 静かに許すと、CI が何も見ないまま緑になる。その線だけ先に引いておく。

if (has('index.html')) {
  const chrome = findChrome();
  if (!chrome && process.env.CI) {
    ng('描画', 'Chrome が見つからない（CI では飛ばさず落とす。緑なのに何も見ていない状態を作らない）');
  } else if (!chrome) {
    console.log('Chrome が見つからないので描画の検査は飛ばす（CHROME= で場所を渡せる）');
  } else {
    await browserChecks(chrome);
  }
}

/**
 * 画面を実際に描かせてからの検査。
 *
 * ここを作った理由は typing-engineer と同じで、既定値はエラーを出さないから。
 * リンクの下線も、地に沈んだ文字色も、動きは壊さないし画像を見ても気づけない。
 * computed style を実測して不変条件を置くしか捕まえようがない。
 *
 * このアプリ固有の事情がもう一つある。配色を 4 種持っていて、地の色が種類ごとに違う。
 * 「黒地で 7:1 出ているから大丈夫」は他の 3 種の保証にならないので、
 * 4 種すべてについて、地の色を実測してから比を出す。
 */
async function browserChecks(chromeBin) {
  const PORT = 8793;

  // CSP を検査サーバーが送る。_headers があればそれを、無ければ「置く予定の形」を送る。
  // 送らずに検査すると「CSP を当てた瞬間に画面が死ぬ」を出荷まで見つけられない。
  const headersFile = has('_headers') ? read('_headers') : null;
  const declaredCsp = headersFile?.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1]?.trim() ?? null;

  // 冒頭のちらつき止めはインラインスクリプト。ハッシュを実測して許可する。
  // 'unsafe-inline' で通すと検査が甘くなるうえ、ここで出るハッシュは
  // そのまま _headers に貼れる（下で表示する）
  const inline = [...read('index.html').matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const hashes = inline.map((s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`);
  const intendedCsp = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  const csp = declaredCsp ?? intendedCsp;
  if (!declaredCsp) {
    console.log('_headers がまだ無いので、検査サーバーが「置く予定の CSP」を代わりに送って検査する:');
    console.log(`  Content-Security-Policy: ${intendedCsp}`);
  } else {
    // 置いてあるなら、緩んでいないかを見る。ここが緩むと外に出られるのに気づけない
    for (const need of ["default-src 'self'", "connect-src 'none'", "object-src 'none'", "base-uri 'none'"]) {
      if (!declaredCsp.includes(need)) ng('CSP', `_headers の CSP に ${need} が無い`);
    }
    if (/connect-src[^;]*(https?:|\*)/.test(declaredCsp)) ng('CSP', '_headers の connect-src が外を向いている');
    for (const h of hashes) {
      if (!declaredCsp.includes(h) && !/script-src[^;]*'unsafe-inline'/.test(declaredCsp)) {
        ng('CSP', `index.html のインラインスクリプトが _headers の script-src で許可されていない: ${h}`);
      }
    }
  }

  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream',
      'Content-Security-Policy': csp,
    });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  const chrome = spawn(chromeBin, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'oyayubi-'))}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1280,900',
    ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  try {
    const wsBrowser = await new Promise((res, rej) => {
      let buf = '';
      const timer = setTimeout(() => rej(new Error('Chrome が起動しない')), 20000);
      chrome.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/ws:\/\/\S+/);
        if (m) {
          clearTimeout(timer);
          res(m[0]);
        }
      });
    });

    const port = new URL(wsBrowser).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));

    let id = 0;
    const waiting = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)(m);
        waiting.delete(m.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((r) => {
        const i = ++id;
        waiting.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? JSON.stringify(r.result.exceptionDetails));
      return r.result?.result?.value;
    };

    // Page.enable を先に呼ばないと addScriptToEvaluateOnNewDocument が効かない。
    // 効いていないと window.__err はいつまでも undefined で、読み込みで落ちた
    // ときの理由が「(見当たらない)」になる。仕込みの空振りは緑になるので厄介
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__err = null;
        // capture を立てないと、script や link の読み込み失敗（404）を拾えない。
        // これが無いと「真っ白なのに理由は見当たらない」で止まる
        addEventListener("error", (e) => {
          const t = e.target;
          if (t && t !== window && (t.src || t.href)) window.__err = "読み込めない: " + (t.src || t.href);
          else window.__err = String(e.message || e.error);
        }, true);
        addEventListener("unhandledrejection", (e) => { window.__err = "unhandled: " + e.reason; });
        window.__csp = [];
        addEventListener("securitypolicyviolation", (e) => {
          window.__csp.push(e.violatedDirective + " ← " + (e.blockedURI || "(inline)"));
        });
      `,
    });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

    // 画面が出ているか。これを先に見ないと、真っ白でも下の検査は通ってしまう。
    //
    // 数えるのは「JS が入れた中身」だけにする。index.html に静的に置いてある
    // ボタン（配色の切替など）を数に入れると、app.js が丸ごと無くても
    // 数が立って緑になる。実際それで一度取り逃した
    // 画面ごとに «そこで JS が入れるはずの中身» を見る。
    // 玄関に課題一覧があった頃は 1 画面で足りたが、入口を «覚える／鍛える» に
    // 分けたので一覧は #/learn へ移った。玄関だけ見ていると、
    // 一覧が壊れていても «玄関は出ている» で緑になる
    const DRAWN = [
      ['#/', '#homePick .pick__one', '玄関の二つの入口'],
      ['#/learn', '#courseList > *', '課題の一覧'],
      ['#/train', '#drillTextList .material', '題材の一覧'],
      ['#/layout', '.board > *', '配列表'],
      ['#/play/basic-1', '.meter > *', 'タイミングメーター'],
    ];
    for (const [hash, sel, label] of DRAWN) {
      await evaluate(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
      let drawn = 0;
      for (let i = 0; i < 30; i++) {
        drawn = await evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`).catch(() => 0);
        if (drawn > 0) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!drawn) {
        const why = await evaluate('window.__err || "(見当たらない)"').catch(() => '(読めない)');
        ng('描画', `${hash} で ${label} が一つも出ていない（${sel}）。読み込みで落ちている疑い: ${why}`);
      }
    }
    await evaluate("location.hash = '#/'").catch(() => {});

    // ---- 配色。デザイン担当の「4 種すべてで最小 7.0:1」を、こちらで実測して裏を取る
    const tones = ['midnight', 'matcha', 'plum', 'sumi'];
    const measured = await evaluate(`(${String(measureContrast)})(${JSON.stringify(tones)})`);
    let worst = { ratio: Infinity };
    for (const row of measured) {
      if (row.ratio < worst.ratio) worst = row;
      if (row.ratio < 4.5) ng('配色', `${row.tone} の ${row.fg} が ${row.bgName} に対して ${row.ratio.toFixed(2)}:1（4.5 未満で読めない）`);
    }
    if (worst.ratio === Infinity) {
      ng('配色', 'コントラスト比を一つも測れていない（色トークンの名前が変わった？ 検査が空振りしている）');
    } else {
      // 地ごとに最小を出す。「素地では出ているが札の上で沈む」が一番多い壊れ方で、
      // 全体の最小値ひとつだと、どちらで沈んだのか分からず直しようがない
      console.log(`配色 ${tones.length} 種 × ${measured.length / tones.length} 組を実測（小さいほど読みにくい）`);
      for (const tone of tones) {
        const line = [];
        for (const bgName of [...new Set(measured.map((m) => m.bgName))]) {
          const rows = measured.filter((m) => m.tone === tone && m.bgName === bgName);
          const min = rows.reduce((a, b) => (a.ratio < b.ratio ? a : b));
          line.push(`${bgName} 上 ${min.ratio.toFixed(2)}:1 (${min.fg})`);
        }
        console.log(`  ${tone.padEnd(9)} ${line.join(' / ')}`);
      }
      if (worst.ratio < 7.0) {
        ng(
          '配色',
          `申告は「4 種すべてで最小 7.0:1」だが、実測の最小は ${worst.ratio.toFixed(2)}:1` +
            `（${worst.tone} の ${worst.fg} ／ ${worst.bgName}）。素地 --bg だけで測ると届くが、札の上では届いていない`
        );
      }
    }

    // ---- 既定の見た目が残っていないか
    for (const f of await evaluate(`(${String(defaultLooks)})()`)) ng('見た目', f);

    // ---- CSP。二方向から見る。何も壊していないかと、本当に効いているか。
    //      効いていない CSP を置くのが一番まずい。宣言だけ増えて何も守らない
    const violations = await evaluate('JSON.stringify(window.__csp || null)');
    if (violations === 'null') {
      ng('CSP', '違反を拾う仕込みが入っていない（検査が空振りしている）');
    } else {
      for (const v of new Set(JSON.parse(violations))) ng('CSP', `CSP に引っかかっている: ${v}`);
    }

    // 外に出ようとしたとき、止めたのが CSP だと言えるのは violation が出たときだけ。
    // fetch が失敗したことだけを見ると、CORS でも回線が無くても同じように失敗するので、
    // CSP を丸ごと消してもこの検査は通ってしまう
    const teeth = await evaluate(`(async () => {
      if (!window.__csp) return ['違反を拾う仕込みが入っていない'];
      window.__csp.length = 0;
      const out = [];
      try { await fetch('https://example.com'); } catch {}
      await new Promise((r) => {
        const s = document.createElement('script');
        s.onload = s.onerror = () => r();
        s.src = 'https://example.com/x.js';
        document.head.append(s);
        setTimeout(r, 2000);
      });
      await new Promise((r) => setTimeout(r, 200));
      const got = window.__csp.join(' | ');
      if (!/connect-src/.test(got)) out.push('外への fetch が connect-src で止まっていない');
      if (!/script-src/.test(got)) out.push('外部スクリプトが script-src で止まっていない');
      try { await import('/assets/data/nicola.js'); } catch (e) { out.push('自前の JS が止められた: ' + e.message); }
      return out;
    })()`);
    for (const f of teeth || []) ng('CSP', f);

    // ---- 横に溢れていないか
    const over = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
    if (over > 1) ng('見た目', `横に溢れている（${over}px）`);

    console.log('描画の検査を実行');
  } catch (e) {
    ng('描画', `検査できなかった: ${e.message}`);
  } finally {
    chrome.kill();
    server.close();
  }
}

/** 画面側で走る。配色ごとに地の色を実測してから比を出す */
function measureContrast(tones) {
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const probe = document.createElement('span');
  document.body.append(probe);
  const lum = (css) => {
    const ch = css.startsWith('color(')
      ? css.match(/[-\d.]+/g).map(Number).slice(0, 3)
      : css.match(/[\d.]+/g).slice(0, 3).map((v) => Number(v) / 255);
    const [r, g, b] = ch.map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const value = (name) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };

  // 字や印として乗る色。地は --bg（素地）と --panel（札の上）の両方で見る。
  // 札の上でだけ沈む、という壊れ方があるので片方だけでは足りない
  const INK = ['--fg', '--fg-mid', '--fg-dim', '--tone', '--cross', '--same', '--perfect', '--good', '--off', '--misfire'];
  const GROUND = ['--bg', '--panel'];

  const was = document.documentElement.dataset.tone;
  const out = [];
  for (const tone of tones) {
    document.documentElement.dataset.tone = tone;
    for (const bgName of GROUND) {
      const bg = lum(value(bgName));
      for (const fg of INK) {
        const [hi, lo] = [lum(value(fg)), bg].sort((a, b) => b - a);
        out.push({ tone, fg, bgName, ratio: (hi + 0.05) / (lo + 0.05) });
      }
    }
    // 主色を地にしたときに乗せる文字（ボタンの中）。地が --tone になる特別な組
    const onTone = lum(value('--tone'));
    const ink = lum(value('--tone-ink'));
    const [hi, lo] = [onTone, ink].sort((a, b) => b - a);
    out.push({ tone, fg: '--tone-ink', bgName: '--tone（ボタンの中）', ratio: (hi + 0.05) / (lo + 0.05) });
  }
  document.documentElement.dataset.tone = was;
  probe.remove();
  return out;
}

/** 画面側で走る。ブラウザ既定の見た目が残っていないか */
function defaultLooks() {
  const out = [];
  for (const a of document.querySelectorAll('a')) {
    const line = getComputedStyle(a).textDecorationLine;
    if (line !== 'none') out.push(`<a class="${a.className || '(なし)'}"> に ${line} が出ている`);
  }
  for (const b of document.querySelectorAll('button')) {
    const s = getComputedStyle(b);
    if (s.cursor !== 'pointer') out.push(`<button ${b.id || b.className || ''}> の cursor が ${s.cursor}`);
  }
  // 触る的が小さすぎないか。親指シフトの練習では設定を何度も触る
  for (const b of document.querySelectorAll('button')) {
    const r = b.getBoundingClientRect();
    if (r.width && r.height && (r.width < 24 || r.height < 24)) {
      out.push(`<button ${b.id || b.className || ''}> が ${Math.round(r.width)}×${Math.round(r.height)}px（24px 未満）`);
    }
  }
  return [...new Set(out)];
}

function findChrome() {
  const cands = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const cache = join(process.env.HOME || '', 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((n) => n.startsWith('chromium-'))) {
      cands.push(join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
    }
  }
  cands.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium');
  return cands.filter(Boolean).find((p) => existsSync(p));
}

// ---------------------------------------------------------------- 判定

const undone = fails.filter((f) => f.startsWith('未実装: '));
const broken = fails.filter((f) => !f.startsWith('未実装: '));

if (fails.length) {
  if (undone.length) {
    console.error(`\nまだ無いもの ${undone.length} 件\n`);
    for (const f of undone) console.error('  ' + f.replace('未実装: ', ''));
  }
  if (broken.length) {
    console.error(`\n落ちた検査 ${broken.length} 件\n`);
    for (const f of broken) console.error('  ' + f);
  }
  console.error('');
  process.exit(1);
}
console.log('\nすべて通った');
