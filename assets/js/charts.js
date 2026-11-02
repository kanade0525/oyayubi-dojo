// 記録画面の図 3 枚：伸び・ズレの分布・練習した日
// ================================================================
// このファイルは何か
//   stats（storage.js）の history / offset / daily を受け取って、SVG の図を組み立てる。
//   置き場所（container）の中身は毎回 replaceChildren で作り直す。何度呼んでもよい。
//
// なぜこの方針か
//   1. 単位の違う量を一枚に重ねない。速さ（CPM）・ぴったり率（%）・平均ズレ（ms）は
//      小さな図を縦に 3 枚並べ、横軸（何本目）だけを揃える。縦軸が二本ある図は、
//      目盛りの合わせ方しだいで «関係があるように» 見せられてしまう。
//   2. 図の大きさは置き場所の実寸（px）で決める。viewBox で伸縮させると、
//      狭い画面で目盛りの字が 7px まで縮んで読めなくなる。幅が変わったら描き直す。
//   3. 色は全部 charts.css で class に当てる。ここには生の色を書かない
//      （配色 data-tone を替えたときに CSS だけで追従させるため）。
//   4. 印の一つ一つに Tab を止めると、カレンダーだけで 365 回 Tab を押すことになる。
//      図ごとに Tab の止まり所は一つにして、中は矢印キーで動く（roving tabindex）。
//   5. 数値は小窓だけに閉じ込めない。最初・最新の値、平均、合計は図の上に字で出す。
//
// 契約
//   export function renderTrend(container, history)
//   export function renderOffsetHist(container, offset)
//   export function renderCalendar(container, daily, today)
//   export function renderScope(container, offset)   入口の計器（左右を合わせた ±60ms）

import { svg, html, showTip, hideTip } from './viz.js';
import { OFFSET_BINS, OFFSET_BIN_MS, OFFSET_RANGE_MS, offsetBinRange, offsetSummary } from './trophies.js';
import { THRESHOLDS } from './meter.js';

const EMPTY_TEXT = 'まだ記録がありません';

// ---------------------------------------------------------------- 小道具

/** 幅が変わったら描き直す。container ごとに監視は一つだけ（何度呼ばれても増やさない） */
const watchers = new WeakMap();
function redrawOnResize(container, draw) {
  let w = watchers.get(container);
  if (!w) {
    w = { draw, width: container.clientWidth, ro: null };
    w.ro = new ResizeObserver(() => {
      const now = container.clientWidth;
      if (now === w.width) return; // 高さだけの変化（自分で描いた結果）では描き直さない
      w.width = now;
      w.draw();
    });
    w.ro.observe(container);
    watchers.set(container, w);
  }
  w.draw = draw;
  w.width = container.clientWidth;
}

/** 置き場所の実寸。まだ画面に出ていない（display:none の）ときは 0 になるので、描ける幅を仮に置く */
function widthOf(container, fallback) {
  const w = container.clientWidth;
  return w > 0 ? w : fallback;
}

/** 目盛りのきりの良い刻み */
function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

const fmtInt = (v) => Math.round(v).toLocaleString('ja-JP');
/** 符号付き ms。負号は全角の «−» にする（ハイフンだと字面が短すぎて読み落とす） */
function fmtMs(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  const r = Number(v.toFixed(digits));
  if (r === 0) return `0ms`;
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(digits)}ms`;
}
function offsetWord(ms) {
  if (ms == null || Number.isNaN(ms)) return '';
  if (Math.abs(ms) < 3) return 'ほぼ同時';
  return ms < 0 ? '親指が先行' : '親指が遅れ';
}
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
function dayKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dateLabel(d) {
  return `${dayKey(d)}（${WEEK[d.getDay()]}）`;
}

function emptyNote(text = EMPTY_TEXT) {
  return html('p', { class: 'chart-empty' }, text);
}

/**
 * Tab の止まり所を一つにして、矢印キーで印の間を動く。
 * marks: 印の要素の配列。lines(i): 小窓の中身。step(i, key): 次の番号（動かないなら null）。
 * 印にはマウスでも同じ小窓が出る。
 */
function roving(marks, lines, step, start = marks.length - 1) {
  let cur = Math.max(0, Math.min(marks.length - 1, start));
  const label = (i) => lines(i).map((l) => (Array.isArray(l) ? `${l[0]} ${l[1]}` : l)).join('、');
  marks.forEach((m, i) => {
    m.setAttribute('tabindex', i === cur ? '0' : '-1');
    m.setAttribute('role', 'img');
    m.setAttribute('aria-label', label(i));
    m.addEventListener('pointermove', (e) => {
      m.classList.add('is-hot');
      showTip(e.clientX, e.clientY, lines(i));
    });
    m.addEventListener('pointerleave', () => {
      m.classList.remove('is-hot');
      hideTip();
    });
    m.addEventListener('focus', () => {
      cur = i;
      const r = m.getBoundingClientRect();
      showTip(r.right, r.top, lines(i));
    });
    m.addEventListener('blur', hideTip);
    m.addEventListener('keydown', (e) => {
      const next = step(i, e.key);
      if (next == null) return;
      e.preventDefault();
      if (next < 0 || next >= marks.length || next === i) return;
      marks[i].setAttribute('tabindex', '-1');
      marks[next].setAttribute('tabindex', '0');
      marks[next].focus();
    });
  });
}

// ---------------------------------------------------------------- 伸び

/** 直近何本で平均を取るか。一本ごとの値はお題の難しさで大きく揺れるので、線はこちらで引く */
const MA_WINDOW = 10;

/**
 * 3 枚の図。domain(values) は縦軸の範囲 [lo, hi] と目盛りを返す。
 *   速さ: 0 起点。上端は最大値の少し上。0 を切ると «120→170» が «3 倍» に見えてしまう。
 *   ぴったり率: 0〜100% 固定。百分率は «全体のうちどれだけ» なので、全体の幅を見せる。
 *   平均ズレ: 0 を真ん中に上下対称。先行（負）と遅れ（正）を同じ重さで見せる。
 *            最低でも ±20ms は取る（判定の «良い» ±35ms の内側が読める幅）。
 */
const TREND_PANELS = [
  {
    key: 'cpm',
    title: '速さ',
    unit: 'CPM（1分あたりのかな数）',
    fmt: (v) => `${Math.round(v)}`,
    tipFmt: (v) => `${Math.round(v)} CPM`,
    domain(vals) {
      const hi = Math.max(10, ...vals);
      const step = niceStep(hi, 3);
      const top = Math.ceil((hi * 1.05) / step) * step;
      return { lo: 0, hi: top, ticks: range(0, top, step) };
    },
  },
  {
    key: 'perfectRate',
    title: 'ぴったり率',
    unit: '%（±15ms に収まった同時打鍵の割合）',
    fmt: (v) => `${Math.round(v)}%`,
    tipFmt: (v) => `${v.toFixed(1)}%`,
    domain: () => ({ lo: 0, hi: 100, ticks: [0, 50, 100] }),
  },
  {
    key: 'meanOffset',
    title: '平均ズレ',
    unit: 'ms（0 に近いほど同時）',
    fmt: (v) => fmtMs(v),
    // 目盛りは単位を見出しに任せて数字だけ。«+30ms» だと狭い画面で左端にはみ出す
    tickFmt: (v) => fmtSigned(v),
    tipFmt: (v) => `${fmtMs(v, 1)}　${offsetWord(v)}`,
    centered: true,
    domain(vals) {
      const m = Math.max(20, ...vals.map(Math.abs));
      const step = niceStep(m, 2);
      const top = Math.ceil((m * 1.05) / step) * step;
      return { lo: -top, hi: top, ticks: [-top, 0, top] };
    },
  },
];

function range(lo, hi, step) {
  const out = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function movingAverage(vals, win) {
  // 前から win 本ぶんの平均（その回を含む過去だけを見る）。最初の数本は手持ちの本数で割る。
  // 欠けた値（ズレの測れない一本など）は数に入れない
  return vals.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - win + 1); j <= i; j++) {
      if (vals[j] == null) continue;
      s += vals[j];
      n++;
    }
    return n ? s / n : null;
  });
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function renderTrend(container, history) {
  const draw = () => drawTrend(container, history);
  redrawOnResize(container, draw);
  draw();
}

function drawTrend(container, history) {
  container.classList.add('viz', 'chart', 'chart--trend');
  const runs = (Array.isArray(history) ? history : []).filter((h) => h && typeof h === 'object').slice().reverse();
  if (runs.length === 0) return container.replaceChildren(emptyNote());
  if (runs.length < 2) return container.replaceChildren(emptyNote('2本以上打つと伸びが出ます'));

  const N = runs.length;
  const W = widthOf(container, 640);
  const M = { l: 40, r: 56, t: 10, b: 8 };
  const PH = W < 520 ? 92 : 112; // 一枚の描画域の高さ
  const AXIS_H = 34; // 一番下の図だけに付ける横軸の帯
  const pw = W - M.l - M.r;
  const x = (i) => M.l + (N === 1 ? pw / 2 : (i / (N - 1)) * pw);

  const first = new Date(runs[0].at);
  const last = new Date(runs[N - 1].at);
  const head = html(
    'div',
    { class: 'chart-head' },
    html('p', { class: 'chart-sum' }, `直近 ${N} 本（${validDay(first)} 〜 ${validDay(last)}）`),
    html(
      'p',
      { class: 'chart-key' },
      html('span', { class: 'chart-key__dot', 'aria-hidden': 'true' }),
      '一本ごと',
      html('span', { class: 'chart-key__line', 'aria-hidden': 'true' }),
      `直近${MA_WINDOW}本の平均`,
    ),
  );

  const panels = [];
  const blocks = TREND_PANELS.map((p, pi) => {
    const isLast = pi === TREND_PANELS.length - 1;
    const vals = runs.map((r) => num(r[p.key]));
    const present = vals.filter((v) => v != null);
    const ma = movingAverage(vals, MA_WINDOW);
    const dom = p.domain(present.length ? present : [0]);
    const y = (v) => M.t + (1 - (v - dom.lo) / (dom.hi - dom.lo)) * PH;
    const H = M.t + PH + (isLast ? AXIS_H : M.b);

    const g = svg('svg', { class: 'chart-svg', width: W, height: H, 'aria-hidden': 'true' });

    // 判定の窓（平均ズレの図だけ）：±15ms をうっすら
    if (p.centered) {
      const pf = THRESHOLDS.perfect;
      if (pf < dom.hi) {
        g.append(svg('rect', { class: 'band band--perfect', x: M.l, y: y(pf), width: pw, height: y(-pf) - y(pf) }));
      }
    }
    // 格子と縦の目盛り
    for (const t of dom.ticks) {
      const cls = p.centered && t === 0 ? 'grid grid--zero' : 'grid';
      g.append(svg('line', { class: cls, x1: M.l, x2: M.l + pw, y1: y(t), y2: y(t) }));
      g.append(svg('text', { class: 'tick tick--y', x: M.l - 6, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, (p.tickFmt || p.fmt)(t)));
    }
    // 向きを言葉で（平均ズレの図）。上＝遅れ、下＝先行
    if (p.centered) {
      g.append(svg('text', { class: 'dir', x: M.l + 4, y: M.t + 10 }, '↑ 親指が遅れ'));
      g.append(svg('text', { class: 'dir', x: M.l + 4, y: M.t + PH - 4 }, '↓ 親指が先行'));
    }

    // 一本ごとの点
    const dots = svg('g', { class: 'dots' });
    vals.forEach((v, i) => {
      if (v == null) return;
      dots.append(svg('circle', { class: 'dot', cx: x(i), cy: y(clamp(v, dom.lo, dom.hi)), r: 2.5 }));
    });
    g.append(dots);

    // 移動平均の線。欠けた所で線を切る
    let d = '';
    let pen = false;
    ma.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(clamp(v, dom.lo, dom.hi)).toFixed(1)}`;
      pen = true;
    });
    if (d) g.append(svg('path', { class: 'ma', d }));

    // 最初と最新の値を直接ラベルで
    const fi = vals.findIndex((v) => v != null);
    const li = vals.length - 1 - [...vals].reverse().findIndex((v) => v != null);
    if (fi >= 0) {
      const fy = y(clamp(vals[fi], dom.lo, dom.hi));
      g.append(svg('circle', { class: 'end-dot end-dot--first', cx: x(fi), cy: fy, r: 4 }));
      const above = fy - M.t > 18;
      g.append(
        svg('text', { class: 'end-label end-label--first', x: x(fi) + 6, y: above ? fy - 8 : fy + 16 }, `最初 ${p.fmt(vals[fi])}`),
      );
    }
    if (li >= 0 && li !== fi) {
      const ly = y(clamp(vals[li], dom.lo, dom.hi));
      g.append(svg('circle', { class: 'end-dot', cx: x(li), cy: ly, r: 4 }));
      g.append(svg('text', { class: 'end-label', x: x(li) + 8, y: ly, 'dominant-baseline': 'middle' }, p.fmt(vals[li])));
      g.append(svg('text', { class: 'end-label end-label--sub', x: x(li) + 8, y: ly + 13, 'dominant-baseline': 'middle' }, '最新'));
    }

    // 横軸（一番下だけ）
    if (isLast) {
      const ax = M.t + PH;
      g.append(svg('line', { class: 'axis', x1: M.l, x2: M.l + pw, y1: ax, y2: ax }));
      const step = niceStep(N, W < 520 ? 3 : 6);
      const ticks = [1];
      for (let v = step; v < N; v += step) if (v - 1 > step * 0.4 && N - v > step * 0.4) ticks.push(v);
      ticks.push(N);
      for (const t of ticks) {
        g.append(svg('text', { class: 'tick', x: x(t - 1), y: ax + 14, 'text-anchor': 'middle' }, String(t)));
      }
      g.append(svg('text', { class: 'tick tick--title', x: M.l + pw, y: ax + 30, 'text-anchor': 'end' }, '何本目'));
    }

    // 十字線（3 枚とも同じ回を指す）
    const cross = svg('g', { class: 'cross' });
    cross.append(svg('line', { class: 'cross__line', x1: 0, x2: 0, y1: M.t, y2: M.t + PH }));
    cross.append(svg('circle', { class: 'cross__dot', cx: 0, cy: 0, r: 4 }));
    cross.style.display = 'none';
    g.append(cross);

    // 当たり判定。線や点を狙わせず、横位置だけで一番近い回を拾う
    const hit = svg('rect', { class: 'hit', x: M.l - 4, y: 0, width: pw + 8, height: M.t + PH });
    g.append(hit);

    panels.push({ p, vals, y, dom, cross, svg: g });
    return html(
      'section',
      { class: 'chart-panel' },
      html('h4', { class: 'chart-title' }, p.title, html('span', { class: 'chart-unit' }, p.unit)),
      g,
    );
  });

  const nearest = (clientX, el) => {
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    return clamp(Math.round(((px - M.l) / pw) * (N - 1)), 0, N - 1);
  };
  const tipLines = (i) => {
    const r = runs[i];
    const at = new Date(r.at);
    const lines = [`${i + 1}本目　${validDate(at)}`];
    for (const pp of TREND_PANELS) {
      const v = num(r[pp.key]);
      lines.push([pp.title, v == null ? '—' : pp.tipFmt(v)]);
    }
    if (typeof r.kana === 'number') lines.push(['打ったかな', `${fmtInt(r.kana)}字`]);
    return lines;
  };
  const place = (i) => {
    for (const pn of panels) {
      pn.cross.style.display = '';
      pn.cross.setAttribute('transform', `translate(${x(i).toFixed(1)},0)`);
      const v = pn.vals[i];
      const dot = pn.cross.querySelector('.cross__dot');
      if (v == null) dot.style.display = 'none';
      else {
        dot.style.display = '';
        dot.setAttribute('cy', pn.y(clamp(v, pn.dom.lo, pn.dom.hi)).toFixed(1));
      }
    }
  };
  const clear = () => {
    for (const pn of panels) pn.cross.style.display = 'none';
    hideTip();
  };

  // 図の束が Tab の止まり所。矢印で一本ずつ、Home / End で端へ
  const body = html('div', {
    class: 'chart-trend',
    tabindex: '0',
    role: 'group',
    'aria-label': `伸びの図。直近${N}本。左右の矢印キーで一本ずつ動かせます`,
  });
  body.append(...blocks);
  let cur = N - 1;
  for (const pn of panels) {
    const hit = pn.svg.querySelector('.hit');
    hit.addEventListener('pointermove', (e) => {
      cur = nearest(e.clientX, pn.svg);
      place(cur);
      showTip(e.clientX, e.clientY, tipLines(cur));
    });
    hit.addEventListener('pointerleave', clear);
  }
  const showAtKey = () => {
    place(cur);
    // キーボードのときは小窓を図の下に出す。上に出すと動かしている線と点を隠してしまう
    const r = body.getBoundingClientRect();
    showTip(r.left + x(cur) - 12, r.bottom - 4, tipLines(cur));
  };
  body.addEventListener('focus', showAtKey);
  body.addEventListener('blur', clear);
  body.addEventListener('keydown', (e) => {
    const k = e.key;
    let next = null;
    if (k === 'ArrowLeft') next = cur - 1;
    else if (k === 'ArrowRight') next = cur + 1;
    else if (k === 'Home') next = 0;
    else if (k === 'End') next = N - 1;
    else if (k === 'Escape') return clear();
    if (next == null) return;
    e.preventDefault();
    cur = clamp(next, 0, N - 1);
    showAtKey();
  });

  container.replaceChildren(head, body);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function validDay(d) {
  return Number.isNaN(d.getTime()) ? '—' : dayKey(d);
}
function validDate(d) {
  if (Number.isNaN(d.getTime())) return '日時不明';
  const p = (n) => String(n).padStart(2, '0');
  return `${dateLabel(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------- ズレの分布

/**
 * 左親指・右親指を上下 2 段。横軸（−100〜+100ms）は共通。
 * 縦は «打鍵数» ではなく «その親指の全体に対する割合»、上下で同じ目盛り。
 * 左と右で打った数が違うので、数のままだと形ではなく量を比べてしまう。数は小窓と見出しに出す。
 */
export function renderOffsetHist(container, offset) {
  const draw = () => drawOffsetHist(container, offset);
  redrawOnResize(container, draw);
  draw();
}

function drawOffsetHist(container, offset) {
  container.classList.add('viz', 'chart', 'chart--offset');
  const sides = [
    { key: 'left', name: '左親指' },
    { key: 'right', name: '右親指' },
  ].map((s) => {
    const agg = (offset && offset[s.key]) || {};
    const hist = Array.from({ length: OFFSET_BINS }, (_, i) => {
      const v = Array.isArray(agg.hist) ? Number(agg.hist[i]) : 0;
      return Number.isFinite(v) && v > 0 ? v : 0;
    });
    const total = hist.reduce((a, b) => a + b, 0);
    return { ...s, hist, total, sum: offsetSummary(agg) };
  });
  if (sides.every((s) => s.total === 0)) return container.replaceChildren(emptyNote());

  const W = widthOf(container, 640);
  const narrow = W < 520;
  const M = { l: 40, r: 12, t: 22, b: 6 };
  const PH = narrow ? 86 : 104;
  const AXIS_H = 40;
  const pw = W - M.l - M.r;
  const R = OFFSET_RANGE_MS;
  const x = (ms) => M.l + ((clamp(ms, -R, R) + R) / (2 * R)) * pw;
  const share = (s, v) => (s.total ? v / s.total : 0);
  const maxShare = Math.max(...sides.flatMap((s) => s.hist.map((v) => share(s, v))), 0.01);
  const yStep = niceStep(maxShare * 100, 2);
  const yTop = Math.ceil((maxShare * 100) / yStep) * yStep;
  const binW = pw / OFFSET_BINS;
  const barW = Math.min(24, Math.max(1, binW - 2)); // 隣の棒との間に 2px の地を残す

  const marks = [];
  const markInfo = [];
  const blocks = sides.map((s, si) => {
    const isLast = si === sides.length - 1;
    const H = M.t + PH + (isLast ? AXIS_H : M.b);
    const y = (pct) => M.t + (1 - pct / yTop) * PH;
    const g = svg('svg', { class: 'chart-svg', width: W, height: H, 'aria-hidden': s.total ? null : 'true' });

    // 判定の窓：良い（±35）を先に、ぴったり（±15）をその上に重ねる
    const { perfect, good } = THRESHOLDS;
    g.append(svg('rect', { class: 'band band--good', x: x(-good), y: M.t, width: x(good) - x(-good), height: PH }));
    g.append(svg('rect', { class: 'band band--perfect', x: x(-perfect), y: M.t, width: x(perfect) - x(-perfect), height: PH }));
    if (si === 0) {
      g.append(svg('text', { class: 'band-label', x: x(0), y: M.t - 8, 'text-anchor': 'middle' }, `ぴったり ±${perfect}`));
      if (!narrow) {
        g.append(svg('text', { class: 'band-label', x: x(-(good + perfect) / 2), y: M.t - 8, 'text-anchor': 'middle' }, '良い'));
        g.append(svg('text', { class: 'band-label', x: x((good + perfect) / 2), y: M.t - 8, 'text-anchor': 'middle' }, '良い'));
      }
    }
    // 横の格子と縦の目盛り（%）
    for (const t of range(0, yTop, yStep)) {
      g.append(svg('line', { class: 'grid', x1: M.l, x2: M.l + pw, y1: y(t), y2: y(t) }));
      g.append(svg('text', { class: 'tick tick--y', x: M.l - 6, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, `${t}%`));
    }

    // 棒
    if (s.total) {
      s.hist.forEach((v, i) => {
        const { from, to } = offsetBinRange(i);
        const pct = share(s, v) * 100;
        const cx = x(from) + binW / 2;
        const top = y(pct);
        const bh = M.t + PH - top;
        const bar = svg('path', { class: 'bar', d: barPath(cx - barW / 2, top, barW, bh) });
        // 当たり判定は棒の形ではなくビンの幅いっぱい・高さいっぱい。低い棒も拾えるように
        const hit = svg('rect', { class: 'bar-hit', x: x(from), y: M.t, width: binW, height: PH });
        g.append(svg('g', { class: 'bin' }, bar, hit));
        marks.push(hit);
        markInfo.push({ s, i, from, to, v, pct });
      });
    } else {
      g.append(svg('text', { class: 'chart-note', x: M.l + pw / 2, y: M.t + PH / 2, 'text-anchor': 'middle' }, 'この親指の記録はまだありません'));
    }

    // 0 の縦線
    g.append(svg('line', { class: 'zero', x1: x(0), x2: x(0), y1: M.t, y2: M.t + PH }));
    // 底の線
    g.append(svg('line', { class: 'axis', x1: M.l, x2: M.l + pw, y1: M.t + PH, y2: M.t + PH }));

    // 平均の印と数値
    const mean = s.sum.mean;
    if (s.total && mean != null) {
      const mx = x(mean);
      g.append(svg('line', { class: 'mean', x1: mx, x2: mx, y1: M.t + 4, y2: M.t + PH }));
      g.append(svg('path', { class: 'mean-mark', d: `M${mx - 5},${M.t - 1}L${mx + 5},${M.t - 1}L${mx},${M.t + 6}Z` }));
      const right = mx < M.l + pw - 90;
      g.append(
        svg(
          'text',
          { class: 'mean-label', x: right ? mx + 8 : mx - 8, y: M.t + 14, 'text-anchor': right ? 'start' : 'end' },
          `平均 ${fmtMs(mean, 1)}`,
        ),
      );
    }

    // 横軸（下の段だけ）。向きを言葉で
    if (isLast) {
      const ax = M.t + PH;
      const ticks = narrow ? [-100, -50, 0, 50, 100] : [-100, -75, -50, -25, 0, 25, 50, 75, 100];
      for (const t of ticks) {
        g.append(svg('text', { class: 'tick', x: x(t), y: ax + 14, 'text-anchor': t === -100 ? 'start' : t === 100 ? 'end' : 'middle' }, t === 0 ? '0' : `${t > 0 ? '+' : '−'}${Math.abs(t)}`));
      }
      g.append(svg('text', { class: 'dir', x: M.l, y: ax + 32 }, '← 親指が先'));
      g.append(svg('text', { class: 'dir', x: M.l + pw, y: ax + 32, 'text-anchor': 'end' }, '親指が遅れ →'));
      g.append(svg('text', { class: 'tick tick--title', x: x(0), y: ax + 32, 'text-anchor': 'middle' }, 'ms'));
    }

    const sm = s.sum;
    // 狭い画面で «4,800\n打» のように数と単位が泣き別れしないよう、項目ごとに折り返しを止める
    const piece = (t) => html('span', { class: 'chart-unit chart-unit--piece' }, t);
    const stats = s.total
      ? [piece(`平均 ${fmtMs(sm.mean, 1)}（${offsetWord(sm.mean)}）`), piece(`ばらつき ±${sm.sd.toFixed(1)}ms`), piece(`${fmtInt(sm.n)}打`)]
      : [piece('まだ記録がありません')];
    return html('section', { class: 'chart-panel' }, html('h4', { class: 'chart-title' }, s.name, ...stats), g);
  });

  if (marks.length) {
    const lines = (k) => {
      const { s, i, from, to, v, pct } = markInfo[k];
      // 端のビンには範囲の外（±100ms を超えた打鍵）も寄せてある（offsetBinOf）
      const span = i === 0 ? `${fmtSigned(to)}ms より先（範囲外を含む）` : i === OFFSET_BINS - 1 ? `${fmtSigned(from)}ms より後（範囲外を含む）` : `${fmtSigned(from)}〜${fmtSigned(to)}ms`;
      return [s.name, `${span}　${fmtInt(v)}打（全体の${pct < 1 && v > 0 ? pct.toFixed(1) : Math.round(pct)}%）`];
    };
    // 左右キーで同じ段の隣のビン、上下キーで段を移る
    roving(
      marks,
      lines,
      (k, key) => {
        const per = OFFSET_BINS;
        if (key === 'ArrowLeft') return k % per === 0 ? k : k - 1;
        if (key === 'ArrowRight') return k % per === per - 1 ? k : k + 1;
        if (key === 'ArrowUp') return k - per;
        if (key === 'ArrowDown') return k + per;
        if (key === 'Home') return k - (k % per);
        if (key === 'End') return k - (k % per) + per - 1;
        return null;
      },
      OFFSET_BINS / 2,
    );
  }

  container.replaceChildren(
    html('p', { class: 'chart-sum' }, '親指キーが文字キーより何 ms 早いか遅いか。縦は打鍵の割合'),
    ...blocks,
  );
}

// ---------------------------------------------------------------- 入口の計器

/**
 * 入口の計器に置く分布。左右の親指を合わせて一本にし、±60ms だけを見せる。
 * 記録の図（renderOffsetHist）の縮約版で、軸・帯・平均の描き方は同じ。
 * 小窓は付けない。細かく見たい人は記録へ行く。
 */
export function renderScope(container, offset) {
  const draw = () => drawScope(container, offset);
  redrawOnResize(container, draw);
  draw();
}

const SCOPE_MS = 60;

function drawScope(container, offset) {
  container.classList.add('viz', 'chart', 'chart--scope');
  const sides = ['left', 'right'].map((k) => (offset && offset[k]) || {});
  const hist = Array.from({ length: OFFSET_BINS }, (_, i) =>
    sides.reduce((a, s) => a + (Array.isArray(s.hist) && Number(s.hist[i]) > 0 ? Number(s.hist[i]) : 0), 0));
  const total = hist.reduce((a, b) => a + b, 0);

  const W = widthOf(container, 520);
  const PH = 112;
  const H = PH + 26;
  const x = (ms) => ((clamp(ms, -SCOPE_MS, SCOPE_MS) + SCOPE_MS) / (2 * SCOPE_MS)) * W;
  const g = svg('svg', { class: 'chart-svg', width: W, height: H, 'aria-hidden': 'true' });
  const { perfect } = THRESHOLDS;
  g.append(svg('rect', { class: 'band band--perfect', x: x(-perfect), y: 0, width: x(perfect) - x(-perfect), height: PH }));

  // 見せる範囲のビンだけ。端のビン（範囲外を寄せたもの）は描かない
  const shown = hist.map((v, i) => ({ v, ...offsetBinRange(i) })).filter((b) => b.from >= -SCOPE_MS && b.to <= SCOPE_MS);
  const peak = Math.max(1, ...shown.map((b) => b.v));
  const binW = (x(OFFSET_BIN_MS) - x(0));
  const barW = Math.max(1, binW - 2);
  for (const b of shown) {
    const h = total ? (b.v / peak) * (PH - 8) : 0;
    const inside = b.from >= -perfect && b.to <= perfect;
    g.append(svg('path', { class: inside ? 'bar bar--in' : 'bar', d: barPath(x(b.from) + 1, PH - h, barW, h) }));
  }
  g.append(svg('line', { class: 'axis', x1: 0, x2: W, y1: PH, y2: PH }));
  for (let t = -SCOPE_MS; t <= SCOPE_MS; t += 15) {
    const major = t % 30 === 0;
    g.append(svg('line', { class: t === 0 ? 'tick-mark tick-mark--zero' : 'tick-mark', x1: x(t), x2: x(t), y1: PH, y2: PH + (major ? 7 : 4) }));
    g.append(svg('text', { class: 'tick', x: x(t), y: PH + 20, 'text-anchor': t === -SCOPE_MS ? 'start' : t === SCOPE_MS ? 'end' : 'middle' }, t === 0 ? '0' : fmtSigned(t)));
  }
  const mean = total ? sides.reduce((a, s) => a + (Number(s.sum) || 0), 0) / sides.reduce((a, s) => a + (Number(s.n) || 0), 0) : null;
  if (mean != null && Number.isFinite(mean)) {
    g.append(svg('line', { class: 'needle', x1: x(mean), x2: x(mean), y1: 0, y2: PH }));
  }
  container.replaceChildren(g);
}

function fmtSigned(v) {
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${Math.abs(v)}`;
}

/** 上端だけ角を丸めた棒（底は四角） */
function barPath(x0, top, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x0},${top + h}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${top + h}Z`;
}

// ---------------------------------------------------------------- 練習した日

const CAL_WEEKS = 52;
const CELL = 12;
const GAP = 2;

/**
 * 濃さの段の切り方は «練習した日の字数の四分位»。
 * 最大値で割ると、一日だけ長く打った日があるとほかの日が全部いちばん薄い段に寄り、
 * «毎日少しずつ» の差が見えなくなる。続けることを見せる図なので、
 * 打った日どうしの中での相対的な多さ（下位 25% / 50% / 75% / それ以上）で 4 段に分ける。
 * 打っていない日は 0 段（地に近い色＋枠）。段の境目の字数は凡例の小窓で読める。
 */
function quartiles(vals) {
  const s = vals.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return [q(0.25), q(0.5), q(0.75)];
}

export function renderCalendar(container, daily, today) {
  const draw = () => drawCalendar(container, daily, today);
  redrawOnResize(container, draw);
  draw();
}

function drawCalendar(container, daily, today) {
  container.classList.add('viz', 'chart', 'chart--cal');
  const now = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // 右端の列は今日を含む週（日曜はじまり）。そこから 52 週ぶん遡る
  const start = new Date(end);
  start.setDate(end.getDate() - end.getDay() - (CAL_WEEKS - 1) * 7);

  const dd = daily && typeof daily === 'object' ? daily : {};
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d);
    const v = dd[key] && typeof dd[key] === 'object' ? dd[key] : null;
    days.push({
      date: new Date(d),
      key,
      runs: v ? Number(v.runs) || 0 : 0,
      kana: v ? Number(v.kana) || 0 : 0,
      seconds: v ? Number(v.seconds) || 0 : 0,
    });
  }
  const active = days.filter((d) => d.runs > 0 || d.kana > 0);
  if (active.length === 0) return container.replaceChildren(emptyNote());

  const qs = quartiles(active.map((d) => d.kana));
  const level = (d) => {
    if (!(d.runs > 0 || d.kana > 0)) return 0;
    if (d.kana <= qs[0]) return 1;
    if (d.kana <= qs[1]) return 2;
    if (d.kana <= qs[2]) return 3;
    return 4;
  };

  const L = 0; // 曜日の欄は横に流れないよう別の SVG に分けた（下の days）
  const T = 18; // 月の欄
  const cols = CAL_WEEKS;
  const W = L + cols * (CELL + GAP) + 16; // 右端の «11月» が切れないよう少し余白
  const H = T + 7 * (CELL + GAP);
  const g = svg('svg', { class: 'chart-svg cal-svg', width: W, height: H });

  // 曜日（月・水・金）。横に流す欄の外に置き、狭い画面で右端へ流しても見えるままにする
  const wk = svg('svg', { class: 'chart-svg cal-days', width: 20, height: H, 'aria-hidden': 'true' });
  for (const [row, name] of [[1, '月'], [3, '水'], [5, '金']]) {
    wk.append(svg('text', { class: 'tick', x: 0, y: T + row * (CELL + GAP) + CELL / 2, 'dominant-baseline': 'middle' }, name));
  }

  const cells = [];
  let lastMonth = -1;
  let lastLabelX = -Infinity;
  days.forEach((d, i) => {
    const col = Math.floor(i / 7);
    const row = d.date.getDay();
    const cx = L + col * (CELL + GAP);
    // 月の名前は、その月の最初の日が入った列の上に。詰まりすぎる時は飛ばす
    if (d.date.getDate() <= 7 && row === 0 && d.date.getMonth() !== lastMonth) {
      if (cx - lastLabelX > 26) {
        g.append(svg('text', { class: 'tick', x: cx, y: T - 6 }, `${d.date.getMonth() + 1}月`));
        lastLabelX = cx;
      }
      lastMonth = d.date.getMonth();
    }
    const c = svg('rect', {
      class: `cell cell--${level(d)}${i === days.length - 1 ? ' cell--today' : ''}`,
      x: cx,
      y: T + row * (CELL + GAP),
      width: CELL,
      height: CELL,
      rx: 2,
    });
    g.append(c);
    cells.push(c);
  });

  const lines = (i) => {
    const d = days[i];
    const head = dateLabel(d.date) + (i === days.length - 1 ? '　今日' : '');
    if (!(d.runs > 0 || d.kana > 0)) return [head, '練習なし'];
    return [head, `${d.runs}本・${fmtInt(d.kana)}字・${Math.max(1, Math.round(d.seconds / 60))}分`];
  };
  // 左右で一週ずつ、上下で一日ずつ
  roving(cells, lines, (i, key) => {
    if (key === 'ArrowLeft') return i - 7;
    if (key === 'ArrowRight') return i + 7;
    if (key === 'ArrowUp') return i - 1;
    if (key === 'ArrowDown') return i + 1;
    if (key === 'Home') return 0;
    if (key === 'End') return days.length - 1;
    return null;
  });

  const totalKana = active.reduce((a, d) => a + d.kana, 0);
  const sum = html(
    'p',
    { class: 'chart-sum' },
    `直近52週で ${active.length}日 練習・合計 ${fmtInt(totalKana)}字`,
  );

  // 凡例：少〜多の 5 段。段の境目の字数は小窓で
  // 練習した日が少ないと四分位の境目が重なり、中身の無い段ができる。その段は «該当なし» と出す
  const counts = [0, 0, 0, 0, 0];
  for (const d of days) counts[level(d)]++;
  const span = (k, lo, hi) => (counts[k] === 0 ? '該当なし' : lo === hi ? `${fmtInt(lo)}字` : `${fmtInt(lo)}〜${fmtInt(hi)}字`);
  const lv = (k) => active.filter((d) => level(d) === k).map((d) => d.kana);
  const ranges = ['練習なし'];
  for (let k = 1; k <= 4; k++) {
    const v = lv(k);
    ranges.push(v.length ? span(k, Math.min(...v), Math.max(...v)) : '該当なし');
  }
  const legendSvg = svg('svg', { class: 'cal-legend__svg', width: 5 * (CELL + GAP), height: CELL, 'aria-hidden': 'true' });
  for (let k = 0; k < 5; k++) {
    legendSvg.append(svg('rect', { class: `cell cell--${k}`, x: k * (CELL + GAP), y: 0, width: CELL, height: CELL, rx: 2 }));
  }
  const legend = html(
    'p',
    { class: 'cal-legend', 'aria-label': `濃さの段：${ranges.join('、')}（その日に打った字数。練習した日の四分位で区切る）` },
    html('span', { 'aria-hidden': 'true' }, '少'),
    legendSvg,
    html('span', { 'aria-hidden': 'true' }, '多'),
  );
  legendSvg.addEventListener('pointermove', (e) => {
    const r = legendSvg.getBoundingClientRect();
    const k = clamp(Math.floor((e.clientX - r.left) / (CELL + GAP)), 0, 4);
    showTip(e.clientX, e.clientY, ['その日に打った字数', ranges[k]]);
  });
  legendSvg.addEventListener('pointerleave', hideTip);

  const scroller = html('div', { class: 'cal-scroll' }, g);
  container.replaceChildren(sum, html('div', { class: 'cal-body' }, wk, scroller), legend);
  // 狭い画面では右端（今日）から見せる。左は古い日なので、見たければ戻ればよい
  scroller.scrollLeft = scroller.scrollWidth;
}
