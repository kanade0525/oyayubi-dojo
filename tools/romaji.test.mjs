#!/usr/bin/env node
/*
 * ローマ字入力の判定（assets/js/romaji.js）の検査。
 *
 * 綴りの揺れを受けるか、拗音・促音・撥音の塊を正しく数えるか、
 * 出題に使う字が全部ローマ字で打てるかを見る。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRomaji, spellingsAt, canType, romajiKeyOf } from '../assets/js/romaji.js';
import { TEXTS } from '../assets/js/lessons.js';
import { WORDS } from '../assets/js/game/words.js';

/** keys を順に打って、最後まで打ち切れたか・ミスの数を返す */
function typeAll(text, keys) {
  const chars = [...text];
  const r = createRomaji();
  let pos = 0;
  let miss = 0;
  for (const k of keys) {
    if (pos >= chars.length) break;
    const res = r.press(chars, pos, k);
    if (!res.ok) miss++;
    pos += res.done;
  }
  return { done: pos === chars.length, pos, miss, buffer: r.buffer };
}

test('綴りの揺れを受ける', () => {
  for (const [text, keys] of [
    ['し', 'shi'], ['し', 'si'], ['し', 'ci'],
    ['つ', 'tsu'], ['つ', 'tu'], ['ふ', 'fu'], ['ふ', 'hu'],
    ['じ', 'ji'], ['じ', 'zi'], ['ち', 'chi'], ['ち', 'ti'],
    ['を', 'wo'], ['ー', '-'], ['、。', ',.'],
  ]) {
    assert.deepEqual(typeAll(text, keys), { done: true, pos: [...text].length, miss: 0, buffer: '' }, `${text} を ${keys}`);
  }
});

test('拗音は二字の塊で、一字ずつも打てる', () => {
  assert.equal(typeAll('しゃ', 'sha').done, true);
  assert.equal(typeAll('しゃ', 'sya').done, true);
  assert.equal(typeAll('しゃ', 'shixya').done, true);
  assert.equal(typeAll('ちょ', 'cho').done, true);
  assert.equal(typeAll('ちょ', 'tyo').done, true);
  assert.equal(typeAll('じゅ', 'ju').done, true);
  assert.equal(typeAll('じゅ', 'jyu').done, true);
  assert.equal(typeAll('ふぁ', 'fa').done, true);
});

test('促音は次の子音を重ねるか、xtu で打つ', () => {
  assert.equal(typeAll('きって', 'kitte').done, true);
  assert.equal(typeAll('きって', 'kixtute').done, true);
  assert.equal(typeAll('まっちゃ', 'maccha').done, true);
  assert.equal(typeAll('まっちゃ', 'matcha').done, true);
  assert.equal(typeAll('まっちゃ', 'mattya').done, true);
  // 母音は重ねられない
  assert.equal(typeAll('っあ', 'aa').miss > 0, true);
});

test('撥音：次が子音なら n 一つ、母音・y・n の前と末尾は nn', () => {
  assert.equal(typeAll('かんじ', 'kanji').done, true);
  assert.equal(typeAll('かんじ', 'kannji').done, true);
  // 「かんい」を kani と打つと「かに」で外れる
  const r = typeAll('かんい', 'kani');
  assert.equal(r.done, false);
  assert.ok(r.miss > 0);
  assert.equal(typeAll('かんい', 'kanni').done, true);
  assert.equal(typeAll('ほんや', 'honnya').done, true);
  assert.equal(typeAll('ほんや', 'honya').done, false);
  // 末尾の n 一つでは終わらない
  assert.deepEqual(typeAll('ほん', 'hon'), { done: false, pos: 1, miss: 0, buffer: 'n' });
  assert.equal(typeAll('ほん', 'honn').done, true);
});

test('合わない字はミスにして、打ちかけの綴りは残す', () => {
  const chars = [...'か'];
  const r = createRomaji();
  assert.deepEqual(r.press(chars, 0, 'k'), { ok: true, done: 0 });
  assert.deepEqual(r.press(chars, 0, 'q'), { ok: false, done: 0 });
  assert.equal(r.buffer, 'k');
  assert.deepEqual(r.press(chars, 0, 'a'), { ok: true, done: 1 });
});

test('案内は打ちかけの綴りの続きを返す', () => {
  const chars = [...'しゃしん'];
  const r = createRomaji();
  assert.deepEqual(r.hint(chars, 0), { typed: '', rest: 'sha', n: 2 });
  r.press(chars, 0, 's');
  r.press(chars, 0, 'y');
  assert.deepEqual(r.hint(chars, 0), { typed: 'sy', rest: 'a', n: 2 });
});

test('ローマ字の一字だけをキーから取り出す', () => {
  assert.equal(romajiKeyOf('A'), 'a');
  assert.equal(romajiKeyOf('-'), '-');
  assert.equal(romajiKeyOf('Shift'), null);
  assert.equal(romajiKeyOf('1'), null);
});

// ローマ字で打てるのは鍛えるの実文とゲームの語。覚えるのレッスンは親指シフトだけで打つ
test('出題に使う字は全部ローマ字で打てる', () => {
  const all = new Set();
  for (const l of TEXTS) for (const c of l.text) all.add(c);
  for (const w of WORDS) for (const c of w.kana) all.add(c);
  const bad = [...all].filter((c) => !canType(c));
  assert.deepEqual(bad, []);
});

test('実文とタイピングゲームの語は、案内どおりに打てば最後まで打ち切れる', () => {
  for (const text of [...TEXTS.map((l) => l.text), ...WORDS.map((w) => w.kana)]) {
    const chars = [...text];
    const r = createRomaji();
    let pos = 0;
    let guard = 0;
    while (pos < chars.length) {
      const h = r.hint(chars, pos);
      assert.ok(h, `${text} の ${pos} 字目に案内が無い`);
      const res = r.press(chars, pos, h.rest[0]);
      assert.equal(res.ok, true, `${text} の ${pos} 字目で案内の字が受からない`);
      pos += res.done;
      if (++guard > chars.length * 6) assert.fail(`${text} が終わらない`);
    }
    assert.equal(spellingsAt(chars, pos).length, 0);
  }
});
