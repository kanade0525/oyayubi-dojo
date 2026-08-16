// 配列表の引き当て。
//
// 「どちらの親指を沈めたか」から「どのかなが出るか」を決めるだけの薄い層。
// 同時打鍵の判定そのものは nicola.js が持っていて、こちらは配列を知っているだけ。
// 分けてあるのは、月配列・新下駄配列・薙刀式のような他の同時打鍵系かな配列に
// 差し替えられるようにするため。nicola.js は配列を知らない。
//
// fetch は使わない。配列表は JS モジュールとして import する（理由は data/nicola.js に書いた）。

import { NICOLA } from '../data/nicola.js';

/**
 * 配列表を読む。
 * 名前で選べるようにしてあるのは、後から配列を足したときに呼び出し側を変えずに済むため。
 */
export function loadLayout(name = 'nicola') {
  if (name !== 'nicola') throw new Error(`知らない配列です: ${name}`);
  return NICOLA;
}

/**
 * 同側シフトか交差シフトかを決める。
 *
 * 規格 §5.3 は「左領域のキーに対して親指右を、右領域のキーに対して親指左を同時打けん
 * すると（中略）主として濁音又は半濁音の入力に用いる」としている。
 * つまり *交差* が濁音側。ここを取り違えると学習者に逆を教えることになる。
 */
export function shiftKindOf(hand, thumb) {
  if (!thumb) return null;
  return hand === thumb ? 'same' : 'cross';
}

/**
 * 文字キーと親指から、出るかなを引く。
 *
 * 引けなければ null を返す。**例外は投げない。**
 * 未知のキーは打ち間違いとして普通に起きるので、そのたびに throw されると
 * 呼び出し側が全部 try で包むことになる。
 */
export function lookup(layout, charCode, thumb) {
  const key = layout?.keys?.[charCode];
  if (!key) return null;

  const kana = thumb ? key[thumb] : key.none;
  if (!kana) return null;

  return { kana, shiftKind: shiftKindOf(key.hand, thumb) };
}

/** キーが左右どちらの領域か。キーボード図の色分けに使う */
export function handOf(layout, charCode) {
  return layout?.keys?.[charCode]?.hand ?? null;
}

/** その code が親指キーなら 'left' | 'right'、違えば null */
export function thumbSideOf(thumbKeys, code) {
  if (thumbKeys?.left?.includes(code)) return 'left';
  if (thumbKeys?.right?.includes(code)) return 'right';
  return null;
}
