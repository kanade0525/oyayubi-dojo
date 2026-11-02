// 得意・苦手を、配列そのものの上に 3D の柱で立てる図（アイソメトリック）。
//
// 高さと色の両方で «自分の平均と比べたミス率の倍率» を言う（二重に符号化する）。
//   苦手 … 赤く、高く突き出る
//   得意 … 青く、低く沈む
// 最初は高さに «打った数» を当てたが、キーごとの打鍵数は似た量に揃いやすく、
// 高さに差が出ないうえ、手前の高い柱が奥の段をまるごと隠した。
// 立体にする意味は «どこが突き出ているか» が一目で分かることなので、高さも苦手さに使う。
// 打った数は小窓と表に回す。少ない面は点線の縁で «言い切っていない» と示す。
//
// 平均と比べるのは、上達すると全面のミス率が下がるから。絶対値で塗ると、
// 上手くなるほど図が一色になって «どこが相対的に弱いか» が消える。
//
// ミス率は drill.js の missRateOf と同じ式（事前分布を混ぜる）。出題と図で物差しを揃える。
// 打った数が少ない面（LOW_HITS 未満）は色で断定しない。灰にして «まだ少ない» と言う。
//
// 計算（isoData）は DOM を知らない。Node から import してテストできる。描画は renderIso。

import { missRateOf, describeFace } from './drill.js';
import { KEY_CODES } from './keyboard.js';
import { svg, html, bindTip } from './viz.js';

/** これ未満しか打っていない面は、色で得意・苦手を言い切らない */
export const LOW_HITS = 15;

export const FACES = Object.freeze([
  Object.freeze({ id: 'all', name: '全部' }),
  Object.freeze({ id: 'none', name: '単独' }),
  Object.freeze({ id: 'left', name: '左親指' }),
  Object.freeze({ id: 'right', name: '右親指' }),
]);

/**
 * 平均との倍率 → 段階。段の境目は «0.85〜1.18 倍は平均並み» を中心に、
 * 外側ほど幅を広く取る（倍率は比なので、対数で見てほぼ等間隔になるように）
 */
export function levelOf(ratio) {
  if (!Number.isFinite(ratio)) return 'mid';
  if (ratio <= 0.5) return 'g3';
  if (ratio <= 0.7) return 'g2';
  if (ratio <= 0.85) return 'g1';
  if (ratio < 1.18) return 'mid';
  if (ratio < 1.4) return 'b1';
  if (ratio < 2) return 'b2';
  return 'b3';
}

// 配列図と同じ 3 段 × 10 キー。KEY_CODES は keyboard.js の段の順に平らに並んでいる。
// 並びが変わったら黙って崩れるより、ここで止める
if (KEY_CODES.length !== 30) throw new Error(`iso.js: キーの数が 30 ではない（${KEY_CODES.length}）。段の切り方を見直すこと`);
const ROWS = [KEY_CODES.slice(0, 10), KEY_CODES.slice(10, 20), KEY_CODES.slice(20, 30)];
/** 段ごとの横ずれ（キー幅に対する割合）。実物のキーボードと同じく下の段ほど右へ */
const STAGGER = [0, 0.25, 0.75];

const THUMBS = ['none', 'left', 'right'];
const THUMB_NAME = { none: '単独', left: '左親指', right: '右親指' };

/**
 * 図に載せる数字を作る。
 * @param {object} layout loadLayout('nicola')
 * @param {object} stats  loadStats() の faceHits / faceMisses
 * @param {string} face   'all' | 'none' | 'left' | 'right'
 * @returns {{ keys: Array, avgRate: number, totalHits: number, maxHits: number }}
 *   keys の各要素: { code, row, col, x, kana, hits, misses, rate, ratio, level, low, faces }
 *   faces は面ごとの内訳（全部のときの小窓用）
 */
export function isoData(layout, stats, face = 'all') {
  if (!FACES.some((f) => f.id === face)) throw new Error(`iso.js: 知らない面 ${face}`);
  const hitsOf = (k) => Number(stats?.faceHits?.[k]) || 0;
  const missOf = (k) => Number(stats?.faceMisses?.[k]) || 0;
  const thumbs = face === 'all' ? THUMBS : [face];

  const keys = [];
  ROWS.forEach((row, r) => row.forEach((code, c) => {
    const def = layout.keys[code];
    if (!def) throw new Error(`iso.js: 配列に ${code} が無い`);
    const faces = thumbs.map((t) => ({
      thumb: t, face: `${code}:${t}`, kana: def[t] ?? null,
      hits: hitsOf(`${code}:${t}`), misses: missOf(`${code}:${t}`),
    }));
    const hits = faces.reduce((a, f) => a + f.hits, 0);
    const misses = faces.reduce((a, f) => a + f.misses, 0);
    keys.push({
      code, row: r, col: c, x: c + STAGGER[r],
      // 全部のときは単独の字を札にする（その キーの «顔»）
      kana: face === 'all' ? def.none : def[face],
      hand: def.hand,
      hits, misses, faces,
    });
  }));

  const totalHits = keys.reduce((a, k) => a + k.hits, 0);
  const totalMiss = keys.reduce((a, k) => a + k.misses, 0);
  const avgRate = missRateOf(totalHits, totalMiss);
  const maxHits = Math.max(0, ...keys.map((k) => k.hits));
  for (const k of keys) {
    k.rate = missRateOf(k.hits, k.misses);
    k.ratio = k.rate / avgRate;
    k.low = k.hits < LOW_HITS;
    k.level = k.hits === 0 ? 'none' : k.low ? 'mid' : levelOf(k.ratio);
  }
  return { keys, avgRate, totalHits, maxHits };
}

/** 苦手・得意の上位。打った数が少ない面は言い切れないので入れない */
export function rankKeys(data, n = 5) {
  const sure = data.keys.filter((k) => !k.low);
  const worst = [...sure].sort((a, b) => b.ratio - a.ratio).filter((k) => k.ratio >= 1.18).slice(0, n);
  const best = [...sure].sort((a, b) => a.ratio - b.ratio).filter((k) => k.ratio <= 0.85).slice(0, n);
  return { worst, best };
}

// ---------------------------------------------------------------- 描画

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const times = (r) => (Number.isFinite(r) ? `${r.toFixed(2)}倍` : '—');
const LEVEL_WORD = { g3: 'かなり得意', g2: '得意', g1: 'やや得意', mid: '平均並み', b1: 'やや苦手', b2: '苦手', b3: 'かなり苦手', none: 'まだ打っていない' };

/** 柱の札（キー）の小窓 */
function tipLines(k, face) {
  const head = face === 'all' ? `${k.kana ?? ''}　${k.code.replace(/^Key/, '')} キー` : describeFace(`${k.code}:${face}`) || k.kana;
  const lines = [head];
  if (k.hits === 0) return [...lines, 'まだ打っていません'];
  lines.push(['打った数', `${k.hits}打`], ['ミス', `${k.misses}回`], ['ミス率', pct(k.rate)], ['平均との比', times(k.ratio)]);
  lines.push(k.low ? `まだ ${LOW_HITS} 打に満たないので、得意・苦手は言い切りません` : LEVEL_WORD[k.level]);
  if (face === 'all') {
    for (const f of k.faces) if (f.hits) lines.push([`　${THUMB_NAME[f.thumb]}「${f.kana}」`, `${f.hits}打・${pct(missRateOf(f.hits, f.misses))}`]);
  }
  return lines;
}

/**
 * 図を描く。container の中身は作り直す。
 * 状態（どの面か・どちら向きか）は container に持たせ、切り替えのたびに描き直す。
 */
export function renderIso(container, { layout, stats }) {
  if (!container) return;
  const state = container._iso ?? (container._iso = { face: 'all', view: 'left' });

  const draw = () => {
    const data = isoData(layout, stats, state.face);
    // 一打もしていないなら一文だけ。切り替えや凡例を出しても、切り替える先が全部空
    if (isoData(layout, stats, 'all').totalHits === 0) {
      container.replaceChildren(html('p', { class: 'iso-empty' }, 'まだ記録がありません。打つと、ここにキーごとの柱が立ちます。'));
      return;
    }
    container.replaceChildren(controls(), figure(data), legend(), lists(data), table(data));
  };

  const controls = () => {
    const seg = (items, key, label) => html('div', { class: 'iso-seg', role: 'group', 'aria-label': label },
      ...items.map((it) => {
        const b = html('button', { type: 'button', class: 'iso-seg__b', 'aria-pressed': String(state[key] === it.id) }, it.name);
        b.addEventListener('click', () => { state[key] = it.id; draw(); });
        return b;
      }));
    return html('div', { class: 'iso-ctl' },
      seg(FACES, 'face', '面'),
      seg([{ id: 'left', name: '左から見る' }, { id: 'right', name: '右から見る' }], 'view', '向き'));
  };

  const figure = (data) => {
    if (data.totalHits === 0) {
      return html('p', { class: 'iso-empty' }, `${FACES.find((f) => f.id === state.face).name}の面はまだ打っていません。`);
    }
    // 単位: キー 1 個 = 1。アイソメトリックの軸は 30°。
    // 左から見るとき: 列は右下へ、段は左下へ伸びる。右から見るときは列を反転する
    const U = 46;
    const cos = Math.cos(Math.PI / 6) * U;
    const sin = Math.sin(Math.PI / 6) * U;
    // 倍率 RATIO_CAP 以上の柱の高さ。これより高くすると、手前の段の苦手が奥の段をまるごと隠す
    const H = 1.2 * U;
    const W_COLS = 10.75;
    // 段の間隔。キーの奥行き（1）より広く取って、手前の高い柱の後ろに奥の段が覗けるようにする。
    // 実物どおり 1 にすると、下段がまとめて苦手な人ではホーム段がまるごと隠れた
    const ROW_PITCH = 1.7;
    const DEPTH = 2 * ROW_PITCH + 1;
    // 見る向き。どちらも配列は左から右へ読める並びのまま、カメラだけを回す
    // （鏡に映すと配列が逆順に並んでしまう。最初はそうなっていた）。
    //   左から … 列は右下へ、段は左下へ伸びる。手前に見える側面は列の右側（x1）
    //   右から … 列は右上へ、段は右下へ伸びる。手前に見える側面は列の左側（x0）
    const fromRight = state.view === 'right';
    // 描いた点を全部覚えておき、最後にその外接矩形を viewBox にする（空の上空を取らない）
    const seen = [];
    const proj = (x, y, z = 0) => {
      const p = fromRight ? [(x + y) * cos, (y - x) * sin - z] : [(x - y) * cos, (x + y) * sin - z];
      seen.push(p);
      return p;
    };
    // 画面の下にあるほど手前。足もとの奥行きで並べる
    const depthOf = (k) => {
      const x = k.x + 0.5;
      const y = k.row * ROW_PITCH + 0.5;
      return fromRight ? y - x : x + y;
    };
    // 倍率 0 → 床すれすれ、1（平均）→ 高さの 1/3、RATIO_CAP 倍以上 → 頭打ち。
    // 言い切れない面（打った数が少ない）は平均の高さに置く
    const RATIO_CAP = 3;
    const FLOOR = 4;
    const heightOf = (k) => {
      if (k.hits === 0) return 0;
      const r = k.low ? 1 : Math.min(RATIO_CAP, k.ratio);
      return FLOOR + (H - FLOOR) * (r / RATIO_CAP);
    };

    // 手前ほど後で描く（画家のアルゴリズム）
    const order = [...data.keys].sort((a, b) => depthOf(a) - depthOf(b));

    const g = svg('g', { class: 'iso-keys' });
    // 台座。キーボードの板。これがあると «どこが配列の端か» が分かる
    const P = 0.35;
    const plate = [[-P, -P], [W_COLS + P, -P], [W_COLS + P, DEPTH + P - 0.1], [-P, DEPTH + P - 0.1]].map(([x, y]) => proj(x, y).join(',')).join(' ');
    g.append(svg('polygon', { class: 'iso-plate', points: plate }));

    const S = 0.86; // キーの一辺（隙間を残す）
    for (const k of order) {
      const x0 = k.x + (1 - S) / 2;
      const y0 = k.row * ROW_PITCH + (1 - S) / 2;
      const x1 = x0 + S;
      const y1 = y0 + S;
      const h = heightOf(k);
      const pts = (arr) => arr.map((p) => p.join(',')).join(' ');
      // 見える面は上面と、手前の二面。向きを反転したら手前に来る側面も入れ替わる
      const top = [proj(x0, y0, h), proj(x1, y0, h), proj(x1, y1, h), proj(x0, y1, h)];
      const front = [proj(x0, y1, 0), proj(x1, y1, 0), proj(x1, y1, h), proj(x0, y1, h)]; // 段の手前の面
      const sideX = fromRight ? x0 : x1;
      const side = [proj(sideX, y0, 0), proj(sideX, y1, 0), proj(sideX, y1, h), proj(sideX, y0, h)]; // 列の手前の面
      const key = svg('g', { class: 'iso-key', 'data-lv': k.level, 'data-low': k.low ? '1' : null });
      if (h > 0) {
        key.append(svg('polygon', { class: 'iso-side', points: pts(side) }), svg('polygon', { class: 'iso-front', points: pts(front) }));
      }
      key.append(svg('polygon', { class: 'iso-top', points: pts(top) }));
      if (k.kana) {
        const [cx, cy] = proj(k.x + 0.5, k.row * ROW_PITCH + 0.5, h);
        key.append(svg('text', { class: 'iso-kana', x: cx, y: cy + 5, 'text-anchor': 'middle' }, k.kana));
      }
      bindTip(key, () => tipLines(k, state.face));
      g.append(key);
    }

    const xs = seen.map((c) => c[0]);
    const ys = seen.map((c) => c[1]);
    const pad = 12;
    const vb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2];
    const label = `得意・苦手の柱。${FACES.find((f) => f.id === state.face).name}。高さと色は、自分の平均と比べたミス率。高いほど苦手。`;
    return html('div', { class: 'iso-fig viz' },
      svg('svg', { viewBox: vb.map((v) => v.toFixed(1)).join(' '), role: 'group', 'aria-label': label, class: 'iso-svg' }, g));
  };

  const legend = () => {
    const sw = (lv, word) => html('span', { class: 'iso-leg__sw', 'data-lv': lv, title: word });
    return html('div', { class: 'iso-leg' },
      html('span', { class: 'iso-leg__end' }, '得意'),
      html('span', { class: 'iso-leg__ramp' }, ...['g3', 'g2', 'g1', 'mid', 'b1', 'b2', 'b3'].map((lv) => sw(lv, LEVEL_WORD[lv]))),
      html('span', { class: 'iso-leg__end' }, '苦手'),
      html('span', { class: 'iso-leg__note' }, `高さと色は、自分の平均ミス率との比。高いほど苦手、低いほど得意。縁が点線の柱は、まだ ${LOW_HITS} 打に満たず言い切れない面`));
  };

  const lists = (data) => {
    const { worst, best } = rankKeys(data);
    const item = (k) => html('li', {},
      html('b', { class: 'iso-rank__kana' }, k.kana ?? k.code),
      html('span', {}, `${times(k.ratio)}・ミス率 ${pct(k.rate)}・${k.hits}打`));
    const col = (title, arr, cls, none) => html('div', { class: `iso-rank ${cls}` },
      html('h3', { class: 'iso-rank__head' }, title),
      arr.length ? html('ol', {}, ...arr.map(item)) : html('p', { class: 'iso-rank__none' }, none));
    return html('div', { class: 'iso-ranks' },
      col('苦手（平均より外している）', worst, 'is-bad', 'はっきり苦手と言える面はまだありません'),
      col('得意（平均より外していない）', best, 'is-good', 'はっきり得意と言える面はまだありません'));
  };

  // 表で見る。色と高さを読めない人・正確な数字が欲しい人のため。図と同じ数字を出す
  const table = (data) => {
    const rows = [...data.keys].filter((k) => k.hits > 0).sort((a, b) => b.ratio - a.ratio);
    const t = html('table', { class: 'rec iso-table' },
      html('thead', {}, html('tr', {}, ...['字', 'キー', '打った数', 'ミス', 'ミス率', '平均との比'].map((h) => html('th', {}, h)))),
      html('tbody', {}, ...rows.map((k) => html('tr', {},
        html('td', {}, k.kana ?? ''), html('td', {}, k.code.replace(/^Key/, '')),
        html('td', {}, String(k.hits)), html('td', {}, String(k.misses)),
        html('td', {}, pct(k.rate)), html('td', {}, k.low ? `${times(k.ratio)}（少）` : times(k.ratio))))));
    return html('details', { class: 'iso-details' }, html('summary', {}, '表で見る'), t);
  };

  draw();
}
