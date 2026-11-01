// 得意・苦手の柱（assets/js/iso.js）の数字の検査。描画ではなく、どのキーを何色に塗るかを見る。
//
// 図は «平均と比べた倍率» で塗る。ここが狂うと、苦手を得意と言う図になり、
// しかも見た目には何の異常も出ない。だから計算を描画から切り離して確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLayout } from '../assets/js/layout.js';
import { isoData, levelOf, rankKeys, LOW_HITS } from '../assets/js/iso.js';
import { missRateOf } from '../assets/js/drill.js';

const layout = loadLayout('nicola');

/** 全キーの単独面を同じだけ打ち、指定したキーだけミスを足した記録 */
function statsWith(misses = {}, hits = 100) {
  const faceHits = {};
  const faceMisses = {};
  for (const code of Object.keys(layout.keys)) faceHits[`${code}:none`] = hits;
  for (const [face, n] of Object.entries(misses)) faceMisses[face] = n;
  return { faceHits, faceMisses };
}

test('配列の 30 キーが 3 段 × 10 で並ぶ', () => {
  const d = isoData(layout, statsWith(), 'all');
  assert.equal(d.keys.length, 30);
  assert.deepEqual([...new Set(d.keys.map((k) => k.row))], [0, 1, 2]);
  // 下の段ほど右へずれる（実物のキーボードと同じ）
  const first = (r) => d.keys.find((k) => k.row === r).x;
  assert.ok(first(0) < first(1) && first(1) < first(2));
});

test('ミスの多いキーは苦手（赤）、少ないキーは得意（青）、並みは灰', () => {
  const d = isoData(layout, statsWith({ 'KeyJ:none': 20, 'KeyF:none': 3 }), 'none');
  const by = (c) => d.keys.find((k) => k.code === c);
  assert.match(by('KeyJ').level, /^b/);
  assert.match(by('KeyA').level, /^g/); // ミス 0 は平均より外していない
  assert.ok(by('KeyJ').ratio > by('KeyF').ratio);
});

test('倍率は «自分の平均» と比べる。全キーが同じだけ外していれば全部が平均並み', () => {
  const misses = {};
  for (const code of Object.keys(layout.keys)) misses[`${code}:none`] = 5;
  const d = isoData(layout, statsWith(misses), 'none');
  for (const k of d.keys) {
    assert.equal(k.level, 'mid', `${k.code} が ${k.level}`);
    assert.ok(Math.abs(k.ratio - 1) < 0.05);
  }
});

test('ミス率は drill.js と同じ式（出題と図で物差しを揃える）', () => {
  const d = isoData(layout, statsWith({ 'KeyK:none': 7 }), 'none');
  const k = d.keys.find((x) => x.code === 'KeyK');
  assert.equal(k.rate, missRateOf(100, 7));
});

test('打った数が少ない面は言い切らない（灰・low）', () => {
  const s = { faceHits: { 'KeyJ:none': LOW_HITS - 1, 'KeyF:none': 200 }, faceMisses: { 'KeyJ:none': LOW_HITS - 1 } };
  const d = isoData(layout, s, 'none');
  const j = d.keys.find((k) => k.code === 'KeyJ');
  assert.equal(j.low, true);
  assert.equal(j.level, 'mid');
  assert.equal(rankKeys(d).worst.some((k) => k.code === 'KeyJ'), false);
});

test('一度も打っていないキーは none（平均並みの灰と混ぜない）', () => {
  const d = isoData(layout, { faceHits: { 'KeyJ:none': 50 }, faceMisses: {} }, 'none');
  assert.equal(d.keys.find((k) => k.code === 'KeyQ').level, 'none');
});

test('面の切り替え：左親指を選ぶと左親指の面だけを数え、字も左親指の字になる', () => {
  const s = { faceHits: { 'KeyJ:none': 100, 'KeyJ:left': 30 }, faceMisses: { 'KeyJ:left': 9 } };
  const left = isoData(layout, s, 'left').keys.find((k) => k.code === 'KeyJ');
  assert.equal(left.hits, 30);
  assert.equal(left.misses, 9);
  assert.equal(left.kana, layout.keys.KeyJ.left);
  const all = isoData(layout, s, 'all').keys.find((k) => k.code === 'KeyJ');
  assert.equal(all.hits, 130);
  assert.equal(all.faces.length, 3);
});

test('段階の境目', () => {
  assert.equal(levelOf(0.4), 'g3');
  assert.equal(levelOf(0.8), 'g1');
  assert.equal(levelOf(1), 'mid');
  assert.equal(levelOf(1.3), 'b1');
  assert.equal(levelOf(1.9), 'b2');
  assert.equal(levelOf(5), 'b3');
  assert.equal(levelOf(Number.NaN), 'mid');
});

test('知らない面を渡したら止める（黙って全部 0 の図を出さない）', () => {
  assert.throws(() => isoData(layout, statsWith(), 'both'));
});

test('苦手・得意の上位は、言い切れる面だけを倍率順に', () => {
  const d = isoData(layout, statsWith({ 'KeyJ:none': 30, 'KeyK:none': 15, 'KeyL:none': 8 }), 'none');
  const { worst } = rankKeys(d);
  assert.deepEqual(worst.map((k) => k.code).slice(0, 3), ['KeyJ', 'KeyK', 'KeyL']);
});
