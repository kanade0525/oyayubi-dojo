#!/usr/bin/env node
/*
 * assets/js/nicola.js（同時打けんの状態機械）の単体テスト。
 *
 * 実装より先に書いた。NICOLA規格 JIS提案 §5.4 の状態遷移表から直接起こしてあり、
 * これが nicola.js の契約そのものになる。表の 25 マスを一つ残らず踏む。
 *
 * なぜこの方針か。
 *
 * (1) 時刻を引数で受け取る設計（keyDown(code, timeStamp)）にしてもらったので、
 *     同時打けん判定という「時間が主役」の処理を、実時間ゼロで決定的に検査できる。
 *     sleep で待つテストは遅いうえに CI で揺れる。ここでは一切待たない。
 *
 * (2) 配列（かな）には依存させない。このファイルが検査するのは「どのキーの組が
 *     いつ確定するか」であって「何のかなが出るか」ではない。layout に空テーブルを
 *     渡し、kana は値を見ない（CONTRACT.md の「引けなければ null」に乗る）。
 *     かなの正しさ＝配列データの検算は tools/check.mjs の仕事に分けてある。
 *     こう割ると、nicola.json がまだ無くても状態機械の契約は全部固定できる。
 *
 * (3) 出力は毎回 result の形そのものを検査する（assertResultShape）。
 *     CONTRACT.md の result は全担当が依存する。形が崩れたら状態遷移が正しくても落とす。
 *
 * 規格原文（http://nicola.sunicom.co.jp/spec/jisdraft.htm）を読んで分かったこと。
 * 依頼時に渡された遷移表と食い違う箇所があり、ここでは原文（2018.4 修正版の表）に従う。
 *
 *   ★1 S3（Oオン状態）で文字キーが押されたとき、原文の表は
 *       「<del>OM出力</del> Mセット, S5)へ」。OM出力に打ち消し線が引いてある。
 *       つまり 2018 年の修正で「ここで出力する」は取り消され、正しくは
 *       「出力せずに M をセットして S5 へ」。§5.4(3.2) の本文は 1999 年当時の
 *       ままなので表と食い違うが、表側が新しい。
 *       この方が筋も通る。S5 は「O と M が両方押されていて、まだ確定していない」
 *       状態であり、ここで出してしまうと後段の処理B・処理Dが意味を失う。
 *       S2 で親指が押されたとき（Oセット, S4)へ＝出力なし）とも対称になる。
 *
 *   ★2 処理C の t2 は「親指オンから【図形キーオフ】までの時間」＝重なりの厚み。
 *       親指キーの押下継続時間ではない。表題も「重なり厚み判定」。
 *       したがって S4 で未成立になり得るのは【文字キー】が離れたときで、
 *       親指キーが離れたときは無条件に MO 出力 → S1。
 *
 *   ★3 処理D は原文に本文が無い（表に「処理D (重なり厚み判定)」とあるだけ）。
 *       ここでは処理C の左右対称形として置く。すなわち S5 で【親指キー】が
 *       離れたときに重なり厚みを見て、未成立なら親指キー単独を出して S2 へ。
 *
 * タイムアウトだけは時刻を渡す口が無いので、tick(timeStamp) を要求する。
 * CONTRACT.md への追記案として報告済み。setTimeout で実装すると、この検査は
 * 実時間を待つほかなくなり、必ず遅く不安定になる。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const NICOLA_PATH = join(ROOT, 'assets/js/nicola.js');

/**
 * CONTRACT.md と突き合わせるための一覧。tools/check.mjs がこの 2 行を読み、
 * CONTRACT.md の記述とズレていたら落とす。片方だけ直したのを見逃さないため。
 */
export const RESULT_KEYS = ['kana', 'charCode', 'thumb', 'shiftKind', 'offsetMs', 'continued', 'state'];
export const OPTION_KEYS = ['layout', 'thumbKeys', 'tau', 'charTimeout', 'thumbTimeout', 'lenientRelease', 'continuousShift', 'onOutput'];

// ---------------------------------------------------------------- 読み込み

let createNicola = null;
let importError = null;
try {
  ({ createNicola } = await import(pathToFileURL(NICOLA_PATH).href));
} catch (e) {
  importError = e;
}

/** 実装がまだ無いことを、全テストで同じ言葉で言う */
function ready() {
  if (importError) {
    assert.fail(
      'assets/js/nicola.js を読み込めない。まだ実装されていない。\n' +
        `    置き場所 : ${NICOLA_PATH}\n` +
        '    要るもの : export function createNicola(options)\n' +
        `    実際の理由: ${importError.message}`
    );
  }
  if (typeof createNicola !== 'function') {
    assert.fail(
      'assets/js/nicola.js はあるが createNicola が export されていない。まだ実装されていない。\n' +
        '    要るもの : export function createNicola(options)'
    );
  }
}

/** タイムアウトを実時間なしで検査するための注入口 */
function readyTick(g) {
  if (typeof g.tick !== 'function') {
    assert.fail(
      'tick(timeStamp) が無い。タイムアウトを実時間ゼロで検査できない。\n' +
        '    CONTRACT.md への追記案:\n' +
        '      tick(timeStamp)  // 経過時刻だけを流し込む。タイムアウトの発火はここでだけ起きる\n' +
        '    画面側は requestAnimationFrame か setInterval から tick を呼ぶ。\n' +
        '    内部で Date.now() を読むとテストから時間を進められず、検査が実時間待ちになる。'
    );
  }
}

// ---------------------------------------------------------------- 道具

// 左右の領域が分かれていることだけが要る。かなは見ない
const M_LEFT = 'KeyF'; //  左領域の文字キー
const M_LEFT2 = 'KeyD'; // 左領域の別の文字キー
const M_RIGHT = 'KeyJ'; // 右領域の文字キー
const O_LEFT = 'Space'; //  親指左
const O_RIGHT = 'Lang2'; // 親指右

const THUMB_KEYS = { left: [O_LEFT], right: [O_RIGHT] };
const TAU = 80;
const CHAR_TIMEOUT = 150;
const THUMB_TIMEOUT = 250;

// 配列は見ない、という宣言そのもの。ここに何を入れても状態遷移は変わってはいけない
const EMPTY_LAYOUT = Object.freeze({});

const STATES = ['S1', 'S2', 'S3', 'S4', 'S5'];

/** 出力ひとつの形を、出るたびに検査する */
function assertResultShape(r) {
  assert.ok(r && typeof r === 'object', 'onOutput に渡るのはオブジェクトのはず');
  for (const k of RESULT_KEYS) {
    assert.ok(k in r, `result に ${k} が無い（CONTRACT.md の result の形は全担当が依存する）`);
  }
  assert.ok([null, 'left', 'right'].includes(r.thumb), `thumb が ${JSON.stringify(r.thumb)}`);
  assert.ok([null, 'same', 'cross'].includes(r.shiftKind), `shiftKind が ${JSON.stringify(r.shiftKind)}`);
  assert.ok(STATES.includes(r.state), `state が ${JSON.stringify(r.state)}`);
  assert.ok(
    r.charCode !== null || r.thumb !== null,
    '文字キーも親指キーも入っていない出力は出してはいけない'
  );
  if (r.charCode === null || r.thumb === null) {
    // 単独打けん（文字だけ／親指だけ）。組み合わせが無いのだからズレも面も無い
    assert.equal(r.shiftKind, null, '単独打けんの shiftKind は null');
    assert.equal(r.offsetMs, null, '単独打けんの offsetMs は null');
  } else if (r.continued) {
    // 連続シフト（規格の外・continuousShift のとき）。親指を落とした瞬間が
    // 無いのでズレが存在しない。0 を出すと «完全同時» という嘘になる
    assert.equal(r.offsetMs, null, '連続シフトの offsetMs は null');
  } else {
    assert.equal(typeof r.offsetMs, 'number', '同時打けんの offsetMs は数値');
  }
  return r;
}

/** 出力を一行で表す。「どのキーの組が、どの状態で確定したか」だけを見る */
function sig(r) {
  return `${r.charCode ?? '−'}/${r.thumb ?? '−'}@${r.state}`;
}
const sigs = (list) => list.map(sig);

function harness(over = {}) {
  ready();
  const outputs = [];
  const engine = createNicola({
    layout: over.layout ?? EMPTY_LAYOUT,
    thumbKeys: over.thumbKeys ?? THUMB_KEYS,
    tau: over.tau ?? TAU,
    charTimeout: over.charTimeout ?? CHAR_TIMEOUT,
    thumbTimeout: over.thumbTimeout ?? THUMB_TIMEOUT,
    // 規格の外。既定は両方 false ＝ §5.4 そのまま
    lenientRelease: over.lenientRelease ?? false,
    continuousShift: over.continuousShift ?? false,
    onOutput: (r) => outputs.push(assertResultShape(r)),
  });
  return { engine, outputs };
}

// ================================================================ 表の 25 マス

describe('§5.4 状態遷移表 ─ 初期化（reset）の行', () => {
  test('S1 初期状態で初期化しても、出すものが無いので何も出ない', () => {
    const { engine, outputs } = harness();
    engine.reset();
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S1');
  });

  test('S2 文字キー押下状態で初期化すると、抱えていた文字キーを単独打けんとして出して S1 に戻る', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.reset();
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/−@S2`]);
    assert.equal(engine.state, 'S1');
  });

  test('S3 親指キー押下状態で初期化すると、抱えていた親指キーを単独で出して S1 に戻る', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.reset();
    assert.deepEqual(sigs(outputs), [`−/left@S3`]);
    assert.equal(engine.state, 'S1');
  });

  test('S4 文字→親指の状態で初期化すると、同時打けんとして確定させて S1 に戻る', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 30);
    engine.reset();
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S4`]);
    assert.equal(outputs[0].offsetMs, 30, '親指が 30ms 遅れたので正の 30');
    assert.equal(engine.state, 'S1');
  });

  test('S5 親指→文字の状態で初期化すると、同時打けんとして確定させて S1 に戻る', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 30);
    engine.reset();
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S5`]);
    assert.equal(outputs[0].offsetMs, -30, '親指が 30ms 先行したので負の 30');
    assert.equal(engine.state, 'S1');
  });

  test('初期化で親指ランプも消える（押しっぱなしのまま画面に残さない）', () => {
    const { engine } = harness();
    engine.keyDown(O_LEFT, 0);
    assert.deepEqual(engine.thumbHeld, { left: true, right: false });
    engine.reset();
    assert.deepEqual(engine.thumbHeld, { left: false, right: false });
  });
});

describe('§5.4 状態遷移表 ─ 文字キー（M）オンの行', () => {
  test('S1 で文字キーを押すと、まだ何も出さずに S2 へ（親指が後から来るかもしれない）', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S2');
  });

  test('S2 で別の文字キーを押すと、前の文字キーが単独打けんで確定し、新しい方を抱えて S2 のまま', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(M_RIGHT, 50);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/−@S2`]);
    assert.equal(engine.state, 'S2');
    // 新しい方を本当に抱えているか、離して確かめる
    engine.keyUp(M_RIGHT, 80);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/−@S2`, `${M_RIGHT}/−@S2`]);
  });

  test('★S3 で文字キーを押しても、ここでは出力しない。M を抱えて S5 へ（2018.4 修正で OM出力 は取り消された）', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 50);
    assert.deepEqual(sigs(outputs), [], 'ここで出すと、後段の処理B・処理D が判定する余地を失う');
    assert.equal(engine.state, 'S5');
  });

  test('S4 で文字キーを押すと処理A（3キー判定）に入る ─ 別マスとして下でまとめて検査', () => {
    const { engine } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 20);
    engine.keyDown(M_RIGHT, 120);
    assert.ok(STATES.includes(engine.state));
  });

  test('S5 で別の文字キーを押すと、抱えていた親指＋文字が同時打けんで確定し、新しい文字を抱えて S2 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 40);
    engine.keyDown(M_LEFT2, 80);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S5`]);
    assert.equal(outputs[0].offsetMs, -40);
    assert.equal(engine.state, 'S2');
    engine.keyUp(M_LEFT2, 120);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S5`, `${M_LEFT2}/−@S2`]);
  });
});

describe('§5.4 状態遷移表 ─ 親指キー（O）オンの行', () => {
  test('S1 で親指キーを押すと、まだ何も出さずに S3 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S3');
  });

  test('S2 で親指キーを押しても、ここでは出力しない。両方を抱えて S4 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_LEFT, 50);
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S4');
  });

  test('S3 で別の親指キーを押すと、前の親指キーが単独で確定し、新しい方を抱えて S3 のまま', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(O_RIGHT, 50);
    assert.deepEqual(sigs(outputs), [`−/left@S3`]);
    assert.equal(engine.state, 'S3');
    // ランプは判定の状態ではなく、指の状態を映す。左親指は確定して抱えるのをやめたが、
    // 指はまだ沈んだままなので点いていてよい。ここで消すと画面が手の実態について嘘をつく。
    // 「親指を押しっぱなしにしている」ことに気づかせるのがこのランプの役目なので、
    // 内部で抱えるのをやめた瞬間に消すと、いちばん見せたい状態が見えなくなる
    assert.deepEqual(engine.thumbHeld, { left: true, right: true },
      '確定しても、指が離れていなければ点いたまま');
    engine.keyUp(O_LEFT, 60);
    assert.deepEqual(engine.thumbHeld, { left: false, right: true }, '離せば消える');
    assert.deepEqual(sigs(outputs), [`−/left@S3`], '抱えていない親指を離しても何も出ない');
  });

  test('S4 で別の親指キーを押すと、抱えていた組が同時打けんで確定し、新しい親指を抱えて S3 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_LEFT, 40);
    engine.keyDown(O_RIGHT, 80);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/left@S4`]);
    assert.equal(outputs[0].offsetMs, 40);
    assert.equal(engine.state, 'S3');
  });

  test('S5 で親指キーを押すと処理B（3キー判定）に入る ─ 別マスとして下でまとめて検査', () => {
    const { engine } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(M_LEFT, 20);
    engine.keyDown(O_RIGHT, 120);
    assert.ok(STATES.includes(engine.state));
  });
});

describe('§5.4 状態遷移表 ─ キーオフの行（注2：状態遷移の原因になった最後のキーが「当該キー」）', () => {
  test('S1 でキーを離しても何も起きない（確定済みのキーの離しが遅れて届くのは普通のこと）', () => {
    const { engine, outputs } = harness();
    engine.keyUp(M_LEFT, 10);
    engine.keyUp(O_LEFT, 20);
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S1');
  });

  test('S2 で当該キーを離すと、単独打けんで確定して S1 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyUp(M_LEFT, 60);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/−@S2`]);
    assert.equal(engine.state, 'S1');
  });

  test('S2 で当該キー以外を離しても無視して S2 のまま', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyUp(M_RIGHT, 30);
    engine.keyUp(O_LEFT, 40);
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S2');
  });

  test('S3 で当該キーを離すと、親指キー単独で確定して S1 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyUp(O_LEFT, 60);
    assert.deepEqual(sigs(outputs), [`−/left@S3`]);
    assert.equal(engine.state, 'S1');
    assert.deepEqual(engine.thumbHeld, { left: false, right: false });
  });

  test('S3 で当該キー以外を離しても無視して S3 のまま', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyUp(O_RIGHT, 30);
    engine.keyUp(M_LEFT, 40);
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S3');
  });

  test('S4 でキーオフは処理C（重なり厚み判定）に入る ─ 別マスとして下でまとめて検査', () => {
    const { engine } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_LEFT, 20);
    engine.keyUp(O_LEFT, 100);
    assert.ok(STATES.includes(engine.state));
  });

  test('S5 でキーオフは処理D（重なり厚み判定）に入る ─ 別マスとして下でまとめて検査', () => {
    const { engine } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(M_LEFT, 20);
    engine.keyUp(M_LEFT, 100);
    assert.ok(STATES.includes(engine.state));
  });
});

describe('§5.4 状態遷移表 ─ タイムアウトの行（注3）', () => {
  test('S1 では、どれだけ時間が経っても何も出ない', () => {
    const { engine, outputs } = harness();
    readyTick(engine);
    engine.tick(100000);
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S1');
  });

  test('S2 で charTimeout を過ぎると、抱えていた文字キーが単独打けんで確定して S1 へ', () => {
    const { engine, outputs } = harness();
    readyTick(engine);
    engine.keyDown(M_LEFT, 0);
    engine.tick(CHAR_TIMEOUT - 50);
    assert.deepEqual(sigs(outputs), [], 'まだ期限内。ここで出ると親指を待てない');
    assert.equal(engine.state, 'S2');
    engine.tick(CHAR_TIMEOUT + 50);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/−@S2`]);
    assert.equal(engine.state, 'S1');
  });

  test('S3 で thumbTimeout を過ぎると、抱えていた親指キーが単独で確定して S1 へ', () => {
    const { engine, outputs } = harness();
    readyTick(engine);
    engine.keyDown(O_RIGHT, 0);
    engine.tick(THUMB_TIMEOUT - 50);
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S3');
    engine.tick(THUMB_TIMEOUT + 50);
    assert.deepEqual(sigs(outputs), [`−/right@S3`]);
    assert.equal(engine.state, 'S1');
  });

  test('S4 でタイムアウトすると、抱えていた組が同時打けんとして確定して S1 へ', () => {
    const { engine, outputs } = harness();
    readyTick(engine);
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 40);
    engine.tick(40 + THUMB_TIMEOUT + 50);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S4`]);
    assert.equal(outputs[0].offsetMs, 40);
    assert.equal(engine.state, 'S1');
  });

  test('S5 でタイムアウトすると、抱えていた組が同時打けんとして確定して S1 へ', () => {
    const { engine, outputs } = harness();
    readyTick(engine);
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 40);
    engine.tick(40 + CHAR_TIMEOUT + THUMB_TIMEOUT);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S5`]);
    assert.equal(outputs[0].offsetMs, -40);
    assert.equal(engine.state, 'S1');
  });

  test('タイムアウトは一度きり。同じ状態から二重に出さない', () => {
    const { engine, outputs } = harness();
    readyTick(engine);
    engine.keyDown(M_LEFT, 0);
    engine.tick(1000);
    engine.tick(2000);
    engine.tick(3000);
    assert.equal(outputs.length, 1, `${outputs.length} 回出ている`);
  });
});

// ================================================================ 処理A〜D

describe('処理A（S4 で文字キー ─ M1→O→M2 の 3 キー判定）', () => {
  // t1 = O が押されるまでの間, t2 = O から M2 までの間。
  // 先に押した M1 の「独り立ちの長さ」と、O と M2 の「近さ」を比べている。
  test('t1 ≧ t2 なら、O は後から来た M2 のものと見て、M1 は単独打けん。M2 を抱えて S5 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 100); // t1 = 100
    engine.keyDown(M_RIGHT, 150); // t2 = 50
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/−@S4`]);
    assert.equal(engine.state, 'S5', 'O と M2 が押されたまま残るので S5');
    // S5 に本当に居るか、離して確かめる（処理D 経由で MO が出る）
    engine.keyUp(M_RIGHT, 400);
    assert.equal(outputs.length, 2);
    assert.equal(sig(outputs[1]), `${M_RIGHT}/right@S5`);
  });

  test('t1 < t2 なら、O は先の M1 のものと見て M1＋O を同時打けん。M2 を抱えて S2 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 20); //  t1 = 20
    engine.keyDown(M_RIGHT, 120); // t2 = 100
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S4`]);
    assert.equal(outputs[0].offsetMs, 20);
    assert.equal(engine.state, 'S2', 'M2 だけが残るので S2');
    assert.deepEqual(engine.thumbHeld, { left: false, right: true }, '親指はまだ物理的に押されている');
  });

  test('t1 == t2 の境目は t1 ≧ t2 の側（M1 が単独打けん）', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 60);
    engine.keyDown(M_RIGHT, 120);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/−@S4`], '規格は t1≧t2。等しいときに同時打けんにしてはいけない');
    assert.equal(engine.state, 'S5');
  });
});

describe('処理B（S5 で親指キー ─ O1→M→O2 の 3 キー判定）', () => {
  test('t1 ≧ t2 なら、M は後から来た O2 のものと見て、O1 は親指単独。O2 を抱えて S4 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(M_RIGHT, 100); // t1 = 100
    engine.keyDown(O_RIGHT, 150); // t2 = 50
    assert.deepEqual(sigs(outputs), [`−/left@S5`]);
    assert.equal(engine.state, 'S4', 'M と O2 が押されたまま残るので S4');
    engine.keyUp(O_RIGHT, 400);
    assert.equal(outputs.length, 2);
    assert.equal(sig(outputs[1]), `${M_RIGHT}/right@S4`);
  });

  test('t1 < t2 なら、M は先の O1 のものと見て M＋O1 を同時打けん。O2 を抱えて S3 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(M_RIGHT, 20); //  t1 = 20
    engine.keyDown(O_RIGHT, 120); // t2 = 100
    assert.deepEqual(sigs(outputs), [`${M_RIGHT}/left@S5`]);
    assert.equal(outputs[0].offsetMs, -20, '親指 O1 が 20ms 先行');
    assert.equal(engine.state, 'S3', 'O2 だけが残るので S3');
  });

  test('t1 == t2 の境目は t1 ≧ t2 の側（O1 が親指単独）', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(M_RIGHT, 60);
    engine.keyDown(O_RIGHT, 120);
    assert.deepEqual(sigs(outputs), [`−/left@S5`]);
    assert.equal(engine.state, 'S4');
  });
});

describe('処理C（S4 でキーオフ ─ 重なり厚み判定）', () => {
  // ★原文どおり t2 は「親指オン→【文字キー】オフ」＝重なりの厚み。
  // ずるずる遅れて押した親指を、薄い重なりのまま同時打けんと認めると、
  // シフト不発を「成功」と誤って数えてしまい、練習として意味を失う。
  test('文字キーを離したとき t1 ≧ t2 かつ t2 < τ なら同時打けん未成立。文字キー単独を出して S3 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 60); // t1 = 60
    engine.keyUp(M_LEFT, 90); //   t2 = 30（重なりが薄い）
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/−@S4`]);
    assert.equal(engine.state, 'S3', '親指はまだ押されているので S3 に落ちる');
    assert.deepEqual(engine.thumbHeld, { left: false, right: true });
    // S3 に本当に居るか、親指を離して確かめる
    engine.keyUp(O_RIGHT, 120);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/−@S4`, `−/right@S3`]);
  });

  test('文字キーを離しても t1 < t2 なら（重なりが厚い）同時打けん成立。MO を出して S1 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 20); // t1 = 20
    engine.keyUp(M_LEFT, 120); //  t2 = 100
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S4`]);
    assert.equal(outputs[0].offsetMs, 20);
    assert.equal(engine.state, 'S1');
  });

  test('t1 ≧ t2 でも t2 が τ 以上なら未成立にしない（τ は薄さの下限）', () => {
    // τ を 20 に狭めた盤で、t1=60・t2=30 という上と同じ打ち方をさせる。
    // 同じ時刻でも τ 次第で判定が変わることを固定する
    const { engine, outputs } = harness({ tau: 20 });
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 60); // t1 = 60
    engine.keyUp(M_LEFT, 90); //   t2 = 30 ≧ τ(20)
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S4`]);
    assert.equal(engine.state, 'S1');
  });

  test('親指キー（当該キー）を離したときは厚みを見ず、いつでも同時打けんとして S1 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 60);
    engine.keyUp(O_RIGHT, 75); // 親指の押下は 15ms しかないが、未成立にはしない
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S4`]);
    assert.equal(outputs[0].offsetMs, 60);
    assert.equal(engine.state, 'S1');
  });

  test('S4 で当該キーにも抱えている文字キーにも当たらないキーを離したら無視して S4 のまま', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 40);
    engine.keyUp(M_RIGHT, 60);
    engine.keyUp(O_LEFT, 70);
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S4');
  });
});

describe('処理D（S5 でキーオフ ─ 重なり厚み判定。原文に本文が無く、処理C の対称形として置く）', () => {
  test('親指キーを離したとき t1 ≧ t2 かつ t2 < τ なら未成立。親指キー単独を出して S2 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(M_RIGHT, 60); // t1 = 60
    engine.keyUp(O_LEFT, 90); //   t2 = 30（重なりが薄い）
    assert.deepEqual(sigs(outputs), [`−/left@S5`]);
    assert.equal(engine.state, 'S2', '文字キーはまだ押されているので S2 に落ちる');
    assert.deepEqual(engine.thumbHeld, { left: false, right: false });
    engine.keyUp(M_RIGHT, 120);
    assert.deepEqual(sigs(outputs), [`−/left@S5`, `${M_RIGHT}/−@S2`]);
  });

  test('親指キーを離しても t1 < t2 なら同時打けん成立。MO を出して S1 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(M_RIGHT, 20); // t1 = 20
    engine.keyUp(O_LEFT, 120); //  t2 = 100
    assert.deepEqual(sigs(outputs), [`${M_RIGHT}/left@S5`]);
    assert.equal(outputs[0].offsetMs, -20);
    assert.equal(engine.state, 'S1');
  });

  test('t1 ≧ t2 でも t2 が τ 以上なら未成立にしない', () => {
    const { engine, outputs } = harness({ tau: 20 });
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(M_RIGHT, 60);
    engine.keyUp(O_LEFT, 90); // t2 = 30 ≧ τ(20)
    assert.deepEqual(sigs(outputs), [`${M_RIGHT}/left@S5`]);
    assert.equal(engine.state, 'S1');
  });

  test('文字キー（当該キー）を離したときは厚みを見ず、いつでも同時打けんとして S1 へ', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(M_RIGHT, 60);
    engine.keyUp(M_RIGHT, 75);
    assert.deepEqual(sigs(outputs), [`${M_RIGHT}/left@S5`]);
    assert.equal(outputs[0].offsetMs, -60);
    assert.equal(engine.state, 'S1');
  });

  test('S5 で関係の無いキーを離したら無視して S5 のまま', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_LEFT, 0);
    engine.keyDown(M_RIGHT, 40);
    engine.keyUp(M_LEFT, 60);
    engine.keyUp(O_RIGHT, 70);
    assert.deepEqual(sigs(outputs), []);
    assert.equal(engine.state, 'S5');
  });
});

// ================================================================ 表の外の約束

describe('親指キーの割り当てと押下ランプ', () => {
  test('thumbKeys に挙げた code だけが親指キー。挙げていない code は文字キーとして扱う', () => {
    const { engine, outputs } = harness({ thumbKeys: { left: ['NonConvert'], right: ['Convert'] } });
    engine.keyDown('NonConvert', 0);
    assert.equal(engine.state, 'S3', '割り当てたキーは親指キー');
    engine.reset();
    outputs.length = 0;
    engine.keyDown(O_LEFT, 0); // 既定では親指だが、この盤では割り当てていない
    assert.equal(engine.state, 'S2', '割り当てていないキーは文字キー扱い');
  });

  test('左右どちらの親指も複数の code を割り当てられる', () => {
    const { engine } = harness({ thumbKeys: { left: ['Space', 'NonConvert'], right: ['Lang2', 'Convert'] } });
    engine.keyDown('NonConvert', 0);
    assert.deepEqual(engine.thumbHeld, { left: true, right: false });
    engine.keyUp('NonConvert', 50);
    engine.keyDown('Convert', 60);
    assert.deepEqual(engine.thumbHeld, { left: false, right: true });
  });

  test('thumbHeld は物理的な押下だけを映す（確定したかどうかとは別）', () => {
    const { engine } = harness();
    assert.deepEqual(engine.thumbHeld, { left: false, right: false });
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_LEFT, 20);
    engine.keyUp(M_LEFT, 120); // ここで同時打けんが確定するが、親指はまだ押されている
    assert.deepEqual(engine.thumbHeld, { left: true, right: false }, '確定しても指が離れていなければ点いたまま');
    engine.keyUp(O_LEFT, 200);
    assert.deepEqual(engine.thumbHeld, { left: false, right: false });
  });

  test('thumbHeld が返した値を外から書き換えても、内部状態は壊れない', () => {
    // 画面側は毎フレームこれを読んでランプを更新する。うっかり書き換えられたときに
    // 状態機械まで巻き込まれると、原因の分からない不具合になる。
    // 凍らせて弾くのでも、毎回作り直すのでもよい。届かなければどちらでもよい
    const { engine } = harness();
    engine.keyDown(O_LEFT, 0);
    const held = engine.thumbHeld;
    try {
      held.left = false;
    } catch {
      // 凍らせてある実装。それでよい
    }
    assert.deepEqual(engine.thumbHeld, { left: true, right: false }, '返した値への書き込みが内部に届いてはいけない');
  });
});

describe('offsetMs の符号（メーターが「先行／遅れ」を出すための約束）', () => {
  test('親指が遅れたら正、先行したら負。絶対値は押下時刻の差そのもの', () => {
    const late = harness();
    late.engine.keyDown(M_LEFT, 0);
    late.engine.keyDown(O_RIGHT, 17);
    late.engine.keyUp(O_RIGHT, 200);
    assert.equal(late.outputs[0].offsetMs, 17, '親指が 17ms 遅れ');

    const early = harness();
    early.engine.keyDown(O_RIGHT, 0);
    early.engine.keyDown(M_LEFT, 17);
    early.engine.keyUp(M_LEFT, 200);
    assert.equal(early.outputs[0].offsetMs, -17, '親指が 17ms 先行');
  });

  test('同時ちょうどなら 0（先行でも遅れでもない）', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 40);
    engine.keyDown(O_LEFT, 40);
    engine.keyUp(O_LEFT, 200);
    assert.equal(outputs[0].offsetMs, 0);
    assert.ok(!Object.is(outputs[0].offsetMs, -0), '-0 だと表示が「-0ms」になる');
  });
});

describe('配列に依存しない（このファイルが状態機械だけを見ていることの担保）', () => {
  test('layout が空でも状態遷移と offsetMs は変わらない。kana が引けないだけ', () => {
    const { engine, outputs } = harness({ layout: EMPTY_LAYOUT });
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 20);
    engine.keyUp(M_LEFT, 120);
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].charCode, M_LEFT, 'かなが引けなくても、押されたキーは分かる');
    assert.equal(outputs[0].kana, null, 'CONTRACT.md「引けなければ null」');
    assert.equal(engine.state, 'S1');
  });

  test('未知の code を渡しても投げない（配列に無いキーもキーボードには載っている）', () => {
    const { engine, outputs } = harness();
    engine.keyDown('F13', 0);
    engine.keyUp('F13', 50);
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].kana, null);
  });
});

describe('連続打鍵の通し（一マスずつでは出ない、つなぎ目の崩れを見る）', () => {
  test('同時打けん → 単独打けん → 同時打けん を続けて打つと、3 つが順番どおりに出る', () => {
    const { engine, outputs } = harness();
    // 1 打目: 文字→親指、文字を先に離す（重なりが厚いので成立）
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 10);
    engine.keyUp(M_LEFT, 110);
    engine.keyUp(O_RIGHT, 120);
    // 2 打目: 単独打けん
    engine.keyDown(M_RIGHT, 200);
    engine.keyUp(M_RIGHT, 260);
    // 3 打目: 親指→文字、親指を先に離す（重なりが厚いので成立）
    engine.keyDown(O_LEFT, 300);
    engine.keyDown(M_LEFT2, 310);
    engine.keyUp(O_LEFT, 410);
    engine.keyUp(M_LEFT2, 420);
    assert.deepEqual(sigs(outputs), [
      `${M_LEFT}/right@S4`,
      `${M_RIGHT}/−@S2`,
      `${M_LEFT2}/left@S5`,
    ]);
    assert.equal(engine.state, 'S1');
    assert.deepEqual(engine.thumbHeld, { left: false, right: false });
  });

  test('親指を押しっぱなしで文字キーを次々打つ（親指ホールド打ち）と、一打ごとに同時打けんが出る', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 10); //  S5
    engine.keyDown(M_LEFT2, 60); // S5 で文字キー → MO 出力、新 M セット、S2 へ
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S5`]);
    engine.keyDown(M_RIGHT, 110); // S2 で文字キー → 前の M が単独打けんで出てしまう
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S5`, `${M_LEFT2}/−@S2`]);
    // 規格どおりの帰結。押しっぱなしでも 2 打目以降は単独になる＝シフト不発として
    // 学習者に見せるべき事象であり、ここを「親指が押されているから」と補正してはいけない
  });

  test('同じキーの keyDown が繰り返し来ても（OS のオートリピート）状態が壊れない', () => {
    const { engine, outputs } = harness();
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(M_LEFT, 30);
    engine.keyDown(M_LEFT, 60);
    engine.keyUp(M_LEFT, 90);
    assert.equal(engine.state, 'S1');
    for (const r of outputs) assert.equal(r.charCode, M_LEFT);
  });
});

// ================================================================ 規格の外（既定 off）
//
// createNicola の既定は両方 false で、上の遷移表検査はその状態を見ている。
// ここは «アプリが既定で渡す設定» の側を固定する。規格を緩めた結果として
// 何が変わり、何は変わらないままなのかを、一箇所で読めるようにしておく。

describe('lenientRelease ─ 親指を先に離しても同時打けんと認める', () => {
  test('規格どおり（既定）だと、親指の押下が «先行ぶんの2倍» 以下で不発になる', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 15); // 親指が 15ms 先行 → S5
    engine.keyUp(O_RIGHT, 30);  // t1=15, t2=15 → t1>=t2 かつ t2<tau で不発
    assert.deepEqual(sigs(outputs), [`−/right@S5`]);
    engine.keyUp(M_LEFT, 80);
    assert.deepEqual(sigs(outputs), [`−/right@S5`, `${M_LEFT}/−@S2`]);
  });

  test('lenientRelease なら、同じ打ち方が同時打けんとして通る', () => {
    const { engine, outputs } = harness({ lenientRelease: true });
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 15);
    engine.keyUp(O_RIGHT, 30);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S5`]);
    assert.equal(outputs[0].offsetMs, -15, 'ズレは測れているので null にしない');
    assert.equal(outputs[0].continued, false);
  });

  test('S4（文字キーが先）の 処理C は緩めない。前の字と次の親指の区別が付かなくなるため', () => {
    const { engine, outputs } = harness({ lenientRelease: true });
    engine.keyDown(M_LEFT, 0);
    engine.keyDown(O_RIGHT, 40);  // 文字キーを抱えたまま次の親指が来た → S4
    engine.keyUp(M_LEFT, 70);     // t1=40, t2=30 → 単独打けんのまま
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/−@S4`]);
    assert.equal(engine.state, 'S3', '親指はまだ生きている');
  });
});

describe('continuousShift ─ 連続シフト（親指を押したまま続けて打つ）', () => {
  test('既定 off では、2 打目から単独打けんになる（規格どおり）', () => {
    const { engine, outputs } = harness();
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 10);
    engine.keyUp(M_LEFT, 60);
    engine.keyDown(M_LEFT2, 80);
    engine.keyUp(M_LEFT2, 130);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S5`, `${M_LEFT2}/−@S2`]);
  });

  test('on なら、親指を離すまで何打でも同時打けんが続く', () => {
    const { engine, outputs } = harness({ continuousShift: true });
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 10);
    engine.keyUp(M_LEFT, 60);
    engine.keyDown(M_LEFT2, 80);
    engine.keyUp(M_LEFT2, 130);
    engine.keyDown(M_RIGHT, 150);
    engine.keyUp(M_RIGHT, 200);
    assert.deepEqual(sigs(outputs), [
      `${M_LEFT}/right@S5`,
      `${M_LEFT2}/right@S5`,
      `${M_RIGHT}/right@S5`,
    ]);
  });

  test('2 打目以降の offsetMs は null。親指を落とした瞬間が無いので測れない', () => {
    const { engine, outputs } = harness({ continuousShift: true });
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 10);
    engine.keyUp(M_LEFT, 60);
    engine.keyDown(M_LEFT2, 80);
    engine.keyUp(M_LEFT2, 130);
    assert.equal(outputs[0].offsetMs, -10, '1 打目は実測どおり');
    assert.equal(outputs[0].continued, false);
    assert.equal(outputs[1].offsetMs, null, '2 打目は測れない');
    assert.equal(outputs[1].continued, true);
  });

  test('親指を置いたまま考え込んでも、時間切れで連続シフトが切れない', () => {
    const { engine, outputs } = harness({ continuousShift: true });
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 10);
    engine.keyUp(M_LEFT, 60);
    engine.tick(60 + THUMB_TIMEOUT * 4); // 指はまだ乗っている。捨ててはいけない
    engine.keyDown(M_LEFT2, 1200);
    engine.keyUp(M_LEFT2, 1250);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S5`, `${M_LEFT2}/right@S5`]);
  });

  test('親指を離せば、次の文字キーは単独打けんに戻る', () => {
    const { engine, outputs } = harness({ continuousShift: true });
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 10);
    engine.keyUp(M_LEFT, 60);
    engine.keyUp(O_RIGHT, 70);
    engine.keyDown(M_LEFT2, 90);
    engine.keyUp(M_LEFT2, 140);
    assert.deepEqual(sigs(outputs), [`${M_LEFT}/right@S5`, `${M_LEFT2}/−@S2`]);
    assert.deepEqual(engine.thumbHeld, { left: false, right: false });
  });

  test('reset で、押しっぱなしの親指ごと捨てられる', () => {
    const { engine } = harness({ continuousShift: true });
    engine.keyDown(O_RIGHT, 0);
    engine.keyDown(M_LEFT, 10);
    engine.keyUp(M_LEFT, 60);
    assert.equal(engine.state, 'S3');
    engine.reset();
    assert.equal(engine.state, 'S1');
    assert.deepEqual(engine.thumbHeld, { left: false, right: false });
  });
});
