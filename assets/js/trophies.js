// 段位・実績・アンロック。手元のブラウザにだけ残る。
//
// サーバーは使わない。順位を競わせるとサーバーが要るし、
// クライアントから送る数字は必ず偽装される。
// 自分の積み上げだけなら、ごまかしても損をするのは自分だけで済む。
//
// このファイルは「続けさせる仕組み」の判定だけを持つ純粋なデータ層で、
// DOM も localStorage も知らない。判定は全て `check: (stats) => boolean` の
// 宣言的な配列にしてあり、storage.js が蓄積した stats を渡すだけで動く。
// Node から import してそのままテストできる。
//
// 親指シフト（NICOLA）に固有の設計が三つある。
//
// 1. 段位は CPM と正確率の「両方」を同じ一本で満たさないと上がらない。
//    速いだけの人は正確率で止まり、丁寧なだけの人は CPM で止まる。
//    片方だけ伸ばして段位を稼ぐ抜け道を作ると、段位が実力を指さなくなる。
//
// 2. タイミング系の実績を厚く置いた。同時打鍵の時間差(ms)を測っている配列でしか
//    作れない実績で、他のタイピングゲームには存在しない。親指シフトの練習の本体は
//    「文字を覚えること」より「親指と文字キーを揃えること」なので、
//    そこに報酬を置かないと練習の的が外れる。
//
// 3. アンロックは「買う」ではなく「達成で開く」。ローカル保存しかないアプリで
//    通貨を貯めさせても、残高はいつでも書き換えられるし実感も薄い。
//    「濁音の面を20キー打ったから濁音コースが開く」の方が、開いた理由が自分に分かる。

// ---------------------------------------------------------------- 物理キーの左右
//
// 同側シフトか交差シフト（＝濁音・半濁音）かは「文字キーが左右どちらの手か」で決まる。
// これは NICOLA のかな割り当て（nicola.json、コア担当）とは別の、
// QWERTY 物理配置の話なのでここに持っても二重管理にならない。
// かな自体はここでは一切持たない。持つと配列データが二か所に散る。

const LEFT_KEYS = [
  'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT',
  'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB',
];
const RIGHT_KEYS = [
  'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP',
  'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon',
  'KeyN', 'KeyM', 'Comma', 'Period', 'Slash',
];

const LEFT_SET = new Set(LEFT_KEYS);
const RIGHT_SET = new Set(RIGHT_KEYS);

/** NICOLA が使う文字キーの総数（3段×10列）。踏破系の分母 */
export const CHAR_KEY_COUNT = LEFT_KEYS.length + RIGHT_KEYS.length;

function handOf(code) {
  if (LEFT_SET.has(code)) return 'left';
  if (RIGHT_SET.has(code)) return 'right';
  return null;
}

/**
 * faceHits（'KeyH:none' → 打鍵数）から、三つの面それぞれで何種類のキーを
 * 打ったかを数える。踏破系の実績はこれで判定する。
 *
 * かな単位（「濁音を20文字打った」）ではなくキー単位で数えるのは、
 * run に入ってくるのが確定かなではなくキーコードだから。
 * NICOLA では交差シフト面が濁音・半濁音の面なので（規格 §5.3）、
 * 「交差シフトで20キー」は「濁音を一通り打った」とほぼ同義になる。
 * 同側シフト面は濁音ではなく別のかなが出る。ここを取り違えると、
 * 実績が配列表と逆のことを教えることになる。
 *
 * @returns {{solo:number, same:number, cross:number}}
 */
export function faceCoverage(faceHits = {}) {
  const solo = new Set();
  const same = new Set();
  const cross = new Set();
  for (const key of Object.keys(faceHits || {})) {
    if (!(faceHits[key] > 0)) continue;
    const i = key.lastIndexOf(':');
    if (i < 0) continue;
    const code = key.slice(0, i);
    const thumb = key.slice(i + 1);
    if (thumb === 'none') {
      if (handOf(code)) solo.add(code);
      continue;
    }
    const hand = handOf(code);
    if (!hand) continue;
    if (hand === thumb) same.add(code);
    else cross.add(code);
  }
  return { solo: solo.size, same: same.size, cross: cross.size };
}

/** 面ごとの打鍵数の合計。'交差シフト100回' のような回数系に使う */
export function faceTotals(faceHits = {}) {
  let solo = 0;
  let same = 0;
  let cross = 0;
  for (const [key, n] of Object.entries(faceHits || {})) {
    if (!(n > 0)) continue;
    const i = key.lastIndexOf(':');
    if (i < 0) continue;
    const code = key.slice(0, i);
    const thumb = key.slice(i + 1);
    if (thumb === 'none') {
      solo += n;
      continue;
    }
    const hand = handOf(code);
    if (!hand) continue;
    if (hand === thumb) same += n;
    else cross += n;
  }
  return { solo, same, cross };
}

// stats に storage.js が入れておいた集計があればそれを使い、無ければその場で数える。
// 実績の check は毎回全件走るので、重い計算を毎回やらせない。
const cov = (s) => s.coverage || faceCoverage(s.faceHits);

// ---------------------------------------------------------------- 一本ぶんの指標
//
// run から出す指標の定義をここに一か所だけ置く。storage.js も UI もここを使う。
// 定義が二か所にあると「マイページの正確率と結果画面の正確率が違う」が必ず起きる。

/** ミスの合計。3分類（ミスタッチ・シフト不発・誤シフト面）を足すだけ */
export function missTotalOf(run) {
  const m = (run && run.misses) || {};
  return (m.mistouch || 0) + (m.shiftMisfire || 0) + (m.wrongFace || 0);
}

/**
 * 正確率(%)。「出したかった文字のうち、正しく出せた割合」。
 * 分母を物理キー数にしないのは、親指シフトでは1文字に2キー使う打鍵があり、
 * 同じミスでも同時打鍵の課題の方が数字が良く出てしまうから。
 */
export function accuracyOf(run) {
  const kana = (run && run.kana) || 0;
  const miss = missTotalOf(run);
  const denom = kana + miss;
  if (denom <= 0) return 0;
  return (kana / denom) * 100;
}

/** CPM。確定した「かな」の毎分。同時打鍵は 1 と数える（＝出力の速さ） */
export function cpmOf(run) {
  const sec = (run && run.seconds) || 0;
  if (sec <= 0) return 0;
  return ((run.kana || 0) / sec) * 60;
}

/** KCPM。物理キーの毎分。CPM と並べると「1文字あたり何キー使ったか」が見える */
export function kcpmOf(run) {
  const sec = (run && run.seconds) || 0;
  if (sec <= 0) return 0;
  return ((run.keystrokes || 0) / sec) * 60;
}

/** ぴったり率(%)。同時打鍵の判定のうち perfect の割合 */
export function perfectRateOf(timing) {
  const t = timing || {};
  const n = (t.perfect || 0) + (t.good || 0) + (t.off || 0);
  if (n <= 0) return 0;
  return ((t.perfect || 0) / n) * 100;
}

/**
 * ズレ幅の生配列を要約する。生データは保存しないので、
 * ここで「後から平均・標準偏差を復元できる形」まで畳んでおく。
 * n・sum・sumAbs・sumSq があれば、生データ無しで平均も絶対値平均も標準偏差も出せる。
 */
export function summarizeOffsets(list) {
  const a = Array.isArray(list) ? list : [];
  let n = 0;
  let sum = 0;
  let sumAbs = 0;
  let sumSq = 0;
  for (const v of a) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    n++;
    sum += v;
    sumAbs += Math.abs(v);
    sumSq += v * v;
  }
  return { n, sum, sumAbs, sumSq };
}

/** 要約から読める値。n が 0 のときは null（0 と区別する。0ms は「完璧」の意味になってしまう） */
export function offsetSummary(agg) {
  const a = agg || {};
  const n = a.n || 0;
  if (n <= 0) return { n: 0, mean: null, meanAbs: null, sd: null };
  const mean = a.sum / n;
  const varr = Math.max(0, a.sumSq / n - mean * mean);
  return { n, mean, meanAbs: a.sumAbs / n, sd: Math.sqrt(varr) };
}

// ---------------------------------------------------------------- ズレ幅のヒストグラム
//
// 生の ms を全部持つと、1万打で1万個の数値になって localStorage を食い潰す。
// かといって平均だけだと「早すぎと遅すぎが半々で平均0ms」を見抜けない。
// 5ms 刻み・±100ms の 40 ビンに畳む。両端は外れ値を飲み込むクランプビン。
// 5ms なのは perfect の窓が ±15ms だから。窓の中が 6 ビンに割れれば形は読める。

export const OFFSET_BIN_MS = 5;
export const OFFSET_RANGE_MS = 100;
export const OFFSET_BINS = (OFFSET_RANGE_MS * 2) / OFFSET_BIN_MS; // 40

/** ms → ビン番号。範囲外は端のビンに寄せる */
export function offsetBinOf(ms) {
  const i = Math.floor((ms + OFFSET_RANGE_MS) / OFFSET_BIN_MS);
  return Math.min(OFFSET_BINS - 1, Math.max(0, i));
}

/** ビン番号 → { from, to, center }（ms）。UI が軸ラベルを作るため */
export function offsetBinRange(i) {
  const from = -OFFSET_RANGE_MS + i * OFFSET_BIN_MS;
  return { from, to: from + OFFSET_BIN_MS, center: from + OFFSET_BIN_MS / 2 };
}

// ---------------------------------------------------------------- 段位
//
// 段位名は親指シフトの文化に寄せた。武道の伝位（初伝〜皆伝）から段位へ上がる形。
// 親指シフトは「習うより慣れろ」で身体に入れる入力法なので、
// 点数の階段よりも稽古の段階として見せた方が、いま何をすべきかが分かりやすい。
//
// cpm / accuracy は「同じ一本」で両方満たしたときだけ昇段する（rankIndexOfRun 参照）。
// at は序列の値で、rankOf(score) が段位を引くためだけに使う。
// 「次の段位まであと何点」ではなく「あと CPM いくつ・正確率いくつ」を見せたいので、
// UI は nextRankGap() を使うこと。

export const RANKS = [
  { at: 0, name: '素振り', cpm: 0, accuracy: 0, note: 'まずキーの位置を身体に入れる' },
  { at: 100, name: '初伝', cpm: 40, accuracy: 90, note: '見ないで打てる字が増えてきた' },
  { at: 250, name: '中伝', cpm: 70, accuracy: 92, note: '同時打鍵が指に馴染んできた' },
  { at: 450, name: '奥伝', cpm: 100, accuracy: 94, note: '考えずに濁音が出る' },
  { at: 700, name: '皆伝', cpm: 140, accuracy: 95, note: '日常の文章なら詰まらない' },
  { at: 1000, name: '初段', cpm: 180, accuracy: 96, note: '仕事で使って支障がない' },
  { at: 1400, name: '二段', cpm: 220, accuracy: 97, note: '考える速さに手が追いつく' },
  { at: 1900, name: '三段', cpm: 260, accuracy: 97.5, note: '口述に近い速さ' },
  { at: 2500, name: '師範', cpm: 300, accuracy: 98, note: '人に教えられる' },
  { at: 3200, name: '名人', cpm: 360, accuracy: 99, note: '親指シフトの本領' },
];

/**
 * 昇段の対象にする最低文字数。
 * 5文字だけ打って CPM 400 を出しても昇段させない。
 * 短い run は偶然で数字が跳ねるし、それを許すと段位が実力を指さなくなる。
 */
export const RANK_MIN_KANA = 30;

/** 契約どおり score から段位を引く。score は stats.score（到達した段の at） */
export function rankOf(score) {
  let i = 0;
  while (i + 1 < RANKS.length && (score || 0) >= RANKS[i + 1].at) i++;
  return { ...RANKS[i], index: i, next: RANKS[i + 1] || null };
}

/**
 * その一本で到達できる段位のインデックス。
 * CPM と正確率の両方を満たした段までしか上がらない。
 * 「桶は一番短い板の高さまでしか水が入らない」の考え方。
 */
export function rankIndexOfRun(run) {
  if ((run && run.kana ? run.kana : 0) < RANK_MIN_KANA) return 0;
  const cpm = cpmOf(run);
  const acc = accuracyOf(run);
  let i = 0;
  while (i + 1 < RANKS.length && cpm >= RANKS[i + 1].cpm && acc >= RANKS[i + 1].accuracy) i++;
  return i;
}

/**
 * 次の段位まで、CPM と正確率がそれぞれあといくつ足りないか。
 * 足りている方は 0 を返す。両方 0 になった一本で昇段する。
 */
export function nextRankGap(stats) {
  // いまの段は stats.rank（腕前と稽古量の両方で決まった段）から引く。
  // 稽古量だけで引く rankOf(score) を使うと、稽古量が名人の値を越えた人は腕前が皆伝でも
  // «最高段位です» と出ていた（2026-11-02）。rank が無い・読めないときだけ稽古量から引く
  const byName = RANKS.findIndex((r) => r.name === (stats && stats.rank));
  const idx = byName >= 0 ? byName : rankOf((stats && stats.score) || 0).index;
  const cur = { ...RANKS[idx], index: idx, next: RANKS[idx + 1] || null };
  if (!cur.next) return null;
  const best = (stats && stats.best) || {};
  // 段位は「腕前（一本で CPM と正確率）」と「稽古量（積み上げスコア）」の両方が要る。
  // scoreGap を返していなかったため、稽古量が足りないのに
  // 「条件は満たしています。一本打ち切れば上がります」と嘘をついていた。
  return {
    next: cur.next,
    cpmGap: Math.max(0, cur.next.cpm - (best.cpm || 0)),
    accGap: Math.max(0, cur.next.accuracy - (best.accuracy || 0)),
    scoreGap: Math.max(0, cur.next.at - ((stats && stats.score) || 0)),
  };
}

/**
 * 一本ぶんの取り分（積み上げスコア）。
 * 正確率を二乗で効かせ、ぴったり率も係数に入れる。
 * 速いだけ・多いだけでは伸びないようにするため。
 * 100文字・正確率100%・CPM150・ぴったり率50% でおよそ 50。
 */
export function scoreOf(run) {
  const kana = (run && run.kana) || 0;
  if (kana <= 0) return 0;
  const acc = accuracyOf(run) / 100;
  const cpm = cpmOf(run);
  const pr = perfectRateOf(run && run.timing) / 100;
  return Math.max(1, Math.round((kana / 5) * acc * acc * (1 + cpm / 150) * (1 + pr / 2)));
}

// ---------------------------------------------------------------- 日付と連続日数

/** 地元時間の日付。toISOString だと UTC になって日付がずれる */
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 連続で打った日数。今日か昨日で終わっていなければ途切れている */
export function streakOf(days) {
  if (!Array.isArray(days) || !days.length) return 0;
  const set = new Set(days);
  const d = new Date();
  if (!set.has(dayKey(d))) {
    d.setDate(d.getDate() - 1);
    if (!set.has(dayKey(d))) return 0;
  }
  let n = 0;
  while (set.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** 打った日の配列から、これまでで一番長かった連続日数を出す */
export function longestStreakOf(days) {
  if (!Array.isArray(days) || !days.length) return 0;
  const sorted = [...new Set(days)].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00`);
    prev.setDate(prev.getDate() + 1);
    if (dayKey(prev) === sorted[i]) run++;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

// ---------------------------------------------------------------- 実績
//
// 五系統。習得・継続・精度・速度・タイミング。
// check は stats だけを見る純関数にしてある。だから「一本の中で達成した」種類の
// 条件は、storage.js 側が stats.best に「一本ぶんの最良値」として畳んでから渡す。
// （例: best.perfectRateInRun は「これまでで一番ぴったり率が高かった一本の値」）

const CATEGORY_LABEL = {
  mastery: '習得',
  streak: '継続',
  accuracy: '精度',
  speed: '速度',
  timing: 'タイミング',
};

export { CATEGORY_LABEL };

// ---------------------------------------------------------------- 実績を出す前の最低ボリューム
//
// 速度・精度・タイミングの実績は「一本の出来」で決まる。ところが一本の数字は
// 課題が短いほど跳ねる（54文字・19秒の一本で CPM 258 が出る）。下限を置かないと、
// 初稽古の一本で速度も精度もタイミングも同時に開く。実測では 1本目で 7個、
// 機械速度なら 1本で 15個が同時に解除されていた。
//
// 実績が一度に花火として上がると、その後に取るものが無くなる。
// トークンエコノミーとして効くのは「次に何が取れるか」が常に一段だけ見えている形で、
// 全部先に配ってしまうと続ける理由が消える。だから配る速さの方を絞る。
//
// 段位側は同じ問題を RANK_MIN_KANA（30文字未満の一本では昇段しない）で塞いである。
// 同じ考えを実績にも入れる。ただし「一本の長さ」ではなく「通算量」で縛る。
// 一本の長さで縛ると「長い課題を選べば取れる」に化けて、稽古量の担保にならない。
// 通算なら、どの課題をどう選んでも積み上げでしか越えられない。
//
// 数字の根拠。lessons.js の課題は一本 34〜140字、ならすと 50〜70字。
// 一本 55字として本数に直したのが右のコメント。
//
// この下限は「上達した人には見えない」ように選んである。実際に CPM 200 を出せる
// ようになった人は、その時点で通算数万字を打っている。塞ぎたいのは初日の花火だけで、
// 稽古を続けている人の足を止めるためのものではない。
export const TROPHY_MIN_KANA = {
  start: 300, //  5本ぶん。「一度やってみた」を越えた所
  day: 1000, // 18本ぶん。一日みっちり打った所
  week: 2500, // 45本ぶん。数日〜一週間
  weeks: 4500, // 80本ぶん。半月〜一月
  month: 6000, // 110本ぶん。m-keys10k（一万打 ≒ 課題140本）の一段手前に置く
};

// タイミング系だけは通算「同時打鍵の回数」で測る。文字数で測ると、
// 同時打鍵のほとんど出ない課題（第一課の単独打鍵だけの面）を延々打っても
// 下限を越えてしまい、タイミングの実績なのにタイミングの稽古量を担保しない。
// 一本あたりの同時打鍵を 20 回として本数に直したのが右のコメント。
export const TROPHY_MIN_SHIFTS = {
  start: 150, //   8本ぶん
  day: 400, //  20本ぶん
  week: 1000, //  50本ぶん
  month: 2500, // 125本ぶん
};

/** 通算の同時打鍵回数。タイミング系の下限に使う */
const shiftsDone = (s) => {
  const t = (s && s.timing) || {};
  return (t.perfect || 0) + (t.good || 0) + (t.off || 0);
};

/** 通算の確定文字数 */
const kanaDone = (s) => (s && s.kana) || 0;

export const TROPHIES = [
  // ------------------------------------------------ 習得
  {
    id: 'm-first',
    category: 'mastery',
    tier: 'bronze',
    name: '初稽古',
    hint: '課題をひとつ打ち切る',
    check: (s) => s.runs >= 1,
  },
  {
    id: 'm-solo-half',
    category: 'mastery',
    tier: 'bronze',
    name: '素面を半分',
    hint: '単独打鍵の面で15キー打つ',
    check: (s) => cov(s).solo >= 15,
  },
  {
    id: 'm-solo-all',
    category: 'mastery',
    tier: 'silver',
    name: '全キーを正打',
    hint: `単独打鍵の面で${CHAR_KEY_COUNT}キーすべてを打つ`,
    check: (s) => cov(s).solo >= CHAR_KEY_COUNT,
  },
  {
    id: 'm-same-open',
    category: 'mastery',
    tier: 'bronze',
    name: '別のかなの面を開く',
    hint: '同側シフト（別のかな）で10キー打つ',
    check: (s) => cov(s).same >= 10,
  },
  {
    // 濁音は交差シフトの面に出る（規格 §5.3）。ここが same を数えていたため、
    // 濁音を一字も打っていない段階で「濁音を制覇」と出て、
    // 配列表や課題が教えていることの逆を、達成の瞬間に刷り込んでいた
    id: 'm-dakuten',
    category: 'mastery',
    tier: 'silver',
    name: '濁音を制覇',
    hint: '交差シフト（濁音・半濁音）で20キー打つ',
    check: (s) => cov(s).cross >= 20,
  },
  {
    id: 'm-cross-open',
    category: 'mastery',
    tier: 'bronze',
    name: '交差の面を開く',
    hint: '交差シフトで10キー打つ',
    check: (s) => cov(s).cross >= 10,
  },
  {
    id: 'm-kogaki',
    category: 'mastery',
    tier: 'silver',
    name: '小書きを制覇',
    hint: '交差シフト（小書き・拗音が住む面）で18キー打つ',
    check: (s) => cov(s).cross >= 18,
  },
  {
    id: 'm-cross100',
    category: 'mastery',
    tier: 'bronze',
    name: '逆側シフト百本',
    hint: '交差シフトを100回成功させる',
    check: (s) => (s.shiftHits ? s.shiftHits.cross : 0) >= 100,
  },
  {
    id: 'm-cross1000',
    category: 'mastery',
    tier: 'gold',
    name: '逆側シフト千本',
    hint: '交差シフトを1000回成功させる',
    check: (s) => (s.shiftHits ? s.shiftHits.cross : 0) >= 1000,
  },
  {
    id: 'm-three-faces',
    category: 'mastery',
    tier: 'silver',
    name: '三面踏破',
    hint: '単独・同側・交差の三つの面すべてで18キー以上打つ',
    check: (s) => {
      const c = cov(s);
      return c.solo >= 18 && c.same >= 18 && c.cross >= 18;
    },
  },
  // 通算量の三つ（一万打・十万打・十時間）は名前が数字そのものなので、緩めようが無い。
  // 一万打は通算7000字ぶん＝課題130本ほどで、続けている人には届く。
  // 十万打と十時間は最後まで残る二つで、それでいい。ここを緩めると天井が無くなる。
  //
  // 問題は一万打の手前と、一万打から十万打までの間が空くことだった。手前は速度と
  // タイミングの上の段（速くて正確＝通算4500字／毎分三百字＝6000字／五ミリ秒の指・
  // 寸分違わず・ぴったり三十連＝同時打鍵2500回）で埋める。間は逆側シフト千本・五十日・
  // 百日行・十時間が受け持つ。腕前の段と稽古量の段を交互に踏ませたい。
  {
    id: 'm-keys10k',
    category: 'mastery',
    tier: 'silver',
    name: '一万打',
    hint: '通算一万打鍵',
    check: (s) => s.keystrokes >= 10000,
  },
  {
    id: 'm-keys100k',
    category: 'mastery',
    tier: 'gold',
    name: '十万打',
    hint: '通算十万打鍵',
    check: (s) => s.keystrokes >= 100000,
  },
  {
    id: 'm-hour10',
    category: 'mastery',
    tier: 'gold',
    name: '十時間の稽古',
    hint: '通算10時間打つ',
    check: (s) => s.seconds >= 36000,
  },

  // ------------------------------------------------ 継続
  {
    id: 's-3',
    category: 'streak',
    tier: 'bronze',
    name: '三日坊主を越える',
    hint: '3日つづけて打つ',
    check: (s) => s.streak >= 3,
  },
  {
    id: 's-7',
    category: 'streak',
    tier: 'bronze',
    name: '一週間',
    hint: '7日つづけて打つ',
    check: (s) => s.streak >= 7,
  },
  {
    id: 's-14',
    category: 'streak',
    tier: 'silver',
    name: '二週間',
    hint: '14日つづけて打つ',
    check: (s) => s.streak >= 14,
  },
  {
    id: 's-30',
    category: 'streak',
    tier: 'gold',
    name: '一月精進',
    hint: '30日つづけて打つ',
    check: (s) => s.streak >= 30,
  },
  {
    id: 's-100',
    category: 'streak',
    tier: 'gold',
    name: '百日行',
    hint: '100日つづけて打つ',
    check: (s) => s.streak >= 100,
  },
  {
    id: 's-days50',
    category: 'streak',
    tier: 'gold',
    name: '五十日',
    hint: '通算50日打つ（連続でなくてよい）',
    check: (s) => s.days.length >= 50,
  },
  {
    id: 's-return',
    category: 'streak',
    tier: 'silver',
    name: '出戻り',
    hint: '7日以上あけてから戻ってきて、また3日つづける',
    // 一度途切れた人がまた積み上げ始めた瞬間を拾う。移行期は必ず一度は離れるので、
    // 「途切れた＝もう終わり」にさせないための実績。
    check: (s) => s.gapReturns >= 1 && s.streak >= 3,
  },

  // ------------------------------------------------ 精度
  //
  // 「百打」の二つには通算300字を足した。100打鍵は同時打鍵の多い課題なら一本で届くので、
  // 足さないと初稽古と同時に二つ開く（実測で確認した）。
  // 「五百打」だけ素のままなのは、500打鍵を一本で通した時点で通算300字を必ず越えていて、
  // 足しても何も変わらないから。効かない条件を書くと、後から読む人が意味を探して迷う。
  {
    id: 'a-nomisfire100',
    category: 'accuracy',
    tier: 'bronze',
    name: 'シフト不発ゼロ・百打',
    hint: 'シフト不発ひとつも無しで100打鍵する（通算300字から）',
    check: (s) => s.best.noMisfireKeys >= 100 && kanaDone(s) >= TROPHY_MIN_KANA.start,
  },
  {
    id: 'a-nomisfire500',
    category: 'accuracy',
    tier: 'silver',
    name: 'シフト不発ゼロ・五百打',
    hint: 'シフト不発ひとつも無しで500打鍵する',
    check: (s) => s.best.noMisfireKeys >= 500,
  },
  {
    id: 'a-noface100',
    category: 'accuracy',
    tier: 'bronze',
    name: '面を間違えない',
    hint: '誤シフト面ゼロで100打鍵する（通算300字から）',
    check: (s) => s.best.noWrongFaceKeys >= 100 && kanaDone(s) >= TROPHY_MIN_KANA.start,
  },
  {
    id: 'a-perfect1',
    category: 'accuracy',
    tier: 'silver',
    name: '無傷',
    hint: '50文字以上の課題を正確率100%で打ち切る（通算300字から）',
    // 「一度出せばよい」型。ここは積み上げを要求する所ではない。
    // ただし以前は 34文字の一本をミス無しで通しただけで初稽古と同時に開いていた。
    // 二つ足す。(1) 一本が 50文字以上 ─ 短い課題を選んで取る抜け道を塞ぐ。
    // 課題の下限が 34文字なので、最短の一本では届かない所に置く。
    // (2) 通算300字 ─ 初稽古と同時に出さない。
    check: (s) => s.perfectRuns >= 1 && s.best.perfectRunKana >= 50 && kanaDone(s) >= TROPHY_MIN_KANA.start,
  },
  {
    id: 'a-perfect10',
    category: 'accuracy',
    tier: 'gold',
    name: '無傷を十度',
    hint: '正確率100%で10回打ち切る',
    check: (s) => s.perfectRuns >= 10,
  },
  {
    id: 'a-acc98',
    category: 'accuracy',
    tier: 'silver',
    name: '狙いを外さない',
    hint: '正確率98%以上で打ち切る（通算1000字から）',
    // 一本の正確率は文字数が少ないほど跳ねる（50文字ならミス1つで98%）。
    // 一日ぶん打ってなお98%を保てることを求める。無傷（通算300字）より一段上に置いて、
    // 精度の系統に「無傷 → 狙いを外さない → 無傷を十度 → 長丁場を無傷で」の階段を作る。
    check: (s) => s.best.accuracy >= 98 && kanaDone(s) >= TROPHY_MIN_KANA.day,
  },
  {
    id: 'a-clean-long',
    category: 'accuracy',
    tier: 'gold',
    name: '長丁場を無傷で',
    hint: '300文字以上を正確率100%で打ち切る',
    check: (s) => s.best.perfectRunKana >= 300,
  },

  // ------------------------------------------------ 速度
  //
  // 速度は全部「通算いくら打ったか」を条件に足してある。
  // best.cpm は storage.js が一本ごとに無条件で更新するので（文字数の下限が無い）、
  // 5文字を勢いで打った一本でも CPM は跳ねる。速度の実績だけを見て
  // 「その速さで打てる人」と言えるようにするには、量の裏付けが要る。
  //
  // 三段を 通算300字 / 2500字 / 7000字 に散らしてある。等間隔ではなく、
  // 上に行くほど間を広げる。初めの一段は早く来ないと次の目標にならないが、
  // 上の段はそこまでの稽古そのものが中身なので、間が詰まっていると意味が無い。
  {
    id: 'v-cpm100',
    category: 'speed',
    tier: 'bronze',
    name: '毎分百字',
    hint: 'CPM 100 に届く（通算300字から）',
    check: (s) => s.best.cpm >= 100 && kanaDone(s) >= TROPHY_MIN_KANA.start,
  },
  {
    id: 'v-cpm200',
    category: 'speed',
    tier: 'gold',
    name: '毎分二百字',
    hint: 'CPM 200 に届く（通算2500字から）',
    check: (s) => s.best.cpm >= 200 && kanaDone(s) >= TROPHY_MIN_KANA.week,
  },
  {
    id: 'v-cpm300',
    category: 'speed',
    tier: 'gold',
    name: '毎分三百字',
    hint: 'CPM 300 に届く（通算6000字から）',
    check: (s) => s.best.cpm >= 300 && kanaDone(s) >= TROPHY_MIN_KANA.month,
  },
  {
    id: 'v-fast-clean',
    category: 'speed',
    tier: 'gold',
    name: '速くて正確',
    hint: 'CPM 200 以上を正確率98%以上で出す（通算4500字から）',
    // 別々の一本の自己ベストではなく、同じ一本で両立させる。
    // 下限を「毎分二百字」より一段上に置いてあるのは、両立の方が難しいから。
    // 同じ下限にすると二つ同時に開いて、せっかくの一段が一段ぶんに数えられない。
    check: (s) => s.best.fastCleanCpm >= 200 && kanaDone(s) >= TROPHY_MIN_KANA.weeks,
  },
  {
    id: 'v-beat-romaji',
    category: 'speed',
    tier: 'silver',
    name: 'ローマ字を追い抜く',
    hint: '移行前のローマ字入力の速さを超える（通算1000字から）',
    // ここは移行者に「もう戻らなくていい」と言う実績なので、
    // まぐれの一本で言ってはいけない。一日ぶん打った上での最高記録で判定する。
    check: (s) => !!(s.romaji && s.romaji.cpm > 0 && s.best.cpm >= s.romaji.cpm && kanaDone(s) >= TROPHY_MIN_KANA.day),
  },
  {
    id: 'v-romaji-x1_5',
    category: 'speed',
    tier: 'gold',
    name: 'ローマ字の一・五倍',
    hint: '移行前のローマ字入力の1.5倍の速さを出す（通算1000字から）',
    check: (s) => !!(s.romaji && s.romaji.cpm > 0 && s.best.cpm >= s.romaji.cpm * 1.5 && kanaDone(s) >= TROPHY_MIN_KANA.day),
  },

  // ------------------------------------------------ タイミング
  //
  // ここがこの配列でしか作れない領域。同時打鍵の時間差(ms)を測っているから
  // 「揃っているか」「早すぎるか遅すぎるか」「ばらついていないか」を実績にできる。
  // 速さや正確さと違い、タイミングは意識すればその日のうちに変わるので、
  // 上達の実感が最も早く返ってくる系統でもある。
  //
  // その返りの早さが、そのまま緩さでもあった。「一本でぴったり率80%」の類は
  // 同時打鍵が20回あれば成立してしまうので、一本目に同時打鍵の多い課題を選ぶだけで
  // 系統ごと開いていた。一本の出来の条件はそのまま残し、通算の同時打鍵回数を足す。
  // 「その一本で揃った」と「揃うようになった」は違う。実績にしたいのは後者。
  {
    id: 't-first',
    category: 'timing',
    tier: 'bronze',
    name: 'はじめてのぴったり',
    hint: 'ぴったり判定（±15ms）を1回出す',
    check: (s) => s.timing.perfect >= 1,
  },
  {
    id: 't-perfect50',
    category: 'timing',
    tier: 'bronze',
    name: 'ぴったり五十',
    hint: 'ぴったり判定を通算50回出す',
    check: (s) => s.timing.perfect >= 50,
  },
  {
    id: 't-perfect500',
    category: 'timing',
    tier: 'gold',
    name: 'ぴったり五百',
    hint: 'ぴったり判定を通算500回出す',
    check: (s) => s.timing.perfect >= 500,
  },
  {
    id: 't-all-perfect',
    category: 'timing',
    tier: 'gold',
    name: '寸分違わず',
    hint: '1課題の同時打鍵を30回以上、すべてぴったりで打ち切る（通算2500回から）',
    // 20回では、同時打鍵の多い課題を一本打てば機械速度でその場で取れていた。
    // 全部ぴったりを続けるのは回数が増えるほど急に難しくなるので、
    // 回数の方を 30 に上げるのが、この実績を「一番上」に戻す一番素直な直し方。
    check: (s) => s.best.allPerfectShifts >= 30 && shiftsDone(s) >= TROPHY_MIN_SHIFTS.month,
  },
  {
    id: 't-rate80',
    category: 'timing',
    tier: 'silver',
    name: 'ぴったり八割',
    hint: '1課題でぴったり率80%以上（同時打鍵20回以上・通算400回から）',
    check: (s) => s.best.perfectRate >= 80 && shiftsDone(s) >= TROPHY_MIN_SHIFTS.day,
  },
  {
    id: 't-mean10',
    category: 'timing',
    tier: 'silver',
    name: '十ミリ秒の指',
    hint: '1課題のズレ平均を±10ms以内に収める（20回以上・通算400回から）',
    check: (s) => s.best.meanAbsOffset != null && s.best.meanAbsOffset <= 10 && shiftsDone(s) >= TROPHY_MIN_SHIFTS.day,
  },
  {
    id: 't-mean5',
    category: 'timing',
    tier: 'gold',
    name: '五ミリ秒の指',
    hint: '1課題のズレ平均を±5ms以内に収める（20回以上・通算2500回から）',
    // ±5ms は perfect の窓（±15ms）の三分の一。狙って出せる幅ではなく、
    // 積み上げた結果その辺りに寄ってくる幅なので、通算も一番上の段に置く。
    check: (s) => s.best.meanAbsOffset != null && s.best.meanAbsOffset <= 5 && shiftsDone(s) >= TROPHY_MIN_SHIFTS.month,
  },
  {
    id: 't-steady',
    category: 'timing',
    tier: 'gold',
    name: 'ぶれない親指',
    hint: '1課題のズレのばらつき（標準偏差）を15ms以内に収める（30回以上・通算1000回から）',
    // 平均が0でも「早すぎ・遅すぎが半々」なら直っていない。ばらつきを別に見る。
    check: (s) => s.best.sdOffset != null && s.best.sdOffset <= 15 && shiftsDone(s) >= TROPHY_MIN_SHIFTS.week,
  },
  {
    id: 't-both-hands',
    category: 'timing',
    tier: 'silver',
    name: '左右そろい踏み',
    hint: '1課題で左右どちらの親指もズレ平均±10ms以内（各10回以上・通算400回から）',
    check: (s) => s.best.bothHandsMeanAbs != null && s.best.bothHandsMeanAbs <= 10 && shiftsDone(s) >= TROPHY_MIN_SHIFTS.day,
  },
  {
    id: 't-symmetric',
    category: 'timing',
    tier: 'gold',
    name: '左右対称',
    hint: '1課題で左右の親指のズレ平均の差を5ms以内にする（各10回以上・通算1000回から）',
    // 片方の親指だけ遅い人は多い。左右差は本人には自覚しにくいので実績にする。
    // ただし左右10回ずつでは、たまたま両方の平均が近づいた一本で出てしまう。
    // 「左右そろい踏み」より一段上に置く。片手ずつ揃える方が、左右を揃えるより先に来る。
    check: (s) => s.best.handGap != null && s.best.handGap <= 5 && shiftsDone(s) >= TROPHY_MIN_SHIFTS.week,
  },
  {
    id: 't-fixed-drift',
    category: 'timing',
    tier: 'silver',
    name: '癖を直した',
    hint: 'ズレ平均が±20msを超えた課題を5回経てから、±10ms以内を出す',
    // 最初から揃っている人には出ない。「直した」人だけの実績。
    check: (s) => s.driftRuns >= 5 && s.best.meanAbsOffset != null && s.best.meanAbsOffset <= 10,
  },
  {
    id: 't-perfect-streak',
    category: 'timing',
    tier: 'silver',
    name: 'ぴったり十連',
    hint: 'ぴったり判定を10回続けて出す（通算150回から）',
    // タイミング系で最初に届く一段。下限も一番低く置く。
    check: (s) => s.best.perfectStreak >= 10 && shiftsDone(s) >= TROPHY_MIN_SHIFTS.start,
  },
  {
    id: 't-perfect-streak30',
    category: 'timing',
    tier: 'gold',
    name: 'ぴったり三十連',
    hint: 'ぴったり判定を30回続けて出す（通算2500回から）',
    check: (s) => s.best.perfectStreak >= 30 && shiftsDone(s) >= TROPHY_MIN_SHIFTS.month,
  },
  // ------------------------------------------------ 皆伝（白金）
  // ゲームの «プラチナトロフィー» にあたる一つ。ほかを全部取ったときだけ開く。
  // check はほかの実績の取得状況だけを見る。同じ回で最後の一つと一緒に取れるよう、
  // newlyEarned が «この回で取ったもの» も足して判定する
  {
    id: 'x-all',
    category: 'crown',
    tier: 'platinum',
    name: '親指の極み',
    hint: 'ほかの実績をすべて取る',
    check: (s) => TROPHIES.every((t) => t.id === 'x-all' || !!(s.earned && s.earned[t.id])),
  },
];

/**
 * メダルの格。ゲームの実績と同じく、取りやすいものから銅・銀・金、全部を取った印が白金。
 * 格は «どれだけ稽古を積めば届くか» で付けた。一日で届くものが銅、一週間ほどが銀、
 * 月単位の稽古か、狙っても簡単には出ない精度が要るものが金
 */
export const TIERS = [
  { id: 'bronze', name: '銅' },
  { id: 'silver', name: '銀' },
  { id: 'gold', name: '金' },
  { id: 'platinum', name: '白金' },
];

/**
 * 数で届く実績の «いまどこまで来たか»。[いま, 目標] を返す。
 * 一回の出来で決まるもの（ズレ平均・正確率など）は進み具合が無いので null。
 * 途中が見えると «あと 38 打» が次に打つ理由になる（ゲームの実績の進捗バーと同じ）
 */
const PROGRESS = {
  'm-solo-half': (s) => [cov(s).solo, 15],
  'm-solo-all': (s) => [cov(s).solo, CHAR_KEY_COUNT],
  'm-same-open': (s) => [cov(s).same, 10],
  'm-dakuten': (s) => [cov(s).cross, 20],
  'm-cross-open': (s) => [cov(s).cross, 10],
  'm-kogaki': (s) => [cov(s).cross, 18],
  'm-cross100': (s) => [s.shiftHits?.cross ?? 0, 100],
  'm-cross1000': (s) => [s.shiftHits?.cross ?? 0, 1000],
  'm-keys10k': (s) => [s.keystrokes ?? 0, 10000],
  'm-keys100k': (s) => [s.keystrokes ?? 0, 100000],
  'm-hour10': (s) => [Math.floor((s.seconds ?? 0) / 3600), 10],
  's-3': (s) => [s.streak ?? 0, 3],
  's-7': (s) => [s.streak ?? 0, 7],
  's-14': (s) => [s.streak ?? 0, 14],
  's-30': (s) => [s.streak ?? 0, 30],
  's-100': (s) => [s.streak ?? 0, 100],
  's-days50': (s) => [s.days?.length ?? 0, 50],
  'a-perfect10': (s) => [s.perfectRuns ?? 0, 10],
  't-perfect50': (s) => [s.timing?.perfect ?? 0, 50],
  't-perfect500': (s) => [s.timing?.perfect ?? 0, 500],
  'x-all': (s) => [TROPHIES.filter((t) => t.id !== 'x-all' && s.earned && s.earned[t.id]).length, TROPHIES.length - 1],
};

/** @returns {{now:number, goal:number} | null} いまの値は目標で頭打ちにする */
export function progressOf(trophy, stats) {
  const f = PROGRESS[trophy.id];
  if (!f) return null;
  const [now, goal] = f(stats);
  return { now: Math.min(goal, Math.max(0, Math.floor(now))), goal };
}

/** まだ取っていないもののうち、条件を満たしたものを返す */
export function newlyEarned(stats) {
  const found = TROPHIES.filter((t) => {
    if (t.id === 'x-all') return false;
    if (stats.earned && stats.earned[t.id]) return false;
    try {
      return !!t.check(stats);
    } catch {
      // stats の形が古くて check が転んでも、記録の保存自体は続けたい
      return false;
    }
  });
  // 白金は «この回で取ったもの» も取ったことにして判定する。でないと最後の一つの次の回まで開かない
  const crown = TROPHIES.find((t) => t.id === 'x-all');
  if (!(stats.earned && stats.earned[crown.id])) {
    const earned = { ...(stats.earned ?? {}) };
    for (const t of found) earned[t.id] = true;
    if (crown.check({ ...stats, earned })) found.push(crown);
  }
  return found;
}

/** 系統ごとに束ねた実績。マイページの一覧用 */
export function trophiesByCategory() {
  const out = {};
  for (const t of TROPHIES) {
    (out[t.category] || (out[t.category] = [])).push(t);
  }
  return out;
}

// ---------------------------------------------------------------- アンロック
//
// 買うのではなく達成で開く。開く理由が自分の稽古と結びついている方が、
// 通貨の残高が増えるより手応えがある。
//
// kind: 'course'（課題コース）| 'theme'（配色）| 'sound'（打鍵音）
// target: 他担当が参照する ID。course の target は lessons 側のコース ID と一致させること。

export const UNLOCKS = [
  // ---- 課題コース（段階的解禁）
  {
    id: 'u-course-dakuten',
    kind: 'course',
    target: 'dakuten',
    name: '濁音コース',
    hint: '単独打鍵の面で20キー打つ',
    check: (s) => cov(s).solo >= 20,
  },
  {
    id: 'u-course-cross',
    kind: 'course',
    target: 'cross',
    name: '交差シフトコース',
    hint: '同側シフト（別のかな）で15キー打つ',
    check: (s) => cov(s).same >= 15,
  },
  {
    id: 'u-course-words',
    kind: 'course',
    target: 'words',
    name: '単語コース',
    hint: '三つの面すべてで10キー以上打つ',
    check: (s) => {
      const c = cov(s);
      return c.solo >= 10 && c.same >= 10 && c.cross >= 10;
    },
  },
  {
    id: 'u-course-sentence',
    kind: 'course',
    target: 'sentence',
    name: '文章コース',
    hint: '正確率95%以上で打ち切る',
    check: (s) => s.best.accuracy >= 95,
  },
  {
    id: 'u-course-timing',
    kind: 'course',
    target: 'timing',
    name: 'タイミング稽古',
    hint: 'ぴったり判定を通算50回出す',
    check: (s) => s.timing.perfect >= 50,
  },
  {
    id: 'u-course-speed',
    kind: 'course',
    target: 'speed',
    name: '速度コース',
    // 最終課なので、速さだけでは開けない。三つの面を一通り打っていることを併せて見る。
    // 以前は CPM100 だけで、初心者の一本目で最終課だけが先に開いていた。
    hint: 'CPM 100 に届く。三つの面をそれぞれ15キー以上打つ',
    check: (s) => {
      const c = cov(s);
      return s.best.cpm >= 100 && c.solo >= 15 && c.same >= 15 && c.cross >= 15;
    },
  },

  // ---- 配色
  {
    id: 'u-theme-matcha',
    kind: 'theme',
    target: 'matcha',
    name: '抹茶',
    hint: '3日つづけて打つ',
    check: (s) => s.streak >= 3 || s.bestStreak >= 3,
  },
  {
    id: 'u-theme-plum',
    kind: 'theme',
    target: 'plum',
    name: '藤',
    hint: '7日つづけて打つ',
    check: (s) => s.streak >= 7 || s.bestStreak >= 7,
  },
  {
    id: 'u-theme-sumi',
    kind: 'theme',
    target: 'sumi',
    name: '墨',
    hint: '通算一万打鍵',
    check: (s) => s.keystrokes >= 10000,
  },
  // 配色は 藍(midnight, 既定) / 抹茶 / 藤 / 墨 の4つ。既定を除く3つが開く。
  // かつて存在しない配色（松葉など）を開こうとしていたが、画面側には無いので消した。

  // ---- 打鍵音
  {
    id: 'u-sound-tsuzumi',
    kind: 'sound',
    target: 'tsuzumi',
    name: '鼓',
    hint: '課題をひとつ打ち切る',
    check: (s) => s.runs >= 1,
  },
  {
    id: 'u-sound-hyoshigi',
    kind: 'sound',
    target: 'hyoshigi',
    name: '拍子木',
    hint: 'ぴったり判定を通算50回出す',
    check: (s) => s.timing.perfect >= 50,
  },
  {
    id: 'u-sound-typewriter',
    kind: 'sound',
    target: 'typewriter',
    name: '和文タイプ',
    hint: '交差シフト（濁音・半濁音）で20キー打つ',
    check: (s) => cov(s).cross >= 20,
  },
];

/** 最初から使えるもの。アンロックの一覧に「既定」として並べるため */
export const DEFAULT_UNLOCKED = {
  course: ['basic'],
  theme: ['midnight'],
  sound: ['off'],
};

/**
 * いま開いているものを種類ごとに返す。
 * 開いている・いないは stats から毎回計算する。保存した「開いた印」を正とすると、
 * 実績の条件を後から変えたときに食い違うし、印だけ書き換える抜け道もできる。
 *
 * @returns {{course:string[], theme:string[], sound:string[], items:object[]}}
 */
export function unlockedOf(stats) {
  const out = {
    course: [...DEFAULT_UNLOCKED.course],
    theme: [...DEFAULT_UNLOCKED.theme],
    sound: [...DEFAULT_UNLOCKED.sound],
    items: [],
  };
  // コースだけは順番に開く。条件が独立だと、CPM が出た人に最終課だけ先に開いて
  // 間が全部閉じたままになる（実際そうなっていた）。教程は順に進んでこそ教程なので、
  // 前の課が開いていない限り次は開かない。配色や音は独立でよい。
  let coursesStillOpen = true;

  for (const u of UNLOCKS) {
    let ok = false;
    try {
      ok = !!u.check(stats);
    } catch {
      ok = false;
    }
    if (u.kind === 'course') {
      ok = ok && coursesStillOpen;
      if (!ok) coursesStillOpen = false;
    }
    out.items.push({ id: u.id, kind: u.kind, target: u.target, name: u.name, hint: u.hint, open: ok });
    if (ok && !out[u.kind].includes(u.target)) out[u.kind].push(u.target);
  }
  return out;
}

/** その設定値が使えるか。UI が保存済み設定を検証するため（開いていない配色が選ばれたままでも壊さない） */
export function isUnlocked(stats, kind, target) {
  const u = unlockedOf(stats);
  return (u[kind] || []).includes(target);
}

// ---------------------------------------------------------------- ローマ字時代の自分との比較
//
// 親指シフト移行の最大の障壁は「速さ」ではなく「仕事が回らなくなる期間の不安」。
// 移行前のローマ字入力の速さを最初に一度だけ測っておき、
// 「いまローマ字の何割」「この伸びなら追い抜くまであと何日」を出す。
//
// ここが効くのは、不安の正体が「いつまで続くか分からないこと」だから。
// 終わりが日数で見えれば耐えられる。既存の練習サイトは誰もここに手を付けていない。
//
// 単位は両方とも CPM（確定かな/分）で揃える。ローマ字も同じ日本語文を打って測るので、
// キーの数ではなく「出た文字の数」で比べれば、入力方式が違っても素直に比較できる。

/** 伸びを推定するのに最低限必要な稽古日数。これ未満だと予測を出さない */
const FORECAST_MIN_DAYS = 3;

/**
 * 日ごとの代表 CPM を history から作る。
 * 一日の最高ではなく中央値を使う。最高だとまぐれの一本で線が跳ね、
 * 「明日には追い抜く」のような嘘の予測が出る。
 */
function dailyCpm(history) {
  const byDay = new Map();
  for (const h of history || []) {
    if (!h || !h.at || !(h.cpm > 0)) continue;
    const d = new Date(h.at);
    if (Number.isNaN(d.getTime())) continue;
    const k = dayKey(d);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(h.cpm);
  }
  const out = [];
  for (const [k, list] of byDay) {
    list.sort((a, b) => a - b);
    out.push({ day: k, cpm: list[Math.floor(list.length / 2)] });
  }
  out.sort((a, b) => (a.day < b.day ? -1 : 1));
  return out;
}

/** 最小二乗で「一日あたり何 CPM 伸びているか」を出す */
function slopePerDay(points) {
  if (points.length < 2) return null;
  const t0 = new Date(`${points[0].day}T00:00:00`).getTime();
  const xs = points.map((p) => (new Date(`${p.day}T00:00:00`).getTime() - t0) / 86400000);
  const ys = points.map((p) => p.cpm);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  if (den === 0) return null;
  return num / den;
}

/**
 * ローマ字時代の自分との比較。
 *
 * current は自己ベストではなく「直近の代表値」を使う。
 * 追い抜いたと言えるのは、まぐれの最高記録ではなく普段出る速さが越えたとき。
 *
 * @returns {{
 *   baseline:number|null, current:number|null, ratio:number|null,
 *   passed:boolean, passedAt:string|null,
 *   perDay:number|null, daysToPass:number|null, passDate:string|null,
 *   samples:number, message:string
 * }}
 */
export function romajiComparison(stats) {
  const base = stats && stats.romaji && stats.romaji.cpm > 0 ? stats.romaji.cpm : null;
  const points = dailyCpm(stats && stats.history);
  const recent = points.slice(-5);
  const current = recent.length ? recent.reduce((a, p) => a + p.cpm, 0) / recent.length : null;

  const out = {
    baseline: base,
    current,
    ratio: base && current ? current / base : null,
    passed: !!(stats && stats.romaji && stats.romaji.passedAt),
    passedAt: (stats && stats.romaji && stats.romaji.passedAt) || null,
    perDay: null,
    daysToPass: null,
    passDate: null,
    samples: points.length,
    message: '',
  };

  if (!base) {
    out.message = '移行前のローマ字入力の速さがまだ記録されていません。最初に一度だけ測っておくと、追い抜く日が分かります。';
    return out;
  }
  if (!current) {
    out.message = 'まだ稽古の記録がありません。';
    return out;
  }
  if (out.passed || current >= base) {
    out.passed = true;
    out.message = `ローマ字を追い抜きました（${Math.round(current)} / ${Math.round(base)} cpm）。`;
    return out;
  }

  // 追い抜くまでの見込み。直近30日ぶんの傾きで見る。
  // 移行直後の急落から立ち直る局面まで含めると傾きが暴れるので、最近だけを見る。
  const window = points.slice(-30);
  const slope = window.length >= FORECAST_MIN_DAYS ? slopePerDay(window) : null;
  out.perDay = slope;

  const pct = Math.round((current / base) * 100);
  if (slope == null) {
    out.message = `ローマ字の ${pct}%。`;
    return out;
  }
  if (slope <= 0) {
    out.message = `ローマ字の ${pct}%。ここ数日は伸びが止まっています。`;
    return out;
  }

  const days = Math.ceil((base - current) / slope);
  out.daysToPass = days;
  const d = new Date();
  d.setDate(d.getDate() + days);
  out.passDate = dayKey(d);
  out.message = `ローマ字の ${pct}%。この伸び（1日 +${slope.toFixed(1)} cpm）なら、あと ${days} 日で追い抜きます。`;
  return out;
}
