#!/usr/bin/env node
/*
 * assets/js/game/courses.js・engine.js・words.js（タイピングゲーム。題材は検品ライン）の単体テスト。
 *
 * 採点は寿司打と同じ数値と算出方法にしてある（courses.js の注記）。ここではその数値を
 * «調べた値そのもの» で確かめる。courses.js の値を読んで比べるだけだと、値を書き換えても通ってしまい、
 * 寿司打と比べられなくなったことに気づけない。
 *
 * engine.js は nicola.js と同じく時刻を引数で受け取り、乱数も rng で受け取る約束。
 * だからここでは一切待たない。時間切れは tick(t) に大きな t を渡すだけで起こせる。
 * その約束が守られていることも、Date.now / performance.now / Math.random を
 * «呼ばれたら投げる» ものに差し替えて一局通すことで確かめる。
 *
 * 入力は nicola.js の onOutput の result を手で組んで渡す。どのキーで出るかは本物の配列表から引く。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const { COURSES, SPEEDS, itemValue, lengthRamp, lengthAt, SAME_LEN_RUN, METER_STEPS } = await imp('assets/js/game/courses.js');
const { createGame, keyFor } = await imp('assets/js/game/engine.js');
const { WORDS } = await imp('assets/js/game/words.js');
const { THRESHOLDS } = await imp('assets/js/meter.js');
const { RANKS } = await imp('assets/js/trophies.js');

// ---------------------------------------------------------------- 道具

const T0 = 10_000; // 開始時刻。0 にしないのは «0 を未設定扱いする» 実装を見逃さないため
const course = (id) => COURSES.find((c) => c.id === id);
/** 普通の速さ（寿司打を測った値。courses.js を読まずに書く） */
const LANE = 6000;

/** onOutput の result の形。親指を使う字だけ offsetMs が意味を持つ */
function result(kana, { offsetMs = -5, keys } = {}) {
  const how = keyFor(kana);
  if (!how) throw new Error(`テストの誤り: 「${kana}」は NICOLA 配列で打てない`);
  const base = { kana, charCode: how.code, continued: false, keys };
  if (!how.thumb) return { ...base, thumb: null, shiftKind: null, offsetMs: null, state: 'S2' };
  return { ...base, thumb: how.thumb, shiftKind: how.thumb === how.hand ? 'same' : 'cross', offsetMs, state: 'S4' };
}

/** どの字数にも語がある、見本の語の表。字は «か»（単打）と «が»（親指）を並べただけ */
const SAMPLE = [];
for (let n = 1; n <= 16; n++) {
  SAMPLE.push({ kana: 'か'.repeat(n) });
  SAMPLE.push({ kana: 'が'.repeat(n) });
  SAMPLE.push({ kana: `${'か'.repeat(n - 1)}が` });
}

function play(id = 'p3000', words = SAMPLE) {
  const g = createGame({ course: course(id), words, rng: () => 0, laneMs: LANE });
  g.start(T0);
  return g;
}

/** 先頭の作業品を打ち切る。返り値は起きた events */
function finishHead(g, t, opts) {
  const head = g.state.items[0];
  const ev = [];
  for (const c of [...head.word.kana].slice(head.typed)) ev.push(...g.input(result(c, opts), t));
  return ev;
}

const only = (ev, type) => ev.filter((e) => e.type === type);

// ---------------------------------------------------------------- コースの数値（寿司打と同じ）

describe('コースの数値は寿司打と同じ', () => {
  test('ノルマ・制限時間・字数の帯', () => {
    assert.deepEqual(COURSES.map((c) => [c.id, c.target, c.timeMs, c.minLen, c.maxLen]), [
      ['p3000', 3000, 60000, 2, 7],
      ['p5000', 5000, 90000, 5, 10],
      ['p10000', 10000, 120000, 9, 14],
    ]);
  });

  test('作業品の値段は字数で決まる（3,000: 2〜4 字 100・5〜6 字 180・7 字 240 など）', () => {
    const v = (id, n) => itemValue(course(id), { kana: 'か'.repeat(n) });
    assert.deepEqual([2, 3, 4, 5, 6, 7].map((n) => v('p3000', n)), [100, 100, 100, 180, 180, 240]);
    assert.deepEqual([5, 6, 7, 8, 9, 10].map((n) => v('p5000', n)), [180, 180, 240, 240, 240, 380]);
    assert.deepEqual([9, 10, 11, 12, 13, 14].map((n) => v('p10000', n)), [240, 380, 380, 380, 500, 500]);
    assert.throws(() => v('p3000', 8), '帯の外の字数で値段が付いた');
  });

  test('字数の順は最小から最大まで上がり、下がらない。一つの字数で 3 枚', () => {
    assert.deepEqual(lengthRamp(course('p3000')), [2, 3, 4, 5, 6, 7]);
    assert.deepEqual(lengthRamp(course('p5000')), [5, 6, 7, 8, 9, 10]);
    assert.deepEqual(lengthRamp(course('p10000')), [9, 10, 11, 12, 13, 14]);
    assert.equal(SAME_LEN_RUN, 3);
    // 何枚目でも、前の枚より短くならない
    for (const c of COURSES) {
      for (let i = 1; i < 300; i++) assert.ok(lengthAt(c, i) >= lengthAt(c, i - 1), `${c.id} の ${i} 枚目で短くなった`);
      assert.equal(lengthAt(c, 299), c.maxLen);
    }
  });

  test('連打メーターは 28 / 59 / 92 / 130 キーで +1 / +1 / +2 / +3 秒', () => {
    assert.deepEqual(METER_STEPS.map((s) => [s.keys, s.ms]), [[28, 1000], [59, 1000], [92, 2000], [130, 3000]]);
  });
});

// ---------------------------------------------------------------- 始まりと出る順

describe('始まりと出る順', () => {
  test('start 前は ready、start 後は playing で、残り時間はコースの制限時間', () => {
    const g = createGame({ course: course('p5000'), words: SAMPLE, rng: () => 0, laneMs: LANE });
    assert.equal(g.state.phase, 'ready');
    assert.equal(g.state.remainingMs, 90000);
    g.start(T0);
    assert.equal(g.state.phase, 'playing');
    assert.equal(g.state.items.length, 1);
  });

  test('作業品は字数の順に 3 枚ずつ出て、最大の字数まで来たらそのまま続く。値段は itemValue', () => {
    const g = play('p3000', WORDS);
    const lens = [];
    const values = [];
    for (let i = 0; i < 30; i++) {
      const head = g.state.items[0];
      lens.push([...head.word.kana].length);
      values.push(head.value);
      assert.equal(head.value, itemValue(course('p3000'), head.word));
      finishHead(g, T0 + 1);
    }
    // 寿司打はここから下がる（7,6,5,4,3）が、途中から簡単になるので下げない
    assert.deepEqual(lens, [...[2, 3, 4, 5, 6, 7].flatMap((n) => [n, n, n]), ...Array(12).fill(7)]);
    assert.deepEqual(values, [...Array(9).fill(100), ...Array(6).fill(180), ...Array(15).fill(240)]);
  });

  test('出る順の字数に語が無ければ throw（黙って別の字数を出さない）', () => {
    const words = SAMPLE.filter((w) => [...w.kana].length !== 4);
    assert.throws(() => createGame({ course: course('p3000'), words, rng: () => 0, laneMs: LANE }));
  });
});

// ---------------------------------------------------------------- 同じ語を出さない

/** 決まった乱数（mulberry32）。Math.random だと落ちたときに同じ回を再現できない */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 一字を msPerKana かけて、まちがえずに打ち続ける。連打メーターの延長も全部取る。
 * 時間切れまでに出た作業品の語（kana）を出た順に返す
 */
function playThrough(c, { kanaPerMin, seed }) {
  const g = createGame({ course: c, words: WORDS, rng: seeded(seed), laneMs: LANE });
  const step = 60000 / kanaPerMin;
  let t = T0;
  g.start(t);
  const seen = [];
  let lastId = null;
  while (g.state.phase === 'playing') {
    const head = g.state.items[0];
    if (head.id !== lastId) { seen.push(head.word.kana); lastId = head.id; }
    t += step;
    g.tick(t);
    if (g.state.phase !== 'playing') break;
    g.input(result([...head.word.kana][head.typed]), t);
  }
  return seen;
}

describe('一回のゲームで同じ語は出さない', () => {
  const top = RANKS[RANKS.length - 1];          // 名人（毎分 360 字）
  const shodan = RANKS.find((r) => r.name === '初段'); // 毎分 180 字

  test(`${top.name}の速さ（毎分 ${top.cpm} 字・延長を全部取る）で最後まで打っても、同じ語が二度出ない`, () => {
    for (const c of COURSES) {
      for (let seed = 1; seed <= 20; seed++) {
        const seen = playThrough(c, { kanaPerMin: top.cpm, seed });
        const twice = seen.filter((k, i) => seen.indexOf(k) !== i);
        assert.deepEqual(twice, [], `${c.id}（seed ${seed}）で ${seen.length} 個中に重なり`);
      }
    }
  });

  test(`${shodan.name}の速さ（毎分 ${shodan.cpm} 字）なら、最大の字数まで来たあとは最後まで最大の字数（短い語へ下りない）`, () => {
    for (const c of COURSES) {
      for (let seed = 1; seed <= 20; seed++) {
        const lens = playThrough(c, { kanaPerMin: shodan.cpm, seed }).map((k) => [...k].length);
        const plateau = lens.slice(lengthRamp(c).length * SAME_LEN_RUN);
        assert.ok(plateau.length > 0, `${c.id} が最大の字数まで届いていない`);
        assert.ok(plateau.every((n) => n === c.maxLen), `${c.id}（seed ${seed}）で短い語へ下りた: ${plateau.join(',')}`);
      }
    }
  });

  test('その字数を使い切ったら一つ短い字数へ下り、範囲を出し切ったときだけ二巡目に入る', () => {
    // 見本の表は字数ごとに 3 語。2〜7 字の上りで 18 語を出し切る
    const g = play('p3000');
    const seen = [];
    for (let i = 0; i < 21; i++) {
      seen.push(g.state.items[0].word.kana);
      finishHead(g, T0 + 1);
    }
    assert.equal(new Set(seen.slice(0, 18)).size, 18, '一巡目で重なった');
    assert.equal(seen.slice(18).every((k) => [...k].length === 7), true, '二巡目も最大の字数から');
  });
});

// ---------------------------------------------------------------- 点

describe('点', () => {
  test('打ち切ると clear が出て、作業品の値段が score に入る', () => {
    const g = play();
    const head = g.state.items[0];
    const ev = finishHead(g, T0 + 100);
    assert.deepEqual(only(ev, 'clear'), [{ type: 'clear', itemId: head.id, value: head.value }]);
    assert.equal(g.state.score, head.value);
  });

  test('ぴったりでも値段は変わらない（独自の上乗せを入れない）', () => {
    const g = play('p3000', [{ kana: 'がが' }, ...SAMPLE.filter((w) => [...w.kana].length !== 2)]);
    const ev = finishHead(g, T0 + 100, { offsetMs: 0 });
    assert.ok(only(ev, 'hit').every((e) => e.tier === 'perfect'));
    assert.equal(g.state.score, 100);
    assert.equal(g.state.perfect, 2, 'ぴったりは数えている');
  });

  test('親指を使う字のズレの判定（ぴったり・良い）は数えるだけ', () => {
    const g = play('p3000', [{ kana: 'がが' }, ...SAMPLE.filter((w) => [...w.kana].length !== 2)]);
    g.input(result('が', { offsetMs: THRESHOLDS.perfect }), T0 + 1);
    g.input(result('が', { offsetMs: THRESHOLDS.good }), T0 + 2);
    assert.equal(g.state.perfect, 1);
    assert.equal(g.state.good, 1);
    assert.deepEqual(g.state.offsets, [THRESHOLDS.perfect, THRESHOLDS.good]);
  });

  test('打ち間違いは miss。字は進まず、点も減らない', () => {
    const g = play();
    g.input(result('か'), T0 + 1);
    const ev = g.input(result('さ'), T0 + 2);
    assert.equal(only(ev, 'miss').length, 1);
    assert.equal(g.state.items[0].typed, 1);
    assert.equal(g.state.misses, 1);
    assert.equal(g.state.score, 0);
  });

  test('親指が効かずに同じキーの単打が出たら、不発（misfire）の miss', () => {
    const g = play('p3000', [{ kana: 'がが' }, ...SAMPLE.filter((w) => [...w.kana].length !== 2)]);
    const how = keyFor('が');
    const ev = g.input({ kana: 'か', charCode: how.code, thumb: null, offsetMs: null }, T0 + 1);
    assert.equal(only(ev, 'miss')[0].misfire, true);
  });

  // 寿司打を開いて 0.5 秒ごとに撮って測った値（courses.js の注記）。courses.js の値を読まずに数字で書く
  test('流れる速さは寿司打と同じ：普通 6 秒・練習 11 秒', () => {
    assert.deepEqual(SPEEDS.map((x) => [x.id, x.laneMs]), [['normal', 6000], ['practice', 11000]]);
  });

  test('作業品は一度に一つ。流れきると、その時刻に次が入口から出る', () => {
    const g = play();
    const first = g.state.items[0].id;
    for (let t = T0; t < T0 + LANE - 100; t += 100) g.tick(t);
    assert.equal(g.state.items.length, 1);
    assert.equal(g.state.items[0].id, first, '6 秒たつまでは同じ作業品');
    const ev = g.tick(T0 + LANE + 30);
    assert.equal(only(ev, 'lost').length, 1);
    assert.equal(g.state.items.length, 1);
    assert.ok(g.state.items[0].x < 0.01, '次の作業品は入口から');
  });

  test('打ち切ると、次の作業品がすぐ入口から出て、まる 6 秒もらえる', () => {
    const g = play();
    g.tick(T0 + 4000);
    finishHead(g, T0 + 4000);
    assert.equal(g.state.items.length, 1);
    assert.equal(g.state.items[0].x, 0);
    assert.equal(only(g.tick(T0 + 4000 + LANE - 50), 'lost').length, 0);
  });

  test('打たずに放っておくと出口で lost（点もミスも付かない）', () => {
    const g = play();
    const head = g.state.items[0];
    let ev = [];
    for (let t = T0; t <= T0 + LANE + 10; t += 50) ev.push(...g.tick(t));
    assert.ok(only(ev, 'lost').some((e) => e.itemId === head.id));
    assert.equal(g.state.misses, 0);
    assert.equal(g.state.score, 0);
  });
});

// ---------------------------------------------------------------- 連打メーター

describe('連打メーター', () => {
  test('ミスなしで 28 キーに届くと +1 秒。キーは result.keys（無ければ 1）', () => {
    const g = play();
    const before = g.state.remainingMs;
    let ev = [];
    for (let i = 0; i < 27; i++) ev.push(...g.input(result([...g.state.items[0].word.kana][g.state.items[0].typed]), T0));
    assert.equal(only(ev, 'meter').length, 0);
    assert.equal(g.state.meterKeys, 27);
    ev = g.input(result([...g.state.items[0].word.kana][g.state.items[0].typed]), T0);
    assert.deepEqual(only(ev, 'meter'), [{ type: 'meter', step: 0, bonusMs: 1000 }]);
    assert.equal(g.state.remainingMs, before + 1000);
  });

  test('ローマ字の一字は押したキーの数で進む。一打で段をまたげば、またいだ段だけ延びる', () => {
    const g = play();
    const want = () => [...g.state.items[0].word.kana][g.state.items[0].typed];
    g.input({ kana: want(), charCode: 'Romaji', thumb: null, offsetMs: null, keys: 27 }, T0);
    assert.equal(g.state.meterKeys, 27);
    const ev = g.input({ kana: want(), charCode: 'Romaji', thumb: null, offsetMs: null, keys: 40 }, T0);
    assert.deepEqual(only(ev, 'meter').map((e) => e.step), [0, 1]);
    assert.equal(g.state.correctKeys, 67);
  });

  test('ミスで 0 に戻る', () => {
    const g = play();
    for (let i = 0; i < 20; i++) g.input(result([...g.state.items[0].word.kana][g.state.items[0].typed]), T0);
    g.input(result('さ'), T0);
    assert.equal(g.state.meterKeys, 0);
    assert.equal(g.state.meterNext, 28);
  });

  test('130 キーで +1+1+2+3 秒延びて一周し、また 28 から数える', () => {
    const g = play();
    const before = g.state.remainingMs;
    for (let i = 0; i < 130; i++) g.input(result([...g.state.items[0].word.kana][g.state.items[0].typed]), T0);
    assert.equal(g.state.remainingMs, before + 7000);
    assert.equal(g.state.meterKeys, 0);
    assert.equal(g.state.meterNext, 28);
  });
});

// ---------------------------------------------------------------- 時間切れと summary

describe('時間切れと summary', () => {
  test('制限時間の手前では終わらず、尽きたら over が一度だけ出る', () => {
    const g = play();
    assert.deepEqual(g.tick(T0 + 59_999).filter((e) => e.type === 'over'), []);
    assert.deepEqual(only(g.tick(T0 + 60_000), 'over').length, 1);
    assert.deepEqual(g.tick(T0 + 70_000), []);
  });

  test('over より前の summary() は throw する', () => {
    assert.throws(() => play().summary());
  });

  test('結果の項目: 点・お得/損・正しく打ったキーの数・平均キータイプ数・ミスタイプ数', () => {
    const g = play();
    const events = [];
    for (let i = 0; i < 12; i++) {
      if (i === 5) { events.push(...g.input(result('さ'), T0 + 100)); continue; }
      events.push(...g.input(result([...g.state.items[0].word.kana][g.state.items[0].typed]), T0 + 100));
    }
    events.push(...g.tick(T0 + 60_000));
    const s = g.summary();
    const hits = only(events, 'hit');
    assert.equal(s.score, only(events, 'clear').reduce((a, e) => a + e.value, 0));
    assert.equal(s.balance, s.score - 3000);
    assert.equal(s.correctKeys, hits.length);
    assert.equal(s.misses, 1);
    assert.equal(s.cleared, only(events, 'clear').length);
    // 平均キータイプ数 = 正しく打ったキー ÷ 遊んだ秒数（延長込み）、小数一桁で切り捨て
    assert.equal(s.keysPerSec, Math.floor((s.correctKeys / 60) * 10) / 10);
  });

  test('延長した時間は durationMs と平均キータイプ数の分母に入る', () => {
    const g = play();
    for (let i = 0; i < 28; i++) g.input(result([...g.state.items[0].word.kana][g.state.items[0].typed]), T0);
    g.tick(T0 + 61_000);
    const s = g.summary();
    assert.equal(s.durationMs, 61_000);
    assert.equal(s.keysPerSec, Math.floor((28 / 61) * 10) / 10);
  });

  test('Date.now / performance.now / Math.random を呼ぶと投げる世界でも、一局通せる', () => {
    const saved = { now: Date.now, perf: performance.now, random: Math.random };
    const trap = (name) => () => { throw new Error(`engine.js が ${name} を呼んだ`); };
    Date.now = trap('Date.now()');
    performance.now = trap('performance.now()');
    Math.random = trap('Math.random()');
    try {
      const g = createGame({ course: course('p10000'), words: WORDS, rng: () => 0.3, laneMs: LANE });
      g.start(T0);
      for (let i = 0; i < 40; i++) g.input(result([...g.state.items[0].word.kana][g.state.items[0].typed], { offsetMs: 4 }), T0 + i * 50);
      g.tick(T0 + 1e7);
      g.summary();
    } finally {
      Date.now = saved.now;
      performance.now = saved.perf;
      Math.random = saved.random;
    }
  });
});

// ---------------------------------------------------------------- 出す語（words.js）

describe('出す語', () => {
  test('どのコースの、どの字数にも 10 語以上ある', () => {
    for (const c of COURSES) {
      for (const n of lengthRamp(c)) {
        const k = WORDS.filter((w) => [...w.kana].length === n).length;
        assert.ok(k >= 10, `${c.id} の ${n} 字の語が ${k} 語しか無い`);
      }
    }
  });

  test('どの語も配列で打ち切れ、見せる表記（label）がある。重なりが無い', () => {
    assert.equal(new Set(WORDS.map((w) => w.kana)).size, WORDS.length);
    for (const w of WORDS) {
      for (const c of w.kana) assert.ok(keyFor(c), `「${w.kana}」の「${c}」は配列に無い`);
      assert.ok(typeof w.label === 'string' && w.label, `「${w.kana}」に label が無い`);
      const n = [...w.kana].length;
      assert.ok(n >= 2 && n <= 14, `「${w.kana}」は ${n} 字（コースの帯 2〜14 字の外）`);
    }
  });
});

// ---------------------------------------------------------------- サーバーと同じ物差し

describe('サーバーの検算と同じ数', () => {
  test('コースの時間・値段の表・連打メーターが server/src/core.mjs と同じ', async () => {
    const core = await imp('server/src/core.mjs');
    assert.deepEqual(Object.keys(core.COURSE_LIMITS).sort(), COURSES.map((c) => c.id).sort(), 'コースの id が違う');
    for (const c of COURSES) {
      assert.equal(core.COURSE_LIMITS[c.id].timeMs, c.timeMs, `${c.id} の時間`);
      assert.deepEqual(core.COURSE_LIMITS[c.id].prices.map((p) => ({ ...p })), c.prices.map((p) => ({ ...p })), `${c.id} の値段の表`);
    }
    assert.deepEqual(core.METER_STEPS.map((s) => ({ ...s })), METER_STEPS.map((s) => ({ ...s })));
  });
});
