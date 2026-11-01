// 回転ずし（game.html）の配線。
//
// このファイルは何か
//   キー入力 → nicola.js（同時打鍵の判定）→ engine.js（ゲームの決まり）→ render.js（絵）と sound.js（音）
//   をつなぎ、タイトル・カウントダウン・プレイ・結果・ランキング・参加の同意の画面を切り替える。
//   判断は持たない。ゲームの決まりは engine.js、送受信は ranking.js にある。
//
// なぜ app.js と同じやり方で入力を取るのか
//   同時打鍵の判定は「押した時刻」と「離した時刻」の両方が要る。練習画面と同じ設定
//   （親指キー・閾値・緩和の有無）で同じ判定機を作らないと、練習では通る打ち方が
//   ゲームでは通らない、ということが起きる。だから設定は storage.js の loadSettings() から
//   そのまま読み、keydown / keyup / blur / rAF の扱いも app.js と同じ方針にしてある
//   （オートリピートは無視・IME がオンなら言う・blur で抱えたキーを捨てる・Esc で中断）。
//
// デモ用の入口（?demo=play など）
//   見た目を目で確かめるためだけの入口。疑似の打鍵を engine に流して、ある瞬間の絵で止める。
//   URL に demo が無いときは一切走らない。本番の動きはこの分岐の外にある。

import { createNicola } from '../nicola.js';
import { loadLayout, thumbSideOf } from '../layout.js';
import { loadSettings } from '../storage.js';
import { createSound } from '../sound.js';
import { createSfx, loadSfxOn, saveSfxOn } from './sfx.js';
import { COURSES } from './courses.js';
import { WORDS } from './words.js';
import { createGame, keyFor } from './engine.js';
import { createRenderer } from './render.js';
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

const canvas = $('canvas');
const renderer = createRenderer(canvas);
renderer.readTheme();
renderer.resize();

const el = {
  stage: $('stage'),
  imeWarn: $('imeWarn'),
  scTitle: $('scTitle'),
  scResult: $('scResult'),
  scRanking: $('scRanking'),
  scConsent: $('scConsent'),
  courseList: $('courseList'),
  thumbNames: $('thumbNames'),
  soundNote: $('soundNote'),
  btnSfx: $('btnSfx'),
  resultCourse: $('resultCourse'),
  resultMoney: $('resultMoney'),
  resultBalance: $('resultBalance'),
  resultBest: $('resultBest'),
  resultTally: $('resultTally'),
  submitBox: $('submitBox'),
  btnAgain: $('btnAgain'),
  btnCourses: $('btnCourses'),
  btnRankingFromTitle: $('btnRankingFromTitle'),
  btnRankingFromResult: $('btnRankingFromResult'),
  rankCourseTabs: $('rankCourseTabs'),
  rankPeriodTabs: $('rankPeriodTabs'),
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

const yen = (n) => Math.round(n).toLocaleString('ja-JP');

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

// ---------------------------------------------------------------- 自己ベスト（この端末だけ）
//
// ランキングに参加しなくても «前の自分» と比べられるようにする。送らない。
// 保存できない環境でも遊べることが先なので、読めなければ «記録なし»、書けなければ何もしない。

const BEST_KEY = 'oyayubi-dojo:gamebest:v1';

function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function saveBest(courseId, summary) {
  const all = loadBest();
  const prev = all[courseId];
  const isBest = !prev || summary.money > prev.money;
  if (isBest) {
    all[courseId] = { money: summary.money, kpm: Math.round(summary.kpm), at: Date.now() };
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(all));
    } catch {
      /* 書けなくても結果画面は出す */
    }
  }
  return { isBest, prev: prev ?? null };
}

// ---------------------------------------------------------------- 画面の切り替え

/** 'title' | 'countdown' | 'play' | 'over' | 'result' | 'ranking' | 'consent' */
let screen = 'title';
let backFromRanking = 'title';

function show(name) {
  screen = name;
  el.scTitle.hidden = name !== 'title';
  el.scResult.hidden = name !== 'result';
  el.scRanking.hidden = name !== 'ranking';
  el.scConsent.hidden = name !== 'consent';
  if (name !== 'play' && name !== 'countdown') el.imeWarn.hidden = true;
}

// ---------------------------------------------------------------- タイトル

const KEY_OF = ['1', '2', '3'];

function paintTitle() {
  const best = loadBest();
  el.courseList.replaceChildren(
    ...COURSES.map((c, i) => {
      const b = best[c.id];
      const btn = h('button', { type: 'button', class: 'g-course', role: 'listitem', dataset: { course: c.id } },
        h('span', { class: 'g-course__key' }, KEY_OF[i] ?? ''),
        h('span', { class: 'g-course__name' }, `${c.name}コース`),
        h('span', { class: 'g-course__price' }, yen(c.price), h('small', {}, '円')),
        h('span', { class: 'g-course__meta' }, `${c.timeMs / 1000}秒 ・ ${c.minLen}〜${c.maxLen}字の単語`),
        h('span', { class: 'g-course__best' },
          b ? ['自己ベスト ', h('b', {}, `${yen(b.money)}円`)] : 'まだ食べていません'),
      );
      btn.addEventListener('click', () => {
        sound.prime();
        sfx.prime();
        startCountdown(c);
      });
      return btn;
    }),
  );

  const NAME = { Lang2: '英数', Lang1: 'かな', KanaMode: 'かな', NonConvert: '無変換', Convert: '変換', Space: 'スペース' };
  const nameOf = (codes) => NAME[codes[0]] ?? codes[0];
  el.thumbNames.textContent = `左 ${nameOf(thumbKeys.left)} ／ 右 ${nameOf(thumbKeys.right)}`;

  paintSfx();
  el.soundNote.replaceChildren(
    ...(settings.sound && settings.sound !== 'off'
      ? ['打鍵音は練習の設定（', h('b', {}, settings.sound), '）で鳴ります。']
      : ['打鍵音はいま無音です。', h('a', { class: 'link', href: 'index.html#/setup' }, '設定'), 'で音色を選ぶと、ズレが耳でも分かります。']),
  );
}

function paintSfx() {
  const b = el.btnSfx;
  if (!sfx.available) {
    b.disabled = true;
    b.textContent = '効果音：この環境では鳴りません';
    return;
  }
  b.setAttribute('aria-pressed', String(sfx.enabled));
  b.textContent = sfx.enabled ? '効果音：オン' : '効果音：オフ';
}

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
let countdownEnd = 0;
let curT = 0;           // いま処理している入力の時刻。onOutput には時刻が付かないので預けておく
let imeUntil = 0;
let lastResult = null;  // 直前の nicola の出力（音にズレを渡すため）
let summary = null;
let bestInfo = null;
let perfectPlates = new Set(); // ぴったりを一打でも含んだ皿。取ったときの音を変える
let lastCount = 0;              // カウントダウンで最後に鳴らした数
let lastTick = 0;               // 残り時間の刻みで最後に鳴らした秒

// タイトル・結果の後ろで流しておく皿。誰も打たない «見本» のレーン
let attract = null;
function newAttract(t) {
  attract = createGame({ course: COURSES[0], words: WORDS, rng: Math.random });
  attract.start(t - COURSES[0].laneMs * 0.9); // 最初から皿が並んでいるように、少し前に始めたことにする
  attract.tick(t);
}

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

function startCountdown(c) {
  course = c;
  renderer.setCourse(c);
  game = createGame({ course: c, words: WORDS, rng: Math.random });
  nicola = buildNicola();
  countdownEnd = performance.now() + 3000;
  perfectPlates = new Set();
  lastCount = 0;
  lastTick = 0;
  show('countdown');
  // ボタンに残ったフォーカスで、スペースや Enter が «もう一度押した» にならないように
  document.activeElement?.blur?.();
}

function startPlay(t) {
  sfx.count(0);
  game.start(t);
  show('play');
}

/** engine の events を絵と音に流す */
function handle(events, t) {
  if (!events.length) return;
  renderer.events(events, game.state, t);
  for (const e of events) {
    if (e.type === 'hit') {
      if (lastResult?.thumb && lastResult.offsetMs != null) {
        sound.shifted({ tier: e.tier, offsetMs: lastResult.offsetMs });
      } else {
        sound.hit();
      }
    } else if (e.type === 'miss') {
      if (e.misfire) sound.misfire();
      else sound.miss();
    } else if (e.type === 'perfect') {
      perfectPlates.add(e.plateId);
    } else if (e.type === 'clear') {
      // 皿を取った音は sfx.js が受け持つ（打鍵音の設定が無音でも鳴る）
      sfx.take({ perfect: perfectPlates.has(e.plateId) });
    } else if (e.type === 'lost') {
      sfx.lost();
    } else if (e.type === 'combo') {
      sfx.combo();
    } else if (e.type === 'over') {
      sfx.end();
      finishGame(t);
    }
  }
}

function finishGame(t) {
  summary = game.summary();
  bestInfo = saveBest(course.id, summary);
  // 前の回の「送りました」やエラーを持ち越さない。持ち越すと次の結果が送れなくなる
  submitState = { busy: false, msg: '', kind: '' };
  nicola?.reset();
  screen = 'over';
  sound.finish({ best: bestInfo.isBest });
  // 最後の皿の演出を見せてから結果を出す。すぐ重ねると «何で終わったか» が見えない
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
  paintTitle();
  show('title');
}

// ---------------------------------------------------------------- 結果

function verdictOf(s, price) {
  const r = s.money / price;
  if (r >= 1.5) return '大満足。お店が泣いています';
  if (r >= 1.0) return '元は取れました';
  if (r >= 0.7) return 'もう少しで元が取れました';
  return 'まずは一皿ずつ、確実に';
}

function paintResult() {
  const s = summary;
  const gain = s.balance >= 0;
  el.scResult.classList.toggle('is-gain', gain);
  el.resultCourse.textContent = `${course.name}コース（${yen(course.price)}円・${course.timeMs / 1000}秒）`;
  el.resultMoney.textContent = yen(s.money);

  const avg = s.plates ? s.money / s.plates : 0;
  el.resultBalance.replaceChildren(
    h('span', { class: gain ? 'is-gain' : 'is-loss' },
      gain ? `${yen(s.balance)}円 お得！` : `${yen(-s.balance)}円 損しました`),
    h('small', {}, gain || !avg
      ? verdictOf(s, course.price)
      : `${verdictOf(s, course.price)}（あと ${Math.ceil(-s.balance / avg)} 皿ほど）`),
  );

  el.resultBest.hidden = !bestInfo?.isBest;
  el.resultBest.textContent = bestInfo?.prev ? `自己ベスト更新（前回 ${yen(bestInfo.prev.money)}円）` : 'はじめての記録';

  const pct = (x) => `${(x * 100).toFixed(1)}`;
  const rate = s.shifted ? s.perfect / s.shifted : 0;
  const cell = (k, v, unit, cls) => h('div', cls ? { class: cls } : {}, h('dt', {}, k), h('dd', {}, v, unit ? h('small', {}, unit) : null));
  el.resultTally.replaceChildren(
    cell('取った皿', String(s.plates), '枚'),
    cell('正確さ', pct(s.accuracy), '%'),
    cell('毎分', String(Math.round(s.kpm)), 'かな'),
    cell('ぴったり率', s.shifted ? pct(rate) : '—', s.shifted ? `% (${s.perfect}/${s.shifted})` : 'シフト打鍵なし', 'is-perfect'),
    cell('最大コンボ', String(s.maxCombo), ''),
    cell('ミス', String(s.misses), `${s.misfires ? `うち不発 ${s.misfires}・` : ''}取り逃し ${s.lost}皿`),
  );

  paintSubmit();
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
    box.replaceChildren(
      h('p', {}, 'ランキングに参加すると、この結果を送れます。送るのはニックネームと結果だけです。'),
      h('div', { class: 'g-row' }, btn),
      status,
    );
    return;
  }
  const btn = h('button', { type: 'button', class: 'btn btn--primary', disabled: submitState.busy || submitState.kind === 'ok' },
    submitState.kind === 'ok' ? '送りました' : 'ランキングに送る');
  btn.addEventListener('click', sendSummary);
  box.replaceChildren(
    h('p', {}, h('b', {}, me.nickname), ' として送ります。'),
    h('div', { class: 'g-row' }, btn),
    status,
  );
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
    submitState = {
      busy: false,
      kind: 'ok',
      msg: r?.isBest
        ? `送りました。いま ${r.rank} 位です（自己ベスト更新）`
        : `送りました。自己ベストは ${yen(r?.best ?? 0)}円で、いま ${r?.rank ?? '—'} 位です`,
    };
  } catch (err) {
    if (summary !== sent) return;
    submitState = { busy: false, kind: 'error', msg: `送れませんでした：${err.message}` };
  }
  paintSubmit();
}

// ---------------------------------------------------------------- ランキング

let rankCourse = COURSES[0].id;
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
      const b = h('button', { type: 'button', role: 'tab', dataset: { course: c.id } }, `${c.name}コース`);
      b.setAttribute('aria-selected', String(c.id === rankCourse));
      b.addEventListener('click', () => {
        rankCourse = c.id;
        paintRankingTabs();
        loadRanking();
      });
      return b;
    }),
  );
  for (const b of el.rankPeriodTabs.querySelectorAll('[data-period]')) {
    b.setAttribute('aria-selected', String(b.dataset.period === rankPeriod));
  }
  const me = currentPlayer();
  const on = rankingEnabled();
  el.btnRegister.hidden = !on || !!me;
  el.btnForget.hidden = !on || !me;
  el.rankMe.textContent = on && me ? `${me.nickname} として参加しています` : '';
}

function setRankStatus(text, kind = '') {
  el.rankStatus.className = `g-status ${kind ? `is-${kind}` : ''}`;
  el.rankStatus.replaceChildren(text);
}

async function loadRanking() {
  const seq = ++rankSeq;
  if (!rankingEnabled()) {
    el.rankList.replaceChildren();
    setRankStatus(soonNote());
    return;
  }
  el.rankList.replaceChildren();
  setRankStatus('読み込んでいます…');
  try {
    const rows = await fetchRanking({ course: rankCourse, period: rankPeriod });
    if (seq !== rankSeq) return; // タブを切り替えたあとに古い応答が来た
    const me = currentPlayer();
    if (!rows.length) {
      setRankStatus(rankPeriod === 'month' ? '今月の記録はまだありません。' : 'まだ記録がありません。最初の一人になれます。');
      return;
    }
    setRankStatus('');
    el.rankList.replaceChildren(
      h('li', { class: 'is-head', 'aria-hidden': 'true' },
        h('span', {}, '順位'), h('span', {}, '名前'), h('span', { class: 'm' }, '金額'),
        h('span', { class: 'k' }, '毎分'), h('span', { class: 'a' }, '正確さ')),
      ...rows.map((r) => h('li', { class: me && r.nickname === me.nickname ? 'is-me' : '' },
        h('span', { class: 'r' }, String(r.rank)),
        h('span', { class: 'n' }, r.nickname),
        h('span', { class: 'm' }, `${yen(r.money)}円`),
        h('span', { class: 'k' }, `${Math.round(r.kpm)}`),
        h('span', { class: 'a' }, `${(r.accuracy * 100).toFixed(0)}%`))),
    );
  } catch (err) {
    if (seq !== rankSeq) return;
    setRankStatus(`ランキングを読み込めませんでした：${err.message}`, 'error');
  }
}

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
    slot.replaceChildren(h('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, '☕ 開発を応援する（Buy Me a Coffee）'));
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
      sound.prime();
      sfx.prime();
      startCountdown(COURSES[i]);
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
  if (screen !== 'play' || !nicola) return;   // カウントダウン中の打鍵は捨てる
  curT = e.timeStamp;
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

el.btnAgain.addEventListener('click', () => { sound.prime(); sfx.prime(); startCountdown(course); });
el.btnCourses.addEventListener('click', abortToTitle);
el.btnRankingFromTitle.addEventListener('click', () => openRanking('title'));
// ヘッダーのランキング。遊んでいる最中は押しても何もしない（一回をうっかり捨てさせない）
document.getElementById('navRanking').addEventListener('click', () => {
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
  }
  if (screen === 'countdown' && t >= countdownEnd) startPlay(countdownEnd);

  if (screen === 'play') {
    curT = t;
    nicola.tick(t);                       // タイムアウトはここでだけ起きる
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

  if (screen === 'play' || screen === 'countdown' || screen === 'over') {
    renderer.draw({
      mode: screen === 'countdown' ? 'countdown' : 'play',
      state: game.state,
      now: t,
      countdown: (countdownEnd - t) / 1000,
      thumbs: nicola?.thumbHeld,
      totalMs: course.timeMs,
      laneMs: course.laneMs,
    });
  } else {
    if (!attract || attract.state.phase === 'over') newAttract(t);
    attract.tick(t);
    renderer.draw({ mode: 'attract', state: attract.state, now: t, laneMs: COURSES[0].laneMs });
  }
  requestAnimationFrame(frame);
}

new ResizeObserver(() => renderer.resize()).observe(canvas);

// ---------------------------------------------------------------- デモ（見た目の確認用）

/** 種つき乱数。デモの絵を毎回同じにするため */
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
function simulate(g, t0, stopAt, { step = 260, missEvery = 23, draw = true } = {}) {
  let t = t0;
  let i = 0;
  while (t < stopAt && g.state.phase === 'playing') {
    t += step;
    const evs = g.tick(t);
    if (draw) { renderer.draw({ mode: 'play', state: g.state, now: t, totalMs: course.timeMs, laneMs: course.laneMs }); renderer.events(evs, g.state, t); }
    if (g.state.phase !== 'playing') break;
    const head = g.state.plates[0];
    // 皿がレーンの中ほどに来るまで待つ。デモの打ち手が速すぎると皿が入口で取られ、レーンが空に見える
    if (!head || head.x < 0.32) continue;
    const want = [...head.word.kana][head.typed];
    const how = keyFor(want);
    i++;
    let result;
    if (i % missEvery === 0) {
      result = { kana: 'ん', charCode: 'KeyQ', thumb: null, shiftKind: null, offsetMs: null, continued: false, state: 'S2' };
    } else {
      const off = how.thumb ? [4, -9, 22, -41, 12, 0][i % 6] : null;
      result = { kana: want, charCode: how.code, thumb: how.thumb, shiftKind: null, offsetMs: off, continued: false, state: 'S4' };
    }
    const evs2 = g.input(result, t);
    if (draw) { renderer.draw({ mode: 'play', state: g.state, now: t, totalMs: course.timeMs, laneMs: course.laneMs }); renderer.events(evs2, g.state, t); }
  }
  return t;
}

function runDemo(kind) {
  const rng = seeded(7);
  course = COURSES.find((c) => c.id === params.get('course')) ?? COURSES[1];
  renderer.setCourse(course);

  if (kind === 'play' || kind === 'hint' || kind === 'countdown') {
    game = createGame({ course, words: WORDS, rng });
    const T0 = 10000;
    if (kind === 'countdown') {
      show('countdown');
      const paint = () => renderer.draw({ mode: 'countdown', state: game.state, now: T0, countdown: 2.35, thumbs: { left: false, right: false }, totalMs: course.timeMs, laneMs: course.laneMs });
      paint();
      new ResizeObserver(paint).observe(canvas);
      return;
    }
    game.start(T0);
    let t = simulate(game, T0, T0 + 24000);
    if (kind === 'hint') {
      // 同じ字で二度外して、打ち方の案内が出た瞬間
      for (let k = 0; k < 2; k++) {
        t += 200;
        renderer.events(game.input({ kana: 'ん', charCode: 'KeyQ', thumb: null, offsetMs: null }, t), game.state, t);
      }
    } else {
      // 先頭の皿を打ち切って、取った演出が出ている瞬間で止める
      while (game.state.plates[0] && game.state.phase === 'playing') {
        const head = game.state.plates[0];
        const want = [...head.word.kana][head.typed];
        const how = keyFor(want);
        t += 120;
        lastResult = null;
        const evs = game.input({ kana: want, charCode: how.code, thumb: how.thumb, offsetMs: how.thumb ? 3 : null }, t);
        renderer.events(evs, game.state, t);
        renderer.draw({ mode: 'play', state: game.state, now: t, totalMs: course.timeMs, laneMs: course.laneMs });
        if (evs.some((e) => e.type === 'clear')) break;
      }
    }
    const freeze = t + 180;
    show('play');
    screen = 'demo';
    const paint = () => renderer.draw({ mode: 'play', state: game.state, now: freeze, thumbs: { left: true, right: false }, totalMs: course.timeMs, laneMs: course.laneMs });
    paint();
    new ResizeObserver(paint).observe(canvas);
    return;
  }

  if (kind === 'result') {
    game = createGame({ course, words: WORDS, rng });
    game.start(0);
    simulate(game, 0, 1e9, { step: 300, draw: false });
    while (game.state.phase === 'playing') game.tick(game.state.remainingMs + 1e6);
    summary = game.summary();
    bestInfo = { isBest: true, prev: { money: Math.round(summary.money * 0.8) } };
    paintResult();
    show('result');
  } else if (kind === 'ranking') {
    openRanking('title');
  } else if (kind === 'consent') {
    openConsent('ranking');
    el.nickname.value = 'おやゆび';
    el.consentCheck.checked = true;
    syncConsent();
  } else {
    throw new Error(`知らないデモ: ${kind}`);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- 起動

paintTitle();
paintSupport();
if (DEMO) {
  runDemo(DEMO);
} else {
  show('title');
  requestAnimationFrame(frame);
}
