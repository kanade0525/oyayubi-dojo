#!/usr/bin/env node
/*
 * assets/js/drill.js（適応出題）の単体テスト。
 *
 * このエンジンの怖いところは「落ちない壊れ方」をすること。文は出るが弱点を
 * 狙えていない、文は出るが打てない字が混じっている、という壊れ方は例外を投げない。
 * だからここでは出力そのものを毎回検査する。
 *
 *   1. **打てない字を出さない。** 検査は drill.js の中の表ではなく
 *      assets/data/nicola.js から自前で作った集合と突き合わせる。
 *      drill.js の表が間違っていたら、drill.js 自身の表で検算しても気づけない。
 *   2. **乱数を注入して決定的に検査する。** 種を固定した線形合同法を渡し、
 *      同じ種で同じ文が出ることまで見る。生成器のテストが確率で揺れると、
 *      落ちたときに「実装が壊れたのか運が悪いのか」を切り分けられない。
 *   3. **「多く出る」は一本では見ない。** 一本の中の出現数はばらつくので、
 *      弱点ありの統計と無しの統計で何十本も生成し、総数を比べる。
 *
 * 依存パッケージゼロ。node:test / node:assert だけで書いてある。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);

const { NICOLA } = await load('assets/data/nicola.js');
const { weakFaces, makeDrill, DRILL_MODES, DRILL_FACES, VOCAB, describeFace, faceCountsOfText } =
  await load('assets/js/drill.js');

// ---------------------------------------------------------------- 下ごしらえ

/** 配列表から自前で作る「打てる字」の集合。drill.js の表は一切見ない */
const TYPABLE = new Set();
for (const key of Object.values(NICOLA.keys)) {
  for (const kana of [key.none, key.left, key.right]) if (kana) TYPABLE.add(kana);
}

/** 面の一覧（'KeyH:left' の形）を配列表から自前で作る */
const ALL_FACES = [];
for (const [code, key] of Object.entries(NICOLA.keys)) {
  for (const thumb of ['none', 'left', 'right']) {
    const kana = thumb === 'none' ? key.none : key[thumb];
    if (kana) ALL_FACES.push({ face: `${code}:${thumb}`, kana, hand: key.hand, thumb });
  }
}

/** 種から決まる乱数。mulberry32（32bitの短い生成器）。同じ種なら必ず同じ列 */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 全ての面をこれだけ打った、という統計。ここを土台に一点だけ崩して弱点を作る */
function fullStats(hits = 100) {
  const faceHits = {};
  for (const f of ALL_FACES) faceHits[f.face] = hits;
  return { faceHits, faceMisses: {}, offset: {} };
}

const countOf = (text, ch) => [...text].filter((c) => c === ch).length;

/** 打てない字を拾う。ここが空でないなら、その課題は永久にクリアできない */
const untypable = (text) => [...text].filter((ch) => !TYPABLE.has(ch));

const MODES = Object.keys(DRILL_MODES);

// ---------------------------------------------------------------- 面の表と語彙表

describe('面の表', () => {
  test('配列表の面を一つ残らず持っている', () => {
    const mine = new Set(DRILL_FACES.map((f) => f.face));
    assert.equal(mine.size, ALL_FACES.length);
    for (const f of ALL_FACES) assert.ok(mine.has(f.face), `${f.face} が面の一覧に無い`);
  });

  test('割り当ての無い面（Semicolon:left）は持たない', () => {
    assert.ok(!DRILL_FACES.some((f) => f.face === 'Semicolon:left'));
  });

  test('同側／交差の向きが規格どおり（交差＝濁音）', () => {
    const ba = DRILL_FACES.find((f) => f.kana === 'ば'); // 右手 KeyH × 左親指 ＝ 交差
    assert.equal(ba.shiftKind, 'cross');
    const mi = DRILL_FACES.find((f) => f.kana === 'み'); // 右手 KeyH × 右親指 ＝ 同側
    assert.equal(mi.shiftKind, 'same');
    assert.match(describeFace(ba), /交差シフト/);
  });

  test('教程順に並んでいる（単独 → 同側 → 交差）', () => {
    const kinds = DRILL_FACES.map((f) => (f.thumb === 'none' ? 0 : f.shiftKind === 'same' ? 1 : 2));
    assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b));
    assert.equal(DRILL_FACES[0].kana, 'う'); // 左手ホームポジションの先頭
  });
});

describe('語彙表', () => {
  test('全ての語が打てる字だけでできている', () => {
    for (const w of VOCAB) assert.deepEqual(untypable(w), [], `打てない字がある語: ${w}`);
  });

  test('書き間違いで語が黙って捨てられていない', () => {
    // drill.js は読み込み時に打てない語を落とす（永久にクリア不能な課題を防ぐため）。
    // 落ちたこと自体は例外にならないので、原文をソースから読んで突き合わせる。
    const src = readFileSync(join(ROOT, 'assets/js/drill.js'), 'utf8');
    const block = src.match(/const RAW_VOCAB = \[([\s\S]*?)\n\];/);
    assert.ok(block, 'RAW_VOCAB がソースから読み取れない');
    const raw = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(raw.length > 200, `語彙が少なすぎる: ${raw.length}`);
    for (const w of raw) assert.deepEqual(untypable(w), [], `打てない字がある語: ${w}`);
    assert.equal(VOCAB.length, new Set(raw).size, '打てない語が捨てられている');
  });

  test('語の中に句読点が混じっていない', () => {
    for (const w of VOCAB) assert.ok(!/[。、．・]/u.test(w), `区切りが語に入っている: ${w}`);
  });
});

// ---------------------------------------------------------------- 鍛えるの実文と覚えるのレッスン
//
// 適応出題と同じく、出す字が配列表の外に出ていないかを見る。一字でも外れると、その一本は永久に打ち切れない

describe('実文の題材とレッスン', () => {
  test('実文の題材は打てる字だけでできている', async () => {
    const { TEXTS } = await load('assets/js/lessons.js');
    assert.ok(TEXTS.length > 0);
    for (const l of TEXTS) assert.deepEqual(untypable(l.text), [], `打てない字がある題材: ${l.id}`);
  });

  test('覚えるの各段階は打てる字だけでできていて、id で引ける', async () => {
    const { CURRICULUM, PHASES, phaseId } = await load('assets/js/curriculum.js');
    const { findLesson, nextLesson } = await load('assets/js/lessons.js');
    for (const l of CURRICULUM) {
      for (const p of PHASES) {
        const id = phaseId(l.id, p.id);
        const got = findLesson(id);
        assert.ok(got, `${id} が引けない`);
        assert.deepEqual(untypable(got.text), [], `打てない字がある段階: ${id}`);
      }
    }
    const last = CURRICULUM.at(-1);
    assert.equal(nextLesson(phaseId(last.id, PHASES.at(-1).id)), null, '最後の段階の次は null');
  });
});

// ---------------------------------------------------------------- 弱点の読み方

describe('weakFaces', () => {
  test('統計が空なら全面が未踏破で、教程順の先頭から並ぶ', () => {
    const list = weakFaces({});
    assert.equal(list.length, ALL_FACES.length);
    assert.ok(list.every((f) => f.unseen));
    assert.equal(list[0].kana, 'う');
    assert.equal(list[0].reason, 'まだ一度も打っていない');
  });

  test('undefined や壊れた統計でも落ちない', () => {
    for (const bad of [undefined, null, 0, 'x', { faceHits: 'x', offset: 3 }, { faceHits: { 'KeyH:none': NaN } }]) {
      const list = weakFaces(bad);
      assert.equal(list.length, ALL_FACES.length);
    }
  });

  test('未踏破の面は、どんなに悪い踏破済みの面より必ず上に来る', () => {
    const stats = fullStats(100);
    delete stats.faceHits['KeyN:left']; // 「ぷ」だけ未踏破
    stats.faceMisses = { 'KeyH:left': 90 }; // 「ば」はミスだらけ
    const list = weakFaces(stats);
    assert.equal(list[0].face, 'KeyN:left');
    assert.equal(list[1].face, 'KeyH:left');
  });

  test('分母が小さいミスを最悪と判定しない（1打1ミスのミス率 < 100打30ミス）', () => {
    const stats = fullStats(100);
    stats.faceHits['KeyU:none'] = 1; // ち を1回打って
    stats.faceMisses = { 'KeyU:none': 1, 'KeyK:none': 30 }; // 1回ミス。き は100打30ミス
    const list = weakFaces(stats);
    const at = (face) => list.find((f) => f.face === face);
    // ミス率の軸では、1打1ミス（率100%）が100打30ミスを上回ってはいけない
    assert.ok(at('KeyU:none').parts.miss < at('KeyK:none').parts.miss, '1打1ミスをミス率100%として扱っている');
    assert.ok(at('KeyU:none').parts.miss < 1, 'ミス率が振り切れている');
    // 1打しかしていない面が上位に来ること自体は正しい（打ち込み不足として）
    assert.equal(at('KeyU:none').reason, '打ち込みが足りない');
  });

  test('ミスの多い面が上に来る', () => {
    const stats = fullStats(100);
    stats.faceMisses = { 'KeyH:left': 40 };
    assert.equal(weakFaces(stats)[0].face, 'KeyH:left');
    assert.equal(weakFaces(stats)[0].reason, 'ミスが多い');
  });

  test('打ち込みの薄い面が上に来る', () => {
    const stats = fullStats(200);
    stats.faceHits['KeyM:right'] = 2; // ゆ だけ2回しか打っていない
    const top = weakFaces(stats)[0];
    assert.equal(top.face, 'KeyM:right');
    assert.equal(top.reason, '打ち込みが足りない');
  });

  test('片方の親指のズレが大きいと、その親指を使う面が浮き上がる', () => {
    const stats = fullStats(100);
    // 左親指だけ平均 45ms 遅れている（n=200）。右親指はぴったり
    stats.offset = {
      left: { n: 200, sum: 200 * 45, sumAbs: 200 * 45, sumSq: 200 * 45 * 45 },
      right: { n: 200, sum: 0, sumAbs: 0, sumSq: 0 },
    };
    const top20 = weakFaces(stats).slice(0, 20);
    assert.ok(top20.every((f) => f.thumb === 'left'), '左親指の面で上位が埋まっていない');
    assert.match(top20[0].reason, /左親指のズレ/);
    // 単独打鍵（親指を使わない面）は影響を受けない
    assert.ok(!top20.some((f) => f.thumb === 'none'));
  });

  test('ズレの標本が少ないうちは効かせない', () => {
    const stats = fullStats(100);
    stats.offset = { left: { n: 2, sum: 2 * 80, sumAbs: 2 * 80, sumSq: 2 * 6400 }, right: { n: 0 } };
    const top = weakFaces(stats)[0];
    assert.doesNotMatch(top.reason, /ズレ/);
  });

  test('直近に出した面は下がる。ただし本物の弱点は消えない', () => {
    const stats = fullStats(100);
    stats.faceHits['KeyM:right'] = 2; // ゆ
    stats.faceHits['KeyN:right'] = 2; // ぬ。同じだけ薄い面を二つ作る
    const before = weakFaces(stats);
    assert.equal(before[0].face, 'KeyN:right'); // 同点なので教程順で ぬ が先

    const after = weakFaces(stats, { recentFaces: ['KeyN:right'] });
    const at = (list, face) => list.find((f) => f.face === face);
    assert.ok(at(after, 'KeyN:right').score < at(before, 'KeyN:right').score, '直近に出した面が下がっていない');
    assert.equal(after[0].face, 'KeyM:right', '同じくらい弱い面に譲っていない');

    // ミスだらけの面は、一度出したくらいでは狙いから外れない
    const heavy = fullStats(100);
    heavy.faceMisses = { 'KeyH:left': 60 };
    assert.equal(weakFaces(heavy, { recentFaces: ['KeyH:left'] })[0].face, 'KeyH:left');
  });

  test('limit と seenOnly が効く', () => {
    const stats = fullStats(10);
    delete stats.faceHits['KeyN:left'];
    assert.equal(weakFaces(stats, { limit: 5 }).length, 5);
    assert.ok(!weakFaces(stats, { seenOnly: true }).some((f) => f.unseen));
  });
});

// ---------------------------------------------------------------- 生成

describe('makeDrill · 最低条件', () => {
  test('統計が空（初心者）でも文が出る', () => {
    for (const mode of MODES) {
      const d = makeDrill({}, { mode, rng: seeded(1) });
      assert.ok(d.text.length > 0, `${mode} で文が出ない`);
      assert.deepEqual(untypable(d.text), []);
      assert.equal(d.id, `drill-${mode}`);
      assert.equal(d.mode, mode);
    }
  });

  test('乱数を渡さなくても動く（既定は Math.random）', () => {
    const d = makeDrill(fullStats(50));
    assert.ok(d.text.length >= 40);
    assert.deepEqual(untypable(d.text), []);
  });

  test('壊れた統計・未知のモードでも落ちない', () => {
    for (const bad of [undefined, null, 'x', { faceHits: null }, { offset: { left: 'x' } }]) {
      const d = makeDrill(bad, { mode: 'そんなモードは無い', rng: seeded(7) });
      assert.equal(d.mode, 'weak'); // 既定に落ちる
      assert.deepEqual(untypable(d.text), []);
    }
  });

  test('生成文の全てのかなが打てる（統計を変えて200本）', () => {
    const statsList = [{}, fullStats(3), fullStats(100), (() => {
      const s = fullStats(100);
      s.faceMisses = { 'KeyH:left': 30, 'KeyO:left': 20 };
      delete s.faceHits['KeyU:left'];
      return s;
    })()];
    let n = 0;
    for (const stats of statsList) {
      for (const mode of MODES) {
        for (let seed = 1; seed <= 17; seed++) {
          const d = makeDrill(stats, { mode, rng: seeded(seed) });
          assert.deepEqual(untypable(d.text), [], `打てない字が出た: ${d.text}`);
          n++;
        }
      }
    }
    assert.ok(n >= 200, `本数が足りない: ${n}`);
  });

  test('文字数が 40〜80 に収まる', () => {
    for (const stats of [{}, fullStats(5), fullStats(300)]) {
      for (const mode of MODES) {
        for (let seed = 1; seed <= 25; seed++) {
          const d = makeDrill(stats, { mode, rng: seeded(seed) });
          const len = [...d.text].length;
          assert.ok(len >= 40 && len <= 80, `${mode}/seed${seed} の長さが範囲外: ${len} / ${d.text}`);
          assert.equal(d.length, len);
        }
      }
    }
  });

  test('長さの指定を渡せる', () => {
    const d = makeDrill(fullStats(100), { rng: seeded(3), minLength: 100, maxLength: 140 });
    assert.ok(d.length >= 100 && d.length <= 140, `${d.length}`);
  });

  test('文は句点で終わり、区切りが末尾に残らない', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = makeDrill(fullStats(50), { rng: seeded(seed) });
      assert.ok(d.text.endsWith('。'));
      assert.ok(!/[、．・]。$/u.test(d.text), `区切りの直後に句点: ${d.text}`);
    }
  });
});

describe('makeDrill · 決定性', () => {
  test('同じ種なら同じ文が出る', () => {
    const stats = fullStats(60);
    for (const mode of MODES) {
      const a = makeDrill(stats, { mode, rng: seeded(42) });
      const b = makeDrill(stats, { mode, rng: seeded(42) });
      assert.equal(a.text, b.text);
      assert.deepEqual(a.targets, b.targets);
    }
  });

  test('種が違えば文も違う（乱数が本当に効いている）', () => {
    const stats = fullStats(60);
    const texts = new Set();
    for (let seed = 1; seed <= 20; seed++) texts.add(makeDrill(stats, { rng: seeded(seed) }).text);
    assert.ok(texts.size >= 15, `同じ文ばかり出ている: ${texts.size}/20`);
  });

  test('Math.random に触らない（注入した乱数だけで決まる）', () => {
    const real = Math.random;
    Math.random = () => { throw new Error('Math.random を使っている'); };
    try {
      assert.ok(makeDrill(fullStats(60), { rng: seeded(9) }).text.length > 0);
    } finally {
      Math.random = real;
    }
  });
});

describe('makeDrill · 弱点を狙えているか', () => {
  test('未踏破の面が必ず出題に含まれる', () => {
    for (const face of ['KeyN:left', 'KeyU:left', 'KeyA:right', 'KeyX:left', 'KeyM:right', 'Slash:left']) {
      const stats = fullStats(100);
      delete stats.faceHits[face];
      const kana = ALL_FACES.find((f) => f.face === face).kana;
      for (let seed = 1; seed <= 5; seed++) {
        const d = makeDrill(stats, { rng: seeded(seed) });
        assert.ok(d.text.includes(kana), `未踏破の ${face}（${kana}）が出ていない: ${d.text}`);
        assert.equal(d.targets[0].face, face);
      }
    }
  });

  test('どの面も必ず出題できる（練習できない面が一つも無い）', () => {
    // 一つの面だけ未踏破にして、その字が本当に出るかを 89 面すべてで見る。
    // ここが抜けると「弱点として検出されるのに一生出題されない面」が生まれ、
    // その人はいつまでも同じ弱点を指摘され続けることになる。
    for (const f of ALL_FACES) {
      const stats = fullStats(100);
      delete stats.faceHits[f.face];
      const d = makeDrill(stats, { rng: seeded(3) });
      assert.ok(d.text.includes(f.kana), `${f.face}（${f.kana}）が出ない: ${d.text}`);
    }
  });

  test('埋めに使える面がまだ少ない人でも、未踏破の面が出る', () => {
    // 全部を3回ずつしか打っていない＝「打てる面」が一つも無い状態。
    // 手持ちのかなが乏しいと、小書きの「ぁ」のように相棒が要る面を置けなくなる。
    // 相棒（「ふぁ」の「ふ」）が手持ちに無いときは、外から一つだけ借りてよい
    for (const f of ALL_FACES) {
      const stats = fullStats(3);
      delete stats.faceHits[f.face];
      const d = makeDrill(stats, { rng: seeded(4) });
      assert.deepEqual(untypable(d.text), []);
      assert.ok(d.text.includes(f.kana), `${f.face}（${f.kana}）が出ない: ${d.text}`);
    }
  });

  test('未踏破が複数あれば全部出る', () => {
    const stats = fullStats(100);
    const faces = ['KeyN:left', 'KeyU:left', 'KeyC:right', 'Period:left'];
    for (const f of faces) delete stats.faceHits[f];
    const d = makeDrill(stats, { rng: seeded(11) });
    for (const f of faces) {
      const kana = ALL_FACES.find((x) => x.face === f).kana;
      assert.ok(d.text.includes(kana), `${f}（${kana}）が出ていない: ${d.text}`);
    }
  });

  test('わざと弱くした面が有意に多く出る', () => {
    const weak = fullStats(100);
    weak.faceMisses = { 'KeyH:left': 50 }; // 「ば」だけミスだらけ
    const flat = fullStats(100);
    let onWeak = 0;
    let onFlat = 0;
    for (let seed = 1; seed <= 40; seed++) {
      onWeak += countOf(makeDrill(weak, { rng: seeded(seed) }).text, 'ば');
      onFlat += countOf(makeDrill(flat, { rng: seeded(seed) }).text, 'ば');
    }
    assert.ok(onWeak >= 40, `弱点なのに出方が薄い: ${onWeak}回/40本`);
    assert.ok(onWeak > onFlat * 3, `弱点でない場合と差が出ていない: ${onWeak} vs ${onFlat}`);
  });

  test('狙った面の割合が 3〜5 割に収まる（統計が十分にあるとき）', () => {
    const stats = fullStats(100);
    stats.faceMisses = { 'KeyH:left': 30, 'KeyO:left': 25, 'KeyV:right': 20 };
    for (const mode of ['weak', 'review']) {
      for (let seed = 1; seed <= 20; seed++) {
        const d = makeDrill(stats, { mode, rng: seeded(seed) });
        const [lo, hi] = DRILL_MODES[mode].share;
        assert.ok(d.targetShare >= lo - 0.08, `${mode}/seed${seed} 薄すぎる: ${d.targetShare}`);
        assert.ok(d.targetShare <= hi + 0.08, `${mode}/seed${seed} 濃すぎる: ${d.targetShare}`);
      }
    }
  });

  test('review は単独・同側・交差を散らす', () => {
    const stats = fullStats(100);
    const d = makeDrill(stats, { mode: 'review', rng: seeded(5) });
    const kinds = new Set(d.targets.map((t) => (t.thumb === 'none' ? 'none' : t.shiftKind)));
    assert.deepEqual([...kinds].sort(), ['cross', 'none', 'same']);
    const hands = new Set(d.targets.map((t) => t.hand));
    assert.equal(hands.size, 2);
  });

  test('speed は未踏破の面を狙わない', () => {
    const stats = fullStats(100);
    for (const f of ['KeyN:left', 'KeyU:left', 'KeyA:right']) delete stats.faceHits[f];
    const d = makeDrill(stats, { mode: 'speed', rng: seeded(5) });
    for (const t of d.targets) assert.ok(stats.faceHits[t.face] > 0, `未踏破を速度稽古で狙っている: ${t.face}`);
  });

  test('speed は擬似語を使わない（語彙と区切りだけで組む）', () => {
    const stats = fullStats(100);
    const d = makeDrill(stats, { mode: 'speed', rng: seeded(8) });
    for (const chunk of d.text.replace(/。$/u, '').split(/[、．・]/u)) {
      if (!chunk) continue;
      assert.ok(VOCAB.includes(chunk), `語彙表に無い断片: ${chunk}`);
    }
  });

  test('recentFaces を渡すと狙いが入れ替わる（同じ一本が続かない）', () => {
    const stats = fullStats(100);
    stats.faceMisses = { 'KeyH:left': 50 };
    const a = makeDrill(stats, { rng: seeded(2) });
    const b = makeDrill(stats, { rng: seeded(2), recentFaces: a.targets.map((t) => t.face) });
    const before = new Set(a.targets.map((t) => t.face));
    const kept = b.targets.filter((t) => before.has(t.face)).length;
    assert.ok(kept <= b.targets.length / 2, `前回と同じ狙いが残りすぎ: ${kept}/${b.targets.length}`);
    assert.notEqual(a.text, b.text);
    // ミスだらけの面は残る。一度出したくらいで本物の弱点を手放さない
    assert.equal(b.targets[0].face, 'KeyH:left');
  });

  test('faces（面ごとの出現数）が文と合っている', () => {
    const d = makeDrill(fullStats(80), { rng: seeded(4) });
    assert.deepEqual(d.faces, faceCountsOfText(d.text));
    const total = Object.values(d.faces).reduce((a, b) => a + b, 0);
    assert.equal(total, d.length); // 全ての字がいずれかの面に対応する
  });
});

// ---------------------------------------------------------------- 文の質
//
// 擬似語が日本語として読めるかを、かなの並びの規則で機械的に見る。
// 読めない字列は「打ち間違えたのか、そもそも変な字なのか」を打ち手が
// 切り分けられなくするので、生成器の質としてここは落とせない。

describe('makeDrill · 生成文の質', () => {
  const I_DAN = new Set(['き', 'し', 'ち', 'に', 'ひ', 'み', 'り', 'ぎ', 'じ', 'ぢ', 'び', 'ぴ']);
  const SMALL_VOWEL_BASE = {
    ぁ: ['ふ', 'ゔ'],
    ぃ: ['て', 'で', 'ふ', 'ゔ'],
    ぅ: ['と', 'ど', 'ゔ'],
    ぇ: ['ち', 'し', 'じ', 'ふ', 'ゔ', 'う'],
    ぉ: ['ふ', 'う', 'ゔ'],
  };

  /** 全モード・全種・いろいろな統計で作った文をまとめて集める */
  const sample = () => {
    const out = [];
    const statsList = [{}, fullStats(2), fullStats(100), (() => {
      const s = fullStats(100);
      for (const f of ['KeyQ:left', 'KeyZ:left', 'Slash:right', 'KeyX:left', 'Semicolon:right', 'KeyA:right'])
        delete s.faceHits[f];
      return s;
    })()];
    for (const stats of statsList) {
      for (const mode of MODES) {
        for (let seed = 1; seed <= 12; seed++) out.push(makeDrill(stats, { mode, rng: seeded(seed) }).text);
      }
    }
    return out;
  };

  test('拗音「ゃゅょ」は い段のかなの直後にしか出ない', () => {
    for (const text of sample()) {
      const cs = [...text];
      cs.forEach((ch, i) => {
        if (!'ゃゅょ'.includes(ch)) return;
        assert.ok(i > 0 && I_DAN.has(cs[i - 1]), `拗音の位置がおかしい: ${text}`);
      });
    }
  });

  test('促音「っ」は語頭・語尾に立たず、母音や「ん」の前に来ない', () => {
    for (const text of sample()) {
      const cs = [...text];
      cs.forEach((ch, i) => {
        if (ch !== 'っ') return;
        const prev = cs[i - 1];
        const next = cs[i + 1];
        assert.ok(prev && !'。、．・っー'.includes(prev), `促音が語頭に立っている: ${text}`);
        assert.ok(next && !'。、．・っーあいうえおん'.includes(next), `促音の後ろがおかしい: ${text}`);
      });
    }
  });

  test('小書きの「ぁぃぅぇぉ」は決まった相棒の直後にしか出ない', () => {
    for (const text of sample()) {
      const cs = [...text];
      cs.forEach((ch, i) => {
        const bases = SMALL_VOWEL_BASE[ch];
        if (!bases) return;
        assert.ok(i > 0 && bases.includes(cs[i - 1]), `小書き母音の位置がおかしい: ${ch} / ${text}`);
      });
    }
  });

  test('長音「ー」は語頭に立たず、続けて二つ出ない', () => {
    for (const text of sample()) {
      const cs = [...text];
      cs.forEach((ch, i) => {
        if (ch !== 'ー') return;
        const prev = cs[i - 1];
        assert.ok(prev && !'。、．・っー'.includes(prev), `長音の位置がおかしい: ${text}`);
      });
    }
  });

  test('区切りが連続しない・冒頭に立たない', () => {
    for (const text of sample()) {
      assert.ok(!/^[。、．・]/u.test(text), `区切りで始まっている: ${text}`);
      assert.ok(!/[。、．・]{2}/u.test(text), `区切りが連続している: ${text}`);
    }
  });

  test('同じ字が三つ以上続かない', () => {
    for (const text of sample()) {
      assert.ok(!/(.)\1\1/u.test(text), `同じ字が続きすぎ: ${text}`);
    }
  });

  test('統計が十分にある人には、実在の語が主体で出る', () => {
    const stats = fullStats(100);
    stats.faceMisses = { 'KeyH:left': 30, 'KeyK:left': 20 };
    for (let seed = 1; seed <= 10; seed++) {
      const text = makeDrill(stats, { rng: seeded(seed) }).text.replace(/。$/u, '');
      const chunks = text.split(/[、．・]/u).filter(Boolean);
      const real = chunks.filter((c) => VOCAB.includes(c)).length;
      assert.ok(real / chunks.length >= 0.6, `擬似語が多すぎる: ${text}`);
    }
  });
});

// ---------------------------------------------------------------- 出題の型

describe('DRILL_MODES', () => {
  test('weak / review / speed が揃っている', () => {
    for (const id of ['weak', 'review', 'speed']) {
      assert.ok(DRILL_MODES[id], `${id} が無い`);
      assert.equal(DRILL_MODES[id].id, id);
      assert.equal(typeof DRILL_MODES[id].name, 'string');
      const [lo, hi] = DRILL_MODES[id].share;
      assert.ok(lo > 0 && lo < hi && hi <= 1);
    }
  });

  test('凍らせてあり、呼び出し側から書き換えられない', () => {
    assert.throws(() => { DRILL_MODES.weak = null; }, TypeError);
    assert.throws(() => { DRILL_MODES.weak.focus = 99; }, TypeError);
  });
});
