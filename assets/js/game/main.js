// タイピングゲーム（game.html）の配線。題材は工場の検品ライン。
//
// このファイルは何か
//   キー入力 → nicola.js（同時打鍵の判定）→ engine.js（ゲームの決まり）→ 画面と音
//   をつなぎ、タイトル・カウントダウン・検品中・結果・ランキング・参加の同意の画面を切り替える。
//   判断は持たない。ゲームの決まりは engine.js、送受信は ranking.js にある。
//   2026-11-02 に «回転ずし» から題材だけ替えた（皿 → ラインの作業品、円 → pt、コースの値段 → ノルマ）。
//   採点（値段・出る順・連打メーター・結果の項目）は寿司打と同じ数値と算出方法。courses.js の注記を見よ
//
// なぜ app.js と同じやり方で入力を取るのか
//   同時打鍵の判定は「押した時刻」と「離した時刻」の両方が要る。練習画面と同じ設定
//   （親指キー・閾値・緩和の有無）で同じ判定機を作らないと、練習では通る打ち方が
//   ゲームでは通らない、ということが起きる。だから設定は storage.js の loadSettings() から
//   そのまま読み、keydown / keyup / blur / rAF の扱いも app.js と同じ方針にしてある
//   （オートリピートは無視・IME がオンなら言う・blur で抱えたキーを捨てる・Esc で中断）。
//
// ラインの絵
//   canvas は使わない。作業品一つを一つの要素にして、engine.js の x（0..1）を transform で動かす。
//   作業品は数個しか無いので DOM で足り、文字は本文と同じ書体のまま読める。
//
// デモ用の入口（?demo=play など）
//   見た目を目で確かめるためだけの入口。疑似の打鍵を engine に流して、ある瞬間の画面で止める。
//   URL に demo が無いときは一切走らない。本番の動きはこの分岐の外にある。

import { createNicola } from '../nicola.js';
import { createRomaji, romajiKeyOf } from '../romaji.js';
import { loadLayout, thumbSideOf } from '../layout.js';
import { loadSettings } from '../storage.js';
import { createSound } from '../sound.js';
import { offsetBinOf, OFFSET_BINS } from '../trophies.js';
import { renderScope } from '../charts.js';
import { createSfx, loadSfxOn, saveSfxOn } from './sfx.js';
import { COURSES } from './courses.js';
import { WORDS } from './words.js';
import { createGame, keyFor } from './engine.js';
import { icon, fillIcons } from '../icons.js';
import {
  rankingEnabled, currentPlayer, register, submitScore, fetchRanking, forgetMe, CONSENT_VERSION,
} from './ranking.js';
import { SUPPORT_URL } from './config.js';

// ---------------------------------------------------------------- 準備

const $ = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`game.html に #${id} が無い`);
  return node;
};

const TONES = ['midnight', 'matcha', 'plum', 'sumi'];
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo');

const settings = loadSettings();
// デモのときだけ、配色を URL で替えられる（4 配色の見え方を確かめるため）
const tone = DEMO && TONES.includes(params.get('tone')) ? params.get('tone') : settings.tone;
document.documentElement.dataset.tone = TONES.includes(tone) ? tone : 'midnight';

const layout = loadLayout('nicola');
const thumbKeys = {
  left: settings.thumbKeys?.left ?? layout.thumbKeys.left,
  right: settings.thumbKeys?.right ?? layout.thumbKeys.right,
};
const sound = createSound({ volume: settings.soundVolume ?? 0.4, kind: settings.sound ?? 'off' });
const sfx = createSfx({ on: loadSfxOn() });

/** X で共有するときに添えるページの URL。公開先が変わったらここを直す */
const SHARE_URL = 'https://kanade0525.github.io/oyayubi-dojo/game.html';

// ---------------------------------------------------------------- 入力方式
//
// 親指シフトかローマ字か。同じ語・同じコースで遊んで比べられるようにする。
// 選んだ方式はこの端末に覚える。読めなければ親指シフト

const INPUT_KEY = 'oyayubi-dojo:gameinput:v1';
const INPUTS = ['nicola', 'romaji'];
const INPUT_NAME = { nicola: '親指シフト', romaji: 'ローマ字' };

function loadInput() {
  try {
    const v = localStorage.getItem(INPUT_KEY);
    return INPUTS.includes(v) ? v : 'nicola';
  } catch {
    return 'nicola';
  }
}

function saveInput(v) {
  try {
    localStorage.setItem(INPUT_KEY, v);
  } catch {
    /* 覚えられなくても、この回はその方式で遊べる */
  }
}

let inputMode = loadInput();

const el = {
  scTitle: $('scTitle'),
  scPlay: $('scPlay'),
  scResult: $('scResult'),
  scRanking: $('scRanking'),
  scConsent: $('scConsent'),
  inputPick: $('inputPick'),
  romajiNote: $('romajiNote'),
  courseList: $('courseList'),
  thumbNote: $('thumbNote'),
  thumbNames: $('thumbNames'),
  soundNote: $('soundNote'),
  btnSfx: $('btnSfx'),
  imeWarn: $('imeWarn'),
  hudTime: $('hudTime'),
  hudScore: $('hudScore'),
  hudTarget: $('hudTarget'),
  hudMeter: $('hudMeter'),
  hudMeterNext: $('hudMeterNext'),
  hudKps: $('hudKps'),
  line: $('line'),
  lineItems: $('lineItems'),
  cueCount: $('cueCount'),
  cueWord: $('cueWord'),
  cueRomaji: $('cueRomaji'),
  cueHit: $('cueHit'),
  resultMode: $('resultMode'),
  resultScore: $('resultScore'),
  resultBalance: $('resultBalance'),
  resultBest: $('resultBest'),
  resultTally: $('resultTally'),
  resultOffset: $('resultOffset'),
  resultPerfect: $('resultPerfect'),
  resultScope: $('resultScope'),
  resultScopeNote: $('resultScopeNote'),
  submitBox: $('submitBox'),
  btnAgain: $('btnAgain'),
  btnShare: $('btnShare'),
  btnTitle: $('btnTitle'),
  btnRankingFromTitle: $('btnRankingFromTitle'),
  btnRankingFromResult: $('btnRankingFromResult'),
  rankCourseTabs: $('rankCourseTabs'),
  rankBoardTabs: $('rankBoardTabs'),
  rankPeriodTabs: $('rankPeriodTabs'),
  rankOrder: $('rankOrder'),
  rankLeaders: $('rankLeaders'),
  rankStatus: $('rankStatus'),
  rankList: $('rankList'),
  rankMe: $('rankMe'),
  btnRankBack: $('btnRankBack'),
  btnRegister: $('btnRegister'),
  btnForget: $('btnForget'),
  consentVersion: $('consentVersion'),
  nickname: $('nickname'),
  consentCheck: $('consentCheck'),
  consentError: $('consentError'),
  btnConsent: $('btnConsent'),
  btnConsentCancel: $('btnConsentCancel'),
};

const num = (n) => Math.round(n).toLocaleString('ja-JP');

/** DOM を組むための小さな道具。innerHTML を使わないので、要素は全部ここで作る */
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

/** 親指シフトのときだけ出す部品（data-nicola）を出し入れする */
function showNicolaParts(root, on) {
  for (const n of root.querySelectorAll('[data-nicola]')) n.hidden = !on;
}

// ---------------------------------------------------------------- 自己ベスト（この端末だけ）
//
// ランキングに参加しなくても «前の自分» と比べられるようにする。送らない。
// 保存できない環境でも遊べることが先なので、読めなければ «記録なし»、書けなければ何もしない。
// 入力方式×コースごとに一つ: { nicola: { p3000: { score, kpm, at } }, romaji: { … } }。
// 回転ずしの記録（gamebest:v1 / v2）は円の記録なので読まない

const BEST_KEY = 'oyayubi-dojo:gamebest:v3';

function loadBest() {
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  try {
    const v = obj(JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}'));
    return { nicola: obj(v.nicola), romaji: obj(v.romaji) };
  } catch {
    return { nicola: {}, romaji: {} };
  }
}

function saveBest(summary) {
  const all = loadBest();
  const mine = all[summary.input];
  const prev = Number.isFinite(mine[summary.course]?.score) ? mine[summary.course] : null;
  const isBest = !prev || summary.score > prev.score;
  if (isBest) {
    mine[summary.course] = { score: summary.score, kpm: Math.round(summary.kpm), at: Date.now() };
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(all));
    } catch {
      /* 書けなくても結果画面は出す */
    }
  }
  return { isBest, prev };
}

// ---------------------------------------------------------------- 画面の切り替え

/** 'title' | 'countdown' | 'play' | 'over' | 'result' | 'ranking' | 'consent' | 'demo' */
let screen = 'title';
let backFromRanking = 'title';

function show(name) {
  screen = name;
  el.scTitle.hidden = name !== 'title';
  el.scPlay.hidden = !['countdown', 'play', 'over', 'demo'].includes(name);
  el.scResult.hidden = name !== 'result';
  el.scRanking.hidden = name !== 'ranking';
  el.scConsent.hidden = name !== 'consent';
  if (name !== 'play' && name !== 'countdown') el.imeWarn.hidden = true;
}

// ---------------------------------------------------------------- タイトル

const KEY_NAME = { Lang2: '英数', Lang1: 'かな', KanaMode: 'かな', NonConvert: '無変換', Convert: '変換', Space: 'スペース' };
const nameOfCodes = (codes) => KEY_NAME[codes[0]] ?? codes[0];
const KEY_OF = ['1', '2', '3'];

function paintTitle() {
  const nicolaMode = inputMode === 'nicola';
  for (const b of el.inputPick.querySelectorAll('[data-input]')) {
    b.setAttribute('aria-pressed', String(b.dataset.input === inputMode));
  }
  showNicolaParts(el.scTitle, nicolaMode);
  el.thumbNote.hidden = !nicolaMode;
  el.thumbNames.textContent = `左 ${nameOfCodes(thumbKeys.left)} ／ 右 ${nameOfCodes(thumbKeys.right)}`;

  const best = loadBest()[inputMode];
  el.courseList.replaceChildren(
    ...COURSES.map((c, i) => {
      const b = best[c.id];
      const btn = h('button', { type: 'button', class: 'g-course', role: 'listitem', dataset: { course: c.id } },
        h('span', { class: 'g-course__go', dataset: { icon: 'play' } }),
        h('span', { class: 'g-course__main' },
          h('small', { class: 'g-course__label' }, 'ノルマ'),
          h('b', { class: 'g-course__target' }, num(c.target), h('small', {}, 'pt')),
          h('span', { class: 'g-course__meta' }, `${c.timeMs / 1000} 秒・${c.minLen}〜${c.maxLen} 字・作業品 ${c.prices[0].price}〜${c.prices[c.prices.length - 1].price}`),
          h('span', { class: 'g-course__best' }, b ? `自己ベスト ${num(Math.abs(b.score - c.target))} pt ${b.score >= c.target ? 'お得' : '損'}` : 'まだ打っていません')),
        h('kbd', {}, KEY_OF[i] ?? ''),
      );
      btn.addEventListener('click', () => begin(c));
      return btn;
    }),
  );
  fillIcons(el.courseList);

  paintSfx();
  // 打鍵音はズレを耳で返すもの。ローマ字ではズレが無いので出さない
  el.soundNote.hidden = !nicolaMode;
  el.soundNote.replaceChildren(
    '打鍵音：',
    settings.sound && settings.sound !== 'off' ? settings.sound : '無音',
    '（', h('a', { class: 'link', href: 'index.html#/setup' }, '設定'), '）',
  );
}

function paintSfx() {
  const b = el.btnSfx;
  if (!sfx.available) {
    b.disabled = true;
    b.replaceChildren(icon('soundOff'), '効果音：この環境では鳴りません');
    return;
  }
  b.setAttribute('aria-pressed', String(sfx.enabled));
  b.replaceChildren(icon(sfx.enabled ? 'soundOn' : 'soundOff'), sfx.enabled ? '効果音：オン' : '効果音：オフ');
}

el.inputPick.addEventListener('click', (e) => {
  const b = e.target.closest('[data-input]');
  if (!b || !INPUTS.includes(b.dataset.input)) return;
  inputMode = b.dataset.input;
  saveInput(inputMode);
  paintTitle();
});

el.btnSfx.addEventListener('click', () => {
  sfx.setEnabled(!sfx.enabled);
  saveSfxOn(sfx.enabled);
  paintSfx();
  if (sfx.enabled) sfx.take();   // 切り替えた結果がその場で耳で分かるように
});

// ---------------------------------------------------------------- 遊ぶ

let course = null;
let game = null;
let nicola = null;
let romaji = null;      // ローマ字で遊んでいるときだけ
let romajiItem = null;  // romaji の打ちかけが、どの作業品のものか
let romajiKeys = 0;     // ローマ字で、まだかなになっていない正しいキーの数。かなを打ち切ったときに engine へ渡す
let playInput = 'nicola'; // この回の入力方式。遊んでいる途中でタイトルの選択が変わっても動かない
let countdownEnd = 0;
let curT = 0;           // いま処理している入力の時刻。onOutput には時刻が付かないので預けておく
let imeUntil = 0;
let lastResult = null;  // 直前の nicola の出力（音にズレを渡すため）
let summary = null;
let bestInfo = null;
let perfectItems = new Set(); // ぴったりを一打でも含んだ作業品。通したときの音を変える
let lastCount = 0;      // カウントダウンで最後に鳴らした数
let lastTick = 0;       // 残り時間の刻みで最後に鳴らした秒
let hitView = null;     // 直前の一打の返し（«が +10 右親指 −4ms ぴったり» の行）
let lastPainted = '';
const flash = new Map(); // 作業品 id → { kind: 'clear' | 'lost', until }。通した・漏れたの一瞬の印

function buildNicola() {
  return createNicola({
    layout,
    thumbKeys,
    tau: settings.tau ?? 80,
    charTimeout: settings.charTimeout ?? 150,
    thumbTimeout: settings.thumbTimeout ?? 250,
    lenientRelease: settings.lenientRelease !== false,
    continuousShift: settings.continuousShift === true,
    onOutput(result) {
      if (!game || screen !== 'play') return;
      lastResult = result;
      handle(game.input(result, curT), curT);
    },
  });
}

function begin(c) {
  sound.prime();
  sfx.prime();
  startCountdown(c);
}

function startCountdown(c) {
  course = c;
  game = createGame({ course: c, words: WORDS, rng: Math.random });
  playInput = inputMode;
  nicola = playInput === 'nicola' ? buildNicola() : null;
  romaji = playInput === 'romaji' ? createRomaji() : null;
  romajiItem = null;
  romajiKeys = 0;
  countdownEnd = performance.now() + 3000;
  perfectItems = new Set();
  lastCount = 0;
  lastTick = 0;
  hitView = null;
  lastPainted = '';
  flash.clear();
  el.lineItems.replaceChildren();
  el.hudTarget.textContent = `/ ${num(c.target)} pt`;
  show('countdown');
  // ボタンに残ったフォーカスで、スペースや Enter が «もう一度押した» にならないように
  document.activeElement?.blur?.();
}

function startPlay(t) {
  sfx.count(0);
  game.start(t);
  show('play');
}

/** engine の events を画面と音に流す */
function handle(events, t) {
  if (!events.length) return;
  for (const e of events) {
    if (e.type === 'hit') {
      if (lastResult?.thumb && lastResult.offsetMs != null) {
        sound.shifted({ tier: e.tier, offsetMs: lastResult.offsetMs });
      } else {
        sound.hit();
      }
      hitView = { kind: 'hit', ...e, thumb: lastResult?.thumb ?? null, offsetMs: lastResult?.offsetMs ?? null };
      if (e.tier === 'perfect') perfectItems.add(e.itemId);
    } else if (e.type === 'miss') {
      if (e.misfire) sound.misfire();
      else sound.miss();
      hitView = { kind: 'miss', ...e };
    } else if (e.type === 'hit' && e.tier === 'perfect') {
      perfectItems.add(e.itemId);
    } else if (e.type === 'clear') {
      // 通した音は sfx.js が受け持つ（打鍵音の設定が無音でも鳴る）
      sfx.take({ perfect: perfectItems.has(e.itemId) });
      flash.set(e.itemId, { kind: 'clear', at: t, value: e.value, x: 1 });
    } else if (e.type === 'lost') {
      sfx.lost();
      flash.set(e.itemId, { kind: 'lost', at: t, x: 1 });
    } else if (e.type === 'meter') {
      sfx.combo();
    } else if (e.type === 'over') {
      sfx.end();
      finishGame(t);
    }
  }
}

/** ローマ字の一打。打ち切ったかなの数だけ engine に渡し、合わない字はミスとして渡す */
function pressRomaji(ch, t) {
  const head = game.state.items[0];
  if (!head) return;
  if (head.id !== romajiItem) {
    romaji.reset();
    romajiItem = head.id;
    romajiKeys = 0;
  }
  const chars = [...head.word.kana];
  const res = romaji.press(chars, head.typed, ch);
  lastResult = null;
  if (!res.ok) {
    handle(game.input({ kana: null, charCode: 'Romaji', thumb: null, offsetMs: null }, t), t);
    return;
  }
  // 寿司打と同じく «キー» で数える（正しく打ったキーの数・連打メーター）。
  // 打ち切ったかなの一つ目に、それまでに押したキーをまとめて渡す
  romajiKeys++;
  const from = head.typed;
  for (let i = 0; i < res.done; i++) {
    const keys = i === 0 ? romajiKeys : 0;
    romajiKeys = 0;
    handle(game.input({ kana: chars[from + i], charCode: 'Romaji', thumb: null, offsetMs: null, keys: keys || undefined }, t), t);
    if (screen !== 'play') return;
  }
}

/** 語の下に出す、打ちかけのローマ字と残りの綴り */
function romajiView() {
  if (!romaji || !game) return null;
  const head = game.state.items[0];
  if (!head) return null;
  if (head.id !== romajiItem) {
    romaji.reset();
    romajiItem = head.id;
  }
  const chars = [...head.word.kana];
  let rest = '';
  // 残りを全部綴る。いまの塊は打ちかけの続きから、その先は案内の綴りで
  const r = createRomaji();
  for (let pos = head.typed, first = true; pos < chars.length; first = false) {
    const hint = first ? romaji.hint(chars, pos) : r.hint(chars, pos);
    if (!hint) break;
    rest += hint.rest;
    pos += hint.n;
  }
  return { typed: romaji.buffer, rest };
}

function finishGame(t) {
  summary = { ...game.summary(), input: playInput };
  bestInfo = saveBest(summary);
  // 前の回の「送りました」やエラーを持ち越さない。持ち越すと次の結果が送れなくなる
  submitState = { busy: false, msg: '', kind: '' };
  nicola?.reset();
  screen = 'over';
  sound.finish({ best: bestInfo.isBest });
  // 最後の作業品の様子を見せてから結果を出す。すぐ切り替えると «何で終わったか» が見えない
  setTimeout(() => {
    if (screen !== 'over') return;
    paintResult();
    show('result');
    // 打ち終えた勢いのキーで «もう一度» が押されないよう、少し待ってから焦点を当てる
    setTimeout(() => {
      if (screen === 'result') el.btnAgain.focus();
    }, 600);
  }, 900);
  void t;
}

function abortToTitle() {
  nicola?.reset();
  game = null;
  nicola = null;
  romaji = null;
  paintTitle();
  show('title');
}

// ---------------------------------------------------------------- 検品中の画面

const THUMB_NAME = { left: '左親指', right: '右親指' };
const TIER_NAME = { perfect: 'ぴったり', good: '良い', off: 'ずれ' };
const fmtMs = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v))}ms`;
const keyName = (code) => code.replace(/^Key/, '').replace(/^Digit/, '')
  .replace('Semicolon', ';').replace('Comma', ',').replace('Period', '.').replace('Slash', '/');

/** 一打の返し。«が ぴったり +10 右親指 −4ms» / 外れたら正しい打ち方 */
function paintHit() {
  const v = hitView;
  if (!v) { el.cueHit.replaceChildren(); return; }
  if (v.kind === 'miss') {
    const how = keyFor(v.expected);
    const way = how ? `${how.thumb ? `${THUMB_NAME[how.thumb]} ＋ ` : ''}${keyName(how.code)}` : '';
    const say = v.misfire ? '親指が効いていません' : (game?.state.missStreak ?? 0) >= 2 ? '打ち方' : null;
    el.cueHit.replaceChildren(
      h('span', { class: 'g-cue__kana' }, v.expected),
      h('small', { class: 'is-miss' }, say ? `${say}：${way}` : '外れ'),
    );
    return;
  }
  el.cueHit.replaceChildren(...[
    h('span', { class: 'g-cue__kana' }, v.kana),
    v.tier ? h('small', { class: v.tier === 'perfect' ? 'g-ok' : '' }, `${THUMB_NAME[v.thumb] ?? ''} ${fmtMs(v.offsetMs)} ${TIER_NAME[v.tier]}`) : null,
  ].filter(Boolean));
}

/** 打つ語（先頭の作業品）を大きく。ラインの札は小さいので、読むのはこちら */
function paintCue(st) {
  const head = st.items[0];
  if (!head) {
    el.cueWord.replaceChildren();
    el.cueRomaji.hidden = true;
    return;
  }
  // 大きく見せるのは label（漢字かな交じり）。打つのは下のかな
  const chars = [...head.word.kana];
  el.cueWord.replaceChildren(
    h('span', { class: 'g-cue__label' }, head.word.label ?? head.word.kana),
    h('span', { class: 'g-cue__yomi' },
      h('span', { class: 'is-done' }, chars.slice(0, head.typed).join('')),
      h('span', { class: 'is-cur' }, chars[head.typed] ?? ''),
      h('span', {}, chars.slice(head.typed + 1).join(''))),
  );
  const rv = romajiView();
  el.cueRomaji.hidden = !rv;
  if (rv) el.cueRomaji.replaceChildren(h('b', {}, rv.typed), rv.rest);
}

/**
 * ラインの作業品。id ごとに要素を一つ持ち、毎フレーム位置（x）だけ書き換える。
 * 通した・漏れたものは、出口で少しだけ印を見せてから消す
 */
const nodes = new Map();
const FLASH_MS = 450;

function itemNode(id) {
  let n = nodes.get(id);
  if (!n) {
    n = {
      root: h('div', { class: 'g-item' }),
      word: h('span', { class: 'g-item__word' }),
      value: h('span', { class: 'g-item__value' }),
      key: '',
    };
    n.root.append(n.word, n.value);
    el.lineItems.append(n.root);
    nodes.set(id, n);
  }
  return n;
}

function paintLine(st, t) {
  const live = new Set();
  st.items.forEach((it, i) => {
    live.add(it.id);
    const n = itemNode(it.id);
    // 入口（x=0）から出口（x=1）まで。作業品の幅ぶん内側に収める
    n.root.style.setProperty('--x', String(Math.min(1, Math.max(0, it.x))));
    n.root.classList.toggle('is-head', i === 0);
    n.root.classList.toggle('is-perfect', it.perfect > 0);
    const key = `${it.typed}|${it.value}`;
    if (key !== n.key) {
      n.key = key;
      n.word.textContent = it.word.label ?? it.word.kana;
      n.value.textContent = `${num(it.value)}`;
    }
  });
  for (const [id, n] of nodes) {
    if (live.has(id)) continue;
    const f = flash.get(id);
    if (f && t - f.at < FLASH_MS) {
      n.root.classList.add(f.kind === 'clear' ? 'is-clear' : 'is-lost');
      n.root.classList.remove('is-head');
      n.value.textContent = f.kind === 'clear' ? `+${num(f.value)}` : '検品漏れ';
      continue;
    }
    n.root.remove();
    nodes.delete(id);
    flash.delete(id);
  }
}

function paintPlay(t) {
  const st = game.state;
  if (screen === 'countdown') {
    el.cueCount.hidden = false;
    el.cueCount.textContent = String(Math.max(1, Math.ceil((countdownEnd - t) / 1000)));
    el.hudTime.textContent = (course.timeMs / 1000).toFixed(1);
    el.hudScore.textContent = '0';
    el.hudMeter.textContent = '0';
    el.hudMeterNext.textContent = '';
    el.hudKps.textContent = '0.0';
    el.cueWord.replaceChildren();
    el.cueRomaji.hidden = true;
    el.cueHit.replaceChildren();
    return;
  }
  el.cueCount.hidden = true;
  el.hudTime.textContent = (st.remainingMs / 1000).toFixed(1);
  el.hudScore.textContent = num(st.score);
  el.hudScore.classList.toggle('g-ok', st.score >= course.target);
  el.hudMeter.textContent = String(st.meterKeys);
  el.hudMeterNext.textContent = `/ ${st.meterNext}`;
  el.hudKps.textContent = st.elapsedMs > 1000 ? (Math.floor((st.correctKeys / (st.elapsedMs / 1000)) * 10) / 10).toFixed(1) : '0.0';
  paintLine(st, t);
  // 語と返しは変わったときだけ組み直す（毎フレーム DOM を作り直さない）
  const head = st.items[0];
  const key = `${head?.id}|${head?.typed}|${st.misses}|${romaji?.buffer ?? ''}|${hitView?.kana ?? ''}`;
  if (key !== lastPainted) {
    lastPainted = key;
    paintCue(st);
    paintHit();
  }
}

// ---------------------------------------------------------------- 結果

/** ズレの配列 → renderScope が受け取る集計の形（左右を分けずに left に入れる） */
function aggOf(offsets) {
  const hist = new Array(OFFSET_BINS).fill(0);
  let sum = 0;
  for (const v of offsets) {
    hist[offsetBinOf(v)]++;
    sum += v;
  }
  return { left: { hist, n: offsets.length, sum }, right: {} };
}

function paintResult() {
  const s = summary;
  const nicolaMode = s.input === 'nicola';
  showNicolaParts(el.scResult, nicolaMode);
  el.resultMode.textContent = `ノルマ ${num(course.target)} pt・${course.timeMs / 1000} 秒・${INPUT_NAME[s.input]}`;
  el.resultScore.textContent = num(s.score);

  const done = s.balance >= 0;
  const avg = s.cleared ? s.score / s.cleared : 0;
  // replaceChildren は null を «null» という文字にして入れる（h() と違って飛ばさない）
  el.resultBalance.replaceChildren(...[
    h('b', { class: done ? 'g-ok' : 'is-short' }, done ? `${num(s.balance)} pt お得` : `${num(-s.balance)} pt 損`),
    !done && avg ? h('small', {}, `（あと作業品 ${Math.ceil(-s.balance / avg)} 個ほど）`) : null,
  ].filter(Boolean));

  el.resultBest.hidden = !bestInfo?.isBest;
  el.resultBest.textContent = bestInfo?.prev ? `自己ベスト更新（前回 ${num(bestInfo.prev.score)} pt）` : 'はじめての記録';

  const cell = (k, v, unit, cls) => h('div', {}, h('dt', {}, k), h('dd', cls ? { class: cls } : {}, v, unit ? h('small', {}, unit) : null));
  el.resultTally.replaceChildren(...[
    cell('正しく打ったキーの数', String(s.correctKeys), '回'),
    cell('平均キータイプ数', s.keysPerSec.toFixed(1), '回/秒'),
    cell('ミスタイプ数', String(s.misses), '回'),
    cell('通した作業品', String(s.cleared), '個'),
  ].filter(Boolean));

  if (nicolaMode) {
    const mean = s.offsets.length ? s.offsets.reduce((a, b) => a + b, 0) / s.offsets.length : null;
    el.resultOffset.textContent = mean == null ? '—' : fmtMs(mean).replace('ms', '');
    el.resultPerfect.textContent = s.shifted ? String(Math.round((s.perfect / s.shifted) * 100)) : '—';
    el.resultScopeNote.textContent = `同時打鍵 ${s.shifted} 回`;
    if (s.offsets.length) renderScope(el.resultScope, aggOf(s.offsets));
    else el.resultScope.replaceChildren(h('p', { class: 'inst__empty' }, '親指を使う字のズレがここに出ます'));
  }

  el.btnShare.href = shareUrl(s);
  paintSubmit();
}

/** X の投稿画面を開く URL。投稿するかは本人が決める。こちらからは何も送らない */
function shareUrl(s) {
    const res = s.balance >= 0 ? `${num(s.balance)} pt お得` : `${num(-s.balance)} pt 損`;
  const text = `親指シフトマスターのタイピングゲーム ${num(course.target)} pt コース（${INPUT_NAME[s.input]}）で ${res}。平均キータイプ数 ${s.keysPerSec.toFixed(1)} 回/秒・ミスタイプ ${s.misses} 回`;
  const q = new URLSearchParams({ text, url: SHARE_URL, hashtags: '親指シフト' });
  return `https://x.com/intent/tweet?${q}`;
}

let submitState = { busy: false, msg: '', kind: '' };

function paintSubmit() {
  const box = el.submitBox;
  if (!rankingEnabled()) {
    box.replaceChildren(soonNote());
    return;
  }
  const me = currentPlayer();
  const status = h('p', { class: `g-status ${submitState.kind ? `is-${submitState.kind}` : ''}`, role: 'status' }, submitState.msg);
  if (!me) {
    const btn = h('button', { type: 'button', class: 'btn' }, '参加して送る');
    btn.addEventListener('click', () => openConsent('result'));
    box.replaceChildren(h('p', {}, 'ランキングに参加すると、この結果を送れます。'), btn, status);
    return;
  }
  const btn = h('button', { type: 'button', class: 'btn btn--primary', disabled: submitState.busy || submitState.kind === 'ok' },
    submitState.kind === 'ok' ? '送りました' : 'ランキングに送る');
  btn.addEventListener('click', sendSummary);
  box.replaceChildren(h('p', {}, h('b', {}, me.nickname), ' として送ります。'), btn, status);
}

function soonNote() {
  return h('div', { class: 'g-soon' },
    h('b', {}, 'ランキングは準備中です'),
    'サーバーの用意ができたら、ここから結果を送れるようになります。いまは自己ベストがこの端末に残ります。');
}

async function sendSummary() {
  if (!summary || submitState.busy) return;
  const sent = summary;
  submitState = { busy: true, msg: '送っています…', kind: '' };
  paintSubmit();
  try {
    const r = await submitScore(sent);
    // 返事を待つ間に次の回が終わっていたら、古い返事で新しい結果の表示を書き換えない
    if (summary !== sent) return;
    const div = `${INPUT_NAME[sent.input]}部門 ${r?.rank ?? '—'} 位`;
    const all = `総合 ${r?.overallRank ?? '—'} 位`;
    submitState = {
      busy: false,
      kind: 'ok',
      msg: r?.isBest
        ? `送りました。${div}・${all}（自己ベスト更新）`
        : `送りました。自己ベストは ${num(r?.best ?? 0)} pt で、${div}・${all}`,
    };
  } catch (err) {
    if (summary !== sent) return;
    submitState = { busy: false, kind: 'error', msg: `送れませんでした：${err.message}` };
  }
  paintSubmit();
}

// ---------------------------------------------------------------- ランキング

const BOARDS = ['all', ...INPUTS];
const BOARD_NAME = { all: '総合', nicola: '親指シフト部門', romaji: 'ローマ字部門' };
let rankCourse = COURSES[0].id;
let rankBoard = 'all';
let rankPeriod = 'all';
let rankSeq = 0;

function openRanking(from) {
  backFromRanking = from;
  if (course) rankCourse = course.id;
  show('ranking');
  paintRankingTabs();
  loadRanking();
}

function paintRankingTabs() {
  el.rankCourseTabs.replaceChildren(
    ...COURSES.map((c) => {
      const b = h('button', { type: 'button', role: 'tab', dataset: { course: c.id } }, `${c.name} コース`);
      b.setAttribute('aria-selected', String(c.id === rankCourse));
      return b;
    }),
  );
  for (const b of el.rankBoardTabs.querySelectorAll('[data-board]')) {
    b.setAttribute('aria-selected', String(b.dataset.board === rankBoard));
  }
  for (const b of el.rankPeriodTabs.querySelectorAll('[data-period]')) {
    b.setAttribute('aria-selected', String(b.dataset.period === rankPeriod));
  }
  el.rankOrder.textContent = rankBoard === 'all'
    ? '総合は速さ（1 分あたりのかな）の順。一人一行で、入力方式を問わず速いほうの記録'
    : `${BOARD_NAME[rankBoard]}は獲得 pt の順。一人一行`;
  const me = currentPlayer();
  const on = rankingEnabled();
  el.btnRegister.hidden = !on || !!me;
  el.btnForget.hidden = !on || !me;
  el.rankMe.textContent = on && me ? `${me.nickname} として参加しています` : '';
}

function setRankStatus(content, kind = '') {
  el.rankStatus.className = `g-status ${kind ? `is-${kind}` : ''}`;
  el.rankStatus.replaceChildren(content);
}

async function loadRanking() {
  const seq = ++rankSeq;
  el.rankLeaders.hidden = true;
  el.rankList.replaceChildren();
  if (!rankingEnabled()) {
    setRankStatus(soonNote());
    return;
  }
  setRankStatus('読み込んでいます…');
  try {
    const { entries, leaders } = await fetchRanking({ course: rankCourse, board: rankBoard, period: rankPeriod });
    if (seq !== rankSeq) return; // タブを切り替えたあとに古い応答が来た
    paintLeaders(rankBoard === 'all' ? leaders : null);
    if (!entries.length) {
      setRankStatus(rankPeriod === 'month' ? '今月の記録はまだありません。' : 'まだ記録がありません。最初の一人になれます。');
      return;
    }
    setRankStatus('');
    paintBoard(entries, currentPlayer());
  } catch (err) {
    if (seq !== rankSeq) return;
    setRankStatus(`ランキングを読み込めませんでした：${err.message}`, 'error');
  }
}

/** 総合の頭に、各部門の 1 位を出す */
function paintLeaders(leaders) {
  if (!leaders) { el.rankLeaders.hidden = true; return; }
  const one = (input) => {
    const l = leaders[input];
    return h('span', {}, h('small', {}, `${BOARD_NAME[input]} 1 位`), l ? [h('b', {}, l.nickname), ` ${num(l.score)} pt`] : 'まだいません');
  };
  el.rankLeaders.replaceChildren(one('nicola'), one('romaji'));
  el.rankLeaders.hidden = false;
}

function paintBoard(rows, me) {
  for (const r of rows) {
    if (!INPUTS.includes(r.input)) throw new Error(`順位表の入力方式が違う: ${r.input}`);
  }
  // 総合は速さの順、部門は点数の順に並んで届く。並べた列を太くする
  el.rankList.dataset.order = rankBoard === 'all' ? 'kpm' : 'score';
  el.rankList.replaceChildren(
    h('li', { class: 'is-head', 'aria-hidden': 'true' },
      h('span', {}, '順位'), h('span', {}, '名前'), h('span', { class: 'i' }, '入力'), h('span', { class: 'm' }, 'pt'),
      h('span', { class: 'k' }, '速さ'), h('span', { class: 'a' }, '正確さ')),
    ...rows.map((r) => h('li', { class: me && r.nickname === me.nickname ? 'is-me' : '' },
      h('span', { class: 'r' }, String(r.rank)),
      h('span', { class: 'n' }, r.nickname),
      h('span', { class: 'i' }, INPUT_NAME[r.input]),
      h('span', { class: 'm' }, num(r.score)),
      h('span', { class: 'k' }, `${Math.round(r.kpm)}`),
      h('span', { class: 'a' }, `${(r.accuracy * 100).toFixed(0)}%`))),
  );
}

el.rankCourseTabs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-course]');
  if (!b || !COURSES.some((c) => c.id === b.dataset.course)) return;
  rankCourse = b.dataset.course;
  paintRankingTabs();
  loadRanking();
});

el.rankBoardTabs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-board]');
  if (!b || !BOARDS.includes(b.dataset.board)) return;
  rankBoard = b.dataset.board;
  paintRankingTabs();
  loadRanking();
});

el.rankPeriodTabs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-period]');
  if (!b) return;
  rankPeriod = b.dataset.period;
  paintRankingTabs();
  loadRanking();
});

el.btnRankBack.addEventListener('click', () => {
  // ランキング画面で参加・削除をしていれば送信欄の前提が変わっている。描き直してから戻る
  if (backFromRanking === 'result' && summary) { paintSubmit(); show('result'); }
  else abortToTitle();
});
el.btnRegister.addEventListener('click', () => openConsent('ranking'));
el.btnForget.addEventListener('click', async () => {
  // 取り消せない操作なので、何が消えるかを言ってから確かめる
  const ok = window.confirm('ランキングのサーバーにあるあなたの記録と、この端末の参加登録を消します。元には戻せません。消しますか？');
  if (!ok) return;
  setRankStatus('消しています…');
  try {
    await forgetMe();
    paintRankingTabs();
    await loadRanking();
    setRankStatus('記録を消しました。', 'ok');
  } catch (err) {
    setRankStatus(`消せませんでした：${err.message}`, 'error');
  }
});

// ---------------------------------------------------------------- 参加の同意

let consentFrom = 'ranking';

function openConsent(from) {
  // 参加済みなら同意画面は出さない（二重登録すると先の記録をこの端末から消せなくなる）
  if (currentPlayer()) {
    if (from === 'result' && summary) { paintSubmit(); show('result'); }
    else openRanking(backFromRanking);
    return;
  }
  consentFrom = from;
  el.consentVersion.textContent = CONSENT_VERSION;
  el.consentError.textContent = '';
  el.consentCheck.checked = false;
  syncConsent();
  show('consent');
  el.nickname.focus();
}

function syncConsent() {
  el.btnConsent.disabled = !(el.consentCheck.checked && el.nickname.value.trim());
}

el.nickname.addEventListener('input', syncConsent);
el.consentCheck.addEventListener('change', syncConsent);
el.btnConsentCancel.addEventListener('click', () => {
  if (consentFrom === 'result') { paintSubmit(); show('result'); }
  else openRanking(backFromRanking);
});
el.btnConsent.addEventListener('click', async () => {
  if (!el.consentCheck.checked) return; // ボタンは塞いであるが、念のため同意なしでは送らない
  el.btnConsent.disabled = true;
  el.consentError.textContent = '';
  try {
    await register({ nickname: el.nickname.value.trim(), consent: el.consentCheck.checked === true });
  } catch (err) {
    el.consentError.textContent = `参加できませんでした：${err.message}`;
    syncConsent();
    return;
  }
  if (consentFrom === 'result' && summary) {
    show('result');
    paintSubmit();
    await sendSummary();
  } else {
    openRanking(backFromRanking);
  }
});

// ---------------------------------------------------------------- 支援リンク

function paintSupport() {
  const slots = document.querySelectorAll('[data-support]');
  if (!SUPPORT_URL) return; // 空なら出さない（ダミーで他人に投げ銭が飛ぶのを避ける）
  let url = null;
  try {
    url = new URL(SUPPORT_URL);
  } catch {
    url = null;
  }
  for (const slot of slots) {
    slot.hidden = false;
    if (!url || url.protocol !== 'https:') {
      // 設定の誤りは黙って消さずに見せる。直すのは config.js
      slot.textContent = '支援リンクの設定（config.js の SUPPORT_URL）が https の URL になっていません';
      continue;
    }
    slot.replaceChildren(h('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, '開発を応援する（Buy Me a Coffee）'));
  }
}

// ---------------------------------------------------------------- 打鍵の受け取り

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (screen === 'consent') {
    if (e.key === 'Escape') el.btnConsentCancel.click();
    return; // ニックネームの入力はそのまま通す
  }

  if (screen === 'title') {
    const i = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code) % 3;
    if (i >= 0 && !e.repeat && COURSES[i]) {
      e.preventDefault();
      begin(COURSES[i]);
    }
    return;
  }

  if (screen === 'result') {
    if (e.key === 'Escape') { e.preventDefault(); abortToTitle(); }
    return; // Enter は焦点のある «もう一度» ボタンが受ける
  }

  if (screen === 'ranking') {
    if (e.key === 'Escape') { e.preventDefault(); el.btnRankBack.click(); }
    return;
  }

  if (screen !== 'play' && screen !== 'countdown') return;
  if (e.repeat) { e.preventDefault(); return; }   // オートリピートは打鍵ではない

  // IME が動いていると素のキーが取れない。黙って壊れるより言う
  if (e.isComposing || e.keyCode === 229 || e.key === 'Process') {
    e.preventDefault();
    imeUntil = e.timeStamp + 4000;
    el.imeWarn.hidden = false;
    return;
  }

  if (e.key === 'Escape') { e.preventDefault(); abortToTitle(); return; }

  e.preventDefault();
  if (screen !== 'play') return;   // カウントダウン中の打鍵は捨てる
  curT = e.timeStamp;
  if (romaji) {
    const ch = romajiKeyOf(e.key);
    if (ch == null) return;
    if (imeUntil && e.timeStamp > imeUntil) el.imeWarn.hidden = true;
    pressRomaji(ch, e.timeStamp);
    return;
  }
  if (!nicola) return;
  if (thumbSideOf(thumbKeys, e.code) == null && imeUntil && e.timeStamp > imeUntil) el.imeWarn.hidden = true;
  nicola.keyDown(e.code, e.timeStamp);
});

window.addEventListener('keyup', (e) => {
  if (screen !== 'play' || !nicola) return;
  e.preventDefault();
  curT = e.timeStamp;
  nicola.keyUp(e.code, e.timeStamp);
});

// 別の窓へ行ったら、抱えているキーを捨てる。規格の「初期化」にあたる。
// これが無いと、戻ってきたときに押しっぱなし扱いのキーが残る
window.addEventListener('blur', () => { nicola?.reset(); });

el.btnAgain.addEventListener('click', () => begin(course));
el.btnTitle.addEventListener('click', abortToTitle);
el.btnRankingFromTitle.addEventListener('click', () => openRanking('title'));
// ヘッダーのランキング。遊んでいる最中は押しても何もしない（一回をうっかり捨てさせない）
$('navRanking').addEventListener('click', () => {
  if (screen === 'play' || screen === 'countdown' || screen === 'over') return;
  openRanking(screen === 'result' ? 'result' : 'title');
});
el.btnRankingFromResult.addEventListener('click', () => openRanking('result'));

// ---------------------------------------------------------------- 毎フレーム

function frame(t) {
  if (screen === 'countdown') {
    const n = Math.ceil((countdownEnd - t) / 1000);
    if (n > 0 && n !== lastCount) {
      lastCount = n;
      sfx.count(n);
    }
    if (t >= countdownEnd) startPlay(countdownEnd);
  }

  if (screen === 'play') {
    curT = t;
    nicola?.tick(t);                      // タイムアウトはここでだけ起きる
    if (screen === 'play') handle(game.tick(t), t);
    // 残り 10 秒からは一秒ごとに刻む。延長で秒が戻ったら、また 10 秒を切ったときから刻む
    const sec = Math.ceil(game.state.remainingMs / 1000);
    if (screen === 'play' && sec <= 10 && sec > 0 && sec !== lastTick) sfx.tick(sec);
    lastTick = sec;
  }
  if (imeUntil && t > imeUntil) {
    imeUntil = 0;
    el.imeWarn.hidden = true;
  }
  if (game && (screen === 'play' || screen === 'countdown' || screen === 'over')) paintPlay(t);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- デモ（見た目の確認用）

/** 種つき乱数。デモの画面を毎回同じにするため */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 疑似の打鍵で engine を進める。stopAt まで、step ms ごとに一字。ミスとズレを混ぜる */
function simulate(g, t0, stopAt, { step = 300, missEvery = 29 } = {}) {
  const rng = seeded(11);
  let t = t0;
  let i = 0;
  while (t < stopAt && g.state.phase === 'playing') {
    t += step;
    noteDemo(g.tick(t), t);
    if (g.state.phase !== 'playing') break;
    const head = g.state.items[0];
    // 作業品がラインの中ほどに来るまで待つ。デモの打ち手が速すぎると入口で通してしまい、ラインが空に見える
    if (!head || head.x < 0.3) continue;
    const want = [...head.word.kana][head.typed];
    const how = keyFor(want);
    i++;
    if (i % missEvery === 0) {
      noteDemo(g.input({ kana: 'ん', charCode: 'KeyQ', thumb: null, offsetMs: null }, t), t);
      continue;
    }
    // ズレは中心 −3ms・ばらつき 11ms 程度の山にする
    const off = how.thumb ? Math.round((rng() + rng() + rng() - 1.5) * 19 - 3) : null;
    lastResult = { thumb: how.thumb, offsetMs: off };
    noteDemo(g.input({ kana: want, charCode: how.code, thumb: how.thumb, offsetMs: off }, t), t);
  }
  return t;
}

function noteDemo(events, t) {
  for (const e of events) {
    if (e.type === 'hit') hitView = { kind: 'hit', ...e, thumb: lastResult?.thumb ?? null, offsetMs: lastResult?.offsetMs ?? null };
    else if (e.type === 'miss') hitView = { kind: 'miss', ...e };
    else if (e.type === 'clear') flash.set(e.itemId, { kind: 'clear', at: t, value: e.value });
  }
}

function runDemo(kind) {
  const input = params.get('input') ?? 'nicola';
  if (!INPUTS.includes(input)) throw new Error(`知らない入力方式: ${input}`);
  playInput = input;
  inputMode = input;
  course = COURSES.find((c) => c.id === params.get('course')) ?? COURSES[0];

  if (kind === 'play') {
    game = createGame({ course, words: WORDS, rng: seeded(7) });
    game.start(0);
    const t = simulate(game, 0, 24_000);
    romaji = input === 'romaji' ? createRomaji() : null;
    el.hudTarget.textContent = `/ ${num(course.target)} pt`;
    show('play');
    paintPlay(t);
    screen = 'demo';
  } else if (kind === 'result') {
    game = createGame({ course, words: WORDS, rng: seeded(7) });
    game.start(0);
    simulate(game, 0, 1e9);
    while (game.state.phase === 'playing') game.tick(game.state.remainingMs + 1e6);
    summary = { ...game.summary(), input };
    bestInfo = { isBest: true, prev: { score: Math.round(summary.score * 0.92) } };
    paintResult();
    show('result');
  } else if (kind === 'title') {
    paintTitle();
    show('title');
  } else if (kind === 'board') {
    // 順位表の見た目だけを見る。サーバーにはつながない
    rankBoard = BOARDS.includes(params.get('board')) ? params.get('board') : 'all';
    show('ranking');
    paintRankingTabs();
    setRankStatus('');
    paintLeaders(rankBoard === 'all' ? { nicola: { nickname: 'おやゆび', score: 4120 }, romaji: { nickname: 'ローマ字派', score: 3380 } } : null);
    const names = ['おやゆび', 'ローマ字派', 'nicola_fan', 'てぶくろ', 'あさがお', 'しずく'];
    paintBoard(names.map((n, i) => ({
      rank: i + 1, nickname: n, input: rankBoard === 'all' ? (i % 2 ? 'romaji' : 'nicola') : rankBoard,
      score: 4120 - i * 310, kpm: 236 - i * 13, accuracy: 0.97 - i * 0.02, at: '2026-11-02T00:00:00Z',
    })), null);
  } else if (kind === 'consent') {
    openConsent('ranking');
    el.nickname.value = 'おやゆび';
    el.consentCheck.checked = true;
    syncConsent();
  } else {
    throw new Error(`知らないデモ: ${kind}`);
  }
}

// ---------------------------------------------------------------- 起動

fillIcons();
paintTitle();
paintSupport();
if (DEMO) {
  runDemo(DEMO);
} else {
  show('title');
  requestAnimationFrame(frame);
}
