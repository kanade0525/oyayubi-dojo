// 稽古の記録と設定。手元のブラウザにだけ残る。
//
// このファイルは保存の唯一の窓口で、DOM を知らない。Node から import してテストできる。
//
// なぜこうしているか。
//
// ・既存の親指シフト練習サイトはスコアを一切保存しない。localStorage に入るのは設定だけで、
//   ページを閉じたら記録が消える。親指シフトは覚えるまでの数週間〜数か月が最大の離脱要因なので、
//   「積み上がったものが見えること」はこのアプリの飾りではなく中核価値になる。
//
// ・それでも保存は失敗しうる（プライベートブラウズ、容量超過、localStorage 自体が無い環境）。
//   だから全アクセスを try/catch で包み、記録できなくても遊べる形にしてある。
//   保存に失敗したときにアプリが止まるのは、記録が消えるより悪い。
//
// ・記録の入り口を recordRun() 一つに絞る。入り口が複数あると、
//   「実績は増えたのにストリークが伸びていない」の類のズレが必ず出る。
//   recordRun() は蓄積・自己ベスト更新・段位・実績解除まで全部やって
//   { stats, gained, earned } を返す。呼ぶ側はこれ一つを叩けばよい。
//
// ・キーに :v1 を振る。スキーマを変えるときは新しいキーにして、古いキーは読み捨てる。
//   同じキーに違う形を書くと、古いブラウザに残った記録が壊れる。
//
// ・ズレ幅(ms)の生データは保存しない。1万打で1万個の数値になって容量を食い潰す。
//   平均・絶対値平均・標準偏差を復元できる集計値と、5ms 刻みのヒストグラムに畳む（trophies.js 参照）。

import {
  dayKey,
  streakOf,
  longestStreakOf,
  newlyEarned,
  scoreOf,
  rankOf,
  rankIndexOfRun,
  unlockedOf,
  faceCoverage,
  faceTotals,
  summarizeOffsets,
  offsetSummary,
  offsetBinOf,
  accuracyOf,
  cpmOf,
  kcpmOf,
  perfectRateOf,
  missTotalOf,
  romajiComparison,
  RANKS,
  RANK_MIN_KANA,
  OFFSET_BINS,
} from './trophies.js';

const APP = 'oyayubi-dojo';
const STATS_KEY = 'oyayubi-dojo:stats:v1';
const SETTINGS_KEY = 'oyayubi-dojo:settings:v1';

/** 記録の置き場所。マイページに出して隠さない */
export const STORAGE_KEYS = [STATS_KEY, SETTINGS_KEY];

/** 打った日を残す上限。カレンダーは1年ちょっと見えれば足りる */
const DAYS_LIMIT = 400;
/** 履歴の上限。伸びの推定と直近の振り返りに使うだけなので200本で足りる */
const HISTORY_LIMIT = 200;

// localStorage が無い環境（Node、埋め込みWebView）でも import できるようにする。
// トップレベルで localStorage を触らないこと。
function ls() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readJson(key) {
  try {
    const raw = ls() && ls().getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    const s = ls();
    if (!s) return false;
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    /* 残せなくても遊べる */
    return false;
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
/** 小さいほど良い値の自己ベスト。null は「まだ記録が無い」であって 0 ではない */
const minBest = (prev, next) => (next == null ? prev : prev == null ? next : Math.min(prev, next));

// ---------------------------------------------------------------- stats のかたち
//
// 一項目ずつ、なぜ持つのかを書く。持つ理由を言えない数字は増やさない。

function emptyStats() {
  return {
    app: APP,
    version: 1,

    // 通算。マイページの「積み上げ」表示と、一万打・十時間などの実績に使う
    runs: 0,
    kana: 0, // 確定した文字数（同時打鍵は 1）
    keystrokes: 0, // 物理キー数。kana と並べると 1文字あたりの打鍵数が見える
    seconds: 0,

    since: null, // はじめて打った日。「移行して何日目」を出すため
    lastDay: null, // 最後に打った日。復帰判定に使う

    // 自己ベスト。実績の check は stats しか見られないので、
    // 「一本の中で達成した」種類の条件はここに一本ぶんの最良値として畳んでおく
    best: {
      cpm: 0,
      kcpm: 0,
      accuracy: 0,
      perfectRate: 0, // ぴったり率の最高（同時打鍵20回以上の一本）
      meanAbsOffset: null, // ズレ絶対値平均の最小（20回以上）。小さいほど良いので null 始まり
      sdOffset: null, // ズレのばらつきの最小（30回以上）
      bothHandsMeanAbs: null, // 左右とも揃っていた一本の、悪い方の平均ズレ（各10回以上）
      handGap: null, // 左右の平均ズレの差の最小（各10回以上）
      allPerfectShifts: 0, // 全部ぴったりで打ち切った一本の同時打鍵数
      perfectStreak: 0, // ぴったり判定の連続回数の最高
      noMisfireKeys: 0, // シフト不発ゼロで打ち切った一本の最大打鍵数
      noWrongFaceKeys: 0, // 誤シフト面ゼロで打ち切った一本の最大打鍵数
      perfectRunKana: 0, // 正確率100%で打ち切った一本の最大文字数
      fastCleanCpm: 0, // 正確率98%以上を保ったまま出した最高 CPM（同じ一本で両立）
    },

    // 段位。腕前（一本で CPM と正確率の両方）と稽古量（積み上げスコア）の両方が要る
    rankIndex: 0,
    rank: RANKS[0].name,
    bestRunRank: 0, // 一本で到達したことのある最高段位。腕前の記録なので下がらない
    score: 0, // 積み上げスコア。稽古量。段位から逆算せず、打つたびに足す

    tokens: 0, // 積み上げスコア。爪痕として増えるだけの数字

    days: [], // 打った日（直近 DAYS_LIMIT）。ストリークの計算に使う
    daily: {}, // 日 → { runs, kana, seconds }。カレンダーの濃淡用
    streak: 0,
    bestStreak: 0,
    gapReturns: 0, // 7日以上あけて戻ってきた回数。「出戻り」実績用

    perfectRuns: 0, // 正確率100%で打ち切った回数
    noMisfireRuns: 0, // シフト不発ゼロで打ち切った回数
    driftRuns: 0, // ズレ平均が±20msを超えた回数。「癖を直した」の前提

    // ミスの3分類。親指シフト固有。直し方が三つとも違うので混ぜない
    //   mistouch     … 隣を打った。位置を覚え直す
    //   shiftMisfire … 同時打鍵が単打になった。親指を強く・長く
    //   wrongFace    … 面を間違えた。同側と交差の取り違え
    misses: { mistouch: 0, shiftMisfire: 0, wrongFace: 0 },

    // タイミング判定の内訳。ぴったり率の分母分子
    timing: { perfect: 0, good: 0, off: 0 },

    // キー×シフト面ごとの打鍵数。'KeyH:none' | 'KeyH:left' | 'KeyH:right'
    // ヒートマップと踏破系実績の元データ
    faceHits: {},
    // キー×シフト面ごとのミス数。プレイ画面が run.faceMisses を送ってくれば貯まる（任意）
    faceMisses: {},
    coverage: { solo: 0, same: 0, cross: 0 }, // 面ごとに何種類のキーを打ったか（faceHits の要約）
    shiftHits: { solo: 0, same: 0, cross: 0 }, // 面ごとの打鍵数の合計

    // ズレ幅。生データは持たず、復元可能な集計とヒストグラムに畳む
    offset: {
      left: { n: 0, sum: 0, sumAbs: 0, sumSq: 0, hist: new Array(OFFSET_BINS).fill(0) },
      right: { n: 0, sum: 0, sumAbs: 0, sumSq: 0, hist: new Array(OFFSET_BINS).fill(0) },
    },

    cleared: {}, // lessonId → 打ち切った回数
    earned: {}, // 実績 id → 取った日
    history: [], // 直近 HISTORY_LIMIT 本。新しいものが先頭

    // 移行前のローマ字入力の速さ。移行者向けの独自機能の土台
    romaji: null, // { cpm, at, sampleKana, passedAt, by: 'input' | 'measured' }

    // 同じ文を両方の打ち方で比べるための、文ごとの最高 CPM。
    // lessonBest は親指シフト、romajiBest はローマ字。lessonId → { cpm, runs }
    // ローマ字の一本は段位・実績・弱点・連続日数には入れない（親指シフトの記録ではないので）
    lessonBest: {},
    romajiBest: {},

    // いま開いているコース・配色・打鍵音。保存はするが、正は毎回の再計算（loadStats を見よ）
    unlocked: null,
  };
}

function normalizeOffsetSide(v) {
  const o = obj(v);
  const hist = arr(o.hist);
  const out = {
    n: num(o.n),
    sum: num(o.sum),
    sumAbs: num(o.sumAbs),
    sumSq: num(o.sumSq),
    hist: new Array(OFFSET_BINS).fill(0),
  };
  for (let i = 0; i < OFFSET_BINS; i++) out.hist[i] = num(hist[i]);
  return out;
}

/**
 * 保存された記録を読む。壊れた値・古い形が入っていても落ちないように、
 * 必ず既定値と混ぜて型を揃えてから返す。
 * 保存が失敗したブラウザでは空の stats が返るだけで、遊ぶのに支障は無い。
 */
export function loadStats() {
  const saved = obj(readJson(STATS_KEY));
  const e = emptyStats();
  const s = { ...e, ...saved };

  s.app = APP;
  s.version = e.version;
  s.runs = num(s.runs);
  s.kana = num(s.kana);
  s.keystrokes = num(s.keystrokes);
  s.seconds = num(s.seconds);
  s.tokens = num(s.tokens);
  s.gapReturns = num(s.gapReturns);
  s.perfectRuns = num(s.perfectRuns);
  s.noMisfireRuns = num(s.noMisfireRuns);
  s.driftRuns = num(s.driftRuns);

  s.best = { ...e.best, ...obj(saved.best) };
  for (const k of Object.keys(e.best)) {
    if (e.best[k] === null) s.best[k] = typeof s.best[k] === 'number' && Number.isFinite(s.best[k]) ? s.best[k] : null;
    else s.best[k] = num(s.best[k]);
  }

  s.misses = { ...e.misses, ...obj(saved.misses) };
  for (const k of Object.keys(e.misses)) s.misses[k] = num(s.misses[k]);
  s.timing = { ...e.timing, ...obj(saved.timing) };
  for (const k of Object.keys(e.timing)) s.timing[k] = num(s.timing[k]);
  s.shiftHits = { ...e.shiftHits, ...obj(saved.shiftHits) };
  for (const k of Object.keys(e.shiftHits)) s.shiftHits[k] = num(s.shiftHits[k]);

  s.faceHits = { ...obj(saved.faceHits) };
  s.faceMisses = { ...obj(saved.faceMisses) };
  s.cleared = { ...obj(saved.cleared) };
  s.earned = { ...obj(saved.earned) };
  s.daily = { ...obj(saved.daily) };
  s.days = arr(saved.days).filter((d) => typeof d === 'string');
  s.history = arr(saved.history);

  s.offset = {
    left: normalizeOffsetSide(obj(saved.offset).left),
    right: normalizeOffsetSide(obj(saved.offset).right),
  };

  // 面の要約は保存値を信じず、faceHits から作り直す。
  // 要約と元データが食い違うと、ヒートマップと実績で違うことを言い出す。
  s.coverage = faceCoverage(s.faceHits);

  // ストリークは「今日から見た値」なので、保存値ではなく毎回その場で計算する。
  // 保存したままだと、三日休んだ人に「3日連続中」と表示してしまう。
  s.streak = streakOf(s.days);
  s.bestStreak = Math.max(num(saved.bestStreak), s.streak, longestStreakOf(s.days));

  // score は積み上げ。段位から逆算して上書きしない（そうすると稽古量が消える）
  s.score = Math.max(0, num(saved.score));
  s.bestRunRank = Math.min(RANKS.length - 1, Math.max(0, num(saved.bestRunRank)));
  s.rankIndex = Math.min(RANKS.length - 1, Math.max(0, num(s.rankIndex), 0));
  s.rank = RANKS[s.rankIndex].name;

  s.romaji = saved.romaji && num(saved.romaji.cpm) > 0 ? { ...saved.romaji, cpm: num(saved.romaji.cpm) } : null;

  const bestMap = (v) => Object.fromEntries(Object.entries(obj(v))
    .filter(([, b]) => num(obj(b).cpm) > 0)
    .map(([id, b]) => [id, { cpm: num(b.cpm), runs: num(b.runs) }]));
  s.romajiBest = bestMap(saved.romajiBest);
  s.lessonBest = bestMap(saved.lessonBest);
  // lessonBest が無かった頃の記録は、履歴から拾える分だけ拾う
  if (!saved.lessonBest) {
    for (const h of s.history) {
      if (!h.id || !(num(h.cpm) > 0)) continue;
      const b = s.lessonBest[h.id] ?? { cpm: 0, runs: 0 };
      s.lessonBest[h.id] = { cpm: Math.max(b.cpm, num(h.cpm)), runs: b.runs + 1 };
    }
  }

  // 開いているものも保存値ではなく毎回計算する。保存した「開いた印」を正にすると、
  // 条件を後から変えたときに食い違うし、印だけ書き換える抜け道もできる。
  s.unlocked = unlockedOf(s);

  return s;
}

function writeStats(s) {
  return writeJson(STATS_KEY, s);
}

// ---------------------------------------------------------------- 一本ぶんを記録する

/** 一本ぶんの派生値。結果画面と保存で同じ数字を使うため、UI からも呼べるようにしておく */
export function summarizeRun(run) {
  const r = obj(run);
  const timing = { perfect: num(obj(r.timing).perfect), good: num(obj(r.timing).good), off: num(obj(r.timing).off) };
  const shifts = timing.perfect + timing.good + timing.off;
  const left = summarizeOffsets(obj(r.offsets).left);
  const right = summarizeOffsets(obj(r.offsets).right);
  const both = { n: left.n + right.n, sum: left.sum + right.sum, sumAbs: left.sumAbs + right.sumAbs, sumSq: left.sumSq + right.sumSq };
  return {
    lessonId: typeof r.lessonId === 'string' ? r.lessonId : 'unknown',
    kana: num(r.kana),
    keystrokes: num(r.keystrokes),
    seconds: num(r.seconds),
    misses: {
      mistouch: num(obj(r.misses).mistouch),
      shiftMisfire: num(obj(r.misses).shiftMisfire),
      wrongFace: num(obj(r.misses).wrongFace),
    },
    missTotal: missTotalOf(r),
    timing,
    shifts,
    cpm: cpmOf(r),
    kcpm: kcpmOf(r),
    accuracy: accuracyOf(r),
    perfectRate: perfectRateOf(timing),
    offsets: { left, right, both },
    stat: { left: offsetSummary(left), right: offsetSummary(right), both: offsetSummary(both) },
  };
}

/**
 * 一本ぶんを記録する。ここが記録の唯一の窓口。
 *
 * @param {object} run CONTRACT.md の run の形。
 *   任意で run.perfectStreak（その一本の最大ぴったり連続数）と
 *   run.faceMisses（'KeyH:left' → ミス数）も受け取る。無くても壊れない。
 * @returns {{stats:object, gained:number, earned:object[], summary:object, records:string[]}}
 *   records は「今回更新した自己ベストの名前」。節目だけ派手にする演出のため、
 *   何が更新されたかを呼ぶ側に返す。
 */
export function recordRun(run) {
  const s = loadStats();
  const r = summarizeRun(run);
  const today = dayKey();
  const records = [];

  // ---- 通算
  s.runs++;
  s.kana += r.kana;
  s.keystrokes += r.keystrokes;
  s.seconds += r.seconds;
  s.misses.mistouch += r.misses.mistouch;
  s.misses.shiftMisfire += r.misses.shiftMisfire;
  s.misses.wrongFace += r.misses.wrongFace;
  s.timing.perfect += r.timing.perfect;
  s.timing.good += r.timing.good;
  s.timing.off += r.timing.off;
  s.cleared[r.lessonId] = (num(s.cleared[r.lessonId]) || 0) + 1;
  if (r.kana > 0 && r.missTotal === 0) s.perfectRuns++;
  if (r.keystrokes > 0 && r.misses.shiftMisfire === 0) s.noMisfireRuns++;

  // ---- キー×シフト面
  for (const [k, n] of Object.entries(obj(obj(run).faceHits))) {
    if (!(num(n) > 0)) continue;
    s.faceHits[k] = num(s.faceHits[k]) + num(n);
  }
  for (const [k, n] of Object.entries(obj(obj(run).faceMisses))) {
    if (!(num(n) > 0)) continue;
    s.faceMisses[k] = num(s.faceMisses[k]) + num(n);
  }
  s.coverage = faceCoverage(s.faceHits);
  const ft = faceTotals(obj(obj(run).faceHits));
  s.shiftHits.solo += ft.solo;
  s.shiftHits.same += ft.same;
  s.shiftHits.cross += ft.cross;

  // ---- ズレ幅。集計値を足し込み、ヒストグラムに落とす
  for (const side of ['left', 'right']) {
    const a = s.offset[side];
    const b = r.offsets[side];
    a.n += b.n;
    a.sum += b.sum;
    a.sumAbs += b.sumAbs;
    a.sumSq += b.sumSq;
    for (const v of arr(obj(obj(run).offsets)[side])) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      a.hist[offsetBinOf(v)]++;
    }
  }

  // ---- 自己ベスト
  const mark = (label, cond) => {
    if (cond) records.push(label);
    return cond;
  };
  // 短い一本で速さの自己ベストを塗り替えさせない。
  // 10文字だけ勢いで打てば誰でも高い CPM が出るが、それは実力ではないし、
  // 段位も実績もここを見ているので、まぐれの一本が土台を歪める。
  // 昇段の下限（RANK_MIN_KANA = 30字）と同じ線を引く。
  const longEnough = r.kana >= RANK_MIN_KANA;
  if (longEnough && mark('CPM', r.cpm > s.best.cpm)) s.best.cpm = r.cpm;
  if (longEnough && r.kcpm > s.best.kcpm) s.best.kcpm = r.kcpm;
  if (longEnough && mark('正確率', r.accuracy > s.best.accuracy)) s.best.accuracy = r.accuracy;

  // 同時打鍵が少ない一本でタイミングの自己ベストを塗り替えさせない。
  // 3回中3回ぴったりは「揃っている」の証拠にならない。
  if (r.shifts >= 20 && mark('ぴったり率', r.perfectRate > s.best.perfectRate)) s.best.perfectRate = r.perfectRate;
  if (r.shifts >= 20 && r.timing.good === 0 && r.timing.off === 0) {
    s.best.allPerfectShifts = Math.max(s.best.allPerfectShifts, r.timing.perfect);
  }
  if (r.stat.both.n >= 20) {
    const before = s.best.meanAbsOffset;
    s.best.meanAbsOffset = minBest(before, Math.abs(r.stat.both.mean));
    if (before == null || s.best.meanAbsOffset < before) records.push('ズレ平均');
    // 「癖を直した」の前提。ズレ平均が大きく偏っていた一本を数えておく
    if (Math.abs(r.stat.both.mean) > 20) s.driftRuns++;
  }
  if (r.stat.both.n >= 30) s.best.sdOffset = minBest(s.best.sdOffset, r.stat.both.sd);
  if (r.stat.left.n >= 10 && r.stat.right.n >= 10) {
    s.best.bothHandsMeanAbs = minBest(
      s.best.bothHandsMeanAbs,
      Math.max(Math.abs(r.stat.left.mean), Math.abs(r.stat.right.mean))
    );
    s.best.handGap = minBest(s.best.handGap, Math.abs(r.stat.left.mean - r.stat.right.mean));
  }
  if (r.misses.shiftMisfire === 0) s.best.noMisfireKeys = Math.max(s.best.noMisfireKeys, r.keystrokes);
  if (r.misses.wrongFace === 0) s.best.noWrongFaceKeys = Math.max(s.best.noWrongFaceKeys, r.keystrokes);
  if (r.kana > 0 && r.missTotal === 0) s.best.perfectRunKana = Math.max(s.best.perfectRunKana, r.kana);
  if (r.accuracy >= 98) s.best.fastCleanCpm = Math.max(s.best.fastCleanCpm, r.cpm);

  // ぴったりの連続回数。プレイ画面が数えて渡してくれればそれを使う。
  // 渡ってこない場合は、全部ぴったりだった一本だけ連続数として拾う（過大に見せない）。
  const streakInRun = num(obj(run).perfectStreak) || (r.timing.good === 0 && r.timing.off === 0 ? r.timing.perfect : 0);
  s.best.perfectStreak = Math.max(s.best.perfectStreak, streakInRun);

  // ---- 積み上げスコア。段位より先に足す（段位が積み上げを見るため）
  const gained = scoreOf(obj(run));
  s.tokens += gained;
  s.score += gained;

  // ---- 段位。腕前と稽古量の両方が要る。
  //
  // 以前は「一本の CPM と正確率」だけで決めていた。それだと、たまたま出た一本で
  // 最高段位に着いてしまい、二度と下がらないので段位が実力を指さなくなる。
  // 実際、35文字を機械速度で一度打っただけで名人になった。
  //
  // RANKS には at（積み上げの閾値）と cpm/accuracy（腕前の閾値）の両方がある。
  // 元々そう作られていたのに、積み上げ側が使われていなかった。両方を見る。
  //   ・腕前 … その段位の CPM と正確率を「同じ一本で」出したことがある
  //   ・稽古量 … 積み上げスコアがその段位の at に届いている
  // 腕前は一度出せば消えない（bestRunRank）が、稽古量が足りなければ上がらない。
  const runIdx = rankIndexOfRun(obj(run));
  s.bestRunRank = Math.max(num(s.bestRunRank), runIdx);

  let byScore = 0;
  while (byScore + 1 < RANKS.length && s.score >= RANKS[byScore + 1].at) byScore++;

  const nextIdx = Math.min(s.bestRunRank, byScore);
  if (nextIdx > s.rankIndex) {
    s.rankIndex = nextIdx;
    records.push('段位');
  }
  s.rank = RANKS[s.rankIndex].name;

  // ---- 打った日
  if (!s.since) s.since = today;
  if (s.lastDay && s.lastDay !== today) {
    const gap = (new Date(`${today}T00:00:00`) - new Date(`${s.lastDay}T00:00:00`)) / 86400000;
    if (gap >= 7) s.gapReturns++; // 一度離れて戻ってきた。移行期には必ず起きるので拾う
  }
  s.lastDay = today;
  if (!s.days.includes(today)) s.days.push(today);
  s.days = s.days.slice(-DAYS_LIMIT);
  const d = obj(s.daily[today]);
  s.daily[today] = { runs: num(d.runs) + 1, kana: num(d.kana) + r.kana, seconds: num(d.seconds) + r.seconds };
  // カレンダーの外にはみ出た日は落とす。放っておくと単調に増え続ける
  const keep = new Set(s.days);
  for (const k of Object.keys(s.daily)) if (!keep.has(k)) delete s.daily[k];
  s.streak = streakOf(s.days);
  s.bestStreak = Math.max(s.bestStreak, s.streak);

  // ---- 文ごとの最高。ローマ字との比べっこに使う
  const lb = s.lessonBest[r.lessonId] ?? { cpm: 0, runs: 0 };
  s.lessonBest[r.lessonId] = { cpm: Math.max(lb.cpm, round(r.cpm, 1)), runs: lb.runs + 1 };

  // ---- 履歴。伸びの推定（ローマ字比較）と直近の振り返りに使う
  s.history.unshift({
    at: new Date().toISOString(),
    id: r.lessonId,
    seconds: round(r.seconds, 2),
    kana: r.kana,
    keystrokes: r.keystrokes,
    cpm: round(r.cpm, 1),
    kcpm: round(r.kcpm, 1),
    accuracy: round(r.accuracy, 2),
    perfectRate: round(r.perfectRate, 1),
    meanOffset: r.stat.both.mean == null ? null : round(r.stat.both.mean, 1),
    sdOffset: r.stat.both.sd == null ? null : round(r.stat.both.sd, 1),
    score: gained,
  });
  s.history = s.history.slice(0, HISTORY_LIMIT);

  // ---- ローマ字時代の自分を追い抜いた日を一度だけ刻む
  if (s.romaji && s.romaji.cpm > 0 && !s.romaji.passedAt) {
    const cmp = romajiComparison(s);
    if (cmp.passed) s.romaji = { ...s.romaji, passedAt: today };
  }

  // ---- 実績とアンロック。実績は取った日を残す（マイページで並べるため）
  const earned = newlyEarned(s);
  for (const t of earned) s.earned[t.id] = today;
  s.unlocked = unlockedOf(s);

  writeStats(s);
  return { stats: s, gained, earned, summary: r, records };
}

function round(v, digits) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

// ---------------------------------------------------------------- ローマ字時代の記録

/**
 * 移行前のローマ字入力の速さを記録する。最初に一度だけ測る。
 *
 * 単位は CPM（確定かな/分）で、親指シフト側と同じ物差しにする。
 * ローマ字は 1文字に 2キー打つことが多いが、比べたいのは指の動きではなく
 * 「文章がどれだけ進むか」なので、出た文字の数で揃えるのが正しい。
 *
 * 上書きできるようにしてあるのは、測り直したい人がいるため。
 * ただし追い抜いた記録（passedAt）は消さない。過去に越えた事実は残す。
 */
export function saveRomajiBaseline(cpm, meta = {}) {
  const s = loadStats();
  const v = num(cpm);
  if (v <= 0) return { ok: false, reason: '速さの値が読めませんでした' };
  s.romaji = {
    cpm: round(v, 1),
    at: new Date().toISOString(),
    sampleKana: num(meta.sampleKana),
    seconds: round(num(meta.seconds), 2),
    passedAt: (s.romaji && s.romaji.passedAt) || null,
    by: 'input',
  };
  writeStats(s);
  return { ok: true, stats: s };
}

/** 比べる基準にする最短の一本（字）。数語で出た速さは、文を打つ速さとは言えない */
export const ROMAJI_MIN_KANA = 30;

/**
 * ローマ字で打った一本を残す。親指シフトの記録（段位・実績・弱点・日数）には触らない。
 * 文ごとの最高を更新し、ROMAJI_MIN_KANA 字以上の一本なら比較の基準（romaji.cpm）も
 * 測った最高に上げる。手で入れた値は、測った値が来たら置き換える。
 */
export function recordRomajiRun({ lessonId, kana, seconds, keystrokes, misses }) {
  if (typeof lessonId !== 'string' || !lessonId) throw new Error('recordRomajiRun: lessonId が無い');
  if (!(seconds > 0)) throw new Error('recordRomajiRun: 時間が無い');
  const s = loadStats();
  const cpm = round((num(kana) * 60) / seconds, 1);
  const tries = num(keystrokes) + num(misses);
  const accuracy = tries ? round((num(keystrokes) / tries) * 100, 1) : 0;

  const prev = s.romajiBest[lessonId] ?? { cpm: 0, runs: 0 };
  const isBest = cpm > prev.cpm;
  s.romajiBest[lessonId] = { cpm: Math.max(prev.cpm, cpm), runs: prev.runs + 1 };

  if (num(kana) >= ROMAJI_MIN_KANA) {
    const measured = s.romaji && s.romaji.by === 'measured';
    if (!measured || cpm > s.romaji.cpm) {
      // 基準が上がったら、追い抜いた記録は付け直す（低い基準を越えただけになるので）
      s.romaji = { cpm, at: new Date().toISOString(), sampleKana: num(kana), seconds: round(seconds, 2), by: 'measured', passedAt: null };
    }
  }
  writeStats(s);
  return { stats: s, cpm, accuracy, isBest, nicola: s.lessonBest[lessonId]?.cpm ?? null };
}

/** 測り直し用。基準を消す（追い抜いた記録も一緒に消える） */
export function clearRomajiBaseline() {
  const s = loadStats();
  s.romaji = null;
  writeStats(s);
  return s;
}

// ---------------------------------------------------------------- 設定
//
// 親指キーの割り当て・同時打鍵の閾値・配色。
// 閾値は nicola.js の判定そのものを変えるので、範囲外の値が入ると入力が壊れる。
// 保存の時点で丸めておく。設定画面のバリデーションだけに任せると、
// 書き出しファイルを手で編集した人が詰む。

export const DEFAULT_SETTINGS = {
  // KeyboardEvent.code の配列。複数割り当てられるのは、
  // 環境によって無変換/変換が Lang2/Convert など別の code で来るため
  // macOS の JIS キーボードで実測して決めた。英数（スペースの左）と かな（スペースの右）が
  // ちょうど親指の下にあり、押下も解放も取れて、IME に横取りされない。
  // Safari では かな が KanaMode として届くので両方入れておく。
  // Windows の 無変換/変換 も同じ位置なので並べてある。
  thumbKeys: { left: ['Lang2', 'NonConvert'], right: ['Lang1', 'KanaMode', 'Convert'] },
  tau: 80, // 同時打鍵未成立の判定（ms）
  charTimeout: 150, // 文字キーのタイムアウト（ms）
  thumbTimeout: 250, // 親指キーのタイムアウト（ms）
  // 親指を先に離しても同時打鍵と認める（規格 処理D の厚み検査を省く）。
  // 既定 on。規格どおりだと「親指をぽんと弾いて短く離す」打ち方が
  // t1 >= t2 の壁に当たって不発になり、同時に押しているのに通らない
  lenientRelease: true,
  // 連続シフト（親指を押したまま続けて打てる）。既定 off。
  // 規格には無く、tools/nicola.test.mjs:760 に «補正してはいけない» と
  // 書き残された設計判断がある。エミュレータ（Lacaille など）から来た人向けの逃げ道
  continuousShift: false,
  // 配色。鍵の名前は index.html の <head> のインラインスクリプトと必ず揃える。
  // あちらは module より先に走って配色を先当てする（ちらつき防止）ため、
  // 同じ鍵を直接読んでいる。ここを theme などに変えると、色が保存されなくなる。
  tone: 'midnight',
  sound: 'off', // 打鍵音
  soundVolume: 0.4,
  showKeyboard: true, // 3面キーボード図を出すか
  showMeter: true, // タイミングメーターを出すか
  showRomaji: true, // ローマ字時代との比較を出すか
  input: 'nicola', // 実文・自由入力をどちらで打つか。'nicola' | 'romaji'
  // 同じ字で 6 回続けて外したとき、その字を飛ばして先へ進めるか。
  // 既定 on（これまでの挙動）。off にすると打てるまでそこで止まる
  autoSkip: true,
};

/** 閾値の範囲。NICOLA の規格と実装の都合から、この外は受け付けない */
const LIMITS = {
  tau: [10, 300],
  charTimeout: [30, 600],
  thumbTimeout: [30, 900],
  soundVolume: [0, 1],
};

const clamp = (v, [lo, hi], fallback) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};

function normalizeCodes(v, fallback) {
  const list = arr(v).filter((c) => typeof c === 'string' && c.length > 0);
  return list.length ? [...new Set(list)] : [...fallback];
}

/**
 * 保存値でも入力値でも、必ずここを通してから使う。
 * 「読むときだけ丸める」と、保存直後の画面が丸める前の値で動いてしまう。
 */
function normalizeSettings(raw) {
  const d = DEFAULT_SETTINGS;
  const r = obj(raw);
  const s = { ...d, ...r };
  s.thumbKeys = {
    left: normalizeCodes(obj(r.thumbKeys).left, d.thumbKeys.left),
    right: normalizeCodes(obj(r.thumbKeys).right, d.thumbKeys.right),
  };
  // 左右に同じキーを割り当てると同時打鍵の左右が判別できなくなる。右を既定に戻す
  if (s.thumbKeys.left.some((c) => s.thumbKeys.right.includes(c))) {
    s.thumbKeys.right = [...d.thumbKeys.right];
  }
  s.tau = clamp(s.tau, LIMITS.tau, d.tau);
  s.charTimeout = clamp(s.charTimeout, LIMITS.charTimeout, d.charTimeout);
  s.thumbTimeout = clamp(s.thumbTimeout, LIMITS.thumbTimeout, d.thumbTimeout);
  s.soundVolume = clamp(s.soundVolume, LIMITS.soundVolume, d.soundVolume);
  s.tone = typeof s.tone === 'string' ? s.tone : d.tone;
  s.sound = typeof s.sound === 'string' ? s.sound : d.sound;
  s.showKeyboard = s.showKeyboard !== false;
  s.showMeter = s.showMeter !== false;
  s.showRomaji = s.showRomaji !== false;
  s.lenientRelease = s.lenientRelease !== false;
  s.continuousShift = s.continuousShift === true;
  s.autoSkip = s.autoSkip !== false;
  s.input = s.input === 'romaji' ? 'romaji' : 'nicola';
  return s;
}

/** 設定を読む。壊れていても既定に落として必ず使える形を返す */
export function loadSettings() {
  return normalizeSettings(readJson(SETTINGS_KEY));
}

/**
 * 設定を保存する。渡された分だけ上書きする（部分更新できる）。
 * @returns {object} 丸めたあとの設定。呼ぶ側はこれを使うこと
 */
export function saveSettings(patch) {
  const cur = loadSettings();
  const p = obj(patch);
  const merged = { ...cur, ...p };
  // thumbKeys は片側だけ変えられるようにする（左だけ差し替えて右が消えると入力できなくなる）
  if (p.thumbKeys) merged.thumbKeys = { ...cur.thumbKeys, ...obj(p.thumbKeys) };
  const next = normalizeSettings(merged);
  writeJson(SETTINGS_KEY, next);
  // 保存できたかに関わらず丸めた結果を返す。書けない環境でもその場のセッションは動く
  return next;
}

// ---------------------------------------------------------------- 持ち出しと消去
//
// 手元にしか記録が無いということは、ブラウザを変えたら消えるということでもある。
// だから書き出しと読み戻しは飾りではなく必須機能。
// 保存先のキーも STORAGE_KEYS で公開して隠さない。

/** 手元の記録をまるごと JSON にする */
export function exportAll() {
  return JSON.stringify(
    {
      app: APP,
      version: 1,
      exportedAt: new Date().toISOString(),
      stats: loadStats(),
      settings: loadSettings(),
    },
    null,
    2
  );
}

/**
 * 書き出したファイルの中身を確かめる。importAll は契約どおり boolean を返すので、
 * 「なぜ読めなかったか」を画面に出したいときはこちらを使う。
 * @returns {{ok:boolean, reason?:string, data?:object}}
 */
export function validateImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'JSON として読めませんでした' };
  }
  if (!data || data.app !== APP) {
    return { ok: false, reason: '親指シフトタイピング道場の書き出しファイルではありません' };
  }
  if (!data.stats || typeof data.stats !== 'object') {
    return { ok: false, reason: '中身が足りません（stats が要ります）' };
  }
  return { ok: true, data };
}

/**
 * 書き出した JSON を読み戻す。app 名を確かめてから入れ替える。
 * 今の記録は消える。呼ぶ側で必ず確認を取ること。
 * @returns {boolean}
 */
export function importAll(text) {
  const v = validateImport(text);
  if (!v.ok) return false;
  const okStats = writeJson(STATS_KEY, v.data.stats);
  if (v.data.settings) writeJson(SETTINGS_KEY, v.data.settings);
  return okStats;
}

/** 手元の記録をぜんぶ消す。戻せない */
export function clearAll() {
  try {
    const s = ls();
    if (!s) return false;
    for (const k of STORAGE_KEYS) s.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 表示のための読み出し
//
// マイページが stats を直接こねると、同じ計算が画面ごとに散る。
// 読み出し口をここに置いて、画面は数字を受け取るだけにする。

/** ズレ幅の分布。ヒストグラムと、そこから読める平均・ばらつき */
export function offsetReport(stats = loadStats()) {
  return {
    left: { ...offsetSummary(stats.offset.left), hist: stats.offset.left.hist },
    right: { ...offsetSummary(stats.offset.right), hist: stats.offset.right.hist },
  };
}

/** マイページ一枚に出す要約 */
export function overview(stats = loadStats()) {
  const rank = rankOf(stats.score);
  const acc = stats.kana + stats.misses.mistouch + stats.misses.shiftMisfire + stats.misses.wrongFace;
  return {
    rank,
    score: stats.score,
    tokens: stats.tokens,
    runs: stats.runs,
    kana: stats.kana,
    keystrokes: stats.keystrokes,
    minutes: Math.round(stats.seconds / 60),
    keysPerKana: stats.kana > 0 ? stats.keystrokes / stats.kana : 0,
    accuracy: acc > 0 ? (stats.kana / acc) * 100 : 0,
    streak: stats.streak,
    bestStreak: stats.bestStreak,
    days: stats.days.length,
    since: stats.since,
    best: stats.best,
    misses: stats.misses,
    timing: stats.timing,
    perfectRate: perfectRateOf(stats.timing),
    coverage: stats.coverage,
    earnedCount: Object.keys(stats.earned).length,
    romaji: romajiComparison(stats),
  };
}
