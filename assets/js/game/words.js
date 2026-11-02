// タイピングゲーム（題材は検品ライン）の作業品に付ける語。
//
// このファイルは何か
//   練習の課題（lessons.js）の文を句読点で区切り、親指を使う字を含む語だけを拾って出題の表にする。
//   語の表を別に書いて持たない。課題の文が増えれば、ここも勝手に増える。
//   長さはコースが決める（courses.js の minLen〜maxLen。engine.js がその帯で絞る）。
//
// なぜ親指を使う字を含む語だけなのか
//   ぴったりの上乗せは親指を使う字でしか取れない。単独打鍵だけの語では、
//   親指シフトの人には上乗せの伸ばしどころが無い。
//
// 拾う元は «実際の文» だけ
//   第一課〜第三課・第六課の課題には「ぁぇぉ」「ぎぐぢづばどぞぼ」のような面を覚えるための並びがある。
//   語として読めないものを出すと、指が止まる原因が配列ではなく «読めないこと» になる。
//   だから語・文章・速度の課題と、実文（TEXTS）からだけ拾う。

import { LESSONS, TEXTS } from '../lessons.js';
import { keyFor } from './engine.js';

/** 拾う語の長さ（かなの字数）。コースの帯（2〜7 / 5〜10 / 9〜14）を全部覆う */
export const MIN_LEN = 2;
export const MAX_LEN = 14;

/** 親指を使う字がこれ以上ある語だけを出す */
export const MIN_SHIFTED = 1;

/** 拾う元の課題。面を覚えるための並び（basic / dakuten / cross / timing）は入れない */
const SOURCE_COURSES = new Set(['words', 'sentence', 'speed', 'texts']);

const SPLIT = /[、。，．\s「」『』！？・（）]+/u;

/** 一語の同時打鍵の字数。配列に無い字が一つでもあれば null（その語は打ち切れない） */
export function shiftedCount(kana) {
  let n = 0;
  for (const c of kana) {
    const how = keyFor(c);
    if (!how) return null;
    if (how.thumb) n++;
  }
  return n;
}

function collect() {
  const texts = [
    ...LESSONS.filter((l) => SOURCE_COURSES.has(l.courseId)).map((l) => l.text),
    ...TEXTS.map((t) => t.text),
  ];
  const seen = new Set();
  const out = [];
  for (const text of texts) {
    for (const kana of String(text ?? '').split(SPLIT)) {
      const len = [...kana].length;
      if (len < MIN_LEN || len > MAX_LEN || seen.has(kana)) continue;
      const sh = shiftedCount(kana);
      if (sh == null || sh < MIN_SHIFTED) continue;
      seen.add(kana);
      out.push(Object.freeze({ kana, shifted: sh }));
    }
  }
  // 拾えた語が少なすぎるのは課題データの誤り。黙って少ない表で遊ばせない
  if (out.length < 100) throw new Error(`words.js: 出題に使える語が ${out.length} 語しか無い`);
  return Object.freeze(out);
}

/** [{ kana, shifted }]。shifted はその語の同時打鍵の字数 */
export const WORDS = collect();
