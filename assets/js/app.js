// 画面の組み立てとつなぎ込み。
//
// このファイルは「配線」だけを持つ。判断が要るものは全部よそにある。
//   同時打鍵の判定 … nicola.js（DOMを知らない。規格の状態機械そのもの）
//   配列の引き当て … layout.js
//   記録と実績     … storage.js / trophies.js（DOMを知らない）
//   描画部品       … meter.js / keyboard.js
// ここが太るとテストできない部分が増えるので、計算はなるべく置かない。
//
// 画面は URL で決まる（ハッシュルーティング）。戻るボタンと共有が効くようにするため。
// サーバー側のリライト設定も要らない。

import { createNicola } from './nicola.js';
import { loadLayout, lookup, handOf, thumbSideOf } from './layout.js';
import { renderMeter, showJudgement, resetMeter, tierOf } from './meter.js';
import { renderKeyboard, highlight, setThumbLamp, setFaceStates } from './keyboard.js';
import {
  loadStats, recordRun, loadSettings, saveSettings, STORAGE_KEYS, resolveTone,
  exportAll, importAll, validateImport, clearAll, overview, offsetReport,
} from './storage.js';
import { saveRomajiBaseline, clearRomajiBaseline, recordRomajiRun, recordLessonRun, loadGameBest, loadGameHistory, loadSeen, saveSeen } from './storage.js';
import { COURSES as GAME_COURSES, SPEEDS as GAME_SPEEDS } from './game/courses.js';
import { createRomaji, romajiKeyOf } from './romaji.js';
import {
  RANKS, rankOf, nextRankGap, TROPHIES, TIERS, progressOf, trophiesByCategory, dayKey,
  cpmOf, accuracyOf, unlockedOf, romajiComparison,
} from './trophies.js';
import { TEXTS, findLesson, nextLesson } from './lessons.js';
import { UNITS, CURRICULUM, PHASES, PASS_MAX_MISSES, phaseId, lessonDone, phasesDone, findPhase, nextPhase, reviewPhase, legendOf, fingerOf } from './curriculum.js';
import { downloadLayoutPng } from './layout-sheet.js';
import { makeDrill, weakFaces, describeFace, DRILL_MODES, missRateOf } from './drill.js';
import { renderIso } from './iso.js';
import { svg } from './viz.js';
import { medal } from './medal.js';
import { icon, fillIcons } from './icons.js';
import { renderTrend, renderOffsetHist, renderCalendar, renderScope } from './charts.js';
import { createSound } from './sound.js';

const layout = loadLayout('nicola');

// -- DOM をまとめて掴む -----------------------------------------------------
const $ = id => document.getElementById(id);
const el = {
  // route() はここに載っている画面しか隠さない。足し忘れると出っぱなしになる
  screens: {
    home: $('screenHome'), learn: $('screenLearn'), train: $('screenTrain'),
    record: $('screenRecord'), play: $('screenPlay'),
    layout: $('screenLayout'), setup: $('screenSetup'),
  },
  // 門の扉に添える «いまどこまで来たか» の一行
  doorLearnState: $('doorLearnState'), doorTrainState: $('doorTrainState'),
  // 入口の計器
  gateOffset: $('gateOffset'), gatePerfect: $('gatePerfect'), gateCpm: $('gateCpm'),
  gateSample: $('gateSample'), gateScope: $('gateScope'),
  gateTally: $('gateTally'), gateTallyHead: $('gateTallyHead'), gateTallyRow: $('gateTallyRow'),
  // 鍛えるの見出しの数字
  trainRank: $('trainRank'), trainCpm: $('trainCpm'), trainPerfect: $('trainPerfect'),
  trainOffset: $('trainOffset'), trainWeak: $('trainWeak'),
  noticeStack: $('noticeStack'), playBadge: $('playBadge'),
  // ローマ字の基準。記録画面に置く。
  // 記録が無い間は #romajiCard が隠れるので、入力欄は別の札に分けてある
  checkRomajiState: $('checkRomajiState'), checkRomajiStatus: $('checkRomajiStatus'),
  romajiCpmInput: $('romajiCpmInput'), btnRomajiSave: $('btnRomajiSave'),
  btnRomajiClear: $('btnRomajiClear'),
  // 鍛える
  drillWeakCard: $('drillWeakCard'), drillWeakCount: $('drillWeakCount'),
  drillSkewLeftMark: $('drillSkewLeftMark'), drillSkewLeftVal: $('drillSkewLeftVal'),
  drillSkewRightMark: $('drillSkewRightMark'), drillSkewRightVal: $('drillSkewRightVal'),
  drillWeak: $('drillWeak'), drillWeakEmpty: $('drillWeakEmpty'),
  btnDrillWeak: $('btnDrillWeak'), btnDrillAll: $('btnDrillAll'), btnDrillSpeed: $('btnDrillSpeed'),
  drillTextTabs: $('drillTextTabs'),
  freeText: $('freeText'), freeTextCount: $('freeTextCount'),
  freeTextWarn: $('freeTextWarn'), freeTextWarnList: $('freeTextWarnList'),
  btnFreeStart: $('btnFreeStart'), btnFreeClear: $('btnFreeClear'),
  // ローマ字比較
  romajiCard: $('romajiCard'), romajiRatio: $('romajiRatio'),
  romajiBaseBar: $('romajiBaseBar'), romajiBaseVal: $('romajiBaseVal'),
  romajiNowBar: $('romajiNowBar'), romajiNowVal: $('romajiNowVal'),
  romajiMessage: $('romajiMessage'), romajiPassed: $('romajiPassed'),
  navStreak: $('navStreak'),
  // setup
  warnIme: $('setupWarnIme'), warnEmu: $('setupWarnEmu'),
  catchLeft: $('btnCatchLeft'), catchRight: $('btnCatchRight'),
  thumbLeftCode: $('thumbLeftCode'), thumbRightCode: $('thumbRightCode'),
  tauRange: $('tauRange'), tauOut: $('tauOut'),
  lenientRelease: $('lenientRelease'), continuousShift: $('continuousShift'),
  autoSkip: $('autoSkip'),
  setupMeter: $('setupMeter'), setupBoard: $('setupBoard'),
  // home
  btnStart: $('btnStart'), startSub: $('startSub'), learnUnits: $('learnUnits'),
  learnDone: $('learnDone'), learnTotal: $('learnTotal'), learnFill: $('learnFill'), learnReward: $('learnReward'),
  btnRewardA4: $('btnRewardA4'), btnRewardStrip: $('btnRewardStrip'),
  // play
  playLesson: $('playLesson'), playNote: $('playNote'),
  statTime: $('statTime'), statCpm: $('statCpm'), statAcc: $('statAcc'),
  // お題は行送り。先の行と全体の進みは、デザイン担当が受け皿を置いたら効く
  phrase: $('phrase'), phraseNext: $('phraseNext'), phraseAfter: $('phraseAfter'),
  phraseProgress: $('phraseProgress'), phraseCount: $('phraseCount'),
  cue: $('cue'), cueKana: $('cueKana'), cueThumb: $('cueThumb'),
  cueKey: $('cueKey'), cueKind: $('cueKind'), cueHow: $('cueHow'),
  meter: $('meter'), board: $('board'), toast: $('toast'),
  btnBack: $('btnBack'), btnRetry: $('btnRetry'),
  // 覚えるのレッスン
  learnPhases: $('learnPhases'), learnMiss: $('learnMiss'), learnErr: $('learnErr'),
  learnIntro: $('learnIntro'), introEyebrow: $('introEyebrow'), introKana: $('introKana'),
  introHow: $('introHow'), introRules: $('introRules'), introTry: $('introTry'),
  learnFinish: $('learnFinish'), learnCard: $('learnCard'), lcardEyebrow: $('lcardEyebrow'),
  lcardTitle: $('lcardTitle'), lcardMiss: $('lcardMiss'), lcardOf: $('lcardOf'), lcardLine: $('lcardLine'),
  lcardWeakLabel: $('lcardWeakLabel'), lcardWeak: $('lcardWeak'), lcardNote: $('lcardNote'),
  btnLearnNext: $('btnLearnNext'), btnLearnNextText: $('btnLearnNextText'), btnLearnAgain: $('btnLearnAgain'), btnLearnList: $('btnLearnList'),
  finish: $('finish'), finishEyebrow: $('finishEyebrow'), finishTitle: $('finishTitle'),
  finishCpm: $('finishCpm'), finishBest: $('finishBest'), finishOffset: $('finishOffset'),
  finishOffsetWord: $('finishOffsetWord'), finishPerfect: $('finishPerfect'),
  finishGood: $('finishGood'), finishOff: $('finishOff'), finishMisfire: $('finishMisfire'),
  finishEarned: $('finishEarned'),
  btnNext: $('btnNext'), btnAgain: $('btnAgain'), btnHome: $('btnHome'),
  finishOffsetLabel: $('finishOffsetLabel'), finishGrid: $('finishGrid'), screenPlay: $('screenPlay'),
  inputPick: $('inputPick'), romajiTexts: $('romajiTexts'), romajiTextRows: $('romajiTextRows'),
  // mypage
  rankName: $('rankName'), rankScore: $('rankScore'), rankFill: $('rankFill'),
  rankNext: $('rankNext'), statTally: $('statTally'), rankLadder: $('rankLadder'),
  trendBox: $('trendBox'), offsetHist: $('offsetHist'), isoBoard: $('isoBoard'), calBox: $('calBox'),
  trophies: $('trophies'), trophyCount: $('trophyCount'),
  recBody: $('recBody'), recTable: $('recTable'), recEmpty: $('recEmpty'), dataKeys: $('dataKeys'),
  btnExport: $('btnExport'), btnImport: $('btnImport'), btnClear: $('btnClear'),
  // layout
  layoutBoard: $('layoutBoard'),
};

// -- 状態 -------------------------------------------------------------------
let settings = loadSettings();
let screen = 'home';
let engine = null;
let run = null;       // 進行中の一本。null なら打っていない
let catching = null;  // 親指キーを覚えさせている最中なら 'left' | 'right'
let rafId = null;
let sound = createSound({ kind: settings.sound, volume: settings.soundVolume });
let mode = null;      // 'drill'（鍛えるから始めた一本）| 'free'（自由入力）| null（覚えるのレッスン）
// 実文・自由入力をどちらで打つか。押した瞬間の設定を預かり、やり直しでも同じ打ち方で始める
let playInput = 'nicola';
let romaji = null;    // ローマ字で打っている間の判定器（romaji.js）
let pending = null;   // その場で作った課題（適応出題・自由入力）。id では引けないので持ち回る
let recentFaces = null; // 前回の適応出題で狙った面。渡すと同じ一本が続かない
// 設定画面の試し打ち用。親指キーを押したのに単独打鍵で確定したなら、それは不発。
// 「設定が効いているか確かめる」場所なので、不発を不発と見せないと確かめられない
let trialWantedThumb = false;

/** その場で作った課題をプレイ画面へ渡す */
function playMade(lesson, kind) {
  pending = lesson;
  mode = kind;
  const to = `#/play/${lesson.id}`;
  if (location.hash === to) route(); else location.hash = to;
}


// -- 小物 -------------------------------------------------------------------

const toastTimer = { id: null };
function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer.id);
  toastTimer.id = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

/** ズレの向きを言葉にする。数値だけ見せても直し方が分からない */
function offsetWord(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (Math.abs(ms) < 3) return 'ほぼ同時';
  return ms < 0 ? '親指が先行' : '親指が遅れ';
}

function fmtOffset(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  return `${ms > 0 ? '+' : ''}${ms.toFixed(0)}ms`;
}

/**
 * 次の段位まで何が足りないか。点数ではなく実際の指標で出す。
 * 文言が二か所にあると必ず食い違うので、ここ一本にまとめる。
 */
function rankNeedText(gap) {
  if (!gap) return '—';
  const need = [];
  if (gap.cpmGap > 0) need.push(`CPM あと ${Math.ceil(gap.cpmGap)}`);
  if (gap.accGap > 0) need.push(`正確率 あと ${gap.accGap.toFixed(1)}%`);
  if (gap.scoreGap > 0) need.push(`稽古量 あと ${Math.ceil(gap.scoreGap)}`);
  return need.length ? need.join(' / ') : 'あと一本打ち切るだけ';
}

/**
 * 段位のはしご。十段を一列に並べ、いまの段に印を付ける。
 * 各段の条件（速さ・正確率・稽古量）と目安はマウスを乗せるか Tab で止めると出る
 */
function paintRankLadder(stats) {
  // いまの段は stats.rank（腕前と稽古量の両方で決まった段）。稽古量だけで引く rankOf とは違うことがある
  const cur = Math.max(0, RANKS.findIndex((r) => r.name === stats.rank));
  el.rankLadder.replaceChildren(...RANKS.map((r, i) => {
    const li = document.createElement('li');
    li.className = `ladder__step${i < cur ? ' is-done' : i === cur ? ' is-now' : ''}`;
    li.tabIndex = 0;
    const name = document.createElement('b');
    name.textContent = r.name;
    const pop = document.createElement('span');
    pop.className = 'ladder__pop';
    pop.textContent = i === 0
      ? `はじめの段。${r.note}`
      : `速さ ${r.cpm} CPM・正確率 ${r.accuracy}% 以上の一本 ＋ 稽古量 ${r.at.toLocaleString('ja-JP')}。${r.note}`;
    li.append(name, pop);
    return li;
  }));
}

/** 左右の親指をまとめた平均ズレ。打鍵数で重みを付ける */
function meanOfBoth(rep) {
  const l = rep?.left, r = rep?.right;
  const n = (l?.n ?? 0) + (r?.n ?? 0);
  if (!n) return null;
  return ((l?.mean ?? 0) * (l?.n ?? 0) + (r?.mean ?? 0) * (r?.n ?? 0)) / n;
}

// 実績の系統。trophies.js は英語の id で分けているので、見出しはこちらで日本語にする
const CATEGORY_NAME = {
  mastery: '習得', streak: '継続', accuracy: '精度', speed: '速度', timing: 'タイミング', crown: '皆伝',
};

// -- 設定 -------------------------------------------------------------------

function thumbKeysOf(s) {
  // 設定の形は storage.js の DEFAULT_SETTINGS に合わせる。
  // ここを勝手な名前（thumbLeft など）で読むと、保存されているのに効かない
  return {
    left: s.thumbKeys?.left ?? layout.thumbKeys.left,
    right: s.thumbKeys?.right ?? layout.thumbKeys.right,
  };
}

// 配色は 'system' | 'light' | 'dark'。data-tone には解いた明暗（light / dark）を入れ、
// 札の押し下げは設定の値（system を含む）で付ける
const osDark = matchMedia('(prefers-color-scheme: dark)');

function applyTone(tone) {
  document.documentElement.dataset.tone = resolveTone(tone, osDark.matches);
  for (const b of document.querySelectorAll('[data-tone-set]')) {
    b.setAttribute('aria-pressed', String(b.dataset.toneSet === tone));
  }
}

// «システム» のときは OS の明暗の切り替え（夕方に自動でダークになる等）に開いたまま追従する
osDark.addEventListener('change', () => {
  if (settings.tone === 'system') applyTone('system');
});

// -- 判定エンジンを作り直す -------------------------------------------------
// 親指キーや閾値を変えたら作り直す。状態機械が古い設定を抱えたままになると、
// 「設定を変えたのに効かない」という一番たちの悪い症状になる。
function buildEngine(onOutput) {
  return createNicola({
    layout,
    thumbKeys: thumbKeysOf(settings),
    tau: settings.tau ?? 80,
    charTimeout: settings.charTimeout ?? 150,
    thumbTimeout: settings.thumbTimeout ?? 250,
    lenientRelease: settings.lenientRelease !== false,
    continuousShift: settings.continuousShift === true,
    onOutput,
  });
}

// -- お題の進行 -------------------------------------------------------------

// 一行の狙いの長さ（字）。カラオケの歌詞と同じで、一息で目に入る量にする。
// 長すぎると次の行を予測できず、短すぎると行送りばかりで落ち着かない
const LINE_TARGET = 26;
const LINE_MAX = 34;

/**
 * 本文を行に割る。
 *
 * 長い文章を全部いっぺんに出すと画面に入らないし、いまどこを打っているのかも見失う。
 * カラオケの歌詞と同じで、句読点で切って一息ぶんずつ送る。
 *
 * 返すのは「各行の開始位置（文字数）」。本文そのものは切らない。
 * 位置だけ持てば、進捗（index）は本文全体に対する通し番号のままでよく、
 * 中断と再開も行の切り方を変えても壊れない。
 */
function lineStarts(chars) {
  const starts = [0];
  let len = 0;
  for (let i = 0; i < chars.length; i++) {
    len++;
    const c = chars[i];
    const breakable = c === '。' || c === '、' || c === '・';
    const last = i === chars.length - 1;
    if (last) break;
    // 句読点の直後で切る。狙いの長さに届いていれば切り、
    // 上限を越えたら句読点が来なくても切る（一行が延々と伸びるのを防ぐ）
    if ((breakable && len >= LINE_TARGET) || len >= LINE_MAX) {
      starts.push(i + 1);
      len = 0;
    }
  }
  return starts;
}

/** いま何行目か。index は本文全体の通し番号 */
function lineIndexOf(starts, index) {
  let n = 0;
  while (n + 1 < starts.length && starts[n + 1] <= index) n++;
  return n;
}

// キーの刻印。`Semicolon` と出しても、手元のどのキーか分からない。
// 打ち手が見るのは自分のキーボードなので、刻印そのものを見せる（表は curriculum.js の legendOf 一つ）

/** 自由入力の上限（字）。課題の上限80字より緩く、一息で打ち切れる長さ */
const FREE_TEXT_MAX = 400;
const keyLegend = legendOf;

/** かな1文字を打つのに必要な打ち方を引く。無ければ null（課題データの不備） */
function howToType(kana) {
  for (const [code, k] of Object.entries(layout.keys)) {
    if (k.none === kana) return { code, thumb: null, shiftKind: null };
    if (k.left === kana) return { code, thumb: 'left', shiftKind: k.hand === 'left' ? 'same' : 'cross' };
    if (k.right === kana) return { code, thumb: 'right', shiftKind: k.hand === 'right' ? 'same' : 'cross' };
  }
  return null;
}

/** レッスンの行の頭。語・組を途中で割らず、20 字を越えたら次の行へ */
function groupStarts(groups) {
  const starts = [0];
  let at = 0;
  let len = 0;
  for (const g of groups) {
    if (len > 0 && len + g > 20) { starts.push(at); len = 0; }
    at += g;
    len += g;
  }
  return starts;
}

/** 語・組の最後の字の位置 */
function groupEnds(groups) {
  const ends = new Set();
  let at = 0;
  for (const g of groups) { at += g; ends.add(at - 1); }
  return ends;
}

/**
 * レッスンの枠：段階の並び・画面の切り替え（導入か、確認か、親指を使うか）・配列図の描き分け。
 * レッスンでないときは全部外す
 */
function paintLearnFrame(lesson) {
  const learn = lesson.courseId === 'learn';
  const scr = el.screenPlay;
  scr?.classList.toggle('is-learn', learn);
  scr?.classList.toggle('is-intro', learn && lesson.phase === 'intro');
  // 確認の段は、配列図と打ち方の案内を外して打つ（美佳のタイプトレーナの «ガイドなし»）
  scr?.classList.toggle('is-check', learn && lesson.phase === 'check');
  // 親指を使わないレッスンでは、ズレの帯は何も言うことが無い（動かない帯は故障に見える）
  scr?.classList.toggle('is-nothumb', learn && lesson.newKeys.every((k) => !k.thumb));
  if (el.learnErr) el.learnErr.hidden = true;
  if (el.learnIntro) el.learnIntro.hidden = !(learn && lesson.phase === 'intro');
  if (el.learnPhases) {
    el.learnPhases.hidden = !learn;
    if (learn) {
      const at = lesson.phase === 'review' ? PHASES.length - 1 : lesson.phaseIndex;
      el.learnPhases.replaceChildren(...PHASES.map((p, i) => {
        const li = document.createElement('li');
        li.className = i < at ? 'is-done' : i === at ? 'is-now' : '';
        const b = document.createElement('b');
        b.textContent = String(i + 1);
        li.append(b, lesson.phase === 'review' && i === at ? 'おさらい' : p.name);
        return li;
      }));
    }
  }
  setFaceStates(el.board, learn ? { known: lesson.faces.known, fresh: lesson.faces.fresh } : null);
}

/** 導入のカード。いま打つ字の説明と、3 回続けて打てたかの点 */
function paintIntro() {
  const kana = run.chars[run.index];
  const i = Math.floor(run.index / 3);
  const k = run.lesson.newKeys[i];
  if (!k) return;
  el.introEyebrow.textContent = `新しいかな ${i + 1} / ${run.lesson.newKeys.length}`;
  el.introKana.textContent = kana;
  const key = document.createElement('kbd');
  key.className = 'cue__key';
  key.textContent = k.legend;
  const finger = document.createElement('span');
  finger.textContent = k.finger;
  const parts = [key, finger];
  if (k.thumb) {
    const plus = document.createElement('span');
    plus.className = 'lintro__plus';
    plus.textContent = '＋';
    const th = document.createElement('b');
    th.className = 'lintro__thumb';
    th.textContent = k.thumb === 'left' ? '左親指' : '右親指';
    parts.push(plus, th);
  } else {
    const no = document.createElement('span');
    no.className = 'lintro__nothumb';
    no.textContent = '親指は使わない';
    parts.push(no);
  }
  el.introHow.replaceChildren(...parts);
  el.introRules.replaceChildren(...k.note.map((t) => {
    const p = document.createElement('p');
    p.textContent = t;
    return p;
  }));
  const got = run.index % 3;
  const dots = document.createElement('span');
  dots.className = 'lintro__dots';
  for (let d = 0; d < 3; d++) {
    const dot = document.createElement('i');
    if (d < got) dot.className = 'on';
    dots.append(dot);
  }
  el.introTry.replaceChildren(`「${kana}」を 3 回続けて打つ`, dots);
}

/** 打ち間違えたときの一行：押したキー（とそのかな）と、正しい打ち方 */
function paintLearnError(result, want, how) {
  if (!el.learnErr) return;
  const got = document.createElement('span');
  got.className = 'lerr__got';
  const gk = document.createElement('kbd');
  gk.className = 'cue__key';
  gk.textContent = `${result.thumb ? (result.thumb === 'left' ? '左親指＋' : '右親指＋') : ''}${keyLegend(result.charCode)}`;
  got.append('押したのは ', gk, result.kana ? `（${result.kana}）` : '');
  const sep = document.createElement('span');
  sep.className = 'lerr__sep';
  sep.textContent = '→';
  const right = document.createElement('span');
  const b = document.createElement('b');
  b.textContent = want;
  const rk = document.createElement('kbd');
  rk.className = 'cue__key';
  rk.textContent = how ? keyLegend(how.code) : '?';
  const finger = how ? fingerOf(how.code) : '';
  const thumb = how?.thumb ? ` ＋ ${how.thumb === 'left' ? '左親指' : '右親指'}` : '';
  // 親指だけの取り違え（キーは合っている）は、そこを名指しする
  const sameKey = how && result.charCode === how.code;
  right.append(b, ' は ', rk, `${thumb}${finger ? `　${finger}` : ''}${sameKey ? '（キーは合っています。親指を確かめて）' : ''}`);
  el.learnErr.replaceChildren(got, sep, right);
  el.learnErr.hidden = false;
}

function startRun(lesson) {
  const chars = [...lesson.text];
  const input = mode === 'drill' || mode === 'free' ? playInput : 'nicola';
  const learn = lesson.courseId === 'learn';
  run = {
    lesson,
    input,
    chars,
    learn,
    // 行の切り方は表示のためだけのもの。進捗（index）は本文全体の通し番号なので、
    // 切り方を変えても中断と再開は壊れない。レッスンは語・組の切れ目でだけ切る
    starts: learn ? groupStarts(lesson.groups) : lineStarts(chars),
    // レッスンの語・組の終わり（画面で間を空ける字の位置）
    gapAt: learn ? groupEnds(lesson.groups) : new Set(),
    // レッスンで間違えた字の位置と、かなごとの回数。合否は «間違えた字の数» で見る（打ち直しの回数ではない）
    missedAt: new Set(),
    missedKana: {},
    index: 0,
    startedAt: null,
    kana: 0,
    keystrokes: 0,
    misses: { mistouch: 0, shiftMisfire: 0, wrongFace: 0 },
    offsets: { left: [], right: [] },
    timing: { perfect: 0, good: 0, off: 0 },
    faceHits: {},
    faceMisses: {},
    perfectStreak: 0,
    bestPerfectStreak: 0,
  };

  // 途中で閉じた続きがあれば拾う。時間も引き継がないと CPM が嘘になる。
  // ローマ字の一本は続きを残さない（親指シフトの続きと混ざるので）
  // レッスンの段階は短く、続きから始めると導入の «3 回続けて» が途中から数えられてしまう
  const saved = input === 'romaji' || learn ? null : loadResume(lesson);
  if (saved) {
    Object.assign(run, {
      index: saved.index, kana: saved.kana, keystrokes: saved.keystrokes,
      misses: saved.misses, offsets: saved.offsets, timing: saved.timing,
      faceHits: saved.faceHits, faceMisses: saved.faceMisses,
      bestPerfectStreak: saved.bestPerfectStreak ?? 0,
      startedAt: performance.now() - (saved.elapsed ?? 0) * 1000,
    });
    toast(`${saved.index}字目から続けます`);
  }

  el.playLesson.textContent = learn ? `レッスン ${lesson.lessonNo}　${lesson.lessonTitle}` : lesson.title;
  paintLearnFrame(lesson);
  // 課題の狙い。特に「ここは親指を休ませて場所だけ覚える回。メーターが黙るのはそのため」
  // のような断りが読めないと、メーターが動かないのが故障に見える
  if (el.playNote) {
    el.playNote.textContent = lesson.note ?? '';
    el.playNote.title = lesson.note ?? '';   // 一行に切り詰めるので、全文はここで読める
  }
  el.finish.hidden = true;
  if (el.learnFinish) el.learnFinish.hidden = true;
  el.finishEarned.hidden = true;   // 前回の札が残らないように
  el.screenPlay?.classList.toggle('is-romaji', input === 'romaji');
  romaji = input === 'romaji' ? createRomaji() : null;
  resetMeter(el.meter);
  paintPhrase();
  paintCue();
  updateStats();

  engine = input === 'romaji' ? null : buildEngine(onOutput);
  loop();
}

/**
 * お題を行単位で出す。
 *
 * 打っている行だけを #phrase に入れ、先の行は薄く別に出す。
 * 長文の全文を一度に出すと画面に入らず、いまどこを打っているかも見失う。
 */
function paintPhrase() {
  const { starts } = run;
  const n = lineIndexOf(starts, run.index);
  const from = starts[n];
  const to = starts[n + 1] ?? run.chars.length;

  // いまの行。字ごとの見た目（打ち終えた／いま打つ）は既存のまま
  const cs = [];
  for (let i = from; i < to; i++) {
    const span = document.createElement('span');
    span.className = 'phrase__c'
      + (i < run.index ? ' is-done' : i === run.index ? ' is-cur' : '')
      + (run.gapAt.has(i) ? ' phrase__c--gap' : '')
      + (run.missedAt.has(i) ? ' is-missed' : '');
    span.textContent = run.chars[i];
    cs.push(span);
  }
  el.phrase.replaceChildren(...cs);

  // 先の行。次に何が来るか見えると速度が出る
  const ahead = (target, k) => {
    if (!target) return;
    const s = starts[n + k];
    if (s == null) { target.textContent = ''; return; }
    const end = starts[n + k + 1] ?? run.chars.length;
    // レッスンは語・組の切れ目に空白を入れて見せる（打つ字には入れていない）
    target.textContent = run.chars.slice(s, end).map((c, j) => (run.gapAt.has(s + j) && s + j < end - 1 ? `${c} ` : c)).join('');
  };
  ahead(el.phraseNext, 1);
  ahead(el.phraseAfter, 2);

  // 全体のどこまで来たか。長文だと «あとどれくらい» が分からないと折れる
  if (el.phraseProgress) {
    el.phraseProgress.style.setProperty('--p', String(run.chars.length ? run.index / run.chars.length : 0));
  }
  if (el.phraseCount) {
    el.phraseCount.textContent = starts.length > 1
      ? `${n + 1} / ${starts.length}行　${run.index}/${run.chars.length}字`
      : `${run.index}/${run.chars.length}字`;
  }
}

function paintCue() {
  const kana = run.chars[run.index];
  if (kana == null) return;
  const how = howToType(kana);
  if (run.learn && run.lesson.phase === 'intro') paintIntro();

  el.cueKana.textContent = kana;
  if (run.input === 'romaji') {
    // 打ちかけの綴りと、その続き。親指と面の案内は出さない
    const h = romaji.hint(run.chars, run.index);
    el.cueHow.hidden = true;
    el.cueKind.hidden = false;
    el.cueKind.className = 'cue__kind cue__kind--romaji';
    const typed = document.createElement('b');
    typed.textContent = h?.typed ?? '';
    el.cueKind.replaceChildren(typed, h?.rest ?? '');
    return;
  }
  if (!how) {
    // 課題データにこの配列で打てない字が混ざっている。黙って詰まらせない
    el.cueHow.hidden = true;
    el.cueKind.hidden = false;
    el.cueKind.textContent = 'この配列では打てません';
    return;
  }
  el.cueHow.hidden = false;
  el.cueKey.textContent = keyLegend(how.code);
  el.cueThumb.textContent = how.thumb === 'left' ? '左親指' : how.thumb === 'right' ? '右親指' : '単独';
  el.cueThumb.className = 'cue__thumb' + (how.thumb ? ` cue__thumb--${how.thumb}` : '');
  // 単独打鍵は左の «単独» で足りる。札を重ねて二度言わない
  el.cueKind.hidden = !how.shiftKind;
  el.cueKind.textContent = how.shiftKind === 'cross' ? '交差 · 濁音'
    : how.shiftKind === 'same' ? '同側 · 別のかな' : '単独打鍵';
  el.cueKind.className = 'cue__kind' + (how.shiftKind ? ` cue__kind--${how.shiftKind}` : '');

  highlight(el.board, { charCode: how.code, thumb: how.thumb });
}

/** 判定エンジンから1打ぶん確定して返ってきた */
function onOutput(result) {
  if (!run) return;
  if (result.charCode == null) return;   // 親指キーだけの空打ち。数えない

  if (run.startedAt == null) run.startedAt = performance.now();
  run.keystrokes += result.thumb ? 2 : 1;

  const want = run.chars[run.index];
  const how = howToType(want);
  const faceKey = `${result.charCode}:${result.thumb ?? 'none'}`;

  if (result.kana === want) {
    // 当たり
    run.kana++;
    run.index++;
    run.stuck = null;
    el.cue?.classList.remove('is-stuck');
    run.faceHits[faceKey] = (run.faceHits[faceKey] ?? 0) + 1;
    if (run.learn && el.learnErr) el.learnErr.hidden = true;

    if (result.offsetMs != null && result.thumb) {
      run.offsets[result.thumb].push(result.offsetMs);
      const tier = tierOf(result.offsetMs);
      run.timing[tier === 'perfect' ? 'perfect' : tier === 'good' ? 'good' : 'off']++;
      if (tier === 'perfect') {
        run.perfectStreak++;
        run.bestPerfectStreak = Math.max(run.bestPerfectStreak, run.perfectStreak);
      } else {
        run.perfectStreak = 0;
      }
      showJudgement(el.meter, { offsetMs: result.offsetMs, tier });
      sound.shifted({ tier, offsetMs: result.offsetMs });
    } else if (result.thumb) {
      // 連続シフトで出た一打。同時打鍵としては当たりだが、親指を落とした瞬間が
      // 無いのでズレが存在しない。timing の集計にも入れない（測っていないものは数えない）
      showJudgement(el.meter, { offsetMs: null, tier: 'continued' });
      sound.hit();
    } else {
      sound.hit();
    }
    // 単独打鍵にはズレという概念が無いので、メーターには何も出さない。
    // 針を動かすと嘘になるし、tier に無い値を渡すと meter 側が「ずれ」の文言を出す

    paintPhrase();
    if (run.index >= run.chars.length) { clearResume(); return finishRun(); }
    paintCue();
    saveResume();
  } else {
    // 外れ。3つに分ける。直し方が三つとも違うので最後まで混ぜない
    let kind = 'mistouch';
    if (how && result.charCode === how.code) {
      kind = how.thumb && !result.thumb ? 'shiftMisfire' : 'wrongFace';
    }
    run.misses[kind]++;
    run.faceMisses[faceKey] = (run.faceMisses[faceKey] ?? 0) + 1;
    run.perfectStreak = 0;

    // レッスン：飛ばさず、その場で «押したもの と 正しい打ち方» を出す。
    // 導入は «3 回続けて» なので、その字の 1 回目からやり直す
    if (run.learn) {
      // 打つ場所の «正しい面» の外しとして数える（記録の弱いかなに出るのは、外した字のほう）
      const wantFace = how ? `${how.code}:${how.thumb ?? 'none'}` : null;
      if (wantFace && wantFace !== faceKey) run.faceMisses[wantFace] = (run.faceMisses[wantFace] ?? 0) + 1;
      if (!run.missedAt.has(run.index)) {
        run.missedAt.add(run.index);
        run.missedKana[want] = (run.missedKana[want] ?? 0) + 1;
      }
      if (run.lesson.phase === 'intro') run.index -= run.index % 3;
      paintLearnError(result, want, how);
      if (kind === 'shiftMisfire') showJudgement(el.meter, { offsetMs: null, tier: 'misfire' });
      sound.miss();
      flashMiss();
      paintPhrase();
      paintCue();
      updateStats();
      return;
    }

    // 同じ字で続けて外していると、そこで完全に止まる。読み方が分からない字や、
    // 親指の向きを取り違えている場合は、何度打ってもひとりでには直らない。
    // 三度外したら打ち方を名指しで出し、それでも駄目なら送れるようにする
    run.stuck = run.stuck?.at === run.index ? { at: run.index, n: run.stuck.n + 1 } : { at: run.index, n: 1 };
    const willSkip = settings.autoSkip !== false;
    // 飛ばしが on なら 3 回目に一度出せば足りる（6 回目には送られるので）。
    // off のときは逃げ道が無いので、3 回ごとに出し直す。一度きりだと
    // 打ち方が分からないまま無言で詰まる
    if (how && run.stuck.n % 3 === 0 && !(willSkip && run.stuck.n >= 6)) {
      toast(`「${want}」は ${how.thumb === 'left' ? '左親指' : how.thumb === 'right' ? '右親指' : '単独'}＋${keyLegend(how.code)}`);
      el.cue?.classList.add('is-stuck');
    }
    // 6 回続けて外したら送る。ただし «勝手に進んだ» と感じる人もいるので、
    // 設定で止められる。off のときは打てるまでその字に留まり、打ち方の名指しは出続ける
    if (run.stuck.n >= 6 && willSkip) {
      toast('この字は飛ばします。記録の「苦手な面」に出ます');
      run.index++;
      run.stuck = null;
      el.cue?.classList.remove('is-stuck');
      paintPhrase();
      if (run.index >= run.chars.length) { clearResume(); return finishRun(); }
      paintCue();
      saveResume();
      updateStats();
      return;
    }
    // meter が受け付ける tier は perfect / good / off / misfire の4つだけ。
    // シフト不発は misfire、それ以外の打ち間違いはメーターの担当ではないので出さない
    if (kind === 'shiftMisfire') {
      showJudgement(el.meter, { offsetMs: null, tier: 'misfire' });
      sound.misfire();
    } else {
      sound.miss();
    }
    flashMiss();
  }
  updateStats();
}

/** ローマ字の一字。綴りに合えば進み、合わなければミス（隣を打ったのと同じ数え方） */
function pressRomaji(ch) {
  if (run.startedAt == null) run.startedAt = performance.now();
  const res = romaji.press(run.chars, run.index, ch);
  if (!res.ok) {
    run.misses.mistouch++;
    sound.miss();
    flashMiss();
    updateStats();
    return;
  }
  run.keystrokes++;
  if (res.done) {
    run.kana += res.done;
    run.index += res.done;
    sound.hit();
    paintPhrase();
    if (run.index >= run.chars.length) return finishRomaji();
  }
  paintCue();
  updateStats();
}

/** ローマ字の一本の結果。親指シフトの記録には入れず、同じ文の親指シフトの最高と並べる */
function finishRomaji() {
  const seconds = (performance.now() - run.startedAt) / 1000;
  const r = recordRomajiRun({
    lessonId: run.lesson.id, kana: run.kana, seconds,
    keystrokes: run.keystrokes, misses: run.misses.mistouch,
  });
  el.finishEyebrow.textContent = 'ローマ字';
  el.finishTitle.textContent = run.lesson.title;
  el.finishCpm.textContent = String(Math.round(r.cpm));
  el.finishBest.hidden = !r.isBest;
  el.finishBest.textContent = '自己ベスト更新';
  el.finishOffsetLabel.textContent = '同じ文を親指シフトで';
  el.finishOffset.textContent = r.nicola ? `${Math.round(r.nicola)} cpm` : '—';
  el.finishOffsetWord.textContent = r.nicola ? '' : 'まだ打っていない';
  el.finishGrid.hidden = true;
  el.finishEarned.hidden = true;
  el.finish.hidden = false;
  sound.finish({ best: r.isBest });

  run = null;
  romaji = null;
  mode = null;
  stopLoop();
  paintNav(r.stats);
}

// 打ち間違いを一瞬だけ光らせる。メーターは時間差の担当なので、
// ズレの無いミスまでそこに出すと針が嘘をつく
function flashMiss() {
  el.phrase.classList.add('is-miss');
  setTimeout(() => el.phrase.classList.remove('is-miss'), 160);
}

function updateStats() {
  if (!run) return;
  if (run.learn) {
    // レッスンは時間を測らない。出すのは «あと何字» と «まちがい» だけ
    if (el.phraseCount) el.phraseCount.textContent = `あと ${run.chars.length - run.index} 字`;
    if (el.learnMiss) {
      el.learnMiss.textContent = `まちがい ${run.missedAt.size}`;
      el.learnMiss.classList.toggle('is-on', run.missedAt.size > 0);
    }
    return;
  }
  const sec = run.startedAt == null ? 0 : (performance.now() - run.startedAt) / 1000;
  el.statTime.textContent = sec.toFixed(1);
  // cpmOf / accuracyOf は丸めずに返す。表示のときに丸めるのはこちらの仕事
  el.statCpm.textContent = String(Math.round(cpmOf({ kana: run.kana, seconds: sec })));
  el.statAcc.textContent = String(Math.round(accuracyOf(run)));
}

/**
 * レッスンの段階を打ち終えた。
 * 導入・組み合わせ・語は、そのまま次の段階へ進む（合否は確認の段だけで見る）。
 * おさらいは、終えたら確認をもう一度。確認は合否の札を出す
 */
function finishLesson() {
  const l = run.lesson;
  const missed = Object.entries(run.missedKana).sort((a, b) => b[1] - a[1]);
  const passed = l.phase === 'check' ? run.missedAt.size <= PASS_MAX_MISSES : l.phase !== 'review';
  recordLessonRun({ lessonId: l.id, passed, faceHits: run.faceHits, faceMisses: run.faceMisses });
  const total = run.chars.length;
  const missCount = run.missedAt.size;
  run = null;
  engine = null;
  mode = null;
  stopLoop();
  paintNav(loadStats());

  if (l.phase !== 'check') {
    const next = l.phase === 'review' ? findPhase(phaseId(l.lessonId, 'check')) : nextPhase(l.id);
    sound.finish({ best: false });
    toast(`「${PHASES[next.phaseIndex].name}」へ`);
    location.hash = `#/play/${next.id}`;
    return;
  }

  el.lcardEyebrow.textContent = `レッスン ${l.lessonNo}　${l.lessonTitle}　確認`;
  el.lcardTitle.textContent = passed ? '合格' : 'もう少し';
  el.learnCard.classList.toggle('is-pass', passed);
  el.learnCard.classList.toggle('is-fail', !passed);
  el.lcardMiss.textContent = String(missCount);
  el.lcardOf.textContent = ` / ${total} 字まちがい`;
  el.lcardLine.textContent = `（合格は ${PASS_MAX_MISSES} 字まで）`;
  el.lcardWeakLabel.hidden = !missed.length;
  el.lcardWeak.hidden = !missed.length;
  el.lcardWeak.replaceChildren(...missed.slice(0, 3).map(([kana, n]) => {
    const how = howToType(kana);
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = kana;
    const sp = document.createElement('span');
    const thumb = how?.thumb ? ` ＋ ${how.thumb === 'left' ? '左親指' : '右親指'}` : '';
    sp.textContent = how ? `${keyLegend(how.code)}${thumb}　${fingerOf(how.code)}` : '';
    const sm = document.createElement('small');
    sm.textContent = `${n} 回`;
    li.append(b, sp, sm);
    return li;
  }));
  const next = nextPhase(l.id);
  if (passed) {
    const nextTitle = next ? `次は «${CURRICULUM.find((x) => x.id === next.lessonId).title}»。` : '';
    el.lcardNote.textContent = missed.length
      ? `まちがえたかなは、次のレッスンの組み合わせと確認に多めに混ぜます。${nextTitle}`
      : (next ? `まちがいなし。${nextTitle}` : '全レッスンを終えました。レッスンの一覧から配列表の画像を保存できます。');
    el.btnLearnNextText.textContent = next ? '次のレッスンへ（Enter）' : 'レッスンの一覧へ（Enter）';
    el.btnLearnNext.onclick = () => { location.hash = next ? `#/play/${next.id}` : '#/learn'; };
  } else {
    const kana = missed.map(([k]) => k);
    el.lcardNote.textContent = 'まちがえたかなだけの組み合わせを 16 字打ってから、確認をもう一度。';
    el.btnLearnNextText.textContent = 'おさらいする（Enter）';
    el.btnLearnNext.onclick = () => playMade(reviewPhase(l.lessonId, kana), null);
  }
  el.btnLearnAgain.hidden = !passed;
  el.learnFinish.hidden = false;
  sound.finish({ best: false });
  el.btnLearnNext.focus();
}

function finishRun() {
  if (run.learn) return finishLesson();
  const seconds = (performance.now() - run.startedAt) / 1000;
  const payload = {
    lessonId: run.lesson.id,
    kana: run.kana,
    keystrokes: run.keystrokes,
    seconds,
    misses: run.misses,
    offsets: run.offsets,
    timing: run.timing,
    faceHits: run.faceHits,
    faceMisses: run.faceMisses,
    perfectStreak: run.bestPerfectStreak,
  };
  const { stats, summary, records, earned } = recordRun(payload);

  // summary は summarizeRun() の返り値。平均のズレは stat.both.mean にある
  const meanOffset = summary?.stat?.both?.mean ?? null;
  el.finishTitle.textContent = run.lesson.title;
  el.finishCpm.textContent = String(Math.round(summary?.cpm ?? 0));
  el.finishBest.hidden = !(records && records.length);
  if (records && records.length) el.finishBest.textContent = `自己ベスト更新（${records.join('・')}）`;
  el.finishOffsetLabel.textContent = '平均のズレ';
  el.finishGrid.hidden = false;
  el.finishOffset.textContent = fmtOffset(meanOffset);
  el.finishOffsetWord.textContent = offsetWord(meanOffset);
  // 段位はいちばん見る画面に出す。「自己ベスト更新（段位）」という文字列でしか
  // 分からないのでは、いま何段で次に何が足りないのかが伝わらない
  const gap = nextRankGap(stats);
  el.finishEyebrow.textContent = gap
    ? `${stats.rank}　次の ${gap.next.name} まで ${rankNeedText(gap)}`
    : `${stats.rank}（最高段位）`;

  el.finishPerfect.textContent = String(run.timing.perfect);
  el.finishGood.textContent = String(run.timing.good);
  el.finishOff.textContent = String(run.timing.off);
  el.finishMisfire.textContent = String(run.misses.shiftMisfire);

  // 節目だけ派手にする。取った実績があるときだけ札を出す
  if (earned && earned.length) {
    el.finishEarned.hidden = false;
    el.finishEarned.replaceChildren(...earned.map(t => {
      const d = document.createElement('span');
      d.className = 'finish__badge';
      const tr = typeof t === 'string' ? TROPHIES.find(x => x.name === t) : t;
      if (tr?.tier) d.append(medal(tr, { got: true, size: 's' }));
      d.append(typeof t === 'string' ? t : (t.name ?? ''));
      return d;
    }));
  } else {
    el.finishEarned.hidden = true;
  }

  el.finish.hidden = false;
  sound.finish({ best: !!(records && records.length) });
  if (earned && earned.length) sound.earned();

  // 節目は右下の通知にも積む。トーストはプレイ画面の中にしか出せない。
  // ただし一本で十枚出ることがあり、積み上がると画面を覆う（実際に覆っていた）。
  // 三つを越えたらまとめて一枚にする
  const earnedList = (earned ?? []).map(t => (typeof t === 'string' ? TROPHIES.find(x => x.name === t) ?? { name: t, hint: '' } : t));
  if (earnedList.length > 3) {
    // まとめた一枚には、いちばん格の高いメダルを付ける
    const order = TIERS.map(x => x.id);
    const top = [...earnedList].filter(t => t.tier).sort((a, b) => order.indexOf(b.tier) - order.indexOf(a.tier))[0];
    notice({ eyebrow: '実績解除', name: `${earnedList.length}個を解除`, hint: earnedList.map(t => t.name).join('・'), kind: 'trophy', trophy: top });
  } else {
    for (const t of earnedList) {
      const tierName = TIERS.find(x => x.id === t.tier)?.name;
      notice({ eyebrow: tierName ? `実績解除 ・ ${tierName}` : '実績解除', name: t.name, hint: t.hint ?? '', kind: 'trophy', trophy: t.tier ? t : null });
    }
  }

  const recs = records ?? [];
  if (recs.length > 3) {
    notice({ eyebrow: '自己ベスト', name: `${recs.length}項目を更新`, hint: recs.join('・'), kind: 'best' });
  } else {
    for (const label of recs) notice({ eyebrow: '自己ベスト', name: label, kind: 'best' });
  }

  run = null;
  engine = null;
  mode = null;
  stopLoop();
  paintNav(stats);
}

// -- 中断と再開 -------------------------------------------------------------
//
// 長い課題を途中で閉じると、それまでの打鍵が丸ごと消えていた。76文字の課題ほど
// 離脱の代償が大きく、「途中でやめられない」ことが練習の障壁になる。
// 打つたびに軽く書き出しておき、同じ課題に戻ってきたら続きから始められるようにする。

const RESUME_KEY = 'oyayubi-dojo:resume:v1';

function saveResume() {
  if (!run || run.index === 0 || run.input === 'romaji') return;
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({
      lessonId: run.lesson.id,
      title: run.lesson.title,
      text: run.lesson.text,
      index: run.index,
      kana: run.kana,
      keystrokes: run.keystrokes,
      misses: run.misses,
      offsets: run.offsets,
      timing: run.timing,
      faceHits: run.faceHits,
      faceMisses: run.faceMisses,
      bestPerfectStreak: run.bestPerfectStreak,
      elapsed: run.startedAt == null ? 0 : (performance.now() - run.startedAt) / 1000,
      at: Date.now(),
    }));
  } catch {
    /* 保存できなくても打てる。ここで転ぶ方が損 */
  }
}

function loadResume(lesson) {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw);
    // 課題が違う、字が変わっている、古すぎる（1日）なら使わない
    if (r.lessonId !== lesson.id || r.text !== lesson.text) return null;
    if (!(r.index > 0) || r.index >= [...lesson.text].length) return null;
    if (Date.now() - (r.at ?? 0) > 24 * 60 * 60 * 1000) return null;
    return r;
  } catch {
    return null;
  }
}

function clearResume() {
  try { localStorage.removeItem(RESUME_KEY); } catch { /* 消せなくても実害は無い */ }
}

/** 右下に積む通知。消えるまでの面倒もここで見る */
function notice({ eyebrow, name, hint = '', kind = 'rank', trophy = null }) {
  if (!el.noticeStack || !name) return;
  const d = document.createElement('div');
  d.className = `notice notice--${kind}`;
  const e = document.createElement('span'); e.className = 'notice__eyebrow'; e.textContent = eyebrow;
  const n = document.createElement('b'); n.className = 'notice__name'; n.textContent = name;
  d.append(e, n);
  if (hint) { const h = document.createElement('span'); h.className = 'notice__hint'; h.textContent = hint; d.append(h); }
  if (trophy) {
    // 実績はメダルを左に。ゲームの «実績解除» の通知の形
    d.dataset.tier = trophy.tier;
    d.prepend(medal(trophy, { got: true, size: 's' }));
  }
  el.noticeStack.append(d);
  setTimeout(() => {
    d.classList.add('is-going');
    setTimeout(() => d.remove(), 400);
  }, 3600);
}

// -- 打鍵の受け取り ---------------------------------------------------------

window.addEventListener('keydown', e => {
  // ブラウザ操作は邪魔しない
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // 親指キーを覚えさせている最中は、押されたキーをそのまま採る
  if (catching) {
    e.preventDefault();
    assignThumb(catching, e.code);
    return;
  }

  // 門の試し打ち。文字キーと親指キーだけを拾い、Tab や Enter（扉へ進む）は邪魔しない
  const gateTry = screen === 'home' && engine;
  if (gateTry && !layout.keys[e.code] && !thumbSideOf(thumbKeysOf(settings), e.code) && e.keyCode !== 229) return;
  if (screen !== 'play' && screen !== 'setup' && !gateTry) return;
  if (e.repeat) { e.preventDefault(); return; }   // オートリピートは打鍵ではない

  // IME が動いていると素のキーが取れない。黙って壊れるより言う
  if (e.isComposing || e.keyCode === 229 || e.key === 'Process') {
    e.preventDefault();
    el.warnIme?.classList.add('is-on');
    if (gateTry) { const t = el.gateScope.querySelector('.inst__try'); if (t) t.textContent = '日本語入力をオフ（英数）にしてから押してください'; }
    else toast('日本語入力をオフ（英数）にしてください');
    return;
  }

  if (e.key === 'Escape') { e.preventDefault(); location.hash = run?.learn ? '#/learn' : '#/'; return; }

  // 終わりの札が出ていれば、Enter で «次へ»（主のボタン）。
  // 札の中のほかのボタンにフォーカスがあるときは、そのボタンを押させる
  if (e.key === 'Enter' && !run) {
    const card = !el.learnFinish.hidden ? el.learnFinish : !el.finish.hidden ? el.finish : null;
    if (card && !(document.activeElement instanceof HTMLButtonElement && card.contains(document.activeElement)
      && document.activeElement !== (card === el.finish ? el.btnNext : el.btnLearnNext))) {
      e.preventDefault();
      (card === el.finish ? el.btnNext : el.btnLearnNext).click();
      return;
    }
    if (card) return;
  }

  if (screen === 'play' && run?.input === 'romaji') {
    const ch = romajiKeyOf(e.key);
    if (!ch) return;
    e.preventDefault();
    pressRomaji(ch);
    return;
  }

  if (!engine) return;
  e.preventDefault();
  if (thumbSideOf(thumbKeysOf(settings), e.code)) trialWantedThumb = true;
  engine.keyDown(e.code, e.timeStamp);
  setThumbLamp(screen === 'setup' ? el.setupBoard : el.board, engine.thumbHeld);
});

window.addEventListener('keyup', e => {
  if (catching || !engine) return;
  if (screen !== 'play' && screen !== 'setup' && screen !== 'home') return;
  if (screen === 'home' && !layout.keys[e.code] && !thumbSideOf(thumbKeysOf(settings), e.code)) return;
  e.preventDefault();
  // keyUp の中で最後の一打が確定すると finishRun() が走り、engine が null になる。
  // 掴み直さずに触ると落ちる（実際に落ちていた）
  const eng = engine;
  eng.keyUp(e.code, e.timeStamp);
  setThumbLamp(el.board, (engine ?? eng).thumbHeld);
});

// 別の窓へ行ったら、抱えているキーを捨てる。規格の「初期化」にあたる。
// これが無いと、戻ってきたときに押しっぱなし扱いのキーが残る
window.addEventListener('blur', () => { engine?.reset(); });

// タイムアウトはここでだけ起きる。nicola.js は自分で時計を見ない
function loop() {
  stopLoop();
  const step = t => {
    engine?.tick(t);
    if (run) updateStats();
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}
function stopLoop() {
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
}

// -- 親指キーの割り当て -----------------------------------------------------

const NEVER = new Set(['MetaLeft', 'MetaRight', 'Escape', 'Tab']);

function assignThumb(side, code) {
  const btn = side === 'left' ? el.catchLeft : el.catchRight;
  catching = null;
  btn.classList.remove('is-catching');
  btn.textContent = '押して覚えさせる';

  if (NEVER.has(code)) {
    // ⌘ は押している間、他のキーの keyup が飛ばないブラウザの既知の癖がある。
    // 同時打鍵は解放も見るので、これを選ばれると判定が壊れる
    toast('そのキーは親指キーに使えません');
    return;
  }
  const tk = thumbKeysOf(settings);
  const other = side === 'left' ? tk.right : tk.left;
  if (other.includes(code)) { toast('もう一方の親指キーと同じです'); return; }
  if (layout.keys[code]) { toast('文字キーなので親指には使えません'); return; }

  settings.thumbKeys = { ...tk, [side]: [code] };
  settings = saveSettings(settings) ?? settings;
  paintSetup();
  if (screen === 'setup') startTrial();
}

function labelOfCodes(codes) {
  const NAME = {
    Lang2: '英数', Lang1: 'かな', KanaMode: 'かな', NonConvert: '無変換',
    Convert: '変換', Space: 'スペース',
  };
  // 日本語名が無いキーは code だけ出す。「Backquote（Backquote）」は読みにくい
  return codes.map(c => (NAME[c] ? `${NAME[c]}（${c}）` : c)).join(' / ');
}

function paintSetup() {
  const tk = thumbKeysOf(settings);
  el.thumbLeftCode.textContent = labelOfCodes(tk.left);
  el.thumbRightCode.textContent = labelOfCodes(tk.right);
  el.tauRange.value = String(settings.tau ?? 80);
  el.tauOut.textContent = `${settings.tau ?? 80}ms`;
  if (el.lenientRelease) el.lenientRelease.checked = settings.lenientRelease !== false;
  if (el.continuousShift) el.continuousShift.checked = settings.continuousShift === true;
  if (el.autoSkip) el.autoSkip.checked = settings.autoSkip !== false;
  paintSoundSettings();
}

/**
 * 打鍵音の設定。
 * 音は「押下の時間差を画面を見ずに受け取る」唯一の手段なので、
 * 既定が無音のままだと sound.js が丸ごと死ぬ。ここが唯一の入口。
 */
function paintSoundSettings() {
  const open = unlockedOf(loadStats()).sound ?? ['off'];
  for (const label of document.querySelectorAll('[data-sound-opt]')) {
    const id = label.dataset.soundOpt;
    const unlocked = id === 'off' || open.includes(id);
    label.classList.toggle('is-locked', !unlocked);
    const radio = label.querySelector('input[name="soundKind"]');
    if (!radio) continue;
    // 見た目だけ塞ぐと押せてしまう。効かせるのは disabled のほう
    radio.disabled = !unlocked;
    radio.checked = radio.value === (settings.sound ?? 'off');
  }
  const vol = $('soundVolume');
  if (vol) vol.value = String(Math.round((settings.soundVolume ?? 0.4) * 100));
  const out = $('soundVolumeOut');
  if (out) out.textContent = `${Math.round((settings.soundVolume ?? 0.4) * 100)}`;
}

/** 設定画面の試し打ち。記録は残さない */
function startTrial(meter = el.setupMeter, board = el.setupBoard) {
  renderMeter(meter);
  if (board) renderKeyboard(board, layout, { lookup, thumbs: thumbKeysOf(settings) });
  engine = buildEngine(result => {
    if (result.charCode == null) return;
    // 設定画面の目的は「設定が効いているか確かめる」こと。
    // 親指を狙ったのに単独打鍵になったなら、それは不発として見せないと確かめられない。
    // ここで契約外の tier を渡すと meter が落として「単独打鍵」と出てしまう
    if (result.thumb && result.offsetMs == null) {
      // 連続シフトで出た一打。ズレは測れていないので、針を動かさず «出た» とだけ返す。
      // ここを tierOf(null) に流すと misfire になり、成功したのに不発と出る
      showJudgement(meter, { offsetMs: null, tier: 'continued' });
      sound.hit();
    } else if (result.thumb) {
      showJudgement(meter, { offsetMs: result.offsetMs, tier: tierOf(result.offsetMs) });
      sound.shifted({ tier: tierOf(result.offsetMs), offsetMs: result.offsetMs });
    } else if (trialWantedThumb) {
      showJudgement(meter, { offsetMs: null, tier: 'misfire' });
      sound.misfire();
    } else {
      sound.hit();
    }
    trialWantedThumb = false;
  });
  loop();
}

// -- 画面ごとの描画 ---------------------------------------------------------

function paintNav(stats = loadStats()) {
  el.navStreak.textContent = String(stats.streak ?? 0);
}

/** 門。計器にいまの親指のズレを出し、三つの扉に «いまどこまで来たか» を一行ずつ添える */
function paintHome() {
  const stats = loadStats();
  paintNav(stats);
  paintGateInst(stats);
  paintTally(stats);
  const next = CURRICULUM.find((l) => !lessonDone(stats, l.id));
  if (el.doorLearnState) {
    el.doorLearnState.textContent = next
      ? `${next === CURRICULUM[0] ? 'はじめ' : 'つづき'}：レッスン ${CURRICULUM.indexOf(next) + 1} ${next.title}`
      : '全レッスンを終えています';
  }
  if (el.doorTrainState) {
    el.doorTrainState.textContent = stats.runs > 0
      ? `段位 ${stats.rank ?? RANKS[0].name} ・ いま弱いのは ${weakFaces(stats, { limit: 40 }).length} 面`
      : '弱点集中・総ざらい・速度・実文・自由入力';
  }
}

/**
 * 入口の計器。ズレと分布は累計（stats.offset）、ぴったり率も累計、速さは直近 10 本の平均（gateNumbers）。
 * まだ測っていない間は数字を «—» にして、分布の場所に何が出るかだけを書く
 */
function gateNumbers(stats) {
  const rep = offsetReport(stats);
  const mean = meanOfBoth(rep);
  const n = (rep.left.n ?? 0) + (rep.right.n ?? 0);
  const recent = (stats.history ?? []).slice(0, 10).map(h => h.cpm).filter(v => Number.isFinite(v) && v > 0);
  return {
    n,
    offset: mean == null ? '—' : fmtOffset(mean).replace('ms', '').replace('-', '−'),
    perfect: n ? String(Math.round(overview(stats).perfectRate)) : '—',
    cpm: recent.length ? String(Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)) : '—',
  };
}

function paintGateInst(stats) {
  const g = gateNumbers(stats);
  const n = g.n;
  el.gateOffset.textContent = g.offset;
  el.gatePerfect.textContent = g.perfect;
  el.gateCpm.textContent = g.cpm;
  el.gateSample.textContent = n ? `${n.toLocaleString('ja-JP')} 打の同時打鍵` : '';
  el.gateOffset.closest('.inst').classList.toggle('is-empty', !n);
  if (n) {
    renderScope(el.gateScope, stats.offset);
  } else {
    // まだ測っていない人には、ここで一打試させる。«何を測るサイトか» は読ませるより押させたほうが早い。
    // 記録は残さない（設定画面の試し打ちと同じ）
    const p = document.createElement('p');
    p.className = 'inst__try';
    p.textContent = '文字キーと親指キーを同時に押してみてください（日本語入力はオフ）';
    const m = document.createElement('div');
    m.className = 'inst__meter';
    el.gateScope.replaceChildren(p, m);
    startTrial(m, null);
  }
}

// -- 前回から ----------------------------------------------------------------
//
// 門の «これまで» に、前に来たときから増えた分を添える。控え（storage の seen）は門を描くたびと
// ページを離れるときに書き、比べる相手はこのタブで最初に読んだ控え（sessionStorage）に固定する。
// ゲームへ行って戻る（ページの読み直し）たびに相手が新しくなると、増えた分が消えてしまうため

const SEEN_BASE = 'oyayubi-dojo:seenbase:v1';

function progressNow(stats) {
  const best = loadGameBest();
  const hist = loadGameHistory();
  return {
    at: Date.now(),
    keys: (stats.keystrokes ?? 0) + hist.reduce((a, r) => a + (Number.isFinite(r.keys) ? r.keys : 0), 0),
    rank: stats.runs > 0 ? stats.rank : null,
    days: stats.days?.length ?? 0,
    streak: stats.streak ?? 0,
    earned: Object.keys(stats.earned ?? {}),
    lessons: CURRICULUM.filter((l) => lessonDone(stats, l.id)).length,
    games: hist.length,
    best: Object.fromEntries(GAME_COURSES.map((c) => [c.id, Math.max(best.nicola[c.id]?.score ?? 0, best.romaji[c.id]?.score ?? 0)])),
  };
}

const seenBase = (() => {
  try {
    const kept = sessionStorage.getItem(SEEN_BASE);
    if (kept) return JSON.parse(kept);
    const b = loadSeen();
    sessionStorage.setItem(SEEN_BASE, JSON.stringify(b));
    return b;
  } catch {
    return loadSeen();   // sessionStorage が使えない環境。読み直すたびに相手が新しくなるだけで、数字は正しい
  }
})();

window.addEventListener('pagehide', () => saveSeen(progressNow(loadStats())));

function paintTally(stats) {
  const now = progressNow(stats);
  const was = seenBase;
  saveSeen(now);
  const any = now.keys > 0 || now.lessons > 0 || now.games > 0 || now.earned.length > 0;
  el.gateTally.hidden = !any;
  if (!any) return;

  const f = (v) => Math.round(v).toLocaleString('ja-JP');
  const d = new Date(was?.at ?? 0);
  el.gateTallyHead.textContent = was && Number.isFinite(d.getTime()) && was.at > 0
    ? `前回（${d.getMonth() + 1}月${d.getDate()}日）から` : 'これまで';

  const items = [];
  const item = ({ label, value, unit = '', from = null, plus = '', extra = null }) => items.push({ label, value, unit, from, plus, extra });

  if (now.rank) {
    item({ label: '段位', value: now.rank, plus: was?.rank && was.rank !== now.rank ? `${was.rank} から昇段` : '' });
  }
  const dk = was ? now.keys - (was.keys ?? 0) : 0;
  item({ label: '打鍵', value: now.keys, unit: '打', from: dk > 0 ? was.keys : null, plus: dk > 0 ? `+${f(dk)}` : '' });
  const dd = was ? now.days - (was.days ?? 0) : 0;
  item({ label: '練習した日', value: now.days, unit: '日', plus: [dd > 0 ? `+${dd}` : '', now.streak >= 2 ? `${now.streak} 日連続` : ''].filter(Boolean).join('　') });
  const fresh = was ? now.earned.filter((id) => !(was.earned ?? []).includes(id)) : [];
  const medals = fresh.map((id) => TROPHIES.find((t) => t.id === id)).filter((t) => t?.tier).slice(0, 3);
  item({ label: '実績', value: `${now.earned.length} / ${TROPHIES.length}`, plus: fresh.length ? `+${fresh.length}` : '', extra: medals });
  if (now.lessons > 0) {
    const dl = was ? now.lessons - (was.lessons ?? 0) : 0;
    item({ label: 'レッスン', value: `${now.lessons} / ${CURRICULUM.length}`, plus: dl > 0 ? `+${dl}` : '' });
  }
  const played = GAME_COURSES.filter((c) => now.best[c.id] > 0);
  if (played.length) {
    const c = played[played.length - 1];
    const up = GAME_COURSES.filter((x) => was && now.best[x.id] > (was.best?.[x.id] ?? 0));
    item({ label: `腕試し ${c.name.replace(/\s*pt$/, '')}`, value: now.best[c.id], unit: 'pt', plus: up.length ? '自己ベスト更新' : '' });
  }

  el.gateTallyRow.replaceChildren(...items.map(({ label, value, unit, from, plus, extra }) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    const b = document.createElement('b');
    b.textContent = typeof value === 'number' ? f(value) : value;
    if (typeof value === 'number' && from != null) countUp(b, from, value);
    dd.append(b);
    if (unit) { const u = document.createElement('small'); u.textContent = unit; dd.append(u); }
    div.append(dt, dd);
    if (plus || extra?.length) {
      const p = document.createElement('p');
      p.className = 'gtally__plus';
      p.textContent = plus;
      for (const t of extra ?? []) p.append(medal(t, { got: true, size: 's' }));
      div.append(p);
    }
    return div;
  }));
}

/** 前回の数から今の数まで数え上げる。動きを減らす設定の人には最後の数だけ出す */
function countUp(node, from, to) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  const ms = 1100;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    node.textContent = Math.round(from + (to - from) * e).toLocaleString('ja-JP');
    if (k < 1 && node.isConnected) requestAnimationFrame(step);
  };
  node.textContent = Math.round(from).toLocaleString('ja-JP');
  requestAnimationFrame(step);
}

/**
 * これまで外したかな（多い順に 4 つまで）。キー×面の外しの記録から引く。
 * レッスンの組み合わせと確認に多めに混ぜるのに使う（curriculum.js の findPhase がまだ習っていない字は落とす）
 */
function weakKana(stats) {
  return Object.entries(stats.faceMisses ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([face]) => {
      const [code, thumb] = face.split(':');
      return layout.keys[code]?.[thumb];
    })
    .filter(Boolean)
    .filter((c, i, a) => a.indexOf(c) === i)
    .slice(0, 4);
}

/** そのレッスンを始められるか。最初のレッスンか、一つ前を終えていれば開く */
function lessonOpen(stats, lessonId) {
  const i = CURRICULUM.findIndex((l) => l.id === lessonId);
  return i === 0 || (i > 0 && lessonDone(stats, CURRICULUM[i - 1].id));
}

/** そのレッスンで次に打つ段階（全部終えていれば最初の段階＝やり直し） */
function nextPhaseOf(stats, lessonId) {
  const p = PHASES.find((ph) => !((stats.cleared?.[phaseId(lessonId, ph.id)] ?? 0) > 0)) ?? PHASES[0];
  return phaseId(lessonId, p.id);
}

/**
 * レッスンの一覧。単元ごとに、番号・題・新しいかな・どこまで来たかの行を並べる。
 * 一つ前を終えていないレッスンは押せない（覚える順番に意味がある）
 */
function paintLearn() {
  const stats = loadStats();
  paintNav(stats);

  const doneCount = CURRICULUM.filter((l) => lessonDone(stats, l.id)).length;
  el.learnDone.textContent = String(doneCount);
  el.learnTotal.textContent = `/ ${CURRICULUM.length} レッスン`;
  el.learnFill.style.width = `${(doneCount / CURRICULUM.length) * 100}%`;
  el.learnReward.hidden = doneCount < CURRICULUM.length;

  const cur = CURRICULUM.find((l) => !lessonDone(stats, l.id));
  el.btnStart.hidden = !cur;
  if (cur) {
    const no = CURRICULUM.indexOf(cur) + 1;
    el.startSub.textContent = `レッスン ${no} ${cur.title}`;
    el.btnStart.onclick = () => { location.hash = `#/play/${nextPhaseOf(stats, cur.id)}`; };
  } else {
    el.startSub.textContent = '';
  }

  let no = 0;
  el.learnUnits.replaceChildren(...UNITS.map((u, ui) => {
    const sec = document.createElement('section');
    sec.className = 'unit';
    const h = document.createElement('h2');
    h.className = 'unit__head';
    const tag = document.createElement('span');
    tag.textContent = `単元 ${ui + 1}`;
    h.append(tag, u.name);
    const note = document.createElement('p');
    note.className = 'unit__note';
    note.textContent = u.note;
    const ol = document.createElement('ol');
    ol.className = 'lsteps';
    ol.replaceChildren(...u.lessons.map((l) => {
      no++;
      const done = lessonDone(stats, l.id);
      const open = lessonOpen(stats, l.id);
      const now = !done && open;
      const a = document.createElement('a');
      a.className = `lstep${done ? ' is-done' : now ? ' is-now' : !open ? ' is-locked' : ''}`;
      if (open) a.href = `#/play/${nextPhaseOf(stats, l.id)}`;
      else a.setAttribute('aria-disabled', 'true');
      const num = document.createElement('span');
      num.className = 'lstep__no';
      if (done) num.append(icon('check'));
      else if (!open) num.append(icon('lock'));
      else num.textContent = String(no);
      const main = document.createElement('span');
      main.className = 'lstep__main';
      const t = document.createElement('b');
      t.textContent = l.title;
      const k = document.createElement('small');
      k.textContent = `新しいかな：${l.newKeys.map((x) => x.kana).join(' ')}`;
      main.append(t, k);
      const st = document.createElement('span');
      st.className = 'lstep__state';
      const n = phasesDone(stats, l.id);
      st.textContent = done ? '済み' : now ? (n ? `${n} / ${PHASES.length} 段階` : 'つぎ') : '';
      a.append(num, main, st);
      const li = document.createElement('li');
      li.append(a);
      return li;
    }));
    sec.append(h, note, ol);
    return sec;
  }));
}

el.btnRewardA4?.addEventListener('click', () => downloadLayoutPng(layout, 'a4'));
el.btnRewardStrip?.addEventListener('click', () => downloadLayoutPng(layout, 'strip'));


function paintMypage() {
  const stats = loadStats();
  const o = overview(stats);
  const rep = offsetReport(stats);
  paintNav(stats);

  // いまの弱点
  setSkew(el.drillSkewLeftMark, el.drillSkewLeftVal, rep?.left);
  setSkew(el.drillSkewRightMark, el.drillSkewRightVal, rep?.right);
  const weak = weakFaces(stats, { limit: 6 });
  if (el.drillWeakCount) el.drillWeakCount.textContent = `${weak.length}面`;
  paintWeakList(el.drillWeak, el.drillWeakEmpty, stats);

  el.rankName.textContent = stats.rank ?? RANKS[0].name;
  el.rankScore.textContent = `稽古量 ${(stats.score ?? 0).toLocaleString('ja-JP')}`;
  paintRankLadder(stats);
  // nextRankGap は { next, cpmGap, accGap, scoreGap }。文言はこちらで組む。
  // 点数ではなく「あと何が足りないか」を出す（点数を見せても何をすればいいか分からない）
  const gap = nextRankGap(stats);
  if (!gap) {
    el.rankNext.textContent = '最高段位です';
    if (el.rankFill) el.rankFill.style.width = '100%';
  } else {
    el.rankNext.textContent = `${gap.next.name} まで ${rankNeedText(gap)}`;
    // 線は三つの条件（速さ・正確率・稽古量）のうち、いちばん遅れているものの進み具合。
    // 稽古量だけで引くと、速さが足りないのに線が満杯に見えていた
    const cur = RANKS.find((r) => r.name === stats.rank) ?? rankOf(stats.score ?? 0);
    const part = (have, from, to) => (to > from ? Math.min(1, Math.max(0, (have - from) / (to - from))) : 1);
    const best = stats.best ?? {};
    const fill = Math.min(
      part(best.cpm ?? 0, cur.cpm, gap.next.cpm),
      part(best.accuracy ?? 0, cur.accuracy, gap.next.accuracy),
      part(stats.score ?? 0, cur.at, gap.next.at),
    );
    if (el.rankFill) el.rankFill.style.width = `${fill * 100}%`;
  }

  // overview() は meanOffset を返さない。すぐ下の「同時打鍵のクセ」と同じ出所から取る。
  // 別々の出所にすると、同じ画面で違うことを言い出す（実際に言っていた）
  const tally = [
    ['総打鍵', String(stats.keystrokes ?? 0)],
    ['確定文字', String(stats.kana ?? 0)],
    ['練習日数', `${stats.days?.length ?? 0}日`],
    ['平均ズレ', fmtOffset(meanOfBoth(rep))],
  ];
  el.statTally.replaceChildren(...tally.flatMap(([k, v]) => {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    wrap.append(dt, dd);
    return [wrap];
  }));

  renderTrend(el.trendBox, stats.history ?? []);
  renderOffsetHist(el.offsetHist, stats.offset);

  renderIso(el.isoBoard, { layout, stats });

  renderCalendar(el.calBox, stats.daily ?? {}, new Date());
  paintTrophies(stats);
  paintRecords(stats);
  paintLearnRecord(stats);
  paintGameRecord();
  paintRomajiCard(stats);
  // 入力欄は #romajiCard とは別の札にある。記録が無い間は #romajiCard が隠れるので、
  // 中に入れると「記録が無い人だけが欄に辿り着けない」形になる
  paintRomajiState(stats);

  el.dataKeys.replaceChildren(...Object.values(STORAGE_KEYS).map(k => {
    const li = document.createElement('li');
    li.textContent = k;
    return li;
  }));
}

let trophyFilter = 'all'; // 'all' | 'got' | 'locked'

/**
 * 実績の一覧。ゲームの実績画面の形にしてある。
 *   上に «何個中何個・何％» と格ごとの数、その下に系統ごとの札。
 *   札は左にメダル、右に名前・条件・取った日（取っていなければ進み具合のバー）。
 */
function paintTrophies(stats) {
  const got = stats.earned ?? {};
  const total = TROPHIES.length;
  const have = TROPHIES.filter(t => got[t.id]).length;
  el.trophyCount.textContent = `${have} / ${total}`;

  const pct = Math.round((have / total) * 100);
  const bar = document.createElement('span');
  bar.className = 'ach-sum__bar';
  const fill = document.createElement('i');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `取得率 ${pct}%`);

  const big = document.createElement('p');
  big.className = 'ach-sum__big';
  const bn = document.createElement('b'); bn.textContent = String(have);
  const bt = document.createElement('span'); bt.textContent = ` / ${total} 解除`;
  const bp = document.createElement('em'); bp.textContent = `${pct}%`;
  big.append(bn, bt, bp);

  const tiers = document.createElement('ul');
  tiers.className = 'ach-sum__tiers';
  for (const tier of TIERS) {
    const all = TROPHIES.filter(t => t.tier === tier.id);
    const n = all.filter(t => got[t.id]).length;
    const li = document.createElement('li');
    li.append(medal({ category: 'crown', tier: tier.id }, { got: n > 0, size: 's' }));
    const lab = document.createElement('span');
    lab.textContent = `${tier.name} ${n} / ${all.length}`;
    li.append(lab);
    tiers.append(li);
  }

  const seg = document.createElement('div');
  seg.className = 'ach-filter';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', '絞り込み');
  for (const [id, label] of [['all', 'すべて'], ['got', '取得済み'], ['locked', '未取得']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(trophyFilter === id));
    b.addEventListener('click', () => { trophyFilter = id; paintTrophies(stats); });
    seg.append(b);
  }

  const sum = document.createElement('div');
  sum.className = 'ach-sum';
  sum.append(big, bar, tiers, seg);

  const nodes = [sum];
  for (const [cat, list] of Object.entries(trophiesByCategory())) {
    const shown = list.filter(t => trophyFilter === 'all' || (trophyFilter === 'got') === !!got[t.id]);
    if (!shown.length) continue;
    const h = document.createElement('h3');
    h.className = 'trophies__cat';
    h.textContent = `${CATEGORY_NAME[cat] ?? cat}　${list.filter(t => got[t.id]).length} / ${list.length}`;
    nodes.push(h);
    for (const t of shown) nodes.push(trophyCard(t, got[t.id], stats));
  }
  if (nodes.length === 1) {
    const p = document.createElement('p');
    p.className = 'trophies__none';
    p.textContent = trophyFilter === 'got' ? 'まだありません。' : 'すべて取りました。';
    nodes.push(p);
  }
  el.trophies.replaceChildren(...nodes);
}

function trophyCard(t, when, stats) {
  const tierName = TIERS.find(x => x.id === t.tier)?.name ?? '';
  const d = document.createElement('div');
  d.className = 'ach' + (when ? ' is-got' : '');
  d.dataset.tier = t.tier;
  const body = document.createElement('div');
  body.className = 'ach__body';
  const name = document.createElement('b');
  name.className = 'ach__name';
  name.textContent = t.name;
  const chip = document.createElement('span');
  chip.className = 'ach__tier';
  chip.textContent = tierName;
  const head = document.createElement('span');
  head.className = 'ach__head';
  head.append(name, chip);
  const hint = document.createElement('span');
  hint.className = 'ach__hint';
  hint.textContent = t.hint ?? '';
  body.append(head, hint);
  if (when) {
    const at = document.createElement('span');
    at.className = 'ach__at';
    at.textContent = `${String(when).slice(0, 10).replaceAll('-', '/')} に解除`;
    body.append(at);
  } else {
    const p = progressOf(t, stats);
    if (p) {
      const row = document.createElement('span');
      row.className = 'ach__prog';
      const track = document.createElement('span');
      track.className = 'ach__track';
      const f = document.createElement('i');
      f.style.width = `${Math.round((p.now / p.goal) * 100)}%`;
      track.append(f);
      const num = document.createElement('span');
      num.textContent = `${p.now.toLocaleString('ja-JP')} / ${p.goal.toLocaleString('ja-JP')}`;
      row.append(track, num);
      body.append(row);
    }
  }
  d.append(medal(t, { got: !!when }), body);
  return d;
}

/** 記録の «覚える»：レッスンの進み具合と、単元ごとの済み数 */
function paintLearnRecord(stats) {
  const done = CURRICULUM.filter((l) => lessonDone(stats, l.id)).length;
  $('recLearnCount').textContent = `${done} / ${CURRICULUM.length} レッスン`;
  $('recLearnFill').style.width = `${(done / CURRICULUM.length) * 100}%`;
  $('recLearnUnits').replaceChildren(...UNITS.map((u, i) => {
    const n = u.lessons.filter((l) => lessonDone(stats, l.id)).length;
    const li = document.createElement('li');
    if (n === u.lessons.length) li.className = 'is-done';
    const b = document.createElement('b');
    b.textContent = `${n} / ${u.lessons.length}`;
    li.append(`単元 ${i + 1} ${u.name}`, b);
    return li;
  }));
  const cur = CURRICULUM.find((l) => !lessonDone(stats, l.id));
  const next = $('recLearnNext');
  const a = document.createElement('a');
  a.className = 'link';
  a.href = '#/learn';
  if (cur) {
    a.textContent = `レッスン ${CURRICULUM.indexOf(cur) + 1} ${cur.title}`;
    next.replaceChildren('つぎは ', a);
  } else {
    a.textContent = 'レッスンの一覧';
    next.replaceChildren('全部終えました（', a, '）');
  }
}

const GAME_INPUT_NAME = { nicola: '親指シフト', romaji: 'ローマ字' };

/** 記録の «腕試し»：ノルマ×入力方式の自己ベストと、これまでの回（新しい順に 20 回） */
function paintGameRecord() {
  const best = loadGameBest();
  const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')} pt`;
  const cell = (tr, v) => { const td = document.createElement('td'); td.textContent = v; tr.append(td); };
  $('recGameBest').replaceChildren(...GAME_COURSES.map((c) => {
    const tr = document.createElement('tr');
    cell(tr, c.name);
    for (const input of ['nicola', 'romaji']) {
      const b = best[input][c.id];
      cell(tr, b ? `${yen(b.score)}（${b.score >= c.target ? 'お得' : '損'}）` : '—');
    }
    return tr;
  }));

  const runs = loadGameHistory();
  $('recGameCount').textContent = runs.length ? `${runs.length} 回` : '';
  $('recGameWrap').hidden = runs.length === 0;
  $('recGameEmpty').hidden = runs.length > 0;
  $('recGameRows').replaceChildren(...runs.slice(0, 20).map((r) => {
    const tr = document.createElement('tr');
    const d = new Date(r.at);
    const pad = (n) => String(n).padStart(2, '0');
    cell(tr, Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '—');
    cell(tr, GAME_COURSES.find((c) => c.id === r.course)?.name ?? r.course);
    cell(tr, GAME_INPUT_NAME[r.input] ?? r.input);
    cell(tr, GAME_SPEEDS.find((s) => s.id === r.speed)?.name ?? r.speed);
    cell(tr, yen(r.score));
    cell(tr, r.balance >= 0 ? `${yen(r.balance)} お得` : `${yen(-r.balance)} 損`);
    cell(tr, `${Number(r.keysPerSec).toFixed(1)} 回/秒`);
    cell(tr, `${r.misses} 回`);
    return tr;
  }));
}

function paintRecords(stats) {
  // 課題ごとに一行へまとめる。直近の本をそのまま並べると同じ課題が何十行も続き、
  // 見出しの «課題ごとの» と中身が食い違う。
  // history は新しい順。最大 200 本なので、ここに無い古い回は数えられない（«回数» は直近の範囲で）
  const groups = new Map();
  for (const h of stats.history ?? []) {
    const key = h.id ?? '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  const rows = [...groups.entries()].map(([id, runs]) => {
    const last = runs[0];
    const cpms = runs.map(r => Number(r.cpm)).filter(Number.isFinite);
    const best = cpms.length ? Math.max(...cpms) : null;
    const tr = document.createElement('tr');
    const cells = [
      findLesson(id)?.title ?? id,
      `${runs.length}回`,
      null, // 推移（下で SVG を入れる）
      last.cpm == null ? '—' : Number(last.cpm).toFixed(1),
      best == null ? '—' : best.toFixed(1),
      fmtOffset(last.meanOffset),
      typeof last.at === 'string' ? last.at.slice(0, 10) : '',
    ];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      if (i === 2) {
        td.className = 'rec__spark';
        td.append(sparkline([...cpms].reverse()));
      } else td.textContent = String(v);
      tr.append(td);
    });
    return tr;
  });
  el.recBody.replaceChildren(...rows);
  // 空の表に見出しだけ出すより、一文で言う
  if (el.recTable) el.recTable.hidden = rows.length === 0;
  if (el.recEmpty) el.recEmpty.hidden = rows.length > 0;
}

// 速さの推移を一行に収める小さな線。古い→新しいを左→右。
// 軸も目盛りも無いので、数字は隣の «直近» «最高» の列で読ませる（線は向きだけを言う）
function sparkline(values) {
  const W = 96, H = 22, P = 2;
  if (values.length < 2) {
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'spark', 'aria-hidden': 'true' });
    return s;
  }
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = i => P + (i / (values.length - 1)) * (W - P * 2);
  const y = v => H - P - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - P * 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const lastX = x(values.length - 1), lastY = y(values[values.length - 1]);
  const up = values[values.length - 1] >= values[0];
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'spark', role: 'img',
    'aria-label': `速さの推移。${values.length}回で ${values[0]} から ${values[values.length - 1]} cpm（${up ? '伸びている' : '落ちている'}）` },
    svg('path', { d, class: 'spark__line' }),
    svg('circle', { cx: lastX, cy: lastY, r: 2.5, class: 'spark__dot' }));
}

// -- 弱点の表示（覚える・鍛える の両方で使う） -----------------------------------------------------------------

/** ズレの針。-80〜+80ms を -1〜1 に写す。中央がぴったり */
function setSkew(markEl, valEl, side) {
  if (!markEl) return;
  const ms = side?.mean ?? null;
  markEl.style.setProperty('--at', String(ms == null ? 0 : Math.max(-1, Math.min(1, ms / 80))));
  markEl.hidden = ms == null;
  // 印の色を判定に合わせる（CSS は .skew[data-tier] を待っている。付けないと常に同じ色だった）
  const row = markEl.closest('.skew');
  if (row) {
    if (ms == null) delete row.dataset.tier;
    else row.dataset.tier = tierOf(ms);
  }
  if (valEl) valEl.textContent = fmtOffset(ms);
}

function paintWeakList(listEl, emptyEl, stats, limit = 6) {
  const weak = weakFaces(stats, { limit });
  const has = weak.length > 0;
  if (emptyEl) emptyEl.hidden = has;
  if (!listEl) return has;
  // CSS は 4 列（かな / 説明 / 帯 / 数）を待っている。クラスを付けずに作ると
  // 列に収まらず、文字が枠の外へあふれる（実際あふれていた）
  //
  // 帯と数はミスの «率»。回数にすると、たくさん打った面ほど大きく出てしまう。
  // 率は記録画面の得意・苦手の図と同じ式（missRateOf）。言うことを揃える
  const rateOf = f => missRateOf(f.hits ?? 0, f.misses ?? 0);
  const worst = Math.max(0.01, ...weak.filter(f => !f.unseen).map(rateOf));
  listEl.replaceChildren(...weak.map(f => {
    const li = document.createElement('li');
    li.className = 'weak';

    const face = document.createElement('b');
    const kind = f.thumb === 'none' ? 'solo' : f.shiftKind === 'cross' ? 'cross' : 'same';
    face.className = `weak__face weak__face--${kind}`;
    face.textContent = f.kana ?? '';

    // describeFace は「ば（交差シフト・右手×左親指）」とかなから始まる。
    // 隣にかなを出しているので、括弧の中だけを使う
    const what = document.createElement('span');
    what.className = 'weak__what';
    // なぜ弱いと見たか（ミスが多い・ズレが大きい・打ち込みが足りない）を添える
    what.textContent = `${describeFace(f).replace(/^[^（]*/, '').replace(/^（|）$/g, '')}　${f.reason ?? ''}`;

    const bar = document.createElement('span');
    bar.className = 'weak__bar';
    const i = document.createElement('i');
    i.style.setProperty('--p', String(f.unseen ? 0 : Math.min(1, rateOf(f) / worst)));
    bar.append(i);

    const num = document.createElement('span');
    num.className = 'weak__num';
    num.textContent = f.unseen ? '未' : `${(rateOf(f) * 100).toFixed(1)}%`;
    num.title = f.unseen ? 'まだ打っていない' : `ミス率（${f.hits}打中 ${f.misses}回）`;

    li.append(face, what, bar, num);
    li.title = f.reason ?? '';
    return li;
  }));
  return has;
}

function skewNote(rep) {
  const l = rep?.left?.mean, r = rep?.right?.mean;
  if (l == null && r == null) return 'まだズレの記録がありません。';
  const worse = Math.abs(l ?? 0) >= Math.abs(r ?? 0) ? '左' : '右';
  const v = worse === '左' ? l : r;
  if (v == null || Math.abs(v) < 5) return '左右とも、ほぼ揃っています。';
  return `${worse}親指のズレが大きめです（${fmtOffset(v)}／${offsetWord(v)}）。そちらを意識して直すと効きます。`;
}

function paintRomajiState(stats) {
  const has = stats.romaji && stats.romaji.cpm > 0;
  if (el.checkRomajiState) el.checkRomajiState.textContent = has ? `${Math.round(stats.romaji.cpm)} cpm` : '未記録';
  if (el.checkRomajiStatus) {
    el.checkRomajiStatus.textContent = !has ? ''
      : stats.romaji.by === 'measured' ? 'ここで測った最高の速さです。' : '手で入れた値です。';
  }
}

function paintRomajiCard(stats) {
  if (!el.romajiCard) return;
  const cmp = romajiComparison(stats);
  const has = cmp && cmp.baseline > 0;
  el.romajiCard.hidden = !has;
  if (!has) return;

  if (el.romajiRatio) el.romajiRatio.textContent = cmp.ratio ? `${Math.round(cmp.ratio * 100)}%` : '—';
  if (el.romajiBaseVal) el.romajiBaseVal.textContent = String(Math.round(cmp.baseline));
  if (el.romajiNowVal) el.romajiNowVal.textContent = cmp.current ? String(Math.round(cmp.current)) : '—';
  const top = Math.max(cmp.baseline, cmp.current ?? 0, 1);
  el.romajiBaseBar?.style.setProperty('--w', String(cmp.baseline / top));
  el.romajiNowBar?.style.setProperty('--w', String((cmp.current ?? 0) / top));
  if (el.romajiMessage) el.romajiMessage.textContent = cmp.message ?? '';

  if (el.romajiPassed) {
    el.romajiPassed.hidden = !cmp.passedAt;
    if (cmp.passedAt) el.romajiPassed.textContent = `${cmp.passedAt} に追い抜きました`;
  }

  // 同じ文を両方で打ったもの
  const both = Object.keys(stats.romajiBest ?? {})
    .filter(id => stats.lessonBest?.[id] && findLesson(id))
    .map(id => ({ title: findLesson(id).title, r: stats.romajiBest[id].cpm, n: stats.lessonBest[id].cpm }));
  if (el.romajiTexts) el.romajiTexts.hidden = !both.length;
  el.romajiTextRows?.replaceChildren(...both.map(x => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = x.title;
    const r = document.createElement('td');
    r.textContent = String(Math.round(x.r));
    const n = document.createElement('td');
    n.textContent = String(Math.round(x.n));
    (x.n >= x.r ? n : r).className = 'is-win';
    tr.append(th, r, n);
    return tr;
  }));
}

// -- 鍛える -------------------------------------------------------------------

function paintDrill() {
  const stats = loadStats();
  paintNav(stats);
  // 弱点の一覧は記録の画面にある（paintMypage）。ここは出題の札だけ

  paintTrainStats(stats);
  paintInputPick();
  paintMaterials(stats);
  updateFreeText();
}

/** 見出しの横の数字。数字の出所は入口の計器（gateNumbers）と同じにする */
function paintTrainStats(stats) {
  const g = gateNumbers(stats);
  el.trainRank.textContent = stats.runs > 0 ? (stats.rank ?? RANKS[0].name) : '—';
  el.trainCpm.textContent = g.cpm;
  el.trainPerfect.textContent = g.perfect;
  el.trainOffset.textContent = g.offset;
  el.trainWeak.textContent = stats.runs > 0 ? String(weakFaces(stats, { limit: 40 }).length) : '—';
}

function paintInputPick() {
  for (const b of el.inputPick?.querySelectorAll('[data-input]') ?? []) {
    b.setAttribute('aria-checked', String(b.dataset.input === settings.input));
  }
}

/**
 * 題材の中身を数える。
 *
 * 一覧に題名と字数だけ並べても選べない。稽古で知りたいのは
 * 「これを打つと何が鍛えられるか」なので、面の内訳から特徴を出す。
 */
function materialInfo(lesson) {
  const chars = [...(lesson.text ?? '')];
  let solo = 0, same = 0, cross = 0, small = 0;
  for (const c of chars) {
    const how = howToType(c);
    if (!how) continue;
    if (!how.thumb) solo++;
    else if (how.shiftKind === 'same') same++;
    else cross++;
    if ('ぁぃぅぇぉゃゅょっ'.includes(c)) small++;
  }
  const n = chars.length || 1;
  const shifted = same + cross;

  // 閾値は題材60本の実測分布から決めた。
  // タグは «普通と違う» を指すためのものなので、自然分布の真ん中に線を引くと
  // ほとんどの題材に付いて何も言わなくなる。上位1〜2割に入る値にしてある。
  //   同側  中央0.331 / 90%点0.455 … 0.30 だと41本に付いていた（＝無意味）
  //   同時  中央0.457 / 90%点0.578 … 0.45 だと35本に付いていた
  //   交差  中央0.106 / 90%点0.244 … 0.28 は既に上位。そのまま
  //   小書き 中央0.028 / 90%点0.095 … 0.10 は既に上位。そのまま
  const tags = [];
  if (cross / n >= 0.28) tags.push('濁音が多い');
  if (same / n >= 0.42) tags.push('同側シフトが多い');
  if (small / n >= 0.1) tags.push('小書き・拗音が多い');
  if (shifted / n <= 0.3) tags.push('ほぼ単独打鍵');
  if (shifted / n >= 0.55) tags.push('同時打鍵が主');

  return { kana: chars.length, solo, same, cross, shifted, tags };
}


// 長さで切り替える。83本を平らに並べると長い一本を探せない
const SIZE_ORDER = ['とてもながい', 'ながめ', 'ふつう', 'みじかめ'];
let materialSize = SIZE_ORDER[0];

function sizeOf(lesson) {
  if (lesson.size) return lesson.size;
  const n = [...(lesson.text ?? '')].length;
  return n >= 1000 ? 'とてもながい' : n >= 400 ? 'ながめ' : n >= 100 ? 'ふつう' : 'みじかめ';
}

function paintMaterials(stats) {
  const box = $('drillTextList');
  if (!box) return;

  const groups = new Map(SIZE_ORDER.map(s => [s, []]));
  for (const l of TEXTS) {
    const g = groups.get(sizeOf(l));
    if (!g) throw new Error(`実文 ${l.id} の長さ ${sizeOf(l)} が SIZE_ORDER に無い`);
    g.push(l);
  }

  el.drillTextTabs?.replaceChildren(...SIZE_ORDER.filter(s => groups.get(s).length).map(size => {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'texts__tab';
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-selected', String(size === materialSize));
    t.textContent = size;
    const n = document.createElement('small');
    n.textContent = groups.get(size).length;
    t.append(n);
    t.addEventListener('click', () => { materialSize = size; paintMaterials(loadStats()); });
    return t;
  }));

  box.replaceChildren(...materialRows(groups.get(materialSize) ?? [], stats));
}

function materialRows(list, stats) {
  return list.map(l => {
    const info = materialInfo(l);
    const times = stats.cleared?.[l.id] ?? 0;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'material' + (times ? ' is-done' : '');
    b.dataset.lesson = l.id;

    const name = document.createElement('b');
    name.className = 'material__name';
    name.textContent = l.title;

    const len = document.createElement('span');
    len.className = 'material__len';
    len.textContent = `${info.kana}字`;

    // ホバー（とフォーカス）で出す詳細
    const pop = document.createElement('span');
    pop.className = 'material__pop';
    const meta = document.createElement('span');
    meta.className = 'material__meta';
    meta.textContent = `同時打鍵 ${Math.round((info.shifted / (info.kana || 1)) * 100)}%`
      + (times ? ` · ${times}回打った` : '');
    pop.append(meta);
    // 同じ文を両方で打っていれば、速さを並べる
    const nb = stats.lessonBest?.[l.id]?.cpm;
    const rb = stats.romajiBest?.[l.id]?.cpm;
    if (nb || rb) {
      const vs = document.createElement('span');
      vs.className = 'material__meta';
      vs.textContent = `親指シフト ${nb ? Math.round(nb) : '—'} / ローマ字 ${rb ? Math.round(rb) : '—'} cpm`;
      pop.append(vs);
    }
    if (l.note) {
      const note = document.createElement('span');
      note.className = 'material__note';
      note.textContent = l.note;
      pop.append(note);
    }
    if (info.tags.length) {
      const tags = document.createElement('span');
      tags.className = 'material__tags';
      for (const t of info.tags) {
        const i = document.createElement('i');
        i.textContent = t;
        tags.append(i);
      }
      pop.append(tags);
    }

    if (times) name.prepend(icon('check'));
    b.append(name, len, pop);
    return b;
  });
}

/** 自由入力。打てない字が混ざっていたら先に言う */
function updateFreeText() {
  if (!el.freeText) return;
  const text = el.freeText.value ?? '';
  const chars = [...text].filter(c => !/\s/.test(c));
  if (el.freeTextCount) el.freeTextCount.textContent = `${chars.length}字`;

  // 長すぎる一本は途中で集中が切れて、記録も «その日の実力» を指さなくなる。
  // 課題の上限（80字）よりは緩く、一息で打ち切れる長さで切る
  const tooLong = chars.length > FREE_TEXT_MAX;

  const bad = [...new Set(chars.filter(c => !howToType(c)))];
  if (el.freeTextWarn) el.freeTextWarn.hidden = bad.length === 0 && !tooLong;
  if (el.freeTextWarnList) {
    el.freeTextWarnList.textContent = tooLong
      ? `${FREE_TEXT_MAX}字までにしてください（いま ${chars.length}字）`
      : bad.join(' ');
  }
  if (el.btnFreeStart) el.btnFreeStart.disabled = chars.length === 0 || bad.length > 0 || tooLong;
}

// -- ルーティング -----------------------------------------------------------

/**
 * 場所（門・覚える・鍛える）。看板・帯の色・ナビの中身は CSS が body[data-area] で切り替える。
 * 配列表と設定は場所を持たない道具なので、開いても直前の場所のまま（入門から開いた配列表は入門の顔）。
 * 課題の画面は、覚えるのレッスンの段階なら覚える、それ以外（実文の題材・その場で組んだ出題・自由入力）なら鍛える
 */
// 記録・配列表・設定は場所を持たない（開いても帯の色は前の場所のまま）
const AREA_OF = { home: 'gate', learn: 'learn', train: 'train' };
const AREA_TITLE = { gate: '親指シフトマスター ～0から覚えてトレーニングまで～', learn: '親指シフト入門｜親指シフトマスター', train: '親指シフト トレーニング｜親指シフトマスター' };
let area = 'gate';

function setArea(name, arg) {
  if (AREA_OF[name]) area = AREA_OF[name];
  else if (name === 'play') area = (pending ?? findLesson(arg))?.courseId === 'learn' ? 'learn' : 'train';
  document.body.dataset.area = area;
  document.title = AREA_TITLE[area];
}

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [, head, arg] = hash.match(/^\/([^/]*)\/?(.*)$/) ?? [];

  stopLoop();
  engine = null;
  run = null;

  const KNOWN = ['learn', 'train', 'record', 'play', 'layout', 'setup'];
  const name = head === '' ? 'home' : KNOWN.includes(head) ? head : 'home';

  // 正規の形に直してから進む。知らない場所や «#////» のような形をそのまま残すと、
  // URL が「そこに居る」と嘘をつくし、その URL を渡されても同じ画面が開かない
  const canonical = name === 'home' ? '#/'
    : name === 'play' ? `#/play/${arg}`
      : `#/${name}`;
  if (location.hash !== canonical) { location.replace(canonical); return; }

  screen = name;
  setArea(name, arg);
  for (const [k, node] of Object.entries(el.screens)) {
    if (node) node.hidden = k !== name;
  }
  // 一本打っている間（#/play/…）は、その一本の場所（覚える・鍛える）に印を付ける
  const here = name === 'play' ? `/${area}` : `/${head}`;
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.setAttribute('aria-current', a.dataset.nav === here ? 'page' : 'false');
  }

  if (name === 'home') paintHome();
  else if (name === 'learn') paintLearn();
  else if (name === 'train') paintDrill();
  else if (name === 'record') paintMypage();
  else if (name === 'setup') { paintSetup(); startTrial(); }
  else if (name === 'layout') {
    renderKeyboard(el.layoutBoard, layout, { lookup, thumbs: thumbKeysOf(settings) });
  } else if (name === 'play') {
    let lesson = pending ?? findLesson(arg);
    // レッスンの組み合わせと確認には、これまで外したかなを多めに混ぜる（記録から引き直す）
    if (!pending && lesson?.courseId === 'learn') lesson = findPhase(arg, { weak: weakKana(loadStats()) });
    pending = null;
    if (!lesson) { location.replace('#/'); return; }

    // レッスンの順番は一覧の札だけでなくここでも守る。札の href だけだと URL を打てば素通りでき、
    // 順番は「腕に覚えのある人ほど飛ばしたくなる」もの。題材・その場で組んだ出題は順番を持たない
    if (lesson.courseId === 'learn' && !lessonOpen(loadStats(), lesson.lessonId)) {
      toast('このレッスンは、一つ前のレッスンを終えると開きます');
      location.replace('#/learn');
      return;
    }
    if (el.playBadge) {
      el.playBadge.hidden = !mode;
      el.playBadge.textContent = mode === 'free' ? '自由入力' : mode === 'drill' ? '鍛える' : '';
    }
    renderMeter(el.meter);
    renderKeyboard(el.board, layout, { lookup, thumbs: thumbKeysOf(settings) });
    startRun(lesson);
  }
  window.scrollTo(0, 0);
}

// -- つなぎ -----------------------------------------------------------------

el.catchLeft?.addEventListener('click', () => {
  catching = 'left';
  el.catchLeft.classList.add('is-catching');
  el.catchLeft.textContent = 'キーを押してください…';
});
el.catchRight?.addEventListener('click', () => {
  catching = 'right';
  el.catchRight.classList.add('is-catching');
  el.catchRight.textContent = 'キーを押してください…';
});

// 音色と音量。選んだその場で鳴らさないと、耳で選べない
document.addEventListener('change', e => {
  const r = e.target?.closest?.('input[name="soundKind"]');
  if (!r) return;
  settings.sound = r.value;
  settings = saveSettings(settings) ?? settings;
  sound.setKind(settings.sound);
  paintSoundSettings();
});

$('soundVolume')?.addEventListener('input', e => {
  const v = Math.max(0, Math.min(100, Number(e.target.value))) / 100;
  settings.soundVolume = v;
  const out = $('soundVolumeOut');
  if (out) out.textContent = String(Math.round(v * 100));
  sound.setVolume(v);   // 試聴は sound.js 側で間引かれる
});

$('soundVolume')?.addEventListener('change', () => {
  settings = saveSettings(settings) ?? settings;
});

// 打ち方のクセ。変えたその場で試し打ちに効かせないと «効いたのか» が確かめられない
for (const [node, key] of [[el.lenientRelease, 'lenientRelease'], [el.continuousShift, 'continuousShift'], [el.autoSkip, 'autoSkip']]) {
  node?.addEventListener('change', () => {
    settings[key] = node.checked;
    settings = saveSettings(settings) ?? settings;
    // 判定を変える二つだけ、試し打ちを打ち直して «変えたその場で» 効かせる。
    // autoSkip は判定に関わらないので、試し打ちの針を無駄に消さない
    if (screen === 'setup' && key !== 'autoSkip') startTrial();
  });
}

el.tauRange?.addEventListener('input', () => {
  settings.tau = Number(el.tauRange.value);
  el.tauOut.textContent = `${settings.tau}ms`;
  saveSettings(settings);
  if (screen === 'setup') startTrial();   // 変えたその場で効かせる
});

for (const b of document.querySelectorAll('[data-tone-set]')) {
  b.addEventListener('click', () => {
    settings.tone = b.dataset.toneSet;
    settings = saveSettings(settings) ?? settings;
    applyTone(settings.tone);
  });
}

el.btnBack?.addEventListener('click', () => { location.hash = area === 'learn' ? '#/learn' : '#/'; });
el.btnLearnAgain?.addEventListener('click', () => route());
el.btnLearnList?.addEventListener('click', () => { location.hash = '#/learn'; });
el.btnHome?.addEventListener('click', () => { location.hash = '#/'; });
// 「やり直す」は最初から。途中の続きを拾ってしまうと、やり直したことにならない
el.btnRetry?.addEventListener('click', () => { clearResume(); route(); });
el.btnAgain?.addEventListener('click', () => { clearResume(); route(); });
el.btnNext?.addEventListener('click', () => {
  const cur = location.hash.split('/').pop();
  const n = nextLesson(cur);
  location.hash = n ? `#/play/${n.id}` : '#/';
});

el.btnExport?.addEventListener('click', async () => {
  const text = exportAll();

  // ファイルに落とすのを主にする。クリップボードは環境や権限で落ちることがあり、
  // 落ちたときに記録を取り出す手段が無くなる。記録は消えたら戻らない
  let saved = false;
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `oyayubi-dojo-${dayKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    saved = true;
  } catch {
    /* 落とせない環境もある。下で拾う */
  }

  try {
    await navigator.clipboard.writeText(text);
    toast(saved ? 'ファイルに書き出し、クリップボードにもコピーしました' : 'クリップボードにコピーしました');
    return;
  } catch {
    if (saved) { toast('ファイルに書き出しました'); return; }
  }

  // どちらも駄目なとき。画面に出して手で持ち出せるようにする
  showExportFallback(text);
});

/** 書き出しも コピーも通らないとき、せめて選んで持ち出せるようにする */
function showExportFallback(text) {
  const card = el.btnExport?.closest('.card');
  if (!card) { toast('書き出せませんでした'); return; }
  let ta = card.querySelector('.data__dump');
  if (!ta) {
    ta = document.createElement('textarea');
    ta.className = 'data__dump';
    ta.readOnly = true;
    ta.rows = 6;
    card.append(ta);
  }
  ta.value = text;
  ta.select();
  toast('自動で保存できませんでした。下の内容を選んで控えてください');
}

el.btnImport?.addEventListener('click', () => {
  const text = prompt('書き出した記録を貼り付けてください');
  if (!text) return;
  const v = validateImport(text);
  if (!v.ok) { toast(v.reason ?? '読み込めません'); return; }
  importAll(text);
  toast('読み込みました');
  paintMypage();
});

el.btnClear?.addEventListener('click', () => {
  // 取り返しがつかないので二度聞く
  if (!confirm('この端末の記録を全部消します。元に戻せません。')) return;
  if (!confirm('本当に消しますか？')) return;
  clearAll();
  toast('消しました');
  paintMypage();
});

el.btnRomajiSave?.addEventListener('click', () => {
  const v = Number(el.romajiCpmInput?.value);
  if (!Number.isFinite(v) || v <= 0) { toast('ローマ字入力のときの cpm を入れてください'); return; }
  saveRomajiBaseline(v, { by: 'input' });
  toast('記録しました');
  paintMypage();
});
el.btnRomajiClear?.addEventListener('click', () => {
  clearRomajiBaseline();
  toast('消しました');
  paintMypage();
});

// ---- 稽古
const startDrill = m => {
  const stats = loadStats();
  // 前回狙った面を渡すと、同じ一本が続かなくなる
  const lesson = makeDrill(stats, { mode: m, recentFaces });
  recentFaces = lesson.faces ?? null;
  // 弱点を含む語が語彙で足りないぶんは擬似語で埋まる。断りが無いと
  // 「知らない語」と「意味の無い音の並び」の区別が付かず、読もうとして手が止まる
  const note = (lesson.note ?? '')
    + (DRILL_MODES[m]?.pseudo ? '　実在しない語（意味の無い音の並び）が混ざります。読まずに指だけで追ってください。' : '');
  playInput = 'nicola';
  playMade({ ...lesson, note }, 'drill');
};
el.btnDrillWeak?.addEventListener('click', () => startDrill('weak'));
el.btnDrillAll?.addEventListener('click', () => startDrill('review'));
el.btnDrillSpeed?.addEventListener('click', () => startDrill('speed'));

// 一覧の札から直接始める。選んでから「始める」を押させるのは一手多い
document.addEventListener('click', e => {
  const card = e.target?.closest?.('.material');
  if (!card) return;
  const lesson = findLesson(card.dataset.lesson);
  if (!lesson) return;
  mode = 'drill';
  playInput = settings.input;
  const to = `#/play/${lesson.id}`;
  if (location.hash === to) route(); else location.hash = to;
});

el.inputPick?.addEventListener('click', e => {
  const b = e.target?.closest?.('[data-input]');
  if (!b) return;
  settings.input = b.dataset.input;
  settings = saveSettings(settings) ?? settings;
  paintInputPick();
});

el.freeText?.addEventListener('input', updateFreeText);
el.btnFreeClear?.addEventListener('click', () => { el.freeText.value = ''; updateFreeText(); });
el.btnFreeStart?.addEventListener('click', () => {
  const text = [...(el.freeText?.value ?? '')].filter(c => !/\s/.test(c)).join('');
  if (!text) return;
  playInput = settings.input;
  playMade({ id: 'free', courseId: 'free', title: '自由入力', note: '自分で入れた文章', text }, 'free');
});

window.addEventListener('hashchange', route);

applyTone(settings.tone);
fillIcons();
paintNav();
route();
