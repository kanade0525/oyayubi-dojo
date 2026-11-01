// 図の共通部品。SVG の組み立てと、ホバー・フォーカスで数値を出す小窓。
//
// 図は SVG で描く（canvas にしない）。印の一つ一つが要素になるので、
// ホバーとキーボードのフォーカスをそのまま載せられ、画面読み上げにも名前を渡せる。
// innerHTML は使わない（CSP と XSS の流儀）。文字は全部 textContent で入れる。
//
// 色は viz.css の --viz-* を名前で引く。図の中に生の色を書かない。
// 配色を変えるときは viz.css 一か所で済むようにするため。

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG 要素を作る。attrs の値が null / undefined の属性は付けない */
export function svg(tag, attrs = {}, ...children) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    n.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

/** HTML 要素を作る。文字は textContent で入る */
export function html(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

/** CSS 変数の値を読む。配色（data-tone）で変わるものを図に渡すとき用 */
export function token(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(`--${name}`).trim();
}

// ---------------------------------------------------------------- 小窓

let tipEl = null;

function tip() {
  if (tipEl) return tipEl;
  tipEl = html('div', { class: 'viz-tip', role: 'status', 'aria-live': 'polite' });
  tipEl.hidden = true;
  document.body.append(tipEl);
  return tipEl;
}

/**
 * 小窓を出す。lines の一行目は見出し（太字）、残りは «名前 値» の組か一行の文。
 * x, y は画面（viewport）座標。小窓が画面からはみ出さないよう内側に寄せる。
 */
export function showTip(x, y, lines) {
  const t = tip();
  const rows = lines.map((l, i) => {
    if (Array.isArray(l)) return html('div', { class: 'viz-tip__row' }, html('span', {}, l[0]), html('b', {}, l[1]));
    return html('div', { class: i === 0 ? 'viz-tip__head' : 'viz-tip__note' }, l);
  });
  t.replaceChildren(...rows);
  t.hidden = false;
  const r = t.getBoundingClientRect();
  const pad = 12;
  let left = x + pad;
  let top = y + pad;
  if (left + r.width > innerWidth - 8) left = x - r.width - pad;
  if (top + r.height > innerHeight - 8) top = y - r.height - pad;
  t.style.left = `${Math.max(8, left)}px`;
  t.style.top = `${Math.max(8, top)}px`;
}

export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

/**
 * 印（mark）に小窓を結びつける。マウスでもキーボード（Tab で印に止まる）でも出る。
 * lines は出す瞬間に作る関数でもよい。aria-label には一行にまとめた文を入れる
 */
export function bindTip(mark, lines) {
  const get = () => (typeof lines === 'function' ? lines() : lines);
  mark.setAttribute('tabindex', '0');
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', get().map((l) => (Array.isArray(l) ? `${l[0]} ${l[1]}` : l)).join('、'));
  mark.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, get()));
  mark.addEventListener('pointerleave', hideTip);
  mark.addEventListener('focus', () => {
    const r = mark.getBoundingClientRect();
    showTip(r.right, r.top, get());
  });
  mark.addEventListener('blur', hideTip);
}

// 画面を動かしたら小窓は消す。印から離れた所に浮いたまま残るのが一番紛らわしい
// Node のテストから import されても落ちないよう、window が無ければ何もしない
globalThis.addEventListener?.('scroll', hideTip, { passive: true });
