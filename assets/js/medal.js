// 実績のメダル。記録画面の一覧と、取った瞬間の通知で同じ物を使う。
//
// ゲームの実績（アチーブメント）の見せ方に合わせてある。
//   ・格で金属の色が変わる（銅・銀・金・白金）。格は trophies.js の tier
//   ・中の絵は系統で決まる（習得＝キー、継続＝炎、精度＝的、速度＝稲妻、タイミング＝ストップウォッチ、皆伝＝冠）
//   ・取っていないものは暗い円に絵の影だけ、右下に錠前。何を取れば開くかの文は横に出す
// 色は金属の色なので配色（data-tone）に関わらず固定。CSS（app.css の .medal）が持つ。

import { svg } from './viz.js';

/** 系統 → 絵（24×24 の道）。線ではなく面で描く。小さく出しても形が潰れないように */
const ICONS = {
  mastery: [
    ['path', { d: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 15.5z' }],
    ['path', { d: 'M8 7h8v6.5H8z', class: 'medal__cut' }],
    ['path', { d: 'M6 19.5h12v1.5H6z' }],
  ],
  streak: [
    ['path', { d: 'M12.5 2.5c.6 3.4 4.8 5.6 4.8 10.6a5.3 5.3 0 0 1-10.6 0c0-2.8 1.7-4.4 2.4-6.6 1 1 1.6 2.3 1.6 3.9 1.6-2 2.3-4.8 1.8-7.9z' }],
  ],
  accuracy: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['circle', { cx: 12, cy: 12, r: 6, class: 'medal__cut' }],
    ['circle', { cx: 12, cy: 12, r: 3.4 }],
  ],
  speed: [
    ['path', { d: 'M13.5 2 4.5 13.5h6.2L9.5 22l10-12.5h-6.4z' }],
  ],
  timing: [
    ['path', { d: 'M10 2h4v2h-4z' }],
    ['circle', { cx: 12, cy: 13.5, r: 8 }],
    ['circle', { cx: 12, cy: 13.5, r: 5.8, class: 'medal__cut' }],
    ['path', { d: 'M11.2 9h1.6v5.2l3 1.8-.8 1.3-3.8-2.3z' }],
  ],
  crown: [
    ['path', { d: 'M3 8.5l4.6 4 4.4-7 4.4 7 4.6-4-1.8 10.5H4.8z' }],
    ['path', { d: 'M4.8 20h14.4v1.6H4.8z' }],
  ],
};

const LOCK = [
  ['path', { d: 'M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10h-2V7.5a1.5 1.5 0 0 0-3 0V10z' }],
  ['path', { d: 'M6.5 10h11v9h-11z' }],
];

function draw(parts, cls) {
  return svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    parts.map(([tag, attrs]) => svg(tag, attrs)));
}

/**
 * メダル一つ。got が false なら錠前付きの暗い円。
 * @param {{category:string, tier:string}} trophy
 * @param {{got?:boolean, size?:'l'|'s'}} opts
 */
export function medal(trophy, { got = false, size = 'l' } = {}) {
  const icon = ICONS[trophy.category];
  if (!icon) throw new Error(`実績の系統 ${trophy.category} の絵が medal.js に無い`);
  const m = document.createElement('span');
  m.className = `medal medal--${size}`;
  m.dataset.tier = trophy.tier;
  m.dataset.got = got ? '1' : '0';
  m.append(draw(icon, 'medal__icon'));
  if (!got) m.append(draw(LOCK, 'medal__lock'));
  return m;
}
