#!/usr/bin/env node
/*
 * ゲーム「回転ずし」の題材（assets/js/game/words.js）とコース（assets/js/game/courses.js）の検査。
 *
 * なぜこの検査が要るか。
 *
 * (1) 打てない字が一つ混ざった語は、ゲームの中では «永久に取れない皿» になる。
 *     画面は普通に動き、皿は流れて取り逃しに数えられるだけなので、誰も壊れていると気づかない。
 *     落ちるのは遊んでいる人の気分だけ。だから全語の全字を、本物の配列表
 *     （layout.js の loadLayout('nicola') の三面）に照らして機械で確かめる。
 *     字の集合をここに書き写さないのは、写しが配列表とずれたら検査ごと嘘になるから。
 *
 * (2) 長さの帯ごとに 40 語以上（CONTRACT.md）。少ないと同じ皿ばかり流れて飽きる。
 *     帯は契約の 2〜4 / 3〜7 / 5〜12 と、実際の各コースの minLen..maxLen の両方で数える。
 *     コースの帯を企画が動かしたときに、そのコースだけ語が足りなくなるのを捕まえるため。
 *
 * (3) コースの id はランキングの鍵になる（サーバーが course= で引く）。
 *     名前を変えると過去の記録が別のコースのものとして宙に浮くので、三つの id を固定で見る。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const WORDS_PATH = join(ROOT, 'assets/js/game/words.js');
const COURSES_PATH = join(ROOT, 'assets/js/game/courses.js');
const LAYOUT_PATH = join(ROOT, 'assets/js/layout.js');

const load = async (p) => {
  try {
    return { mod: await import(pathToFileURL(p).href), error: null };
  } catch (e) {
    return { mod: null, error: e };
  }
};
const words = await load(WORDS_PATH);
const courses = await load(COURSES_PATH);
const layoutMod = await load(LAYOUT_PATH);

function need(got, path, what) {
  if (got.error) assert.fail(`${path} を読み込めない。まだ実装されていない。\n    要るもの : ${what}\n    実際の理由: ${got.error.message}`);
}
function readyWords() {
  need(words, WORDS_PATH, 'export const WORDS = [ { kana, label }, ... ]');
  need(layoutMod, LAYOUT_PATH, 'export function loadLayout(name)');
  assert.ok(Array.isArray(words.mod.WORDS), 'words.js が WORDS を配列で export していない');
  assert.ok(words.mod.WORDS.length > 0, 'WORDS が空');
  return words.mod.WORDS;
}
function readyCourses() {
  need(courses, COURSES_PATH, 'export const COURSES / plateValue / PERFECT_BONUS / COMBO_STEP / COMBO_TIME_BONUS_MS');
  assert.ok(Array.isArray(courses.mod.COURSES), 'courses.js が COURSES を配列で export していない');
  return courses.mod.COURSES;
}

/** 配列表の三面（無シフト・左親指・右親指）に現れる字の集合 */
function typable() {
  const layout = layoutMod.mod.loadLayout('nicola');
  const set = new Set();
  for (const k of Object.values(layout.keys)) {
    for (const face of ['none', 'left', 'right']) if (k[face]) set.add(k[face]);
  }
  assert.ok(set.size > 50, `配列表から字が ${set.size} 個しか取れない（形が変わった？ 検査が空振りしている）`);
  return set;
}

const len = (kana) => [...kana].length;

// 契約（CONTRACT.md の words.js の節）の帯
const BANDS = [
  [2, 4],
  [3, 7],
  [5, 12],
];
const MIN_PER_BAND = 40;

describe('words.js', () => {
  test('全語に kana と label があり、どちらも空でない文字列', () => {
    const bad = readyWords().filter(
      (w) => !w || typeof w.kana !== 'string' || !w.kana.trim() || typeof w.label !== 'string' || !w.label.trim()
    );
    assert.deepEqual(bad, [], `kana / label が欠けている語: ${JSON.stringify(bad.slice(0, 10))}`);
  });

  test('全語の全字が NICOLA 配列で打てる', () => {
    const ok = typable();
    const bad = [];
    for (const w of readyWords()) {
      const miss = [...(w.kana ?? '')].filter((ch) => !ok.has(ch));
      if (miss.length) bad.push(`${w.kana}（${w.label}）: ${[...new Set(miss)].join(' ')}`);
    }
    assert.deepEqual(bad, [], `NICOLA 配列で打てない字を含む語が ${bad.length} 語:\n    ${bad.join('\n    ')}`);
  });

  test('検査の検査: 打てない字（カタカナ・漢字・空白）を確かに拾う', () => {
    readyWords();
    const ok = typable();
    for (const ch of ['マ', '鮪', ' ', 'a', 'ゐ']) assert.ok(!ok.has(ch), `「${ch}」が打てる字に入っている（集合の作り方が壊れている）`);
    for (const ch of ['ま', 'ぐ', 'ろ', 'ぱ', 'ー', 'ゃ', 'っ']) assert.ok(ok.has(ch), `「${ch}」が打てる字に入っていない`);
  });

  for (const [lo, hi] of BANDS) {
    test(`長さ ${lo}〜${hi} の語が ${MIN_PER_BAND} 語以上`, () => {
      const n = readyWords().filter((w) => len(w.kana) >= lo && len(w.kana) <= hi).length;
      assert.ok(n >= MIN_PER_BAND, `長さ ${lo}〜${hi} の語が ${n} 語（${MIN_PER_BAND} 語以上要る）`);
    });
  }
});

describe('courses.js', () => {
  test('コースは otegaru / osusume / koukyu の三つちょうど（ランキングの鍵）', () => {
    const ids = readyCourses().map((c) => c?.id);
    assert.deepEqual([...ids].sort(), ['koukyu', 'osusume', 'otegaru']);
  });

  test('各コースに必須の鍵があり、値の型と範囲が正しい', () => {
    for (const c of readyCourses()) {
      const at = `コース ${c.id}`;
      assert.ok(typeof c.name === 'string' && c.name.trim(), `${at} の name`);
      for (const k of ['price', 'timeMs', 'laneMs', 'minLen', 'maxLen']) {
        assert.ok(Number.isFinite(c[k]) && c[k] > 0, `${at} の ${k} が正の数でない（${c[k]}）`);
      }
      assert.ok(Number.isInteger(c.minLen) && Number.isInteger(c.maxLen), `${at} の minLen / maxLen が整数でない`);
      assert.ok(c.minLen <= c.maxLen, `${at} の minLen ${c.minLen} > maxLen ${c.maxLen}`);
    }
  });

  test('定数 PERFECT_BONUS / COMBO_STEP / COMBO_TIME_BONUS_MS が正の数、plateValue が関数', () => {
    readyCourses();
    for (const k of ['PERFECT_BONUS', 'COMBO_STEP', 'COMBO_TIME_BONUS_MS']) {
      assert.ok(Number.isFinite(courses.mod[k]) && courses.mod[k] > 0, `${k} が正の数でない（${courses.mod[k]}）`);
    }
    assert.ok(Number.isInteger(courses.mod.COMBO_STEP), 'COMBO_STEP が整数でない');
    assert.equal(typeof courses.mod.plateValue, 'function');
  });

  test('各コースの長さ帯に、使える語が 40 語以上ある', () => {
    const list = readyWords();
    for (const c of readyCourses()) {
      const n = list.filter((w) => len(w.kana) >= c.minLen && len(w.kana) <= c.maxLen).length;
      assert.ok(n >= MIN_PER_BAND, `コース ${c.id}（${c.minLen}〜${c.maxLen}）に使える語が ${n} 語`);
    }
  });

  test('plateValue は帯の中の全語に正の整数（円）を返し、値段は長さだけで決まる（同じ長さなら同じ値段）', () => {
    const list = readyWords();
    for (const c of readyCourses()) {
      const byLen = new Map();
      for (const w of list.filter((w) => len(w.kana) >= c.minLen && len(w.kana) <= c.maxLen)) {
        const v = courses.mod.plateValue(c, w);
        assert.ok(Number.isInteger(v) && v > 0, `コース ${c.id} の「${w.kana}」の値段が ${v}`);
        const n = len(w.kana);
        if (!byLen.has(n)) byLen.set(n, { v, kana: w.kana });
        const first = byLen.get(n);
        assert.equal(v, first.v, `コース ${c.id} で同じ ${n} 字の「${first.kana}」と「${w.kana}」の値段が違う`);
      }
    }
  });
});
