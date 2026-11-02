// 覚える（親指シフト入門）のレッスン。
//
// このファイルは何か
//   配列表（assets/data/nicola.js）から、キーを少しずつ覚えるレッスンを組み立てる。
//   一つのレッスンで覚える新しいかなは 5 つまで。レッスンは 4 段階で進む:
//     1. 見る      … 新しいかなを一つずつ、3 回ずつ打つ（画面にキーと親指が出る）
//     2. それだけ  … 新しいかなだけを並べた列を打つ
//     3. 混ぜる    … それまでに覚えたかなと混ぜた列を打つ
//     4. 語        … 覚えたかなだけで書ける語を打つ（語が足りないレッスンでは混ぜた列）
//   段階ごとに一本の課題（lesson の形）として出すので、打つ画面・記録・中断と再開は
//   これまでの課題と同じものがそのまま使える。
//
// なぜ配列表から組むのか
//   レッスンの案内（どのキーで、どちらの親指か）を手で書くと、配列と食い違う。
//   見本を作ったときに «な» を K＋右親指と書き間違えた（正しくは D＋左親指）。
//   どのかなを覚えるかは「キーの並び × 面」だけを書き、かなは配列表から引く。
//
// なぜ新しいかなを 5 つまでにして、語・文章を入れないのか
//   一度に十も二十も新しいキーが出ると覚えられず、«いきなり実践が始まっていて覚えられない» になる。
//   語・文章・速度の練習は «鍛える» の領分なので、ここには入れない。

import { NICOLA } from '../data/nicola.js';
import { WORDS } from './game/words.js';

/** キーの並び。左手と右手、段ごと */
const ROWS = {
  leftHome: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'],
  rightHome: ['KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
  leftTop: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
  rightTop: ['KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
  leftBottom: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'],
  rightBottom: ['KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
};

/** face: 'none'（単独）| 'left' | 'right'（その親指と同時） */
const PLAN = [
  {
    id: 'solo', name: '単独打鍵', note: '親指を使わずに打つ 30 キー。',
    lessons: [
      ['l-solo-1', '左手のホーム', 'leftHome', 'none'],
      ['l-solo-2', '右手のホーム', 'rightHome', 'none'],
      ['l-solo-3', '右手の上段', 'rightTop', 'none'],
      ['l-solo-4', '左手の上段', 'leftTop', 'none'],
      ['l-solo-5', '右手の下段', 'rightBottom', 'none'],
      ['l-solo-6', '左手の下段', 'leftBottom', 'none'],
    ],
  },
  {
    id: 'same', name: '同側シフト', note: '同じ側の親指と一緒に打つと、別のかなが出る。',
    lessons: [
      ['l-same-1', '左手のホーム × 左親指', 'leftHome', 'left'],
      ['l-same-2', '右手のホーム × 右親指', 'rightHome', 'right'],
      ['l-same-3', '左手の上段 × 左親指', 'leftTop', 'left'],
      ['l-same-4', '右手の上段 × 右親指', 'rightTop', 'right'],
      ['l-same-5', '左手の下段 × 左親指', 'leftBottom', 'left'],
      ['l-same-6', '右手の下段 × 右親指', 'rightBottom', 'right'],
    ],
  },
  {
    id: 'cross', name: '交差シフト', note: '逆の側の親指と一緒に打つと、主に濁音・半濁音が出る。',
    lessons: [
      ['l-cross-1', '左手のホーム × 右親指', 'leftHome', 'right'],
      ['l-cross-2', '右手のホーム × 左親指', 'rightHome', 'left'],
      ['l-cross-3', '左手の上段 × 右親指', 'leftTop', 'right'],
      ['l-cross-4', '右手の上段 × 左親指', 'rightTop', 'left'],
      ['l-cross-5', '左手の下段 × 右親指', 'leftBottom', 'right'],
      ['l-cross-6', '右手の下段 × 左親指', 'rightBottom', 'left'],
    ],
  },
];

export const PHASES = Object.freeze([
  { id: 'see', name: '新しいキーを見る' },
  { id: 'only', name: 'そのキーだけ打つ' },
  { id: 'mix', name: '前のキーと混ぜる' },
  { id: 'words', name: '語で確かめる' },
]);

/** 決まった種から同じ並びを作る（レッスンの文は毎回同じにする。記録を比べられるように） */
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

/** 新しいかなを並べた列。同じかなが続きすぎないように、かたまり（2〜3 字）を作って並べる */
function drillText(pool, len, rng) {
  const out = [];
  let prev = '';
  while (out.length < len) {
    const c = pool[Math.floor(rng() * pool.length)];
    if (c === prev && pool.length > 1) continue;
    out.push(c);
    prev = c;
  }
  return out.join('');
}

const PHASE_LEN = { only: 24, mix: 32 };
const WORDS_WANTED = 8;

function build() {
  const known = [];        // それまでに覚えたかな（順に）
  const units = [];
  const lessons = [];
  for (const u of PLAN) {
    const unit = { id: u.id, name: u.name, note: u.note, lessons: [] };
    for (const [id, title, row, face] of u.lessons) {
      const keys = ROWS[row].map((code) => ({ code, kana: NICOLA.keys[code][face] }));
      // 同じかなが前の面で出ていれば、それはもう覚えている（例：小書きの «ぁ» は左右どちらの親指でも出る）
      const fresh = keys.filter((k) => k.kana && !known.includes(k.kana));
      if (!fresh.length) throw new Error(`curriculum: ${id} に新しいかなが無い`);
      const newKana = fresh.map((k) => k.kana);
      const rng = seeded(hash(id));
      const all = [...known, ...newKana];
      const allowed = new Set(all);
      const words = WORDS.map((w) => w.kana).filter((k) => [...k].every((c) => allowed.has(c)) && [...k].some((c) => newKana.includes(c)));
      const pick = [];
      // 短い語を先に、合わせて 40 字ほどまで（長い文が続くと、覚える段で疲れる）
      let total = 0;
      for (const w of words.sort((a, b) => [...a].length - [...b].length || rng() - 0.5)) {
        if (pick.length >= WORDS_WANTED || total >= 40) break;
        pick.push(w);
        total += [...w].length + 1;
      }
      const phases = {
        see: newKana.map((c) => c.repeat(3)).join(''),
        only: drillText(newKana, PHASE_LEN.only, rng),
        mix: drillText([...newKana, ...newKana, ...known.slice(-15)], PHASE_LEN.mix, rng),
        // 語が足りないときは、覚えたかなを全部混ぜた列にする（意味のない語を作らない）
        words: pick.length >= 4 ? pick.join(allowed.has('、') ? '、' : '') : drillText(all, PHASE_LEN.mix, rng),
      };
      const lesson = {
        id,
        unitId: u.id,
        title,
        face,
        newKeys: fresh.map((k) => ({ code: k.code, kana: k.kana, thumb: face === 'none' ? null : face })),
        known: [...known],
        phases,
      };
      unit.lessons.push(lesson);
      lessons.push(lesson);
      known.push(...newKana);
    }
    units.push(unit);
  }
  return { units, lessons };
}

const BUILT = build();

/** 単元（単独打鍵・同側シフト・交差シフト）。lessons は並び順 */
export const UNITS = Object.freeze(BUILT.units);
/** レッスン（並び順） */
export const CURRICULUM = Object.freeze(BUILT.lessons);

/** 段階一本の課題の id。例 'l-solo-1~mix' */
export const phaseId = (lessonId, phase) => `${lessonId}~${phase}`;

/**
 * 段階一本を、打つ画面が受け取る課題の形にして返す。id が段階のものでなければ null。
 * courseId は 'learn'（場所を «覚える» にするため）。
 */
export function findPhase(id) {
  const m = /^(l-[a-z]+-\d+)~([a-z]+)$/.exec(String(id ?? ''));
  if (!m) return null;
  const lesson = CURRICULUM.find((l) => l.id === m[1]);
  const pi = PHASES.findIndex((p) => p.id === m[2]);
  if (!lesson || pi < 0) return null;
  const phase = PHASES[pi];
  const no = CURRICULUM.indexOf(lesson) + 1;
  const keysNote = lesson.newKeys.map((k) => k.kana).join(' ');
  return {
    id,
    courseId: 'learn',
    lessonId: lesson.id,
    phase: phase.id,
    phaseIndex: pi,
    title: `レッスン ${no} ${lesson.title}（${pi + 1}/${PHASES.length} ${phase.name}）`,
    note: phase.id === 'see'
      ? `新しいかな ${keysNote}。一つずつ 3 回打つ。キーと親指は下の図と案内に出る`
      : phase.id === 'only' ? `新しいかな ${keysNote} だけ。速さは問わない。正確に`
        : phase.id === 'mix' ? '前に覚えたかなと混ぜる' : '覚えたかなで書ける語',
    text: lesson.phases[phase.id],
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

/** そのレッスンを終えたか（最後の段階を一度でも打ち切ったか） */
export function lessonDone(stats, lessonId) {
  return (stats?.cleared?.[phaseId(lessonId, PHASES[PHASES.length - 1].id)] ?? 0) > 0;
}

/** いまどの段階まで来たか（0..4）。打ち切った段階の数 */
export function phasesDone(stats, lessonId) {
  let n = 0;
  for (const p of PHASES) if ((stats?.cleared?.[phaseId(lessonId, p.id)] ?? 0) > 0) n++;
  return n;
}
