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
import { renderKeyboard, highlight, setThumbLamp } from './keyboard.js';
import {
  loadStats, recordRun, loadSettings, saveSettings, STORAGE_KEYS,
  exportAll, importAll, validateImport, clearAll, overview, offsetReport,
} from './storage.js';
import { saveRomajiBaseline, clearRomajiBaseline } from './storage.js';
import {
  RANKS, rankOf, nextRankGap, TROPHIES, TIERS, progressOf, trophiesByCategory, dayKey,
  cpmOf, accuracyOf, unlockedOf, UNLOCKS, romajiComparison,
} from './trophies.js';
import { COURSES, LESSONS, findLesson, nextLesson, lessonsOf } from './lessons.js';
import { makeDrill, weakFaces, describeFace, DRILL_MODES, missRateOf } from './drill.js';
import { renderIso } from './iso.js';
import { svg } from './viz.js';
import { medal } from './medal.js';
import { renderTrend, renderOffsetHist, renderCalendar } from './charts.js';
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
  // 玄関の振り分け。門ではなく、二つの札の並び順を変えるだけの一問
  doorLearnState: $('doorLearnState'), doorTrainState: $('doorTrainState'),
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
  btnDrillWeak: $('btnDrillWeak'), drillWeakMeta: $('drillWeakMeta'),
  btnDrillAll: $('btnDrillAll'), drillAllMeta: $('drillAllMeta'),
  btnDrillSpeed: $('btnDrillSpeed'), drillSpeedMeta: $('drillSpeedMeta'),
  drillTextPick: $('drillTextPick'), drillTextCount: $('drillTextCount'), btnDrillText: $('btnDrillText'),
  freeText: $('freeText'), freeTextCount: $('freeTextCount'),
  freeTextWarn: $('freeTextWarn'), freeTextWarnList: $('freeTextWarnList'),
  btnFreeStart: $('btnFreeStart'), btnFreeClear: $('btnFreeClear'),
  // ローマ字比較
  romajiCard: $('romajiCard'), romajiRatio: $('romajiRatio'),
  romajiBaseBar: $('romajiBaseBar'), romajiBaseVal: $('romajiBaseVal'),
  romajiNowBar: $('romajiNowBar'), romajiNowVal: $('romajiNowVal'),
  romajiMessage: $('romajiMessage'), romajiForecast: $('romajiForecast'), romajiPassed: $('romajiPassed'),
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
  btnStart: $('btnStart'), startSub: $('startSub'), courseList: $('courseList'),
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
  finish: $('finish'), finishEyebrow: $('finishEyebrow'), finishTitle: $('finishTitle'),
  finishCpm: $('finishCpm'), finishBest: $('finishBest'), finishOffset: $('finishOffset'),
  finishOffsetWord: $('finishOffsetWord'), finishPerfect: $('finishPerfect'),
  finishGood: $('finishGood'), finishOff: $('finishOff'), finishMisfire: $('finishMisfire'),
  finishEarned: $('finishEarned'),
  btnNext: $('btnNext'), btnAgain: $('btnAgain'), btnHome: $('btnHome'),
  // mypage
  rankName: $('rankName'), rankScore: $('rankScore'), rankFill: $('rankFill'),
  rankNext: $('rankNext'), statTally: $('statTally'),
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
let mode = null;      // 'check' | 'drill' | 'free' | null（通常の課題）
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

function applyTone(tone) {
  document.documentElement.dataset.tone = tone;
  for (const b of document.querySelectorAll('[data-tone-set]')) {
    b.setAttribute('aria-pressed', String(b.dataset.toneSet === tone));
  }
}

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
// 打ち手が見るのは自分のキーボードなので、刻印そのものを見せる
const KEY_LEGEND = { Semicolon: ';', Comma: ',', Period: '.', Slash: '/' };

/** 自由入力の上限（字）。課題の上限80字より緩く、一息で打ち切れる長さ */
const FREE_TEXT_MAX = 400;
function keyLegend(code) {
  return KEY_LEGEND[code] ?? code.replace(/^Key/, '');
}

/** かな1文字を打つのに必要な打ち方を引く。無ければ null（課題データの不備） */
function howToType(kana) {
  for (const [code, k] of Object.entries(layout.keys)) {
    if (k.none === kana) return { code, thumb: null, shiftKind: null };
    if (k.left === kana) return { code, thumb: 'left', shiftKind: k.hand === 'left' ? 'same' : 'cross' };
    if (k.right === kana) return { code, thumb: 'right', shiftKind: k.hand === 'right' ? 'same' : 'cross' };
  }
  return null;
}

function startRun(lesson) {
  const chars = [...lesson.text];
  run = {
    lesson,
    chars,
    // 行の切り方は表示のためだけのもの。進捗（index）は本文全体の通し番号なので、
    // 切り方を変えても中断と再開は壊れない
    starts: lineStarts(chars),
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

  // 途中で閉じた続きがあれば拾う。時間も引き継がないと CPM が嘘になる
  const saved = loadResume(lesson);
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

  el.playLesson.textContent = lesson.title;
  // 課題の狙い。特に「ここは親指を休ませて場所だけ覚える回。メーターが黙るのはそのため」
  // のような断りが読めないと、メーターが動かないのが故障に見える
  if (el.playNote) {
    el.playNote.textContent = lesson.note ?? '';
    el.playNote.title = lesson.note ?? '';   // 一行に切り詰めるので、全文はここで読める
  }
  el.finish.hidden = true;
  el.finishEarned.hidden = true;   // 前回の札が残らないように
  resetMeter(el.meter);
  paintPhrase();
  paintCue();
  updateStats();

  engine = buildEngine(onOutput);
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
      + (i < run.index ? ' is-done' : i === run.index ? ' is-cur' : '');
    span.textContent = run.chars[i];
    cs.push(span);
  }
  el.phrase.replaceChildren(...cs);

  // 先の行。次に何が来るか見えると速度が出る
  const ahead = (target, k) => {
    if (!target) return;
    const s = starts[n + k];
    if (s == null) { target.textContent = ''; return; }
    target.textContent = run.chars.slice(s, starts[n + k + 1] ?? run.chars.length).join('');
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

  el.cueKana.textContent = kana;
  if (!how) {
    // 課題データにこの配列で打てない字が混ざっている。黙って詰まらせない
    el.cueHow.hidden = true;
    el.cueKind.textContent = 'この配列では打てません';
    return;
  }
  el.cueHow.hidden = false;
  el.cueKey.textContent = keyLegend(how.code);
  el.cueThumb.textContent = how.thumb === 'left' ? '左親指' : how.thumb === 'right' ? '右親指' : '単独';
  el.cueThumb.className = 'cue__thumb' + (how.thumb ? ` cue__thumb--${how.thumb}` : '');
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

// 打ち間違いを一瞬だけ光らせる。メーターは時間差の担当なので、
// ズレの無いミスまでそこに出すと針が嘘をつく
function flashMiss() {
  el.phrase.classList.add('is-miss');
  setTimeout(() => el.phrase.classList.remove('is-miss'), 160);
}

function updateStats() {
  if (!run) return;
  const sec = run.startedAt == null ? 0 : (performance.now() - run.startedAt) / 1000;
  el.statTime.textContent = sec.toFixed(1);
  // cpmOf / accuracyOf は丸めずに返す。表示のときに丸めるのはこちらの仕事
  el.statCpm.textContent = String(Math.round(cpmOf({ kana: run.kana, seconds: sec })));
  el.statAcc.textContent = String(Math.round(accuracyOf(run)));
}

function finishRun() {
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
  el.finishOffset.textContent = fmtOffset(meanOffset);
  el.finishOffsetWord.textContent = offsetWord(meanOffset);
  // 段位はいちばん見る画面に出す。「自己ベスト更新（段位）」という文字列でしか
  // 分からないのでは、いま何段で次に何が足りないのかが伝わらない
  const gap = nextRankGap(stats);
  el.finishEyebrow.textContent = gap
    ? `${stats.rank}　→　${gap.next.name} まで ${rankNeedText(gap)}`
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
  if (!run || run.index === 0 || mode === 'check') return;
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

  if (screen !== 'play' && screen !== 'setup') return;
  if (e.repeat) { e.preventDefault(); return; }   // オートリピートは打鍵ではない

  // IME が動いていると素のキーが取れない。黙って壊れるより言う
  if (e.isComposing || e.keyCode === 229 || e.key === 'Process') {
    e.preventDefault();
    el.warnIme?.classList.add('is-on');
    toast('日本語入力をオフ（英数）にしてください');
    return;
  }

  if (e.key === 'Escape') { e.preventDefault(); location.hash = '#/'; return; }

  if (!engine) return;
  e.preventDefault();
  if (thumbSideOf(thumbKeysOf(settings), e.code)) trialWantedThumb = true;
  engine.keyDown(e.code, e.timeStamp);
  setThumbLamp(screen === 'setup' ? el.setupBoard : el.board, engine.thumbHeld);
});

window.addEventListener('keyup', e => {
  if (catching || !engine) return;
  if (screen !== 'play' && screen !== 'setup') return;
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
function startTrial() {
  renderMeter(el.setupMeter);
  renderKeyboard(el.setupBoard, layout, { lookup, thumbs: thumbKeysOf(settings) });
  engine = buildEngine(result => {
    if (result.charCode == null) return;
    // 設定画面の目的は「設定が効いているか確かめる」こと。
    // 親指を狙ったのに単独打鍵になったなら、それは不発として見せないと確かめられない。
    // ここで契約外の tier を渡すと meter が落として「単独打鍵」と出てしまう
    if (result.thumb && result.offsetMs == null) {
      // 連続シフトで出た一打。ズレは測れていないので、針を動かさず «出た» とだけ返す。
      // ここを tierOf(null) に流すと misfire になり、成功したのに不発と出る
      showJudgement(el.setupMeter, { offsetMs: null, tier: 'continued' });
      sound.hit();
    } else if (result.thumb) {
      showJudgement(el.setupMeter, { offsetMs: result.offsetMs, tier: tierOf(result.offsetMs) });
      sound.shifted({ tier: tierOf(result.offsetMs), offsetMs: result.offsetMs });
    } else if (trialWantedThumb) {
      showJudgement(el.setupMeter, { offsetMs: null, tier: 'misfire' });
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

/** 門。三つの扉に «いまどこまで来たか» を一行ずつ添えるだけ */
function paintHome() {
  const stats = loadStats();
  paintNav(stats);
  const next = LESSONS.find(l => !(stats.cleared?.[l.id] > 0));
  if (el.doorLearnState) {
    el.doorLearnState.textContent = next
      ? (stats.runs > 0 ? `つづき：${next.title}` : `第一課から：${next.title}`)
      : '七つの課をすべて打ち終えています';
  }
  if (el.doorTrainState) {
    el.doorTrainState.textContent = stats.runs > 0
      ? `段位 ${stats.rank ?? RANKS[0].name} ・ いま弱いのは ${weakFaces(stats, { limit: 40 }).length} 面`
      : '弱点集中・総ざらい・速度・実文・自由入力';
  }
}

/** 課題の一覧。玄関から切り離して «おぼえる» の中へ移した */
function paintLearn() {
  const stats = loadStats();
  paintNav(stats);

  // 「つづきから」は、まだクリアしていない最初の課題（門から移した）
  const next = LESSONS.find(l => !(stats.cleared?.[l.id] > 0)) ?? LESSONS[0];
  if (next && el.startSub && el.btnStart) {
    el.startSub.textContent = next.title;
    el.btnStart.onclick = () => { location.hash = `#/play/${next.id}`; };
  }
  if (!el.courseList) return;

  // unlockedOf は { course, theme, sound, items } を返す。course だけ見る
  const open = unlockedOf(stats).course ?? [];
  const cards = COURSES.map(c => {
    const list = lessonsOf(c.id);
    const done = list.filter(l => (stats.cleared?.[l.id] ?? 0) > 0).length;
    const unlocked = open.includes(c.id) || c.id === 'basic';
    const first = list.find(l => !(stats.cleared?.[l.id] > 0)) ?? list[0];

    const a = document.createElement('a');
    a.className = 'course'
      + (unlocked ? '' : ' is-locked')
      + (list.length && done === list.length ? ' is-done' : '');
    a.href = unlocked && first ? `#/play/${first.id}` : '#/';

    const h = document.createElement('b');
    h.className = 'course__name';
    h.textContent = c.name;

    const p = document.createElement('span');
    p.className = 'course__note';
    p.textContent = c.note ?? '';

    // 進捗は閉じている札にも出す。0/5 が見えること自体に意味がある
    const bar = document.createElement('span');
    bar.className = 'course__bar';
    bar.style.setProperty('--p', String(list.length ? done / list.length : 0));

    const count = document.createElement('span');
    count.className = 'course__count';
    count.textContent = `${list.length}課題中 ${done}`;

    a.append(h, p, bar, count);

    // 閉じている理由と、開ける条件。見えないと何をすればいいか分からない
    if (!unlocked) {
      const lock = document.createElement('span');
      lock.className = 'course__lock';
      const u = UNLOCKS.find(x => x.kind === 'course' && x.target === c.id);
      lock.textContent = u?.hint ?? 'まだ開いていません';
      a.append(lock);
    }
    return a;
  });
  el.courseList.replaceChildren(...cards);
}

/**
 * そのコースが開いているか。判定の出どころをここ一本にする。
 * ホームの札の見た目とルーターで別々に判断すると、片方だけ守られる（実際そうなっていた）。
 */
function isCourseOpen(courseId) {
  // texts は «鍛える» の題材置き場。教程ではないので解禁の対象外。
  // 以前は題材を教程のコースから引いていたため、新規の人には一覧に18本出るのに
  // 押すと全部ホームに弾かれていた。出ているのに押せないのは、いちばん質の悪い壊れ方
  if (!courseId || courseId === 'basic' || courseId === 'free' || courseId === 'texts') return true;
  return (unlockedOf(loadStats()).course ?? []).includes(courseId);
}


function paintMypage() {
  const stats = loadStats();
  const o = overview(stats);
  const rep = offsetReport(stats);
  paintNav(stats);

  // いまの弱点（以前は «鍛える» の頭にあった）
  setSkew(el.drillSkewLeftMark, el.drillSkewLeftVal, rep?.left);
  setSkew(el.drillSkewRightMark, el.drillSkewRightVal, rep?.right);
  const weak = weakFaces(stats, { limit: 6 });
  if (el.drillWeakCount) el.drillWeakCount.textContent = `${weak.length}面`;
  paintWeakList(el.drillWeak, el.drillWeakEmpty, stats);

  el.rankName.textContent = stats.rank ?? RANKS[0].name;
  el.rankScore.textContent = `SCORE ${stats.score ?? 0}`;
  // nextRankGap は { next, cpmGap, accGap }。文言はこちらで組む。
  // 点数ではなく「あと何が足りないか」を出す（点数を見せても何をすればいいか分からない）
  const gap = nextRankGap(stats);
  if (!gap) {
    el.rankNext.textContent = '最高段位です';
    if (el.rankFill) el.rankFill.style.width = '100%';
  } else {
    el.rankNext.textContent = `${gap.next.name} まで ${rankNeedText(gap)}`;
    const cur = rankOf(stats.score ?? 0);
    const span = Math.max(1, (gap.next.at ?? 0) - (cur.at ?? 0));
    if (el.rankFill) {
      el.rankFill.style.width = `${Math.min(100, Math.max(0, (((stats.score ?? 0) - (cur.at ?? 0)) / span) * 100))}%`;
    }
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
    p.textContent = trophyFilter === 'got' ? 'まだ一つも取っていません。課題を一つ打ち切ると «初稽古» が開きます。' : 'すべて取りました。';
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

function paintRecords(stats) {
  // 課題ごとに一行へまとめる。以前は直近 30 本をそのまま並べていて、
  // 同じ課題が何十行も続き、見出しの «課題ごとの» と中身が食い違っていた。
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
  // 帯と数はミスの «率»。以前は回数で、たくさん打った面ほど大きく出ていた（単位も出ていなかった）。
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
    el.checkRomajiStatus.textContent = has
      ? '記録済みです。上の札でいまの速さと比べられます。'
      : 'ローマ字入力のときの速度を入れておくと、追い抜くまでの見通しが出ます。';
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

  // 出せないときは行ごと出さない。嘘の期日を出すくらいなら黙る
  if (el.romajiForecast) {
    el.romajiForecast.hidden = cmp.daysToPass == null;
    if (cmp.daysToPass != null) el.romajiForecast.textContent = `この伸びなら、あと ${cmp.daysToPass} 日で追い抜きます`;
  }
  if (el.romajiPassed) {
    el.romajiPassed.hidden = !cmp.passedAt;
    if (cmp.passedAt) el.romajiPassed.textContent = `${cmp.passedAt} に追い抜きました`;
  }
}

// -- 鍛える -------------------------------------------------------------------

function paintDrill() {
  const stats = loadStats();
  paintNav(stats);

  // 門は撤去した。以前は測定（腕試し）を通さないと三つとも押せなかったが、
  // 測らないと出せないのは「弱点集中」の狙いだけで、そのために全部を閉じるのは重すぎた。
  // 弱点が出せない間は、下の一覧が自分でそう言う。
  // 弱点の一覧は記録の画面へ移した（paintMypage）。ここは出題の札だけ

  for (const [btn, meta, m] of [
    [el.btnDrillWeak, el.drillWeakMeta, DRILL_MODES.weak],
    [el.btnDrillAll, el.drillAllMeta, DRILL_MODES.review],
    [el.btnDrillSpeed, el.drillSpeedMeta, DRILL_MODES.speed],
  ]) {
    if (meta) meta.textContent = m?.note ?? '';
    if (btn) btn.disabled = false;
    btn?.closest('.mode')?.classList.remove('is-locked');
  }

  // 実文の題材。何があるか見えないと選べないので、一覧で出す。
  // select だけだと開くまで中身が分からず、字数も特徴も比べられない
  const texts = materials();
  paintMaterials(stats);
  if (el.drillTextPick) {
    el.drillTextPick.replaceChildren(...texts.map(l => {
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = `${l.title}（${[...l.text].length}字）`;
      return o;
    }));
  }
  if (el.drillTextCount) el.drillTextCount.textContent = `${texts.length}本`;
  updateFreeText();
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
  if (n >= 100) tags.push('長め');
  if (shifted / n >= 0.55) tags.push('同時打鍵が主');

  return { kana: chars.length, solo, same, cross, shifted, tags };
}

/**
 * «鍛える» で選べる実文の題材。
 *
 * 教程（覚える）のコースからは引かない。あちらは段階的に解禁されるので、
 * 一覧に出しても新規の人は押した瞬間に弾かれる。題材は最初から全部打てるべきもの。
 * 専用の置き場（texts）が無ければ、打てるコースの中から拾って凌ぐ。
 */
function materials() {
  const texts = lessonsOf('texts');
  if (texts.length) return texts;
  return LESSONS.filter(l => isCourseOpen(l.courseId));
}

// 長さの束。83本を平らに並べると «長い文章を打ちたい» 人が探せない
const SIZE_ORDER = ['とてもながい', 'ながめ', 'ふつう', 'みじかめ'];
const SIZE_NOTE = {
  とてもながい: '1000字以上。腰を据えて一本',
  ながめ: '400〜1000字',
  ふつう: '100〜400字',
  みじかめ: '100字まで。軽く一本',
};

function sizeOf(lesson) {
  if (lesson.size) return lesson.size;
  const n = [...(lesson.text ?? '')].length;
  return n >= 1000 ? 'とてもながい' : n >= 400 ? 'ながめ' : n >= 100 ? 'ふつう' : 'みじかめ';
}

function paintMaterials(stats) {
  const box = $('drillTextList');
  if (!box) return;

  // 長い順に束ねる。要望は「もっとたくさんの文章を打ちたい」なので、長い方を上に置く
  const groups = new Map(SIZE_ORDER.map(s => [s, []]));
  for (const l of materials()) groups.get(sizeOf(l))?.push(l);

  const nodes = [];
  for (const size of SIZE_ORDER) {
    const list = groups.get(size) ?? [];
    if (!list.length) continue;
    const h = document.createElement('h3');
    h.className = 'materials__group';
    h.textContent = `${size}　${list.length}本`;
    const small = document.createElement('small');
    small.textContent = SIZE_NOTE[size] ?? '';
    h.append(small);
    nodes.push(h, ...materialCards(list, stats));
  }
  box.replaceChildren(...nodes);
}

function materialCards(list, stats) {
  return list.map(l => {
    const info = materialInfo(l);
    const done = (stats.cleared?.[l.id] ?? 0) > 0;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'material' + (done ? ' is-done' : '');
    b.dataset.lesson = l.id;

    const name = document.createElement('b');
    name.className = 'material__name';
    name.textContent = l.title;

    const meta = document.createElement('span');
    meta.className = 'material__meta';
    meta.textContent = `${info.kana}字 · 同時打鍵 ${Math.round((info.shifted / (info.kana || 1)) * 100)}%`
      + (done ? ` · ${stats.cleared[l.id]}回` : '');

    const note = document.createElement('span');
    note.className = 'material__note';
    note.textContent = l.note ?? '';

    b.append(name, meta, note);

    if (info.tags.length) {
      const tags = document.createElement('span');
      tags.className = 'material__tags';
      for (const t of info.tags) {
        const i = document.createElement('i');
        i.textContent = t;
        tags.append(i);
      }
      b.append(tags);
    }
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
 * 場所（入門・道場・門）。看板・帯の色・ナビの中身は CSS が body[data-area] で切り替える。
 * 配列表と設定は場所を持たない道具なので、開いても直前の場所のまま（入門から開いた配列表は入門の顔）。
 * 課題の画面は、七つの課の題なら入門、その場で組んだ出題（鍛える・自由入力）なら道場
 */
const AREA_OF = { home: 'gate', learn: 'learn', train: 'train', record: 'train' };
const AREA_TITLE = { gate: '親指シフト', learn: '親指シフト入門', train: '親指シフト道場' };
let area = 'gate';

function setArea(name, arg) {
  if (AREA_OF[name]) area = AREA_OF[name];
  else if (name === 'play') area = (pending ?? findLesson(arg))?.courseId ? 'learn' : 'train';
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
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.setAttribute('aria-current', a.dataset.nav === `/${head}` ? 'page' : 'false');
  }

  if (name === 'home') paintHome();
  else if (name === 'learn') paintLearn();
  else if (name === 'train') paintDrill();
  else if (name === 'record') paintMypage();
  else if (name === 'setup') { paintSetup(); startTrial(); }
  else if (name === 'layout') {
    renderKeyboard(el.layoutBoard, layout, { lookup, thumbs: thumbKeysOf(settings) });
  } else if (name === 'play') {
    const lesson = pending ?? findLesson(arg);
    pending = null;
    if (!lesson) { location.replace('#/'); return; }

    // 解禁はホームの札の href だけで守られていた。つまり URL を打てば素通りできた。
    // 教程の順番は「腕に覚えのある人ほど飛ばしたくなる」ものなので、
    // 画面の見た目ではなくここで守る。その場で作った課題（適応出題・自由入力）は対象外
    if (!lesson.courseId || !isCourseOpen(lesson.courseId)) {
      if (lesson.courseId) {
        toast('この課は、前の課を終えると開きます');
        location.replace('#/');
        return;
      }
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
    saveSettings(settings);
    applyTone(settings.tone);
  });
}

el.btnBack?.addEventListener('click', () => { location.hash = '#/'; });
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
  location.hash = `#/play/${lesson.id}`;
});

el.btnDrillText?.addEventListener('click', () => {
  const id = el.drillTextPick?.value;
  const lesson = findLesson(id);
  if (!lesson) { toast('選んでください'); return; }
  mode = 'drill';
  location.hash = `#/play/${lesson.id}`;
});

el.freeText?.addEventListener('input', updateFreeText);
el.btnFreeClear?.addEventListener('click', () => { el.freeText.value = ''; updateFreeText(); });
el.btnFreeStart?.addEventListener('click', () => {
  const text = [...(el.freeText?.value ?? '')].filter(c => !/\s/.test(c)).join('');
  if (!text) return;
  playMade({ id: 'free', courseId: 'free', title: '自由入力', note: '自分で入れた文章', text }, 'free');
});

window.addEventListener('hashchange', route);

applyTone(settings.tone ?? 'midnight');
paintNav();
route();
