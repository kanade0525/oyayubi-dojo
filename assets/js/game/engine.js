// 回転ずしゲームの状態機械。
//
// このファイルは何か
//   レーンを流れる皿、打った字の判定、金額・コンボ・残り時間の計算をすべてここに持つ。
//   描画（render.js）と配線（main.js）は、ここが返す state と events を見て絵と音を出すだけ。
//
// なぜ DOM も時計も乱数も持たないのか
//   nicola.js と同じ理由。現在時刻を中で読むと、テストから時間を進められず、
//   「皿が流れきった」「時間切れ」の検査が実時間待ちになって揺れる。
//   乱数も同じで、rng を外から受ければ同じ種で同じ皿の並びを再現できる
//   （画面のデモ表示もこれを使って毎回同じ絵を出している）。
//
// ゲームの決まり（CONTRACT.md「ゲーム『回転ずし』」の節が正）
//   - 打てるのは先頭の皿（いちばん出口に近い皿）だけ
//   - 一字ずつ進む。違う字・シフト不発はミスで、その字は進まない。コンボが切れる
//   - シフトを使う一打が perfect（±15ms）なら、その皿の値段に PERFECT_BONUS を上乗せする。
//     上乗せは «皿に» 積む。取り逃せば上乗せも一緒に流れる。
//     ぴったりを出したのに皿を逃すと惜しい、という緊張をレーンの上に作るため
//   - 皿が出口まで流れたら取り逃し。お金は入らないがミスにも数えず、コンボも切らない
//     （遅いことと間違えることは別の失敗で、罰を重ねると初心者が二重に削られる）
//   - コンボが COMBO_STEP の倍数に届くたびに残り時間が延びる

import { tierOf } from '../meter.js';
import { loadLayout } from '../layout.js';
import { plateValue, PERFECT_BONUS, COMBO_STEP, COMBO_TIME_BONUS_MS } from './courses.js';

/** 皿どうしの間隔（レーン長に対する割合）。前の皿がここまで進んだら次を流す。
    0.26 だとレーンにおよそ 4 枚。多すぎると先頭がどれか分からなくなり、
    少なすぎると次の単語を先読みできない */
const SPACING = 0.22;

/** レーンが空になって補充するとき、皿をどこから出すか。0 だと皿の中心が画面の右外にあり、
    打つべき皿が見えないまま札だけが替わる。少し内側に置いて、出てきた瞬間から見えるようにする */
const ENTRY = 0.1;

/** レーンに同時に載せる上限 */
const MAX_PLATES = 5;

/** 同じ単語が続けて出ないように覚えておく数 */
const RECENT = 12;

const lenOf = (s) => [...s].length;

// かな → どう打つか。同じかなが二つの面にあるとき（「ぁ」など）は単独打鍵を優先する。
// 不発の判定と、詰まったときの打ち方の案内に使う
const HOW = new Map();
{
  const layout = loadLayout('nicola');
  for (const face of [null, 'left', 'right']) {
    for (const [code, key] of Object.entries(layout.keys)) {
      const kana = face ? key[face] : key.none;
      if (kana && !HOW.has(kana)) HOW.set(kana, { code, thumb: face, hand: key.hand });
    }
  }
}

/** そのかなを打つキーと親指。配列に無い字なら null */
export function keyFor(kana) {
  return HOW.get(kana) ?? null;
}

/**
 * @param {{ course: object, words: Array<{kana:string,label:string}>, rng: () => number }} p
 */
export function createGame({ course, words, rng }) {
  if (!course || typeof course.timeMs !== 'number' || typeof course.laneMs !== 'number') {
    throw new Error('createGame: course の形が契約と違う（timeMs / laneMs が無い）');
  }
  if (typeof rng !== 'function') throw new Error('createGame: rng が関数でない');

  // コースの長さの帯に入る語だけを使う。一語も無いのはデータの誤りなので黙って続けない
  const pool = (words ?? []).filter((w) => {
    const n = lenOf(w.kana);
    return n >= course.minLen && n <= course.maxLen;
  });
  if (!pool.length) {
    throw new Error(`createGame: ${course.id} の長さ（${course.minLen}〜${course.maxLen}字）に合う単語が無い`);
  }

  let phase = 'ready';
  let startAt = 0;
  let now = 0;
  let endAt = 0;          // 終わる予定の時刻。時間延長でここが伸びる
  let overAt = null;

  let nextId = 1;
  /** @type {Array<{id:number, word:object, value:number, typed:number, spawnAt:number, perfect:number}>} */
  let plates = [];
  const recent = [];

  let money = 0;
  let combo = 0;
  let maxCombo = 0;
  let missStreak = 0;     // 先頭の同じ字で続けて外した数。打ち方の案内を出す合図
  let cleared = 0;
  let lost = 0;
  let strokes = 0;
  let misses = 0;
  let misfires = 0;
  let perfect = 0;
  let shifted = 0;
  let bonusTotal = 0;
  let timeBonusMs = 0;

  function pickWord() {
    // 直近に出た語を避ける。プールが小さくて避けきれないときは避けるのをやめる
    // （止まるより重なるほうがまし）
    for (let i = 0; i < 20; i++) {
      const w = pool[Math.floor(rng() * pool.length) % pool.length];
      if (!recent.includes(w.kana) || pool.length <= RECENT) {
        recent.push(w.kana);
        if (recent.length > RECENT) recent.shift();
        return w;
      }
    }
    return pool[Math.floor(rng() * pool.length) % pool.length];
  }

  function spawn(t, at = 0) {
    const word = pickWord();
    t -= at * course.laneMs;
    plates.push({ id: nextId++, word, value: plateValue(course, word), typed: 0, spawnAt: t, perfect: 0 });
  }

  const xOf = (p, t) => (t - p.spawnAt) / course.laneMs;

  /** 時間を t まで進める。皿の取り逃し・補充・時間切れはここでだけ起きる */
  function advance(t, events) {
    if (phase !== 'playing') return;
    if (t < now) t = now; // 時計は戻さない（rAF とイベントの timeStamp が前後することがある）
    now = t;

    // 取り逃し。先頭から順に出口を越えたものを落とす
    while (plates.length && xOf(plates[0], t) >= 1) {
      const p = plates.shift();
      lost++;
      missStreak = 0;
      events.push({ type: 'lost', plateId: p.id });
    }

    // 補充。レーンが空なら待たずに出す（速く打てる人を待たせない）。
    // それ以外は最後尾が SPACING だけ進んだら次を出す
    if (!plates.length) spawn(t, ENTRY);
    while (plates.length < MAX_PLATES && xOf(plates[plates.length - 1], t) >= SPACING) {
      // 最後尾がちょうど SPACING 進んだ時刻に出たことにする。
      // tick の間隔に引きずられて皿の間が不揃いになるのを防ぐ
      spawn(plates[plates.length - 1].spawnAt + SPACING * course.laneMs);
    }

    if (t >= endAt) {
      phase = 'over';
      overAt = endAt;
      events.push({ type: 'over' });
    }
  }

  const api = {
    start(t) {
      if (phase !== 'ready') throw new Error('start は一度だけ');
      phase = 'playing';
      startAt = t;
      now = t;
      endAt = t + course.timeMs;
      spawn(t);
      return [];
    },

    tick(t) {
      const events = [];
      advance(t, events);
      return events;
    },

    /**
     * nicola.js の onOutput の result をそのまま受ける。
     * 親指キーだけの空打ち（charCode が null）は打鍵に数えない。
     */
    input(result, t) {
      const events = [];
      advance(t, events);
      if (phase !== 'playing' || !result || result.charCode == null) return events;

      const head = plates[0];
      if (!head) return events; // advance の直後なので通常は起きない
      const chars = [...head.word.kana];
      const expected = chars[head.typed];

      if (result.kana === expected) {
        head.typed++;
        strokes++;
        combo++;
        missStreak = 0;
        if (combo > maxCombo) maxCombo = combo;

        // ズレを測れるのは、親指を落とした瞬間がある一打だけ。
        // 連続シフトで引き継いだ親指の一打（offsetMs が null）は測っていないので、
        // ぴったりにも、シフト打鍵の母数にも入れない（測っていないものは数えない）
        let tier = null;
        if (result.thumb && result.offsetMs != null) {
          tier = tierOf(result.offsetMs);
          shifted++;
        }
        events.push({ type: 'hit', plateId: head.id, kana: expected, tier });

        if (tier === 'perfect') {
          perfect++;
          head.value += PERFECT_BONUS;
          head.perfect++;
          bonusTotal += PERFECT_BONUS;
          events.push({ type: 'perfect', plateId: head.id, bonus: PERFECT_BONUS });
        }

        if (combo % COMBO_STEP === 0) {
          endAt += COMBO_TIME_BONUS_MS;
          timeBonusMs += COMBO_TIME_BONUS_MS;
          events.push({ type: 'combo', combo, bonusMs: COMBO_TIME_BONUS_MS });
        }

        if (head.typed >= chars.length) {
          plates.shift();
          money += head.value;
          cleared++;
          events.push({ type: 'clear', plateId: head.id, value: head.value });
          if (!plates.length) spawn(t, ENTRY);
        }
      } else {
        // 外れ。不発（親指が要る字を、正しい文字キーで単独に打った）かどうかも返す。
        // 指は合っていて親指だけ落ちたのか、別のキーなのかで直し方が違うので、画面の言い方を変える
        const how = keyFor(expected);
        const misfire = !!(how && how.thumb && !result.thumb && result.charCode === how.code);
        if (misfire) misfires++;
        misses++;
        combo = 0;
        missStreak++;
        events.push({ type: 'miss', plateId: head.id, expected, got: result.kana ?? null, misfire });
      }
      return events;
    },

    get state() {
      return {
        phase,
        remainingMs: phase === 'ready' ? course.timeMs : Math.max(0, endAt - (overAt ?? now)),
        plates: plates.map((p) => ({
          id: p.id,
          word: p.word,
          value: p.value,
          typed: p.typed,
          perfect: p.perfect,
          x: phase === 'ready' ? 0 : xOf(p, now),
        })),
        money,
        combo,
        maxCombo,
        missStreak,
        cleared,
        lost,
        misses,
        perfect,
        price: course.price,
      };
    },

    summary() {
      if (phase !== 'over') throw new Error('summary はゲームが終わってから');
      const durationMs = overAt - startAt;
      const tries = strokes + misses;
      return {
        course: course.id,
        money,
        balance: money - course.price,
        plates: cleared,
        lost,
        strokes,
        misses,
        misfires,
        accuracy: tries ? strokes / tries : 0,
        kpm: durationMs > 0 ? (strokes * 60000) / durationMs : 0,
        perfect,
        shifted,
        bonus: bonusTotal,
        timeBonusMs,
        maxCombo,
        durationMs,
      };
    },
  };
  return api;
}
