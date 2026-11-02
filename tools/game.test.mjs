#!/usr/bin/env node
/*
 * assets/js/game/engine.js・courses.js・words.js（ゲーム「検品ライン」）の単体テスト。
 *
 * 2026-11-02 に «回転ずし» から題材だけ替えた（皿 → 作業品、円 → 点、値段 → ノルマ）。決まりは同じなので、
 * 回転ずしのときのテストを言葉だけ置き換えて使っている。テスト名の «皿» は作業品のこと。
 *
 * 実装と並行して、CONTRACT.md の「ゲーム「回転ずし」」の節だけを見て書いた。
 * 実装を読んでから書くと、実装の癖をそのまま正解として写してしまう。
 *
 * なぜこの方針か。
 *
 * (1) engine.js は nicola.js と同じく時刻を引数で受け取り、乱数も rng で受け取る約束。
 *     だからここでは一切待たない。制限時間 60 秒の終わりも、皿が流れ切るのも、
 *     tick(t) に大きな t を渡すだけで決定的に起こせる。
 *     その約束が守られていることも、Date.now / performance.now / Math.random を
 *     «呼ばれたら投げる» ものに差し替えて一局通すことで確かめる。
 *
 * (2) 入力は nicola.js の onOutput の result を手で組んで渡す（CONTRACT.md の result の形）。
 *     どのキーで出るかは本物の配列表（layout.js の loadLayout('nicola')）から引く。
 *     状態機械（nicola.js）は通さない。あちらの正しさは tools/nicola.test.mjs が見ている。
 *
 * (3) 金額や時間の数字は courses.js の export から取る（itemValue / PERFECT_BONUS /
 *     COMBO_STEP / COMBO_TIME_BONUS_MS）。値を決めるのはゲーム企画で、ここが見るのは
 *     «その値どおりに足し引きされるか» だけ。値を決め打ちすると、企画が調整するたびに落ちる。
 *
 * (4) 契約が決めていないことは検査しない（皿がいつ現れるか、いくつ並ぶか、
 *     親指キー単独の出力をどう扱うか、など）。皿が現れるまでは tick を少しずつ進めて待つ。
 *     決まっていないことを検査で決めてしまうと、契約が二つに割れる。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const ENGINE_PATH = join(ROOT, 'assets/js/game/engine.js');
const COURSES_PATH = join(ROOT, 'assets/js/game/courses.js');
const LAYOUT_PATH = join(ROOT, 'assets/js/layout.js');

// ---------------------------------------------------------------- 読み込み

const load = async (p) => {
  try {
    return { mod: await import(pathToFileURL(p).href), error: null };
  } catch (e) {
    return { mod: null, error: e };
  }
};
const engine = await load(ENGINE_PATH);
const courses = await load(COURSES_PATH);
const layoutMod = await load(LAYOUT_PATH);

/** 実装がまだ無いことを、全テストで同じ言葉で言う */
function ready() {
  for (const [what, got, needs] of [
    [ENGINE_PATH, engine, 'export function createGame({ course, words, rng })'],
    [COURSES_PATH, courses, 'export const COURSES / itemValue / PERFECT_BONUS / COMBO_STEP / COMBO_TIME_BONUS_MS'],
    [LAYOUT_PATH, layoutMod, 'export function loadLayout(name)'],
  ]) {
    if (got.error) {
      assert.fail(`${what} を読み込めない。まだ実装されていない。\n    要るもの : ${needs}\n    実際の理由: ${got.error.message}`);
    }
  }
  assert.equal(typeof engine.mod.createGame, 'function', 'engine.js が createGame を export していない');
  const c = courses.mod;
  assert.ok(Array.isArray(c.COURSES), 'courses.js が COURSES を export していない');
  assert.equal(typeof c.itemValue, 'function', 'courses.js が itemValue を export していない');
  for (const k of ['PERFECT_BONUS', 'COMBO_STEP', 'COMBO_TIME_BONUS_MS']) {
    assert.ok(Number.isFinite(c[k]) && c[k] > 0, `courses.js の ${k} が正の数でない（${c[k]}）`);
  }
}

// ---------------------------------------------------------------- 道具

const T0 = 10_000; // 開始時刻。0 にしないのは «0 を未設定扱いする» 実装を見逃さないため

/** 3,000 点のコース。無ければ先頭 */
function course() {
  const list = courses.mod.COURSES;
  return list.find((c) => c.id === 'p3000') ?? list[0];
}

/**
 * かなを出す result を、本物の配列表から組む。
 * 無シフト面にあれば単打、無ければ親指を一つ足す。同側／交差は hand と親指から決まる。
 */
function strokeOf(kana) {
  const layout = layoutMod.mod.loadLayout('nicola');
  for (const [code, k] of Object.entries(layout.keys)) {
    if (k.none === kana) return { code, thumb: null, hand: k.hand };
  }
  for (const [code, k] of Object.entries(layout.keys)) {
    for (const thumb of ['left', 'right']) if (k[thumb] === kana) return { code, thumb, hand: k.hand };
  }
  throw new Error(`テストの誤り: 「${kana}」は NICOLA 配列で打てない`);
}

/** onOutput の result の形（CONTRACT.md）。offsetMs は親指を使う字のときだけ意味を持つ */
function result(kana, { offsetMs = -5 } = {}) {
  const s = strokeOf(kana);
  if (s.thumb === null) {
    return { kana, charCode: s.code, thumb: null, shiftKind: null, offsetMs: null, continued: false, state: 'S2' };
  }
  return {
    kana,
    charCode: s.code,
    thumb: s.thumb,
    shiftKind: s.thumb === s.hand ? 'same' : 'cross',
    offsetMs,
    continued: false,
    state: 'S4',
  };
}

/** シフト不発。親指を使うはずの字が、親指なしの単打として確定したときの result */
function misfire(kana) {
  const s = strokeOf(kana);
  assert.ok(s.thumb, `テストの誤り: 「${kana}」は単打の字なので不発にならない`);
  const none = layoutMod.mod.loadLayout('nicola').keys[s.code].none;
  return { kana: none, charCode: s.code, thumb: null, shiftKind: null, offsetMs: null, continued: false, state: 'S2' };
}

/**
 * コースの長さ帯に収まる単語を作る。head を頭に置き、残りを単打の字で埋める。
 * 実在の語である必要は無い（engine は words を中身で選り分けない…とは契約に無いので、
 * 長さだけはコースの帯に合わせておく）
 */
function wordOf(head = '', len = course().minLen) {
  const FILL = 'かきしてとはいすけせ';
  let kana = head;
  for (let i = 0; [...kana].length < len; i++) kana += FILL[i % FILL.length];
  assert.ok([...kana].length >= course().minLen && [...kana].length <= course().maxLen, 'テストの誤り: 単語がコースの長さ帯の外');
  return { kana, label: kana };
}

/** 決まった列を順に返す rng。長さを超えたら頭に戻る */
const seq = (...xs) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

/** 一局を始める。返すのは game と «いまの時刻» を持つ小さな運転台 */
function play(words, { rng = seq(0.1, 0.5, 0.9, 0.3) } = {}) {
  ready();
  const g = engine.mod.createGame({ course: course(), words, rng });
  const run = { g, t: T0, events: [] };
  g.start(T0);
  return run;
}

function tickTo(run, t) {
  run.t = t;
  const ev = run.g.tick(t);
  assert.ok(Array.isArray(ev), `tick(t) の返り値が events の配列でない（${typeof ev}）`);
  run.events.push(...ev);
  return ev;
}

function input(run, res, dt = 40) {
  run.t += dt;
  // 入力の直前に時刻を揃える。input だけで時間を進める実装とも、tick を要る実装とも噛み合うように
  tickTo(run, run.t);
  const ev = run.g.input(res, run.t);
  assert.ok(Array.isArray(ev), `input(result, t) の返り値が events の配列でない（${typeof ev}）`);
  run.events.push(...ev);
  return ev;
}

/** 先頭の皿が出るまで時間を少しずつ進める。皿がいつ出るかは契約に無いので待つ */
function front(run) {
  const limit = run.t + course().laneMs;
  while (!run.g.state.items.length) {
    assert.ok(run.t < limit, `レーンを一周する時間（${course().laneMs}ms）待っても皿が一枚も出ない`);
    tickTo(run, run.t + 20);
  }
  return run.g.state.items[0];
}

/** 先頭の皿の残りを全部正しく打つ。返り値はその間の events */
function finishFront(run, opts = {}) {
  const p = front(run);
  const out = [];
  for (const ch of [...p.word.kana].slice(p.typed)) out.push(...input(run, result(ch, opts)));
  return out;
}

// 打ち間違いに使う字。単打の字（KeyN の無シフト面）にしておく。親指を使う字にすると
// «シフトを使った打鍵» に数えるかどうかという、契約に無い問いが混ざる
/**
 * CONTRACT.md の events の各型が持つ鍵。比べるときはこの鍵だけを見る。
 * 実装が鍵を足すのは拒まない（描画側の都合で足すことはある）。足したものを契約に
 * 書くかどうかは契約側の話で、ここで落とすとテストが契約より厳しくなる
 */
const EVENT_KEYS = {
  hit: ['type', 'itemId', 'kana', 'tier'],
  perfect: ['type', 'itemId', 'bonus'],
  miss: ['type', 'itemId', 'expected', 'got'],
  clear: ['type', 'itemId', 'value'],
  lost: ['type', 'itemId'],
  combo: ['type', 'combo', 'bonusMs'],
  over: ['type'],
};
const contracted = (e) => {
  const keys = EVENT_KEYS[e.type];
  assert.ok(keys, `契約に無い型の event: ${JSON.stringify(e)}`);
  for (const k of keys) assert.ok(k in e, `${e.type} event に ${k} が無い: ${JSON.stringify(e)}`);
  return Object.fromEntries(keys.map((k) => [k, e[k]]));
};
const only = (ev, type) => ev.filter((e) => e.type === type).map(contracted);
const itemById = (run, id) => run.g.state.items.find((p) => p.id === id);

// ---------------------------------------------------------------- 始まり

describe('始まり', () => {
  test('start 前は ready、start 後は playing で、残り時間はコースの制限時間', () => {
    ready();
    const g = engine.mod.createGame({ course: course(), words: [wordOf()], rng: seq(0.5) });
    assert.equal(g.state.phase, 'ready');
    g.start(T0);
    assert.equal(g.state.phase, 'playing');
    assert.equal(g.state.remainingMs, course().timeMs);
    assert.equal(g.state.score, 0);
    assert.equal(g.state.combo, 0);
    assert.equal(g.state.maxCombo, 0);
  });

  test('皿は words の語を載せ、値段は itemValue(course, word)、位置は 0..1', () => {
    const w = wordOf();
    const run = play([w]);
    const p = front(run);
    assert.equal(p.word.kana, w.kana);
    assert.equal(p.word.label, w.label);
    assert.equal(p.typed, 0);
    assert.equal(p.value, courses.mod.itemValue(course(), w));
    assert.ok(p.x >= 0 && p.x <= 1, `x が 0..1 の外: ${p.x}`);
    assert.ok(p.id != null, '皿に id が無い');
  });

  test('同じ rng の列なら同じ順に語が出る（乱数は rng だけから来る）', () => {
    ready();
    const words = ['かき', 'しか', 'てと', 'はい', 'すけ', 'せか'].map((k) => wordOf(k));
    const order = () => {
      const run = play(words, { rng: seq(0.73, 0.11, 0.42, 0.95, 0.27) });
      const seen = [];
      for (let i = 0; i < 4; i++) {
        seen.push(front(run).word.kana);
        finishFront(run);
      }
      return seen;
    };
    assert.deepEqual(order(), order());
  });
});

// ---------------------------------------------------------------- 打つ

describe('正しい字', () => {
  test('一字進むと hit（単打の tier は null）、typed が増え、コンボが付く', () => {
    const run = play([wordOf('かき')]);
    const p = front(run);
    const ev = input(run, result('か'));
    assert.deepEqual(only(ev, 'hit'), [{ type: 'hit', itemId: p.id, kana: 'か', tier: null }]);
    assert.equal(only(ev, 'miss').length, 0);
    assert.equal(itemById(run, p.id).typed, 1);
    assert.equal(run.g.state.combo, 1);
  });

  test('打ち切ると clear が出て、皿の値段が score に入り、皿はレーンから消える', () => {
    const w = wordOf('かき');
    const run = play([w]);
    const p = front(run);
    const ev = finishFront(run);
    const clears = only(ev, 'clear');
    assert.equal(clears.length, 1, `clear がちょうど一つでない: ${JSON.stringify(ev)}`);
    assert.equal(clears[0].itemId, p.id);
    assert.equal(clears[0].value, courses.mod.itemValue(course(), w));
    assert.equal(run.g.state.score, courses.mod.itemValue(course(), w));
    assert.equal(itemById(run, p.id), undefined, '取った皿がレーンに残っている');
    // 起きた順。最後の一字の hit が先で、clear はその後
    const lastHit = ev.map((e) => e.type).lastIndexOf('hit');
    assert.ok(lastHit >= 0 && lastHit < ev.findIndex((e) => e.type === 'clear'), `hit → clear の順でない: ${ev.map((e) => e.type)}`);
  });

  test('単打だけの皿には上乗せが無い（perfect は出ない、score は皿の値段ちょうど）', () => {
    const w = wordOf('かきし');
    const run = play([w]);
    const ev = finishFront(run);
    assert.equal(only(ev, 'perfect').length, 0);
    assert.ok(only(ev, 'hit').every((e) => e.tier === null), '単打の hit に tier が付いている');
    assert.equal(run.g.state.score, courses.mod.itemValue(course(), w));
  });
});

describe('ぴったり（同時打鍵のズレ）', () => {
  test('シフトの一打が ±15ms 以内なら hit(tier: perfect) の後に perfect が出て、PERFECT_BONUS が上乗せされる', () => {
    const w = wordOf('がき'); // が = 左手の字 × 右親指（交差）
    const run = play([w]);
    const p = front(run);
    const ev = input(run, result('が', { offsetMs: -8 }));
    assert.deepEqual(only(ev, 'hit'), [{ type: 'hit', itemId: p.id, kana: 'が', tier: 'perfect' }]);
    assert.deepEqual(only(ev, 'perfect'), [{ type: 'perfect', itemId: p.id, bonus: courses.mod.PERFECT_BONUS }]);
    assert.ok(ev.findIndex((e) => e.type === 'hit') < ev.findIndex((e) => e.type === 'perfect'), 'hit → perfect の順でない');

    const rest = finishFront(run);
    const base = courses.mod.itemValue(course(), w);
    assert.equal(run.g.state.score, base + courses.mod.PERFECT_BONUS, '取った後の score が «皿の値段 + 上乗せ» でない');
    // clear.value に上乗せを含めるかは契約が決めていない。どちらでも score は合っていること
    const cv = only(rest, 'clear')[0]?.value;
    assert.ok(cv === base || cv === base + courses.mod.PERFECT_BONUS, `clear.value が ${cv}`);
  });

  test('同側シフト（右手の字 × 右親指）も同じ扱い', () => {
    const run = play([wordOf('みか')]); // み = KeyH × 右親指
    const p = front(run);
    const ev = input(run, result('み', { offsetMs: 0 }));
    assert.deepEqual(only(ev, 'perfect'), [{ type: 'perfect', itemId: p.id, bonus: courses.mod.PERFECT_BONUS }]);
  });

  test('ズレが good / off なら hit の tier はそれで、上乗せは無い（減点も無い）', () => {
    for (const [offsetMs, tier] of [[25, 'good'], [-30, 'good'], [60, 'off'], [16, 'good']]) {
      const w = wordOf('がき');
      const run = play([w]);
      const ev = finishFront(run, { offsetMs });
      assert.equal(only(ev, 'hit')[0].tier, tier, `offsetMs ${offsetMs} の tier`);
      assert.equal(only(ev, 'perfect').length, 0, `offsetMs ${offsetMs} で perfect が出た`);
      assert.equal(run.g.state.score, courses.mod.itemValue(course(), w), `offsetMs ${offsetMs} の score`);
    }
  });
});

describe('ミス', () => {
  test('打ち間違いは miss。字は進まず、コンボが切れる', () => {
    const run = play([wordOf('かき')]);
    const p = front(run);
    input(run, result('か'));
    assert.equal(run.g.state.combo, 1);
    const ev = input(run, result('め'));
    assert.deepEqual(only(ev, 'miss'), [{ type: 'miss', itemId: p.id, expected: 'き', got: 'め' }]);
    assert.equal(only(ev, 'hit').length, 0);
    assert.equal(itemById(run, p.id).typed, 1, '打ち間違いで字が進んだ');
    assert.equal(run.g.state.combo, 0, 'コンボが切れていない');
    // 打ち直せば進む
    const again = input(run, result('き'));
    assert.equal(only(again, 'hit').length, 1);
    assert.equal(only(again, 'clear').length, 1);
  });

  test('シフト不発（親指が効かず単打の字が出た）も miss で、字は進まない', () => {
    const run = play([wordOf('がき')]);
    const p = front(run);
    const ev = input(run, misfire('が')); // が のつもりが か
    assert.deepEqual(only(ev, 'miss'), [{ type: 'miss', itemId: p.id, expected: 'が', got: 'か' }]);
    assert.equal(only(ev, 'hit').length, 0);
    assert.equal(itemById(run, p.id).typed, 0);
    assert.equal(run.g.state.combo, 0);
  });

  test('miss ではお金が減らない', () => {
    const run = play([wordOf('かき')]);
    front(run);
    input(run, result('め'));
    input(run, result('め'));
    assert.equal(run.g.state.score, 0);
  });
});

// ---------------------------------------------------------------- 時間

describe('流れる皿', () => {
  test('打たずに放っておくと、皿は右へ進み、レーンの端で lost になる（お金もミスも付かない）', () => {
    const run = play([wordOf('かき')]);
    const p = front(run);
    const appeared = run.t;
    let lastX = p.x;
    let lost = null;
    while (!lost) {
      assert.ok(run.t < appeared + course().laneMs + 2000, `レーンを流れ切る時間（${course().laneMs}ms）を過ぎても lost が出ない`);
      const ev = tickTo(run, run.t + 100);
      lost = only(ev, 'lost').find((e) => e.itemId === p.id) ?? null;
      const still = itemById(run, p.id);
      if (still) {
        assert.ok(still.x >= lastX, `皿が逆に流れた: ${lastX} → ${still.x}`);
        assert.ok(still.x >= 0 && still.x <= 1, `x が 0..1 の外: ${still.x}`);
        lastX = still.x;
      }
    }
    assert.ok(run.t - appeared >= course().laneMs * 0.5, `出てから ${run.t - appeared}ms で lost（早すぎる）`);
    assert.deepEqual(lost, { type: 'lost', itemId: p.id });
    assert.equal(itemById(run, p.id), undefined, '取り逃した皿がレーンに残っている');
    assert.equal(run.g.state.score, 0);

    tickTo(run, T0 + course().timeMs + 1);
    const s = run.g.summary();
    assert.equal(s.misses, 0, '取り逃しがミスに数えられている');
    assert.ok(s.lost >= 1);
  });
});

describe('コンボと時間延長', () => {
  test('COMBO_STEP 回続けて正しく打つと combo が出て、残り時間が COMBO_TIME_BONUS_MS 延びる', () => {
    const { COMBO_STEP, COMBO_TIME_BONUS_MS } = courses.mod;
    const run = play([wordOf('', course().maxLen)]);
    let comboEv = [];
    let jump = null;
    for (let n = 1; n <= COMBO_STEP; n++) {
      const p = front(run);
      const ch = [...p.word.kana][p.typed];
      run.t += 40;
      tickTo(run, run.t);
      const before = run.g.state.remainingMs;
      const ev = run.g.input(result(ch), run.t);
      run.events.push(...ev);
      const after = run.g.state.remainingMs;
      assert.equal(run.g.state.combo, n, `${n} 打目のコンボ`);
      const c = only(ev, 'combo');
      if (n < COMBO_STEP) assert.equal(c.length, 0, `${n} 打目（COMBO_STEP=${COMBO_STEP} 未満）で combo が出た`);
      else {
        comboEv = c;
        jump = after - before;
      }
    }
    assert.deepEqual(comboEv, [{ type: 'combo', combo: COMBO_STEP, bonusMs: COMBO_TIME_BONUS_MS }]);
    assert.equal(jump, COMBO_TIME_BONUS_MS, '残り時間の延びが bonusMs と合わない');
    assert.equal(run.g.state.maxCombo, COMBO_STEP);
  });

  test('コンボが切れても maxCombo は残る', () => {
    const run = play([wordOf('かきし')]);
    front(run);
    input(run, result('か'));
    input(run, result('き'));
    input(run, result('め'));
    assert.equal(run.g.state.combo, 0);
    assert.equal(run.g.state.maxCombo, 2);
  });
});

describe('時間切れ', () => {
  test('制限時間の手前では終わらず、尽きたら over が一度だけ出て phase が over になる', () => {
    const run = play([wordOf()]);
    const before = tickTo(run, T0 + course().timeMs - 1);
    assert.equal(only(before, 'over').length, 0);
    assert.equal(run.g.state.phase, 'playing');
    assert.ok(run.g.state.remainingMs > 0);

    tickTo(run, T0 + course().timeMs + 1);
    assert.equal(run.g.state.phase, 'over');
    assert.ok(run.g.state.remainingMs <= 0, `終わったのに remainingMs が ${run.g.state.remainingMs}`);
    tickTo(run, T0 + course().timeMs + 5000);
    assert.equal(only(run.events, 'over').length, 1, 'over が二度以上出た');
  });

  test('一気に時間を飛ばしても over になる（tick の間隔に頼らない）', () => {
    const run = play([wordOf()]);
    const ev = tickTo(run, T0 + course().timeMs * 3);
    assert.equal(only(ev, 'over').length, 1);
    assert.equal(run.g.state.phase, 'over');
  });

  test('over より前の summary() は throw する', () => {
    ready();
    const g = engine.mod.createGame({ course: course(), words: [wordOf()], rng: seq(0.5) });
    assert.throws(() => g.summary(), undefined, 'start 前の summary() が throw しない');
    g.start(T0);
    assert.throws(() => g.summary(), undefined, 'playing 中の summary() が throw しない');
    g.tick(T0 + 1000);
    assert.throws(() => g.summary(), undefined, 'playing 中の summary() が throw しない');
  });
});

// ---------------------------------------------------------------- 結果

describe('summary', () => {
  test('各値が、起きた events と食い違わない', () => {
    const c = course();
    const w = wordOf('がき'); // ぴったり 1 + 単打
    const run = play([w]);
    front(run);
    input(run, result('が', { offsetMs: 5 })); //  正（シフト・ぴったり）
    input(run, result('め')); //                 ミス 1
    input(run, result('め')); //                 ミス 2
    finishFront(run); //                          残りを正しく
    tickTo(run, T0 + c.timeMs + 1); //            このコースにはコンボ延長が起きない打鍵数で終える

    const hits = only(run.events, 'hit');
    const k = hits.length;
    const misses = only(run.events, 'miss').length;
    assert.equal(misses, 2, 'テストの前提: ミス 2');
    assert.ok(k < courses.mod.COMBO_STEP, 'テストの前提: コンボ延長が起きない打鍵数');

    const s = run.g.summary();
    assert.equal(s.course, c.id);
    assert.equal(s.score, run.g.state.score);
    assert.equal(s.score, courses.mod.itemValue(c, w) + courses.mod.PERFECT_BONUS);
    assert.equal(s.balance, s.score - c.target, 'balance は score - course.target');
    assert.equal(s.cleared, only(run.events, 'clear').length);
    assert.equal(s.lost, only(run.events, 'lost').length);
    assert.equal(s.misses, misses);
    // strokes が «正しい打鍵» か «全打鍵» かは契約が書いていない。どちらかではあること
    assert.ok(s.strokes === k || s.strokes === k + misses, `strokes が ${s.strokes}（正しい打鍵 ${k} / 全打鍵 ${k + misses} のどちらでもない）`);
    // accuracy はどちらの読み方でも «正しい打鍵 ÷ 全打鍵»
    assert.ok(Math.abs(s.accuracy - k / (k + misses)) < 0.005, `accuracy が ${s.accuracy}（期待 ${k / (k + misses)}）`);
    assert.equal(s.perfect, only(run.events, 'perfect').length);
    assert.equal(s.shifted, hits.filter((h) => h.tier !== null).length, 'shifted はシフトを使った（正しい）打鍵の数');
    assert.equal(s.maxCombo, run.g.state.maxCombo);
    assert.ok(Math.abs(s.durationMs - c.timeMs) <= 1, `durationMs が ${s.durationMs}（制限時間 ${c.timeMs}、延長なし）`);
    const kpm = k / (s.durationMs / 60000);
    assert.ok(Math.abs(s.kpm - kpm) <= 0.5, `kpm が ${s.kpm}（期待 ${kpm.toFixed(2)}＝正しい打鍵 ${k} ÷ ${s.durationMs / 60000} 分）`);
  });

  test('一字も打たずに終わっても、accuracy と kpm が数（NaN でない）', () => {
    const run = play([wordOf()]);
    tickTo(run, T0 + course().timeMs + 1);
    const s = run.g.summary();
    assert.ok(Number.isFinite(s.accuracy) && s.accuracy >= 0 && s.accuracy <= 1, `accuracy が ${s.accuracy}`);
    assert.equal(s.kpm, 0);
    assert.equal(s.score, 0);
    assert.equal(s.balance, -course().target);
  });

  test('コンボで延びた時間は durationMs に入る', () => {
    const { COMBO_STEP, COMBO_TIME_BONUS_MS } = courses.mod;
    const run = play([wordOf('', course().maxLen)]);
    for (let n = 0; n < COMBO_STEP; n++) {
      const p = front(run);
      input(run, result([...p.word.kana][p.typed]));
    }
    assert.equal(only(run.events, 'combo').length, 1, 'テストの前提: 延長が一度');
    const end = T0 + course().timeMs + COMBO_TIME_BONUS_MS;
    tickTo(run, end - 1);
    assert.equal(run.g.state.phase, 'playing', '延長ぶんの時間が残っていない');
    tickTo(run, end + 1);
    assert.equal(run.g.state.phase, 'over');
    const s = run.g.summary();
    assert.ok(Math.abs(s.durationMs - (course().timeMs + COMBO_TIME_BONUS_MS)) <= 1, `durationMs が ${s.durationMs}`);
  });
});

// ---------------------------------------------------------------- 時刻と乱数を中から読まない

describe('時刻と乱数は引数からだけ', () => {
  test('Date.now / performance.now / Math.random を呼ぶと投げる世界でも、一局通せる', () => {
    ready();
    const saved = { now: Date.now, perf: performance.now, random: Math.random };
    const trap = (name) => () => {
      throw new Error(`engine.js が ${name} を呼んだ（時刻・乱数は引数で受け取る約束）`);
    };
    Date.now = trap('Date.now()');
    performance.now = trap('performance.now()');
    Math.random = trap('Math.random()');
    try {
      const run = play([wordOf('がき'), wordOf('かし')]);
      for (let i = 0; i < 3; i++) finishFront(run);
      input(run, result('め'));
      tickTo(run, T0 + course().timeMs * 2);
      run.g.summary();
    } finally {
      Date.now = saved.now;
      performance.now = saved.perf;
      Math.random = saved.random;
    }
  });
});

// ---------------------------------------------------------------- ローマ字（2026-11-02）
//
// main.js はローマ字の一打を romaji.js で判定し、打ち切ったかなを一字ずつ
// { kana, charCode: 'Romaji', thumb: null, offsetMs: null } で、合わない字を kana: null で渡す。
// engine はそれを親指シフトの単打と同じに数え、ぴったりも不発も出さない。

describe('ローマ字の入力', () => {
  test('綴りどおりに打てば皿が取れ、ぴったりは出ない', async () => {
    ready();
    const { createRomaji } = await import(pathToFileURL(join(ROOT, 'assets/js/romaji.js')).href);
    const words = [{ kana: 'しゃしん', label: '写真' }, { kana: 'きって', label: '切手' }];
    const g = engine.mod.createGame({ course: { ...course(), minLen: 1, maxLen: 12 }, words, rng: () => 0 });
    g.start(T0);
    const r = createRomaji();
    let t = T0;
    const events = [];
    let plate = null;
    for (const ch of 'shashinn') { // 語末の「ん」は nn
      const head = g.state.items[0];
      if (head.id !== plate) { r.reset(); plate = head.id; }
      const chars = [...head.word.kana];
      const res = r.press(chars, head.typed, ch);
      assert.equal(res.ok, true, ch);
      for (let i = 0; i < res.done; i++) {
        events.push(...g.input({ kana: chars[head.typed + i], charCode: 'Romaji', thumb: null, offsetMs: null }, (t += 50)));
      }
    }
    assert.ok(events.some((e) => e.type === 'clear'));
    assert.ok(!events.some((e) => e.type === 'perfect'));
    assert.ok(events.filter((e) => e.type === 'hit').every((e) => e.tier === null));
  });

  test('合わない字は kana: null のミスで、不発に数えない', () => {
    ready();
    const words = [{ kana: 'がっこう', label: '学校' }];
    const g = engine.mod.createGame({ course: { ...course(), minLen: 1, maxLen: 12 }, words, rng: () => 0 });
    g.start(T0);
    const ev = g.input({ kana: null, charCode: 'Romaji', thumb: null, offsetMs: null }, T0 + 100);
    const miss = ev.find((e) => e.type === 'miss');
    assert.ok(miss);
    assert.equal(miss.misfire, false);
    assert.equal(g.state.misses, 1);
    assert.equal(g.state.items[0].typed, 0);
  });
});

// ---------------------------------------------------------------- 出す語（words.js）

const wordsMod = await load(join(ROOT, 'assets/js/game/words.js'));

describe('出す語', () => {
  test('どのコースの長さの帯にも 100 語以上ある', () => {
    ready();
    for (const c of courses.mod.COURSES) {
      const n = wordsMod.mod.WORDS.filter((w) => [...w.kana].length >= c.minLen && [...w.kana].length <= c.maxLen).length;
      assert.ok(n >= 100, `${c.id}（${c.minLen}〜${c.maxLen}字）に ${n} 語しか無い`);
    }
  });

  test('どの語も配列で打ち切れ、親指を使う字を含む。重なりが無い', () => {
    const { WORDS, shiftedCount, MIN_SHIFTED } = wordsMod.mod;
    assert.equal(new Set(WORDS.map((w) => w.kana)).size, WORDS.length);
    for (const w of WORDS) {
      const sh = shiftedCount(w.kana);
      assert.ok(sh != null, `「${w.kana}」に配列に無い字がある`);
      assert.ok(sh >= MIN_SHIFTED, `「${w.kana}」に親指を使う字が無い`);
    }
  });

  test('面を覚えるための並び（小書きだけの列など）は入っていない', () => {
    for (const w of wordsMod.mod.WORDS) assert.doesNotMatch(w.kana, /^[ぁぃぅぇぉゃゅょっ]+$/u, w.kana);
  });
});

// ---------------------------------------------------------------- サーバーと同じ物差し

describe('サーバーの検算と同じ数', () => {
  test('コースの時間・一字の点・ぴったりの上乗せ・コンボの延長が server/src/core.mjs と同じ', async () => {
    ready();
    const core = await import(pathToFileURL(join(ROOT, 'server/src/core.mjs')).href);
    const c = courses.mod;
    assert.deepEqual(Object.keys(core.COURSE_LIMITS).sort(), c.COURSES.map((x) => x.id).sort(), 'コースの id が違う');
    for (const x of c.COURSES) {
      assert.equal(core.COURSE_LIMITS[x.id].timeMs, x.timeMs, `${x.id} の時間`);
      assert.equal(core.COURSE_LIMITS[x.id].ptPerKana, c.PT_PER_KANA[x.id], `${x.id} の一字の点`);
    }
    assert.equal(core.PERFECT_BONUS, c.PERFECT_BONUS);
    assert.equal(core.COMBO_STEP, c.COMBO_STEP);
    assert.equal(core.COMBO_TIME_BONUS_MS, c.COMBO_TIME_BONUS_MS);
  });
});
