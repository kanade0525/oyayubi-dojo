// 適応出題。その人の弱いところを読んで、練習文をその場で作る。
//
// なぜこれが要るか。
//
// 固定の課題文は「これから覚える人」には効くが、既に打てる人には効かない。
// 同じ文を繰り返すと、指ではなく文章の方を覚えてしまい、打鍵の訓練ではなく
// 暗唱の訓練になる。keybr.com が擬似単語を出し続けるのはこの問題への答えで、
// 「弱いキーを多く含む、毎回違う、しかし言語として自然な並び」を作り続ける。
// このファイルはそれを親指シフト向けにやる。親指シフトの弱点は QWERTY と違って
// 「キー」ではなく **面**（キー×どちらの親指を沈めたか）の単位で出るので、
// 統計も出題も面を単位にしている。
//
// 面 = `${charCode}:${thumb}`（'KeyH:none' | 'KeyH:left' | 'KeyH:right'）。
// storage.js の faceHits / faceMisses と同じ鍵の形。ここで別の形にすると、
// 統計を読み替える層がもう一枚要る。
//
// 同側／交差の定義は layout.js の shiftKindOf に任せて、ここでは持たない。
//   同側シフト（左手×左親指 / 右手×右親指） … 別のかな
//   交差シフト（左手×右親指 / 右手×左親指） … 主に濁音・半濁音
// 二か所に書くと、片方を直したときに学習者へ逆を教えることになる。
//
// このファイルは DOM も保存（storage.js）も時計も知らない。乱数すら外から受け取る
// （makeDrill(stats, { rng })）。乱数を内側に隠すと生成文の検査が書けなくなり、
// 「たまたま通ったテスト」しか残らない。
//
// 出す文字は必ず assets/data/nicola.js に載っているかなだけを使う。
// 載っていない字を一字でも混ぜると、その課題は**永久にクリアできない**。
// 語彙表も擬似語も、この配列表から引いたかなの外へは出ない作りにしてある。

import { loadLayout, shiftKindOf } from './layout.js';
import { offsetSummary } from './trophies.js';

const LAYOUT = loadLayout();

// ---------------------------------------------------------------- 面の一覧
//
// 教程順（lessons.js の basic-1〜basic-7 の順）を面ごとに持たせる。
// これは「弱さが同点のときにどちらを先に出すか」を決めるためのもので、
// 未踏破の面が大量にある初心者（統計が空）のときに効く。
// 同点をキーの ID 順で切ると、いきなり交差シフトから出題される。

/** キーの並び。lessons.js の教程順（左ホーム → 右ホーム → 句読点 → 右上下段 → 左上下段） */
const KEY_ORDER = [
  'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG',
  'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon',
  'KeyQ', 'KeyP',
  'KeyY', 'KeyU', 'KeyI', 'KeyO',
  'KeyN', 'KeyM', 'Comma', 'Period', 'Slash',
  'KeyW', 'KeyE', 'KeyR', 'KeyT',
  'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyZ',
];

/** 面の種類の学習順。単独 → 同側 → 交差。lessons.js のコース順と同じ */
const KIND_RANK = { none: 0, same: 1, cross: 2 };

/** 区切りに使える字。語の中には入れない */
const PUNCT = new Set(['。', '、', '．', '・']);

function buildFaces() {
  const keys = LAYOUT.keys;
  const codes = [
    ...KEY_ORDER.filter((c) => keys[c]),
    ...Object.keys(keys).filter((c) => !KEY_ORDER.includes(c)),
  ];
  const out = [];
  codes.forEach((charCode, keyRank) => {
    const key = keys[charCode];
    for (const thumb of ['none', 'left', 'right']) {
      const kana = thumb === 'none' ? key.none : key[thumb];
      if (!kana) continue; // Semicolon:left のように割り当てが無い面がある
      const shiftKind = shiftKindOf(key.hand, thumb === 'none' ? null : thumb);
      out.push({
        face: `${charCode}:${thumb}`,
        charCode,
        thumb,
        kana,
        hand: key.hand,
        shiftKind, // null | 'same' | 'cross'
        teachOrder: KIND_RANK[shiftKind || 'none'] * 100 + keyRank,
      });
    }
  });
  out.sort((a, b) => a.teachOrder - b.teachOrder);
  return out;
}

/** 打てる面の全て。教程順に並んでいる */
export const DRILL_FACES = Object.freeze(buildFaces().map(Object.freeze));

/** かな → その字を出せる面。「ぁ」「ぅ」「ぉ」は左右どちらの親指でも出るので複数ある */
const KANA_FACES = new Map();
for (const f of DRILL_FACES) {
  if (!KANA_FACES.has(f.kana)) KANA_FACES.set(f.kana, []);
  KANA_FACES.get(f.kana).push(f);
}

/** 打てるかなの全て。生成した文がこの外に出ていないことが、このファイルの最低条件 */
const TYPABLE = new Set(KANA_FACES.keys());

/** 面を日本語で言い表す。出題の説明文と、呼び出し側の表示に使う */
export function describeFace(face) {
  const f = typeof face === 'string' ? DRILL_FACES.find((x) => x.face === face) : face;
  if (!f) return '';
  const hand = f.hand === 'left' ? '左手' : '右手';
  if (f.thumb === 'none') return `${f.kana}（単独打鍵・${hand}）`;
  const thumb = f.thumb === 'left' ? '左親指' : '右親指';
  const kind = f.shiftKind === 'same' ? '同側シフト' : '交差シフト';
  return `${f.kana}（${kind}・${hand}×${thumb}）`;
}

/**
 * 文字列を面ごとの打鍵数に畳む。呼び出し側が「この課題で何の面を打つか」を
 * 先に出すため（ヒートマップの予告、出題の説明）。
 * 「ぁ」のように二つの面が同じ字を出す場合は、教程順で先に来る面に寄せて数える。
 * 実際にどちらの親指で打つかは打ち手の自由なので、ここでの割り当ては目安。
 */
export function faceCountsOfText(text) {
  const counts = {};
  for (const ch of String(text || '')) {
    const faces = KANA_FACES.get(ch);
    if (!faces) continue;
    counts[faces[0].face] = (counts[faces[0].face] || 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------- 弱さの読み方
//
// ここが設計の芯。四つの軸を 0〜1 に正規化してから重みを掛けて足す。
// 正規化してから足すのは、軸ごとに単位（回数・率・ミリ秒）が違うため。
// 生の値のまま足すと、ズレ(ms)だけが桁で勝ってしまう。
//
//   未踏破 … 一度も打っていない面。**最優先**。打てない字は速さ以前の問題で、
//            そこが一つでも残っていると文章のどこかで必ず止まる。
//            重み 4.0 は他の三軸の最大和（0.6+1.0+0.4=2.0）より大きい。
//            こうしておくと「未踏破は必ず先頭」が重みの副作用ではなく保証になる。
//
//   ミス率 … いちばん直接的な弱さの証拠なので、踏破済みの軸では最大の重み 1.0。
//            ただし生の misses/hits は使わない。1回打って1回ミスした面が
//            100回打って20回ミスした面より上に来てしまい、出題が
//            「たまたま一度だけ触った面」で埋まる。事前分布（既定 6%）を
//            8打鍵ぶん混ぜたベイズ平滑で潰す。8 は「その面を8回打てば
//            自分のミス率の方が事前分布より強くなる」という意味の数字で、
//            一課題の中で一つの面が出る回数の見当から取った。
//
//   打ち込み不足 … ミスしていなくても、5回しか打っていない面は身についていない。
//            hits が増えるほど 0 に近づく飽和関数。重み 0.6 は、
//            「ミスは出ていないがまだ薄い」を「ミスが出ている」より下に置くため。
//
//   親指のズレ … offset は面ごとではなく **親指ごと** の情報しか無いので、
//            同じ親指を使う面へ一律に乗る。証拠としては面ごとのミスより粗いから
//            重みは 0.4 と軽く、さらに標本数が少ないうちは効かないよう n で減衰させる。
//            片方の親指だけ遅い人は、その親指を使う面（同側にも交差にも散っている）が
//            まとめて浮き上がる。これは面ごとの統計だけでは絶対に見えない弱点で、
//            親指シフト固有なので軸として持つ価値がある。
//
//   鮮度 … 「最近打っていない面ほど弱い」は正しいが、stats は面ごとの時刻を
//            持っていない（storage.js は faceHits に回数しか積まない）。
//            そこで逆向きに、**直近で出した面を少し下げる** 形で入れる。
//            呼び出し側が options.recentFaces に前回の出題の面を渡すと、
//            同じ弱点ばかりが何本も続くのを防げる。重み 0.5 は、
//            一本ぶん出したくらいでは順位が入れ替わらない程度の大きさ。

const W = {
  unseen: 4.0,
  miss: 1.0,
  thin: 0.6,
  offset: 0.4,
  recent: 0.5,
};

/** ミス率の事前分布。8打鍵ぶんの「ミス率6%」を混ぜてから率を出す */
const MISS_PRIOR_N = 8;
const MISS_PRIOR_P = 0.06;
/** ミス率がここまで来たら弱さは頭打ち。3割ミスは十分に最悪 */
const MISS_CAP = 0.3;
/** 打ち込み量の半減点。30打鍵でようやく半分こなれた、と見る */
const THIN_HALF = 30;
/** これだけ打っていれば「打てる面」として埋めに使ってよい */
const FLUENT_HITS = 5;
/** ズレがここまで来たら頭打ち（ms）。判定 good が ±35ms なので、その少し外 */
const OFFSET_CAP = 40;
/** ズレの標本がこれだけ貯まって初めて満額で効く */
const OFFSET_N_HALF = 10;

const numOf = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const plainObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** stats が空でも壊れていても読めるようにする。初回起動では丸ごと undefined が来る */
function readStats(stats) {
  const s = plainObj(stats);
  const offset = plainObj(s.offset);
  const summarize = (side) => {
    const sum = offsetSummary(plainObj(side));
    const n = numOf(sum.n);
    if (n <= 0) return { n: 0, dev: 0 };
    // 平均のズレ（偏り）とばらつきを半々で見る。どちらか片方だと、
    // 「いつも20ms遅れる人」と「ばらばらに±40ms振れる人」の片方を見落とす。
    const dev = (Math.abs(numOf(sum.meanAbs)) + numOf(sum.sd)) / 2;
    return { n, dev };
  };
  return {
    faceHits: plainObj(s.faceHits),
    faceMisses: plainObj(s.faceMisses),
    offsetDev: { left: summarize(offset.left), right: summarize(offset.right) },
  };
}

/** recentFaces は配列でも { face: 回数 } でも受ける。呼び出し側の手間を減らす */
function toCountMap(v) {
  const out = new Map();
  if (Array.isArray(v)) {
    for (const k of v) if (typeof k === 'string') out.set(k, (out.get(k) || 0) + 1);
  } else if (v && typeof v === 'object') {
    for (const [k, n] of Object.entries(v)) if (numOf(n) > 0) out.set(k, numOf(n));
  }
  return out;
}

function scoreFace(f, s, recent) {
  const hits = numOf(s.faceHits[f.face]);
  const misses = numOf(s.faceMisses[f.face]);
  const unseen = hits <= 0;

  const missRate = (misses + MISS_PRIOR_N * MISS_PRIOR_P) / (hits + MISS_PRIOR_N);
  const miss = Math.min(1, missRate / MISS_CAP);
  const thin = THIN_HALF / (hits + THIN_HALF);

  let offset = 0;
  if (f.thumb !== 'none') {
    const o = s.offsetDev[f.thumb];
    const strength = o.n / (o.n + OFFSET_N_HALF); // 標本が少ないうちは効かせない
    offset = Math.min(1, o.dev / OFFSET_CAP) * strength;
  }

  const recentHits = recent.get(f.face) || 0;
  const recency = recentHits > 0 ? Math.min(1, recentHits / 3) : 0;

  const parts = {
    unseen: unseen ? W.unseen : 0,
    miss: W.miss * miss,
    thin: W.thin * thin,
    offset: W.offset * offset,
    recent: -W.recent * recency,
  };
  const score = parts.unseen + parts.miss + parts.thin + parts.offset + parts.recent;

  // 出題の説明に使う「なぜ弱いと見たか」。いちばん効いた項を選ぶだけ
  let reason = 'まんべんなく';
  if (unseen) reason = 'まだ一度も打っていない';
  else if (parts.miss >= parts.thin && parts.miss >= parts.offset) reason = 'ミスが多い';
  else if (parts.offset >= parts.thin) reason = `${f.thumb === 'left' ? '左' : '右'}親指のズレが大きい`;
  else reason = '打ち込みが足りない';

  return { ...f, hits, misses, unseen, score, parts, reason };
}

/**
 * 弱い面を弱い順に返す。
 *
 * @param {object} stats storage.js の loadStats() が返す形。空・undefined でも動く
 * @param {object} [options]
 *   - recentFaces: string[] | {face:number}  直近に出した面（少し下げる）
 *   - limit: number                          先頭から何件返すか
 *   - includeUnseen: boolean = true          未踏破の面を含めるか
 *   - seenOnly: boolean = false              一度でも打った面だけに絞る（速度稽古用）
 *   - exclude: string[]                      外す面（'KeyH:left' の形）
 * @returns {Array<{face,charCode,thumb,kana,hand,shiftKind,hits,misses,unseen,score,parts,reason}>}
 *   parts は重み付け後の内訳（unseen/miss/thin/offset/recent）。なぜ弱いと見たかを画面に出せる
 */
export function weakFaces(stats, options = {}) {
  const s = readStats(stats);
  const recent = toCountMap(options.recentFaces);
  const exclude = new Set(Array.isArray(options.exclude) ? options.exclude : []);

  let list = DRILL_FACES.filter((f) => !exclude.has(f.face)).map((f) => scoreFace(f, s, recent));
  if (options.includeUnseen === false || options.seenOnly) list = list.filter((f) => !f.unseen);

  // 同点は教程順で切る。統計が空のとき全面が同点になるので、ここが実質の出題順になる
  list.sort((a, b) => b.score - a.score || a.teachOrder - b.teachOrder);

  const limit = numOf(options.limit);
  return limit > 0 ? list.slice(0, limit) : list;
}

// ---------------------------------------------------------------- 出題の型

/**
 * 出題の型。
 *
 * share は「狙った面が文全体に占める割合」の下限と上限。
 * 弱点だけで埋めた文は、打てる人にも打てない。keybr が新しいキーを
 * 少しずつ混ぜるのと同じ理屈で、3〜5割に留めて残りは打てる面で支える。
 * 折れずに続けられることの方が、一本あたりの密度より効く。
 */
export const DRILL_MODES = Object.freeze({
  weak: Object.freeze({
    id: 'weak',
    name: '弱点集中',
    note: '打てていない面・ミスの多い面を厚めに混ぜる。',
    focus: 8, // 一本で狙う面の数。多すぎると一つも身につかない
    share: [0.35, 0.5],
    pseudo: true, // 語彙で足りなければ擬似語を作ってよい
  }),
  review: Object.freeze({
    id: 'review',
    name: '総ざらい',
    note: '単独・同側・交差を散らして、配列全体を一周する。',
    focus: 15,
    share: [0.3, 0.5],
    spread: true, // 面の種類と左右を散らす
    pseudo: true,
  }),
  speed: Object.freeze({
    id: 'speed',
    name: '速度',
    note: '打ち慣れた面だけで組む。考えずに指を回す一本。',
    focus: 14,
    share: [0.3, 0.6],
    strong: true, // 弱い面ではなく強い面を狙う
    pseudo: false, // 速度稽古で擬似語を出すと、意味の切れ目で指が止まる
  }),
});

// ---------------------------------------------------------------- 語彙表
//
// なぜ語彙表を持つか。
//
// ランダムなかなの羅列は指の訓練にならない。日本語の運指は「語のかたまり」で
// 流れるので、実在の語を打って初めて実戦の動きになる。keybr が擬似単語を
// 使うのも、乱数列ではなく **言語らしい並び** を作るためで、目的は同じ。
// だからここでは実在語を第一に置き、語彙で狙えない面（「ぢ」「ぅ」「ゔ」など、
// 語の数がそもそも少ない面）だけを擬似語で補う。
//
// 全ての語は assets/data/nicola.js のかなだけで書いてある。カタカナ語も
// ひらがなに開いてある（配列表にカタカナは無く、打てない字は出せない）。
// 助詞を含む短い句をいくつか混ぜてあるのは、「を」「へ」のように
// 単語の中にはあまり出ないが実戦では毎行出るかなを、自然な形で出すため。

const RAW_VOCAB = [
  // あいさつ・定型
  'おはよう', 'こんにちは', 'こんばんは', 'ありがとう', 'おねがいします', 'ごめんなさい',
  'さようなら', 'いただきます', 'ごちそうさま', 'おつかれさま', 'よろしく', 'しつれいします',
  // 自然
  'あさひ', 'ゆうひ', 'そら', 'くも', 'あめ', 'ゆき', 'かぜ', 'つき', 'ほし', 'うみ',
  'やま', 'かわ', 'もり', 'はな', 'くさ', 'みず', 'ひかり', 'かげ', 'こおり', 'なみ',
  'いし', 'つち', 'さかな', 'とり', 'いぬ', 'ねこ', 'うま', 'うし', 'むし', 'さくら',
  'たけ', 'うめ', 'きのこ', 'みずうみ', 'たいよう', 'ほのお', 'かみなり', 'にじ', 'きり', 'つゆ',
  // 食べ物
  'やさい', 'くだもの', 'りんご', 'みかん', 'ぶどう', 'いちご', 'すいか', 'まめ', 'こめ', 'ぱん',
  'ごはん', 'みそしる', 'たまご', 'にく', 'しお', 'さとう', 'しょうゆ', 'あぶら', 'おちゃ', 'こーひー',
  'ぎゅうにゅう', 'おかし', 'けーき', 'あじ', 'からい', 'あまい', 'にがい',
  // 暮らし
  'いえ', 'へや', 'まど', 'とびら', 'つくえ', 'いす', 'ほん', 'ざっし', 'しんぶん', 'てがみ',
  'えんぴつ', 'けしごむ', 'かばん', 'さいふ', 'とけい', 'めがね', 'くつ', 'ふく', 'ぼうし', 'かさ',
  'かぎ', 'でんわ', 'てれび', 'かめら', 'がめん', 'でんき', 'すいどう', 'だいどころ', 'にわ', 'みち',
  'はし', 'えき', 'でんしゃ', 'じてんしゃ', 'くるま', 'ひこうき', 'ふね', 'まち', 'むら', 'こうえん',
  'がっこう', 'びょういん', 'ぎんこう', 'としょかん', 'みせ', 'いちば', 'かいしゃ', 'ゆうびん', 'へや',
  // 仕事
  'しごと', 'かいぎ', 'しりょう', 'ていあん', 'けんとう', 'ほうこく', 'そうだん', 'れんらく',
  'かくにん', 'しめきり', 'うちあわせ', 'ぎじろく', 'みつもり', 'けいかく', 'もくひょう', 'よさん',
  'きろく', 'ぶんしょ', 'めーる', 'でーた', 'ふぁいる', 'ぺーじ', 'ちぇっく', 'すけじゅーる',
  'ちーむ', 'りーだー', 'めんばー', 'ぷろじぇくと', 'さーびす', 'ぱそこん', 'きーぼーど',
  // 動詞
  'あるく', 'はしる', 'たべる', 'のむ', 'みる', 'きく', 'はなす', 'かんがえる', 'おぼえる',
  'わすれる', 'つくる', 'こわす', 'はじめる', 'おわる', 'つづける', 'まなぶ', 'おしえる',
  'かく', 'よむ', 'うつ', 'まつ', 'さがす', 'みつける', 'つかう', 'もつ', 'とる', 'かえる',
  'できる', 'わかる', 'しる', 'ねむる', 'おきる', 'あそぶ', 'はたらく', 'やすむ', 'いそぐ',
  'とまる', 'うごく', 'ひらく', 'とじる', 'のぼる', 'おりる', 'かぞえる', 'くらべる', 'しらべる',
  'ならぶ', 'つたえる', 'えらぶ', 'はこぶ', 'ながれる', 'ひろう', 'すすむ', 'もどる', 'あつめる',
  // 形容・副詞
  'たのしい', 'うれしい', 'かなしい', 'さびしい', 'いそがしい', 'やさしい', 'むずかしい',
  'あたらしい', 'ふるい', 'おおきい', 'ちいさい', 'ながい', 'みじかい', 'たかい', 'ひくい',
  'あつい', 'さむい', 'あかるい', 'くらい', 'しずか', 'にぎやか', 'きれい', 'ゆっくり',
  'はやく', 'もっと', 'きっと', 'ずっと', 'ちょっと', 'たぶん', 'いつも', 'ときどき',
  'ほとんど', 'すこし', 'たくさん', 'やはり', 'たしかに', 'なるべく',
  // こそあど・接続
  'これ', 'それ', 'あれ', 'どれ', 'ここ', 'そこ', 'あそこ', 'どこ', 'そして', 'しかし',
  'けれども', 'だから', 'つまり', 'たとえば', 'それから', 'ところで', 'または',
  // 濁音・半濁音を厚く含む語
  'ばしょ', 'ぶんしょう', 'べんきょう', 'ぱらぱら', 'ぴかぴか', 'ぷかぷか', 'ぺこぺこ', 'ぽかぽか',
  'せんぱい', 'しんぱい', 'いっぱい', 'たんぽぽ', 'かんぱい', 'ぴあの', 'ぱんや', 'でぱーと',
  'ぷれぜんと', 'ぽけっと', 'ぴったり', 'ぞう', 'かぞく', 'なぞ', 'ぞうきん', 'ざぶとん',
  'げんき', 'ごはん', 'ぐあい', 'ぎんいろ', 'だいこん', 'どうぐ', 'でぐち', 'ばんごう',
  // 「ぢ」「づ」「ゔ」「ー」「小書き」など、語の数が少ない面
  'つづき', 'きづく', 'かたづける', 'みかづき', 'こづつみ', 'ちぢむ', 'はなぢ', 'つづみ',
  'ゔぁいおりん', 'ふぁん', 'ふぃるむ', 'うぇぶ', 'じぇっと', 'てぃっしゅ', 'ぱーてぃー',
  'ふぉーく', 'しぇふ', 'でぃすく', 'のーと', 'てーぶる', 'かーてん', 'すぽーつ', 'にゅーす',
  'せーたー', 'かれー', 'ぼーる', 'ぷーる',
  // 拗音・促音
  'きょうしつ', 'しゅくだい', 'じゅぎょう', 'しゃしん', 'ちょきん', 'りょこう', 'にゅうがく',
  'びょうき', 'しゅっぱつ', 'ひゃっかてん', 'しゅみ', 'ちゃいろ', 'きゃく', 'ぎゅうにく',
  'いっしょ', 'まっすぐ', 'ゆっくり', 'はっけん', 'けっか', 'さっき',
  // 地名
  'とうきょう', 'おおさか', 'なごや', 'さっぽろ', 'ふくおか', 'きょうと', 'よこはま', 'こうべ',
  'ひろしま', 'せんだい', 'にいがた', 'かなざわ', 'ながさき', 'くまもと', 'おきなわ',
  'ほっかいどう', 'あおもり', 'やまがた', 'しずおか', 'わかやま', 'とっとり', 'おかやま',
  'とくしま', 'えひめ', 'かごしま', 'みやざき',
  // 助詞を含む短い句。単語だけだと「を」「へ」「ゐ的な脇役」が出ない
  'ほんをよむ', 'てがみをかく', 'みずをのむ', 'ゆめをみる', 'てをあげる', 'なまえをよぶ',
  'えきへむかう', 'いえへかえる', 'まどをあける', 'とりがとぶ', 'かぜがふく', 'あめがふる',
  'ひがのぼる', 'つきがでる', 'はながさく', 'ゆきがつもる', 'こえをきく', 'みちをあるく',
];

// 打てない字が一字でも混ざった語は、その課題を永久にクリア不能にする。
// 語彙表は手で書くものなので、書き間違いは必ず起きるという前提で、
// 読み込みの時点で落とす（落ちたことはテストが検出する）。
export const VOCAB = Object.freeze(
  [...new Set(RAW_VOCAB)].filter((w) => [...w].every((ch) => TYPABLE.has(ch) && !PUNCT.has(ch)))
);

/** かな → その字を含む語。狙った面から語を引くための索引 */
const VOCAB_INDEX = new Map();
for (const w of VOCAB) {
  for (const ch of new Set(w)) {
    if (!VOCAB_INDEX.has(ch)) VOCAB_INDEX.set(ch, []);
    VOCAB_INDEX.get(ch).push(w);
  }
}

// ---------------------------------------------------------------- 擬似語
//
// 語彙で狙えない面のための逃げ道。ただの乱数列にはしない。
// 日本語として読める並びでなければ運指の訓練にならないので、拍（モーラ）を
// 単位に組み立て、次の四つだけは必ず守る。破ると読めない字列になって、
// 打ち手が「打ち間違えたのか、そもそも変な字なのか」を切り分けられなくなる。
//
//   1. 拗音「ゃゅょ」は い段のかなの直後にしか置かない
//   2. 促音「っ」は語頭・語尾に置かず、子音で始まる拍の前にだけ置く
//   3. 小書きの「ぁぃぅぇぉ」は、実際に外来語で使われる相棒の直後にだけ置く
//   4. 長音「ー」は拍の直後にだけ置き、「っ」「ー」の後には続けない
//
// 同じかなが二つ続くのも避ける。指が同じ場所を連打するだけになり、
// 移動の訓練にならないため。

/** 拗音を付けられる い段のかな */
const YOUON_BASE = ['き', 'し', 'ち', 'に', 'ひ', 'み', 'り', 'ぎ', 'じ', 'ぢ', 'び', 'ぴ'];
const SMALL_YO = ['ゃ', 'ゅ', 'ょ'];
/** 小書き母音と、その直前に来られるかな（外来語の実例に合わせた） */
const SMALL_VOWEL_BASE = {
  ぁ: ['ふ', 'ゔ'],
  ぃ: ['て', 'で', 'ふ', 'ゔ'],
  ぅ: ['と', 'ど', 'ゔ'],
  ぇ: ['ち', 'し', 'じ', 'ふ', 'ゔ', 'う'],
  ぉ: ['ふ', 'う', 'ゔ'],
};
const SMALL = new Set([...SMALL_YO, ...Object.keys(SMALL_VOWEL_BASE), 'っ', 'ー']);
/** 母音とその仲間。促音の後ろに置けない（「っあ」は日本語にならない） */
const VOWEL_LIKE = new Set(['あ', 'い', 'う', 'え', 'お', 'ん', 'ー', 'っ', 'を']);

/**
 * ホームポジションの単独打鍵。統計が空の人でも擬似語の接着に使えるよう、
 * 常に使ってよいかなとして持っておく。ここが無いと、狙った面が
 * 小書き一字だけのときに語を組み立てられない。lessons.js の basic-1/2 と同じ十字。
 */
const BASE_KANA = ['う', 'し', 'て', 'け', 'せ', 'は', 'と', 'き', 'い', 'ん'];

const isBaseKana = (ch) => TYPABLE.has(ch) && !SMALL.has(ch) && !PUNCT.has(ch);

/** 使ってよいかなの集合から、組み立てに使える拍の一覧を作る */
function morasFrom(pool) {
  const moras = [];
  for (const ch of pool) if (isBaseKana(ch)) moras.push(ch);
  for (const b of YOUON_BASE) {
    if (!pool.has(b)) continue;
    for (const y of SMALL_YO) if (pool.has(y)) moras.push(b + y);
  }
  for (const [small, bases] of Object.entries(SMALL_VOWEL_BASE)) {
    if (!pool.has(small)) continue;
    for (const b of bases) if (pool.has(b)) moras.push(b + small);
  }
  return moras;
}

const clamp01 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(0.999999, Math.max(0, v)) : 0);
const pick = (rng, list) => list[Math.floor(clamp01(rng()) * list.length)];

/** 先頭に置けない拍（「ん」始まり、長音・促音始まり） */
const canStart = (m) => !'んーっ'.includes(m[0]);

/**
 * 擬似語を一つ作る。must を必ず含む。
 * @param {function} rng
 * @param {string|null} must 必ず含めるかな
 * @param {Set<string>} pool 使ってよいかな
 */
function pseudoWord(rng, must, pool) {
  const usable = new Set(pool);
  for (const ch of BASE_KANA) usable.add(ch); // 接着用。これが無いと組めない面がある
  if (must) usable.add(must);

  // 小書きは相棒が無いと置けない。相棒が手持ちに無いままだと、その面は
  // どうやっても出題に現れない（＝弱点として検出したのに一生練習できない）。
  // 「打てる面だけで埋める」より「狙った面が必ず出る」を優先して、相棒を一つだけ足す
  if (must && SMALL_YO.includes(must) && !YOUON_BASE.some((b) => usable.has(b))) usable.add('し');
  if (must && SMALL_VOWEL_BASE[must] && !SMALL_VOWEL_BASE[must].some((b) => usable.has(b))) {
    usable.add(SMALL_VOWEL_BASE[must][0]);
  }

  const moras = morasFrom(usable);
  if (!moras.length) return must && !SMALL.has(must) ? must : BASE_KANA[0];

  const build = () => {
    const n = 2 + Math.floor(clamp01(rng()) * 2); // 2〜3拍
    const out = [];
    for (let i = 0; i < n; i++) {
      let m = pick(rng, moras);
      for (let t = 0; t < 6 && ((i === 0 && !canStart(m)) || (out.length && out[out.length - 1] === m)); t++) {
        m = pick(rng, moras);
      }
      if (i === 0 && !canStart(m)) continue;
      out.push(m);
    }
    return out;
  };

  let out = build();
  if (!out.length) out = [pick(rng, moras.filter(canStart) || moras) || BASE_KANA[0]];

  if (must === 'っ') {
    // 促音は子音で始まる拍の前にだけ入る。入れ場所が無ければ拍を足す
    let at = -1;
    for (let i = 1; i < out.length; i++) if (!VOWEL_LIKE.has(out[i][0])) { at = i; break; }
    if (at < 0) {
      const cons = moras.filter((m) => !VOWEL_LIKE.has(m[0]));
      if (cons.length) { out.push(pick(rng, cons)); at = out.length - 1; }
    }
    if (at > 0) out.splice(at, 0, 'っ');
  } else if (must === 'ー') {
    // 長音は拍の直後。「っ」「ー」の直後には置かない
    const at = out.findIndex((m) => !'っー'.includes(m[m.length - 1]));
    out.splice((at < 0 ? 0 : at) + 1, 0, 'ー');
  } else if (must) {
    const holders = moras.filter((m) => m.includes(must));
    if (holders.length) {
      const m = pick(rng, holders);
      const at = canStart(m) ? Math.floor(clamp01(rng()) * out.length) : Math.max(1, Math.floor(clamp01(rng()) * out.length));
      out[Math.min(out.length - 1, at)] = m;
    } else if (!SMALL.has(must)) {
      out[Math.min(out.length - 1, Math.floor(clamp01(rng()) * out.length))] = must;
    }
  }

  // 同じかなの連打をならす。指が同じ場所を叩くだけで、移動の訓練にならない。
  // 重なりを削っても must が消えることは無い（削るのは二つ目以降だけ）
  const chars = [...out.join('')];
  const fixed = [];
  for (const ch of chars) {
    if (fixed.length && fixed[fixed.length - 1] === ch) continue;
    fixed.push(ch);
  }
  // 一字だけの断片は語に見えない。別の拍を足して最低二字にする。
  // 先頭に立てない字（「ん」「っ」「ー」）が残ったときは前に足す
  for (let t = 0; t < 4 && fixed.length < 2; t++) {
    const m = pick(rng, moras.filter((x) => x[0] !== fixed[0])) || pick(rng, moras);
    if (!m) break;
    if (canStart(fixed[0])) fixed.push(...[...m].filter((ch) => ch !== fixed[fixed.length - 1]));
    else fixed.unshift(...[...m].filter((ch) => ch !== fixed[0]));
  }

  const word = fixed.join('');
  return word || (must && !SMALL.has(must) ? must : BASE_KANA[0]);
}

// ---------------------------------------------------------------- 出題を組み立てる

const DEFAULT_MIN = 40;
const DEFAULT_MAX = 80;

function normalizeOptions(options) {
  const o = plainObj(options);
  const rng = typeof o.rng === 'function' ? o.rng : Math.random;
  const mode = DRILL_MODES[o.mode] ? DRILL_MODES[o.mode] : DRILL_MODES.weak;
  let min = numOf(o.minLength) || DEFAULT_MIN;
  let max = numOf(o.maxLength) || DEFAULT_MAX;
  min = Math.max(8, Math.min(min, 400));
  max = Math.max(min + 4, Math.min(max, 400));
  const focus = numOf(o.focus) || mode.focus;
  return { rng, mode, min, max, focus, recentFaces: o.recentFaces };
}

/** 面の種類と左右を散らして取る。総ざらいで交差シフトばかりにならないように */
function spreadPick(ranked, count) {
  const buckets = new Map();
  for (const f of ranked) {
    const key = `${f.shiftKind || 'none'}:${f.hand}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(f);
  }
  const lists = [...buckets.values()];
  const out = [];
  for (let i = 0; out.length < count && lists.some((l) => l.length > i); i++) {
    for (const l of lists) {
      if (out.length >= count) break;
      if (l[i]) out.push(l[i]);
    }
  }
  return out;
}

function pickTargets(stats, opts) {
  const { mode, focus } = opts;
  if (mode.strong) {
    // 速度稽古は「打ちやすい面」を狙う。一度も打っていない面は当然使えないので seenOnly。
    // ここで単に弱い順を逆さにしないこと。全ての面を同じだけ打っている人は
    // 弱さが同点になり、逆順にすると同点の並び（教程順）まで引っくり返って
    // いちばん難しい交差シフトが「打ちやすい面」として出てくる。
    // 弱さの昇順・教程順の昇順で取る。
    const seen = weakFaces(stats, { seenOnly: true, recentFaces: opts.recentFaces });
    const strong = seen
      .slice()
      .sort((a, b) => a.score - b.score || a.teachOrder - b.teachOrder)
      .slice(0, focus)
      .map((f) => ({ ...f, reason: '打ち慣れている' }));
    if (strong.length >= 6) return strong;
    // 統計がほとんど無い人には、教程のいちばん最初＝ホームポジションを渡す。
    // 「まだ何も分からないが速く打ちたい」に対して、これが唯一まともな答え
    const base = DRILL_FACES.filter((f) => f.thumb === 'none').slice(0, focus);
    return base.map((f) => ({ ...f, hits: 0, misses: 0, unseen: true, score: 0, reason: 'まず基本の面から' }));
  }
  const ranked = weakFaces(stats, { recentFaces: opts.recentFaces });
  return mode.spread ? spreadPick(ranked, focus) : ranked.slice(0, focus);
}

/** 埋めに使ってよいかな。「もう打てる」と言える面のかな＋基本の十字 */
function knownKanaOf(stats, targetKana) {
  const s = readStats(stats);
  const out = new Set(BASE_KANA);
  for (const f of DRILL_FACES) {
    if (numOf(s.faceHits[f.face]) >= FLUENT_HITS) out.add(f.kana);
  }
  for (const k of targetKana) out.delete(k); // 埋めの語で狙いの面を水増ししない
  return out;
}

/** 文字列のうち、狙った面のかなが占める割合 */
function shareOf(text, targetKana) {
  if (!text.length) return 0;
  let n = 0;
  for (const ch of text) if (targetKana.has(ch)) n++;
  return n / [...text].length;
}

/**
 * 練習文を一本作る。
 *
 * @param {object} stats storage.js の loadStats() が返す形。空でも動く
 * @param {object} [options]
 *   - mode: 'weak' | 'review' | 'speed'   既定 'weak'
 *   - rng: () => number                   既定 Math.random。**テストのために必ず注入できる**
 *   - minLength / maxLength: number       既定 40 / 80
 *   - focus: number                       狙う面の数（型の既定を上書き）
 *   - recentFaces: string[] | {face:number}  直近に出した面。続けて同じ弱点を出さないため
 * @returns {{id,mode,title,note,text,length,targets,targetShare,faces}}
 */
export function makeDrill(stats, options = {}) {
  const opts = normalizeOptions(options);
  const { rng, mode, min, max } = opts;

  const targets = pickTargets(stats, opts);
  const targetKana = new Set(targets.map((t) => t.kana));
  const known = knownKanaOf(stats, targetKana);

  // 語に使ってよいかな。狙い＋打てる面。ここから外へ出ないので、
  // 生成文の全てのかなが打てることが構造的に保証される
  const allowed = new Set([...known, ...targetKana]);
  const pool = new Set([...allowed].filter((ch) => !PUNCT.has(ch)));

  const fits = (w) => [...w].every((ch) => allowed.has(ch));
  const fillerWords = VOCAB.filter((w) => [...w].every((ch) => known.has(ch)));

  // 区切り。句読点も面なので、狙いに入っていれば区切りとして自然に混ぜる。
  // 「。」は必ず末尾に付くので、ここには入れない。
  // 狙いに入っている区切りは二重に積んで出やすくする（重み付けのつもり）
  const seps = ['、'];
  for (const t of targets) if (PUNCT.has(t.kana) && t.kana !== '。') seps.push(t.kana);

  let text = '';
  const used = new Set(); // 一本の中で同じ語を何度も出さないため
  const room = () => max - text.length - 1; // 終端の「。」の分を残す
  const add = (word) => {
    if (!word) return false;
    const sep = text ? pick(rng, seps) : '';
    if (sep.length + word.length > room()) return false;
    text += sep + word;
    used.add(word);
    return true;
  };

  /** その語のうち、狙った面のかなが占める割合 */
  const densityOf = (w) => {
    let n = 0;
    for (const ch of w) if (targetKana.has(ch)) n++;
    return n / [...w].length;
  };

  /**
   * 面を一つ含む断片。実在語を優先し、無ければ擬似語。
   * @param {boolean} dense 割合が足りていないときは true。密度の高い断片を選ぶ
   */
  const pieceFor = (face, uncovered, dense = false) => {
    if (PUNCT.has(face.kana)) return null; // 句読点は区切りとして入る
    const all = (VOCAB_INDEX.get(face.kana) || []).filter(fits);
    // まだ出していない語を優先する。同じ語が一本の中で何度も出ると、
    // 適応出題なのに固定課題と同じ「暗記」が始まってしまう
    const fresh = all.filter((w) => !used.has(w));
    const cands = fresh.length ? fresh : all;
    if (cands.length) {
      // 語の選び方。二つの物差しで採点する。
      //   (1) その一語でまだ出していない狙いを何個拾えるか … 40〜80字に入る面の数が増える
      //   (2) 狙いのかなの密度 … これを見ないと、狙い一字＋関係ない四字の語ばかりになり、
      //       狙いの割合が3割に届かない（長さに上限があるので、薄い語は席を食うだけ）
      // 満点の一語だけに絞ると毎回同じ語が出るので、僅差はまとめて候補に残す。
      const scoreOfWord = (w) => {
        let cover = 0;
        for (const ch of new Set(w)) if (uncovered.has(ch)) cover++;
        return dense ? densityOf(w) * 3 + cover * 0.5 : cover * 2 + densityOf(w);
      };
      const scored = cands.map((w) => [w, scoreOfWord(w)]);
      const best = Math.max(...scored.map((x) => x[1]));
      const list = scored.filter((x) => x[1] >= best - 0.25).map((x) => x[0]);
      const word = pick(rng, list);
      // 薄い語しか無いのに割合が足りていないなら、擬似語の方が目的に合う。
      // 「ゔ」のように実在語が一つしか無い面では、その語を繰り返すより
      // その面を含む短い拍を作った方が、狙いが濃くなり飽きも来ない
      if (!dense || densityOf(word) >= 0.34 || !mode.pseudo) return word;
    }
    return mode.pseudo ? pseudoWord(rng, face.kana, pool) : null;
  };

  // ---- 一巡目。狙った面を必ず一度は出す。
  // 出題の意味はここで決まるので、長さの調整より先にやる
  const uncovered = new Set(targetKana);
  for (const t of targets) {
    if (text.includes(t.kana)) { uncovered.delete(t.kana); continue; }
    const piece = pieceFor(t, uncovered);
    if (!piece) continue;
    if (!add(piece)) break;
    for (const ch of piece) uncovered.delete(ch);
  }

  // ---- 二巡目。長さを満たすまで足す。狙いの割合を見て、足す種類を切り替える
  const weakWord = (dense = false) => {
    const pool2 = targets.filter((t) => !PUNCT.has(t.kana));
    if (!pool2.length) return null;
    // 弱い順に重みを付ける。先頭ばかりでは他の狙いが出ない
    const i = Math.floor(clamp01(rng()) * clamp01(rng()) * pool2.length);
    return pieceFor(pool2[Math.min(pool2.length - 1, i)], uncovered, dense);
  };
  const fillerWord = () => {
    const fresh = fillerWords.filter((w) => !used.has(w));
    const list = fresh.length ? fresh : fillerWords;
    if (list.length) return pick(rng, list);
    return mode.pseudo ? pseudoWord(rng, null, new Set([...pool].filter((ch) => known.has(ch)))) : null;
  };

  for (let guard = 0; text.length + 1 < min && guard < 200; guard++) {
    const share = shareOf(text + '。', targetKana);
    const wantWeak = share < mode.share[0];
    let word = wantWeak ? weakWord() : fillerWord();
    if (!word || !add(word)) {
      // 入らなかったら短い語で詰める。長さは割合より優先する
      // （短すぎる課題は成立しないが、割合が少しずれた課題は成立する）
      const shortList = (fillerWords.length ? fillerWords : VOCAB.filter(fits))
        .filter((w) => w.length + 1 <= room())
        .sort((a, b) => a.length - b.length);
      if (!shortList.length || !add(shortList[0])) break;
      word = shortList[0];
    }
    for (const ch of word) uncovered.delete(ch);
  }

  // ---- 三巡目。長さは足りたが狙いが薄いとき、上限まで狙いの語を足す。
  // 二巡目は長さで抜けるので、そこで薄いまま終わった一本をここで濃くする
  for (let guard = 0; guard < 60; guard++) {
    if (shareOf(text + '。', targetKana) >= mode.share[0]) break;
    const w = weakWord(true);
    if (!w || !add(w)) break;
    for (const ch of w) uncovered.delete(ch);
  }

  // ---- 四巡目。狙いが濃すぎたら、打てる面で薄める。難しすぎて折れるのを防ぐ
  for (let guard = 0; guard < 60; guard++) {
    if (shareOf(text + '。', targetKana) <= mode.share[1]) break;
    const w = fillerWords.filter((x) => x.length + 1 <= room());
    if (!w.length) break; // 埋めに使える語が無い（初心者はこうなる。割合は諦める）
    if (!add(pick(rng, w))) break;
  }

  text = text.replace(/[、．・]+$/u, '') + '。';

  return {
    // 課題 id。storage.js の cleared / history がこの id で数える。
    // 一本ごとに違う id にすると履歴が散らばるので、型ごとに固定する
    id: `drill-${mode.id}`,
    mode: mode.id,
    title: `適応出題 · ${mode.name}`,
    note: `${mode.note}${targets.length ? `いま狙っているのは ${targets.slice(0, 3).map((t) => describeFace(t)).join('、')} など。` : ''}`,
    text,
    length: [...text].length,
    targets: targets.map((t) => ({
      face: t.face, kana: t.kana, charCode: t.charCode, thumb: t.thumb,
      shiftKind: t.shiftKind, hand: t.hand, hits: t.hits, misses: t.misses, reason: t.reason,
    })),
    targetShare: shareOf(text, targetKana),
    faces: faceCountsOfText(text),
  };
}
