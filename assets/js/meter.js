// タイミングメーター
// ================================================================
// このファイルは何か
//   文字キーと親指キーの押下時間差（offsetMs）を、1 打ごとに絵にして返す。
//   親指シフトの練習でいちばん見たいものなので、プレイ画面の主役に据えてある。
//
// なぜこの方針か
//   1. 目盛りの端を ±80ms に固定した。
//      80ms は同時打鍵が成立しなくなる幅（nicola.js の tau の既定）。
//      端＝もう同時打鍵ではない、という意味になるので、目盛りそのものに意味が宿る。
//      「なんとなく真ん中」ではなく「あと少しで不発になる」が読める。
//
//   2. 向き（先行 / 遅れ）を、色ではなく «位置» で出す。
//      親指が早すぎる人と遅すぎる人では直し方が真逆で、向きが分からないと直せない。
//      既存の練習サイトはここを測っていないので、この 1 点が本アプリの値打ちになる。
//      レールの左右には常に「◀ 先行」「遅れ ▶」を出しっぱなしにしてある。
//      判定が出てから向きを探させない。
//
//   3. «今の 1 打» と «直近のクセ» を、同じ横軸に重ねた。
//      1 打の時間差は運の要素が大きく、それだけ見ても直しようがない。
//      直近の中央値を三角で置くと「自分はいつも早い」という systematic なズレが見える。
//      直すべきはそっちなので、目を動かさずに較べられる位置に置いた。
//
//   4. 平時は静か。perfect と good では色も動きもほとんど出さない。
//      off と misfire のときだけ、色と «直し方の一行» が出る。
//      打鍵中に画面が騒がしいと、お題から目が離れて速度が落ちる。
//
// 契約（CONTRACT.md）
//   export function renderMeter(container)
//   export function showJudgement(container, { offsetMs, tier })
//   tier: 'perfect' | 'good' | 'off' | 'misfire'

/** 目盛りの端（ms）。同時打鍵が成立しなくなる幅に合わせてある */
const FULL_MS = 80;

/** 判定の窓（ms）。CSS の .meter__zone の幅（18.75% / 43.75%）と対になっている。
    ここを変えたら app.css の 2 か所も直すこと */
const PERFECT_MS = 15;
const GOOD_MS = 35;

/** 直近何打を «クセ» として見るか。少なすぎると運に振られ、多すぎると直した結果が出ない */
const HISTORY = 16;

/** 中央値がこれを超えたら、癖として色を付ける（ms） */
const BIAS_MS = 20;

/** container ごとの持ち物。DOM に状態を書かず、参照はここに閉じ込める */
const store = new WeakMap();

const reduceMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/** -1〜1 の素の数にする。CSS 側で calc(50% + var(--at) * 50%) として使う */
function toAt(ms) {
  return Math.max(-1, Math.min(1, ms / FULL_MS));
}

/** 符号を必ず付ける。「8ms」だけでは先行か遅れか分からない */
function fmtMs(ms) {
  const v = Math.round(ms);
  return `${v > 0 ? '+' : v < 0 ? '-' : '±'}${Math.abs(v)}ms`;
}

const dirWord = (ms) => (ms < 0 ? '先行' : '遅れ');

/**
 * 判定の言葉と、直し方の一行。
 * off と misfire では advice を必ず埋める。ここが空だと、
 * 「ずれている」とだけ言われて何をすればいいか分からない道具になる。
 */
function wordsFor(tier, offsetMs) {
  if (tier === 'misfire') {
    return {
      verdict: '不発',
      value: 'シフトが効いていません',
      advice: '親指を先に沈めて、文字キーを離すまで押したままにしてください。',
    };
  }
  if (offsetMs == null) {
    return { verdict: '単独打鍵', value: '', advice: '' };
  }
  if (tier === 'perfect') {
    return { verdict: 'ぴったり', value: fmtMs(offsetMs), advice: '' };
  }
  if (tier === 'good') {
    return { verdict: '良い', value: `${fmtMs(offsetMs)} ${dirWord(offsetMs)}`, advice: '' };
  }
  // off。向きで直し方が真逆になるので、文言も左右で分ける
  return offsetMs < 0
    ? {
        verdict: '先行',
        value: `${fmtMs(offsetMs)} 親指が早い`,
        advice: '親指を沈めるのが早すぎます。文字キーと同じ瞬間に落とすつもりで。',
      }
    : {
        verdict: '遅れ',
        value: `${fmtMs(offsetMs)} 親指が遅い`,
        advice: '親指が遅れています。文字キーより先に親指を沈めるつもりで。',
      };
}

function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * メーターの骨格を組む。container の中身は総取り替えになる。
 * 同じ container に何度呼んでも構わない（履歴は消える）。
 */
export function renderMeter(container) {
  if (!container) return;
  container.classList.add('meter');
  container.dataset.tier = 'none';

  const verdict = el('p', 'meter__verdict');
  const verdictWord = el('span', 'meter__word', '—');
  const value = el('span', 'meter__value');
  verdict.append(verdictWord, value);

  // 傾向の三角。レールと同じ横軸に置く
  const trend = el('div', 'meter__trend');
  const trendMark = el('span', 'meter__trendMark');
  trendMark.hidden = true;
  trend.append(trendMark);

  const rail = el('div', 'meter__rail');
  rail.append(
    el('i', 'meter__zone meter__zone--good'),
    el('i', 'meter__zone meter__zone--perfect'),
    el('i', 'meter__center'),
  );
  const needle = el('i', 'meter__needle');
  rail.append(needle);

  const dots = el('div', 'meter__dots');

  const ends = el('div', 'meter__ends');
  ends.append(
    el('span', 'meter__end meter__end--early', '◀ 先行（親指が先）'),
    el('span', 'meter__end meter__end--mid', 'ぴったり'),
    el('span', 'meter__end meter__end--late', '遅れ（親指が後）▶'),
  );

  const scale = el('div', 'meter__scale');
  scale.append(ends, trend, rail, dots);

  const advice = el('p', 'meter__advice');

  // 読み上げ。1 打ごとに喋らせるとうるさいので、
  // off と misfire のときだけ中身を入れる
  const sr = el('p', 'meter__sr');
  sr.setAttribute('role', 'status');
  sr.setAttribute('aria-live', 'polite');

  container.replaceChildren(verdict, scale, advice, sr);

  store.set(container, {
    verdictWord,
    value,
    needle,
    trend,
    trendMark,
    dots,
    advice,
    sr,
    history: [],
  });
}

/**
 * 1 打の判定を出す。
 * @param {{ offsetMs: number|null, tier: 'perfect'|'good'|'off'|'misfire' }} judgement
 */
export function showJudgement(container, { offsetMs = null, tier = 'off' } = {}) {
  if (!container) return;
  if (!store.has(container)) renderMeter(container);
  const s = store.get(container);

  const hasOffset = typeof offsetMs === 'number' && Number.isFinite(offsetMs);
  const shownTier = tier === 'misfire' ? 'misfire' : hasOffset ? tier : 'none';
  container.dataset.tier = shownTier;
  container.dataset.dir = hasOffset ? (offsetMs < 0 ? 'early' : offsetMs > 0 ? 'late' : 'none') : 'none';

  const w = wordsFor(tier, hasOffset ? offsetMs : null);
  s.verdictWord.textContent = w.verdict;
  s.value.textContent = w.value;
  s.advice.textContent = w.advice;

  // 声に出すのは、直す必要があるときだけ
  s.sr.textContent = tier === 'off' || tier === 'misfire' ? `${w.verdict} ${w.value}` : '';

  if (hasOffset) {
    s.needle.style.setProperty('--at', String(toAt(offsetMs)));
    s.needle.classList.toggle('is-clamped', Math.abs(offsetMs) >= FULL_MS);
  }

  // 履歴。不発は «時間差» を持たないが、散らばりの絵には出したいので印だけ残す
  s.history.push({ offsetMs: hasOffset ? offsetMs : null, tier });
  if (s.history.length > HISTORY) s.history.shift();

  drawDots(s);
  drawTrend(s);

  if (!reduceMotion && typeof s.verdictWord.animate === 'function') {
    // 節目ではないので、跳ねさせない。分かる程度に一瞬だけ
    s.verdictWord.animate(
      [{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
      { duration: 160, easing: 'ease-out' },
    );
  }
}

function drawDots(s) {
  const n = s.history.length;
  const dots = s.history.map((h, i) => {
    const d = el('i', 'meter__dot');
    d.dataset.tier = h.tier;
    // 古いものほど薄く。直近の並びが自然に浮き上がる
    d.style.setProperty('--fade', String(0.25 + (0.75 * (i + 1)) / n));
    if (h.offsetMs != null) d.style.setProperty('--at', String(toAt(h.offsetMs)));
    return d;
  });
  s.dots.replaceChildren(...dots);
}

function drawTrend(s) {
  const offsets = s.history.filter((h) => h.offsetMs != null).map((h) => h.offsetMs);
  // 3 打では «クセ» とは言えない。溜まるまで出さない
  if (offsets.length < 5) {
    s.trendMark.hidden = true;
    return;
  }
  const m = median(offsets);
  s.trendMark.hidden = false;
  s.trendMark.style.setProperty('--at', String(toAt(m)));
  s.trendMark.textContent =
    Math.abs(m) < PERFECT_MS
      ? `直近のクセ ${fmtMs(m)}`
      : `直近のクセ ${fmtMs(m)} ${dirWord(m)}`;
  s.trend.classList.toggle('is-biased', Math.abs(m) >= BIAS_MS);
}

/**
 * 課題をやり直すときに履歴を捨てる。
 * 前の回のクセを引きずったまま «直近の中央値» を出すと嘘になる。
 */
export function resetMeter(container) {
  if (!container || !store.has(container)) return;
  const s = store.get(container);
  s.history = [];
  container.dataset.tier = 'none';
  container.dataset.dir = 'none';
  s.verdictWord.textContent = '—';
  s.value.textContent = '';
  s.advice.textContent = '';
  s.sr.textContent = '';
  s.trendMark.hidden = true;
  s.dots.replaceChildren();
  s.needle.style.setProperty('--at', '0');
  s.needle.classList.remove('is-clamped');
}

/** 判定の境目。プレイ側が tier を決めるときに、同じ数を使えるように公開しておく */
export const THRESHOLDS = { perfect: PERFECT_MS, good: GOOD_MS, full: FULL_MS };

/** offsetMs から tier を決める。境目の定義が 2 か所に散らないようにするための小道具 */
export function tierOf(offsetMs) {
  if (offsetMs == null || !Number.isFinite(offsetMs)) return 'misfire';
  const a = Math.abs(offsetMs);
  if (a <= PERFECT_MS) return 'perfect';
  if (a <= GOOD_MS) return 'good';
  return 'off';
}
