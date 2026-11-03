// タイピングゲームのコースと、作業品の値段の付け方。
//
// 数値と算出方法は寿司打（sushida.net）と同じにしてある。違うのは単位（円 → pt）と題材だけ。
// 同じにしているのは、寿司打の記録とそのまま比べられるようにするため。
// 独自の加点（ぴったりの上乗せ等）を足すと比べられなくなるので、点には何も足さない
// （ズレは結果画面に «参考» として出すだけ）。
//
// 調べた元（2026-11-02）。公式の仕様書は無く、どれも遊んだ人の観察から。食い違う所は多数派に合わせた
//   - コース・制限時間・字数: 寿司打 公式サイト / Wikipedia / freesoft-100
//       3,000: 60 秒・2〜7 字 / 5,000: 90 秒・5〜10 字 / 10,000: 120 秒・9〜14 字
//   - 値段と字数: ぱそメモkids「寿司打」と touch-typing.net「お皿の色が変わる意味と値段の法則性」
//       3,000: 2〜4 字 100・5〜6 字 180・7 字 240
//       5,000: 5〜6 字 180・7〜9 字 240・10 字 380
//       10,000: 9 字 240・10〜12 字 380・13〜14 字 500
//   - 出る順: 寿司打は字数が最小から最大まで上がって、また下がる（3,000 なら 2,3,4,5,6,7,6,5,4,3）。
//       一つの字数で 3 枚続く。touch-typing.net の «何枚目に何円の皿が出るか» の表と一致する。
//       ここだけは寿司打と変えた（2026-11-03）。下がる所で途中から簡単になるので、最大まで上がったら
//       最大の字数のまま続ける。そのぶん寿司打より点が出やすく、寿司打の記録とそのままは比べられない
//   - 時間延長（連打メーター）: touch-typing.net「寿司打の時間の法則」とぱそメモkids
//       ミスなしで続けて 28 / 59 / 92 / 130 キーで +1 / +1 / +2 / +3 秒。130 で一周。ミスで 0 に戻る
//   - 点: 取った値段の合計 − コースの値段（お得 / 損）
//   - 流れ方（2026-11-03、寿司打 WebGL 版 2.5 を開いて 0.5 秒ごとに撮って測った）:
//       皿は一度に一枚だけ流れる。左端に現れて右へ流れ、出ていくと次の皿が左端から出る。
//       打ち切ったときも、次の皿はすぐ左端から出る（a〜z を連打して確かめた）。
//       左端に現れてから出ていくまで «普通» 約 6 秒・«練習» 約 11 秒（どのコースも同じ）。
//       紹介記事（shichibu.com・ameblo の高級コース攻略）の «約 6 秒 / 約 11 秒» とも合う。
//       前はここを測らずに 8・10・12 秒とし、作業品を 4〜5 個並べて流していた。先頭はもう出口近くに
//       いるので打てる時間がずっと短く、«3,000 pt なのに流れてくる語が速い» になっていた
//
// コースの id はランキングの鍵になるので変えないこと（p3000 / p5000 / p10000）。
// サーバーの「ありえない値」の上限もここの値から計算される（server/src/core.mjs に同じ値を写してある）。

export const COURSES = [
  {
    id: 'p3000',
    name: '3,000 pt',
    target: 3000,
    timeMs: 60000,
    minLen: 2,
    maxLen: 7,
    prices: [
      { minLen: 2, maxLen: 4, price: 100 },
      { minLen: 5, maxLen: 6, price: 180 },
      { minLen: 7, maxLen: 7, price: 240 },
    ],
  },
  {
    id: 'p5000',
    name: '5,000 pt',
    target: 5000,
    timeMs: 90000,
    minLen: 5,
    maxLen: 10,
    prices: [
      { minLen: 5, maxLen: 6, price: 180 },
      { minLen: 7, maxLen: 9, price: 240 },
      { minLen: 10, maxLen: 10, price: 380 },
    ],
  },
  {
    id: 'p10000',
    name: '10,000 pt',
    target: 10000,
    timeMs: 120000,
    minLen: 9,
    maxLen: 14,
    prices: [
      { minLen: 9, maxLen: 9, price: 240 },
      { minLen: 10, maxLen: 12, price: 380 },
      { minLen: 13, maxLen: 14, price: 500 },
    ],
  },
];

/**
 * 流れる速さ。寿司打の «普通» と «練習» に合わせる。laneMs は作業品が入口に出てから出口を越えるまで。
 * ランキングに送れるのは普通だけ（練習は寿司打の記録とも、ほかの人とも比べられないので）
 */
export const SPEEDS = [
  { id: 'normal', name: '普通', laneMs: 6000 },
  { id: 'practice', name: '練習', laneMs: 11000 },
];

/** 一つの字数の作業品が続けて出る枚数 */
export const SAME_LEN_RUN = 3;

/**
 * そのコースで出る字数の順。最小から最大まで上がる。3,000 なら [2,3,4,5,6,7]。
 * これを SAME_LEN_RUN 枚ずつ出し、最後まで来たら最大の字数のまま続ける（下がらない）
 */
export function lengthRamp(course) {
  const up = [];
  for (let n = course.minLen; n <= course.maxLen; n++) up.push(n);
  return up;
}

/** seq 枚目（0 から）の作業品の字数 */
export function lengthAt(course, seq) {
  const ramp = lengthRamp(course);
  return ramp[Math.min(Math.floor(seq / SAME_LEN_RUN), ramp.length - 1)];
}

/**
 * 作業品一つの値段（pt）。かなの字数で決まる。
 * 知らないコースや表に無い字数なら throw する。0 や NaN を黙って流すと、
 * 「通したのに点が入らない」不具合が値付けの問題に見えてしまう。
 */
export function itemValue(course, word) {
  const len = [...word.kana].length;
  const row = course?.prices?.find((p) => len >= p.minLen && len <= p.maxLen);
  if (!row) throw new Error(`値段の表に無い: コース ${course?.id}・${len} 字`);
  return row.price;
}

/**
 * 連打メーター。ミスなしで続けて正しく打ったキーの数が keys に届くたびに ms だけ時間が延びる。
 * 最後の段（130）で一周して 0 から数え直す。ミスで 0 に戻る。
 * キーは «実際に押したキー»: 親指シフトは一字 1 キー、ローマ字は綴りのキーの数
 */
export const METER_STEPS = Object.freeze([
  Object.freeze({ keys: 28, ms: 1000 }),
  Object.freeze({ keys: 59, ms: 1000 }),
  Object.freeze({ keys: 92, ms: 2000 }),
  Object.freeze({ keys: 130, ms: 3000 }),
]);
