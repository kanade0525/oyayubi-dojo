// 覚える（親指シフト入門）のレッスン。
//
// このファイルは何か
//   配列表（assets/data/nicola.js）と手で書いた語の表から、キーを少しずつ覚えるレッスンを組み立てる。
//   一つのレッスンで覚える新しいかなは 4〜6 字。レッスンは 4 段階で進む:
//     1. 導入       … 新しいかなを一字ずつ見せ、3 回続けて正しく打てたら次の字へ。点数は付けない
//     2. 組み合わせ … 2 字の組（新しいかなどうし、新しいかなと前に覚えたかな）を並べて打つ
//     3. 語         … そのレッスンまでに覚えたかなだけで書ける、実在する短い語を打つ
//     4. 確認       … 組み合わせと語を混ぜた 40 字ほどを、キーボードの図と案内なしで打つ。
//                     まちがえた字が PASS_MAX_MISSES 以内なら合格で、そのレッスンを終えたことになる
//   どの段階でも時間・速さは測らない。
//
// 教え方の出どころ（README の「出典」にも書いた）
//   - 新しいキーは点数を付けない導入で指の置き方を示してから打たせる（TypingClub の Typing Jungle）
//   - 単独の字の繰り返しではなく、前のキーとの組と実在の語の中で練習させる（keybr / keystrike の整理。
//     Crump & Logan：打鍵は語の単位で制御される）
//   - 合否は速さではなく誤りで見る。60 字で誤り 5 以下なら案内を外す（美佳のタイプトレーナ）、
//     正確さ 95% 以上（keybr）。確認の 40 字で 2 字まで、はその間を取った
//   - 正確にゆっくり打つ。速く打って間違えると間違える癖が付く（shio 氏「親指シフト習得の掟」）
//
// 覚える順（なぜ段ごとか）
//   単独打鍵を全段終えてから親指に進むと、よく出るかな（の・な・が・に・お）が後回しになる。
//   段ごとに 単独 → 同じ側の親指 と進むと、練習文 83 本のかなのうち、ホームと上段だけで約 8 割が打てる。
//   単独打鍵は TypingClub と同じく左右の同じ指を組にして入れる。そうすると最初のレッスンから語が作れる。
//   濁音は一字ずつではなく «清音と同じキーを、反対側の親指と同時に» という決まりで教える。
//   ぱ行（半濁音）だけは決まりに合わない（ぽ は ほ のキーではなく L）ので、例外としてはっきり示す。
//
// 前は «見る・それだけ・混ぜる・語» の 4 段階を全レッスンに当てはめ、中身の無い段階を
// でたらめな列で埋めていた。レッスン 1 では 4 段階が全部 «うしてけせ» の並べ替えになっていた。
// いまは語を手で書き、どのレッスンにも語があることをテスト（tools/drill.test.mjs）が確かめる。

import { NICOLA } from '../data/nicola.js';

/** 確認の段で、まちがえてよい字の数（これを越えると合格にしない） */
export const PASS_MAX_MISSES = 2;

/**
 * レッスンの表。[id, 題, 新しいかな, 親指（同じかなが左右どちらでも出るときの選び方）, 語（空白区切り）]
 * 語は «そのレッスンまでに覚えたかなだけで書ける、実在する短い語»。新しいかなを一つは含める
 */
const PLAN = [
  {
    id: 'home', name: 'ホームの段', note: '指を置いたまま打てる段。親指なしの 10 字と、同じ側の親指と同時の 10 字。',
    lessons: [
      ['l-home-1', 'ホーム 人差し指・中指・薬指', 'けとてきしい', null, 'とき いし きし しき いき てき いと とし けしき'],
      ['l-home-2', 'ホーム 小指と内側の人差し指', 'うんせは', null, 'うし はし せき てん きん はい せんせい しけん'],
      ['l-home-3', 'ホーム 左手 × 左親指', 'あなもをゅ', 'left', 'あし あき もし なし あいて いもうと あんない きゅう'],
      ['l-home-4', 'ホーム 右手 × 右親指', 'みおのょっ', 'right', 'うみ おと きのう みなと きょう いっしょ きって おもい'],
    ],
  },
  {
    id: 'top', name: '上段', note: 'ホームから上へ指を伸ばす段。ホームと上段で、練習文のかなの約 8 割が打てる。',
    lessons: [
      ['l-top-1', '上段 左手', 'かたこさ。', null, 'かさ さか たこ たかい さかな ことし あした こいし'],
      ['l-top-2', '上段 右手', 'らちくつ、', null, 'くち うち つき ちから らく くつ ちかく くらい'],
      ['l-top-3', '上段 左手 × 左親指', 'えりれゃぁ', 'left', 'えき これ かれ りか しゃしん きゃく れんらく えいきょう'],
      ['l-top-4', '上段 右手 × 右親指', 'よにるまぇ', 'right', 'よる にく まる いま くるま にもつ まえ はる'],
    ],
  },
  {
    id: 'daku', name: 'ホームと上段の濁音・半濁音', note: '反対側の親指と同時に押す（交差シフト）。濁音は清音と同じキー。半濁音だけは別のキー。',
    lessons: [
      ['l-daku-1', 'ホームの濁音（左手）', 'じでげぜゔ', 'right', 'でんき じかん げんき かぜ じしん げんかん'],
      ['l-daku-2', 'ホームの濁音・半濁音（右手）', 'ばどぎぽ', 'left', 'ばしょ どこ ぎんこう さんぽ かばん まど'],
      ['l-daku-3', '上段の濁音（左手）', 'がだござ', 'right', 'がっこう だいがく たまご ざいこ かがみ ござ'],
      ['l-daku-4', '上段の濁音・半濁音（右手）', 'ぢぐづぱぴ', 'left', 'ぐあい はなぢ つづく えんぴつ かんぱい ちぐはぐ'],
    ],
  },
  {
    id: 'bottom', name: '下段', note: 'ホームから下へ指を曲げる段。濁音・半濁音もここで覚えて、全 86 字が揃う。',
    lessons: [
      ['l-bottom-1', '下段 左手', 'ひすふへ．', null, 'ひと すし ふく ひかり すき へた ふたつ'],
      ['l-bottom-2', '下段 右手', 'めそねほ・', null, 'あめ そら ねこ ほし ほん めがね それ おそい'],
      ['l-bottom-3', '下段 左手 × 左親指', 'ろやーぃぅ', 'left', 'いろ ろく へや やま こーひー ろうそく'],
      ['l-bottom-4', '下段 右手 × 右親指', 'ぬゆむわぉ', 'right', 'いぬ ゆき むし わたし ゆめ ぬの'],
      ['l-bottom-5', '下段の濁音（左手）', 'びずぶべ', 'right', 'えび みず ぶどう かべ ずっと べんきょう'],
      ['l-bottom-6', '下段の濁音・半濁音（右手）', 'ぷぞぺぼ', 'left', 'ぷーる かぞく ぺん ぼうし ぞう ぼく'],
    ],
  },
];

export const PHASES = Object.freeze([
  { id: 'intro', name: '導入' },
  { id: 'pairs', name: '組み合わせ' },
  { id: 'words', name: '語' },
  { id: 'check', name: '確認' },
]);

/** どの指で押すか。ホームの段で人差し指が受け持つ内側の列（G・H と上下）は «内へ» と添える */
const FINGER = {
  KeyQ: '左手の小指', KeyA: '左手の小指', KeyZ: '左手の小指',
  KeyW: '左手の薬指', KeyS: '左手の薬指', KeyX: '左手の薬指',
  KeyE: '左手の中指', KeyD: '左手の中指', KeyC: '左手の中指',
  KeyR: '左手の人差し指', KeyF: '左手の人差し指', KeyV: '左手の人差し指',
  KeyT: '左手の人差し指（内へ）', KeyG: '左手の人差し指（内へ）', KeyB: '左手の人差し指（内へ）',
  KeyY: '右手の人差し指（内へ）', KeyH: '右手の人差し指（内へ）', KeyN: '右手の人差し指（内へ）',
  KeyU: '右手の人差し指', KeyJ: '右手の人差し指', KeyM: '右手の人差し指',
  KeyI: '右手の中指', KeyK: '右手の中指', Comma: '右手の中指',
  KeyO: '右手の薬指', KeyL: '右手の薬指', Period: '右手の薬指',
  KeyP: '右手の小指', Semicolon: '右手の小指', Slash: '右手の小指',
};
/** そのキーを押す指（'KeyK' → '右手の中指'） */
export const fingerOf = (code) => FINGER[code] ?? '';
const ROW_OF = (code) => (/^(Key[QWERTYUIOP])$/.test(code) ? 'top' : /^(Key[ZXCVBNM]|Comma|Period|Slash)$/.test(code) ? 'bottom' : 'home');

const LEGEND = { Semicolon: ';', Comma: ',', Period: '.', Slash: '/' };
/** キーの刻印。'KeyD' → 'D' */
export const legendOf = (code) => LEGEND[code] ?? code.replace(/^Key/, '');
const THUMB_NAME = { left: '左親指', right: '右親指' };

/** かなを打つ面を引く。左右どちらの親指でも出るかなは prefer の側にする */
function faceOf(kana, prefer) {
  const hits = [];
  for (const [code, k] of Object.entries(NICOLA.keys)) {
    for (const thumb of ['none', 'left', 'right']) if (k[thumb] === kana) hits.push({ code, thumb: thumb === 'none' ? null : thumb });
  }
  if (!hits.length) throw new Error(`curriculum: «${kana}» は配列表に無い`);
  return hits.find((h) => h.thumb === prefer) ?? hits[0];
}

const handOf = (code) => (FINGER[code].startsWith('左') ? 'left' : 'right');

/** 導入のカードに出す説明。配列表から作るので、配列と食い違わない */
function noteOf({ code, kana, thumb }) {
  const solo = NICOLA.keys[code].none;
  const key = legendOf(code);
  // 指と «親指は使わない» はカードの上の行に出るので、ここでは繰り返さない
  if (!thumb) {
    if (code === 'KeyF' || code === 'KeyJ') return ['ホームの印（突起）があるキー。手を置く目印になる。'];
    const row = ROW_OF(code);
    return [row === 'top' ? '指をホームから上へ伸ばして押し、ホームへ戻す。'
      : row === 'bottom' ? '指をホームから下へ曲げて押し、ホームへ戻す。'
        : 'ホームに置いた指のまま押す。'];
  }
  if (thumb === handOf(code)) {
    return [`${key} だけなら «${solo}»。同じ側の${THUMB_NAME[thumb]}と同時に押すと «${kana}»（同側シフト）。`];
  }
  const nfd = kana.normalize('NFD');
  if (nfd.length === 2 && nfd[1] === '゙' && nfd[0] === solo) {
    return [`«${solo}» の濁音。濁音は、清音と同じキーを反対側の親指と同時に押す（交差シフト）。`, `${solo}（${key}）→ ${kana}（${key} ＋ ${THUMB_NAME[thumb]}）`];
  }
  if (nfd.length === 2 && nfd[1] === '゚') {
    const base = faceOf(nfd[0], null);
    return [`«${nfd[0]}» の半濁音。«${nfd[0]}» のキー（${legendOf(base.code)}）ではなく、${key} を${THUMB_NAME[thumb]}と同時に押す。`, '濁音の決まりに合わない例外なので、形で覚える。'];
  }
  return [`${key} を反対側の${THUMB_NAME[thumb]}と同時に押す（交差シフト）。`];
}

/** 決まった種から同じ並びを作る（同じ弱点なら同じ文になる。やり直しで中身が変わらないように） */
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
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.codePointAt(0)) >>> 0, 7);
const pick = (list, rng) => list[Math.floor(rng() * list.length)];
function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}


/** 小書きのかなは、前に付く字が決まっている（«あゅ» のような組は日本語に無い）。拗音は い段の後ろ、小さい母音は外来語の形 */
const YOUON = new Set(['ゃ', 'ゅ', 'ょ']);
const I_ROW = ['き', 'し', 'ち', 'に', 'み', 'り', 'ひ', 'ぎ', 'じ', 'び', 'ぴ'];
const SMALL_VOWEL = { ぁ: 'つ', ぃ: 'て', ぅ: 'と', ぇ: 'し', ぉ: 'う' };

/** 組を作る。小書きを含むときは、その字が自然に付く前の字と組ませる */
function pairOf(a, b, can, rng) {
  if (YOUON.has(a)) return pick(I_ROW.filter((x) => can.has(x)), rng) + a;
  if (SMALL_VOWEL[a]) return SMALL_VOWEL[a] + a;
  // 句読点と «っ» と «ー» は組の後ろにだけ置く（«っと» «ーか» のように頭に来ると読めない）
  if (TAIL.has(a)) return b + a;
  if (TAIL.has(b)) return a + b;
  return rng() < 0.5 ? b + a : a + b;
}
const TAIL = new Set(['。', '、', '．', '・', 'っ', 'ー']);

/**
 * 2 字の組を n 個。一つは新しいかな、もう一つは新しいかな・最近覚えたかな・弱いかなから選ぶ。
 * 同じ字を二つ並べた組（«とと»）は作らない
 */
function pairsOf(lesson, n, rng, weak) {
  const fresh = lesson.newKeys.map((k) => k.kana);
  const can = new Set([...lesson.known, ...fresh]);
  // 弱いかなは 3 倍まで出る（keystrike は 4 倍。入門なので少し抑える）
  // 小書きは相手には選ばない（相手に選ぶと、その字の前に付く字で組が埋まって新しいかなが消える）
  const small = (c) => YOUON.has(c) || SMALL_VOWEL[c];
  const partners = [...fresh, ...lesson.known.slice(-6), ...weak, ...weak, ...weak].filter((c) => !small(c));
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = fresh[i % fresh.length];
    let b = pick(partners, rng);
    // 句読点どうしの組（«。、»）も作らない
    for (let t = 0; t < 12 && (b === a || (TAIL.has(a) && TAIL.has(b))); t++) b = pick(partners, rng);
    if (b === a) b = fresh[(i + 1) % fresh.length];
    out.push(pairOf(a, b, can, rng));
  }
  return out;
}

/** 段階の文。groups は語や組の区切り（画面で間を空けるため。打つ字には空白を入れない） */
function textOf(lesson, phase, weak = []) {
  const rng = seeded(hash(`${lesson.id}~${phase}~${weak.join('')}`));
  let groups;
  if (phase === 'intro') groups = lesson.newKeys.map((k) => k.kana.repeat(3));
  else if (phase === 'pairs') groups = pairsOf(lesson, 12, rng, weak);
  else if (phase === 'words') groups = shuffle(lesson.words, rng);
  else {
    // 確認：組 6 つと、このレッスンの語・前のレッスンの語を合わせて 40 字ほど
    const words = [...shuffle(lesson.words, rng), ...shuffle(lesson.wordsBefore, rng).slice(0, 3)];
    groups = pairsOf(lesson, 6, rng, weak);
    let len = groups.join('').length;
    for (const w of words) {
      if (len >= 40) break;
      groups.push(w);
      len += [...w].length;
    }
    // 語が少ない最初のほうのレッスンでは、組を足して 36 字までは埋める
    if (len < 36) groups.push(...pairsOf(lesson, Math.ceil((36 - len) / 2), rng, weak));
    groups = shuffle(groups, rng);
  }
  return { text: groups.join(''), groups: groups.map((g) => [...g].length) };
}

function build() {
  const known = [];
  const wordsSoFar = [];
  const units = [];
  const lessons = [];
  for (const u of PLAN) {
    const unit = { id: u.id, name: u.name, note: u.note, lessons: [] };
    for (const [id, title, kana, prefer, words] of u.lessons) {
      const newKeys = [...kana].map((c) => {
        const f = faceOf(c, prefer);
        const k = { code: f.code, kana: c, thumb: f.thumb, finger: FINGER[f.code], legend: legendOf(f.code) };
        k.note = noteOf(k);
        return k;
      });
      const lesson = {
        id, unitId: u.id, title, newKeys,
        known: [...known],
        words: words.split(' '),
        wordsBefore: [...wordsSoFar],
      };
      unit.lessons.push(lesson);
      lessons.push(lesson);
      known.push(...newKeys.map((k) => k.kana));
      wordsSoFar.push(...lesson.words);
    }
    units.push(unit);
  }
  return { units, lessons };
}

const BUILT = build();

/** 単元（ホームの段・上段・濁音・下段）。lessons は並び順 */
export const UNITS = Object.freeze(BUILT.units);
/** レッスン（並び順） */
export const CURRICULUM = Object.freeze(BUILT.lessons);

/** 段階一本の課題の id。例 'l-home-1~pairs' */
export const phaseId = (lessonId, phase) => `${lessonId}~${phase}`;

/** そのレッスンまでに覚えた面（'KeyD:left' の形）。配列図で «覚えた / 今回 / まだ» を描き分ける */
function facesOf(lesson) {
  const key = (k) => `${k.code}:${k.thumb ?? 'none'}`;
  const i = CURRICULUM.indexOf(lesson);
  return {
    known: CURRICULUM.slice(0, i).flatMap((l) => l.newKeys.map(key)),
    fresh: lesson.newKeys.map(key),
  };
}

/**
 * 段階一本を、打つ画面が受け取る課題の形にして返す。id が段階のものでなければ null。
 * weak（弱いかな）を渡すと、組み合わせと確認にそれを多めに混ぜる。
 * courseId は 'learn'（場所を «覚える» にするため）。
 */
export function findPhase(id, { weak = [] } = {}) {
  const m = /^(l-[a-z]+-\d+)~([a-z]+)$/.exec(String(id ?? ''));
  if (!m) return null;
  const lesson = CURRICULUM.find((l) => l.id === m[1]);
  const pi = PHASES.findIndex((p) => p.id === m[2]);
  if (!lesson || pi < 0) return null;
  const phase = PHASES[pi];
  const no = CURRICULUM.indexOf(lesson) + 1;
  // 弱いかなは、そのレッスンまでに覚えたものに限る（まだ習っていない字は出さない）
  const can = new Set([...lesson.known, ...lesson.newKeys.map((k) => k.kana)]);
  const w = weak.filter((c) => can.has(c));
  const { text, groups } = textOf(lesson, phase.id, w);
  return {
    id,
    courseId: 'learn',
    lessonId: lesson.id,
    lessonNo: no,
    lessonTitle: lesson.title,
    phase: phase.id,
    phaseIndex: pi,
    title: `レッスン ${no} ${lesson.title}（${pi + 1}/${PHASES.length} ${phase.name}）`,
    note: '',
    text,
    groups,
    newKeys: lesson.newKeys,
    faces: facesOf(lesson),
  };
}

/**
 * 確認に届かなかったときのおさらい。まちがえたかなだけを、2 字の組にして 8 つ（16 字）。
 * 打ち終えたら確認をもう一度打つ（app.js）。id では引けない、その場で作る課題
 */
export function reviewPhase(lessonId, missed) {
  const base = findPhase(phaseId(lessonId, 'check'));
  if (!base || !missed.length) return null;
  const lesson = CURRICULUM.find((l) => l.id === lessonId);
  const rng = seeded(hash(`${lessonId}~review~${missed.join('')}`));
  // 一字だけなら、そのレッスンの新しいかなと組ませる（同じ字を二つ並べた組は作らない）
  const partners = missed.length > 1 ? missed : [...missed, ...lesson.newKeys.map((k) => k.kana).filter((c) => c !== missed[0])];
  const groups = [];
  for (let i = 0; i < 8; i++) {
    const a = missed[i % missed.length];
    let b = pick(partners, rng);
    // 句読点どうしの組（«。、»）も作らない
    for (let t = 0; t < 12 && (b === a || (TAIL.has(a) && TAIL.has(b))); t++) b = pick(partners, rng);
    groups.push(pairOf(a, b, new Set([...lesson.known, ...lesson.newKeys.map((k) => k.kana)]), rng));
  }
  return {
    ...base,
    id: phaseId(lessonId, 'review'),
    phase: 'review',
    title: `レッスン ${base.lessonNo} ${lesson.title}（おさらい）`,
    text: groups.join(''),
    groups: groups.map((g) => [...g].length),
  };
}

/** 次の段階。レッスンの最後の段階なら次のレッスンの最初の段階。全部終わったら null */
export function nextPhase(id) {
  const p = findPhase(id);
  if (!p) return null;
  if (p.phaseIndex + 1 < PHASES.length) return findPhase(phaseId(p.lessonId, PHASES[p.phaseIndex + 1].id));
  const i = CURRICULUM.findIndex((l) => l.id === p.lessonId);
  const next = CURRICULUM[i + 1];
  return next ? findPhase(phaseId(next.id, PHASES[0].id)) : null;
}

/** そのレッスンを終えたか（確認の段に一度でも合格したか） */
export function lessonDone(stats, lessonId) {
  return (stats?.cleared?.[phaseId(lessonId, PHASES[PHASES.length - 1].id)] ?? 0) > 0;
}

/** いまどの段階まで来たか（0..4）。打ち切った段階の数 */
export function phasesDone(stats, lessonId) {
  let n = 0;
  for (const p of PHASES) if ((stats?.cleared?.[phaseId(lessonId, p.id)] ?? 0) > 0) n++;
  return n;
}
