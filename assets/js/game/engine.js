// タイピングゲーム（題材は検品ライン）の状態機械。
//
// このファイルは何か
//   ラインを流れる作業品、打った字の判定、点・コンボ・残り時間の計算をすべてここに持つ。
//   配線（main.js）は、ここが返す state と events を見て画面と音を出すだけ。
//
// なぜ DOM も時計も乱数も持たないのか
//   nicola.js と同じ理由。現在時刻を中で読むと、テストから時間を進められず、
//   「作業品が流れきった」「時間切れ」の検査が実時間待ちになって揺れる。
//   乱数も同じで、rng を外から受ければ同じ種で同じ並びを再現できる
//   （画面のデモ表示もこれを使って毎回同じ絵を出している）。
//
// ゲームの決まり（CONTRACT.md「タイピングゲーム」の節が正）
//   - 打てるのは先頭の作業品（いちばん出口に近いもの）だけ
//   - 一字ずつ進む。違う字・シフト不発はミスで、その字は進まない。連打メーターが 0 に戻る
//   - 作業品の値段は語の字数で決まる（courses.js の prices）。語は字数の順（lengthCycle）に、
//     一つの字数で SAME_LEN_RUN 枚ずつ出る。数値と算出方法は寿司打と同じ（courses.js の注記）
//   - 作業品が出口まで流れたら検品漏れ。点は入らないがミスにも数えず、メーターも切らない
//   - 連打メーター：ミスなしで続けて正しく打ったキーの数が METER_STEPS に届くたびに時間が延びる。
//     最後の段で一周。ミスで 0 に戻る。キーは result.keys（親指シフトは一字 1、ローマ字は綴りのキー数）
//   - 同時打鍵のズレ（ぴったり等）は数えるだけで、点には入れない（寿司打と比べられなくなるので）

import { tierOf } from '../meter.js';
import { loadLayout } from '../layout.js';
import { itemValue, lengthCycle, SAME_LEN_RUN, METER_STEPS } from './courses.js';

/** 作業品どうしの間隔（ライン長に対する割合）。前の作業品がここまで進んだら次を流す。
    0.22 だとラインにおよそ 4〜5 枚。多すぎると先頭がどれか分からなくなり、
    少なすぎると次の単語を先読みできない */
const SPACING = 0.22;

/** ラインが空になって補充するとき、作業品をどこから出すか。0 だと作業品の中心が画面の右外にあり、
    打つべき作業品が見えないまま札だけが替わる。少し内側に置いて、出てきた瞬間から見えるようにする */
const ENTRY = 0.1;

/** ラインに同時に載せる上限 */
const MAX_ITEMS = 5;

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
 * @param {{ course: object, words: Array<{kana:string}>, rng: () => number }} p
 */
export function createGame({ course, words, rng }) {
  if (!course || typeof course.timeMs !== 'number' || typeof course.laneMs !== 'number') {
    throw new Error('createGame: course の形が契約と違う（timeMs / laneMs が無い）');
  }
  if (typeof rng !== 'function') throw new Error('createGame: rng が関数でない');

  // 字数ごとに語を分けておく。出る順の字数に一語も無いのはデータの誤りなので黙って続けない
  const cycle = lengthCycle(course);
  const byLen = new Map();
  for (const w of words ?? []) {
    const n = lenOf(w.kana);
    if (!byLen.has(n)) byLen.set(n, []);
    byLen.get(n).push(w);
  }
  for (const n of cycle) {
    if (!byLen.get(n)?.length) throw new Error(`createGame: ${course.id} で出す ${n} 字の語が無い`);
  }
  let seq = 0;            // 何枚目の作業品か（0 から）。字数の順を決める

  let phase = 'ready';
  let startAt = 0;
  let now = 0;
  let endAt = 0;          // 終わる予定の時刻。時間延長でここが伸びる
  let overAt = null;

  let nextId = 1;
  /** @type {Array<{id:number, word:object, value:number, typed:number, spawnAt:number, perfect:number}>} */
  let items = [];
  const recent = [];

  let score = 0;
  let correctKeys = 0;    // 正しく打ったキーの数（結果画面の «正しく打ったキーの数»）
  let meterKeys = 0;      // 連打メーター。ミスなしで続けて正しく打ったキーの数（一周で 0 に戻る）
  let meterStep = 0;      // 次に届く METER_STEPS の段
  let missStreak = 0;     // 先頭の同じ字で続けて外した数。打ち方の案内を出す合図
  let cleared = 0;
  let lost = 0;
  let strokes = 0;
  let misses = 0;
  let misfires = 0;
  let perfect = 0;
  let good = 0;
  const offsets = [];   // この回のズレ（ms）。結果の分布に使う。一回で数百個なので持っておける
  let shifted = 0;
  let timeBonusMs = 0;

  function pickWord() {
    const pool = byLen.get(cycle[Math.floor(seq / SAME_LEN_RUN) % cycle.length]);
    seq++;
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
    items.push({ id: nextId++, word, value: itemValue(course, word), typed: 0, spawnAt: t, perfect: 0 });
  }

  const xOf = (p, t) => (t - p.spawnAt) / course.laneMs;

  /** 時間を t まで進める。作業品の検品漏れ・補充・時間切れはここでだけ起きる */
  function advance(t, events) {
    if (phase !== 'playing') return;
    if (t < now) t = now; // 時計は戻さない（rAF とイベントの timeStamp が前後することがある）
    now = t;

    // 検品漏れ。先頭から順に出口を越えたものを落とす
    while (items.length && xOf(items[0], t) >= 1) {
      const p = items.shift();
      lost++;
      missStreak = 0;
      events.push({ type: 'lost', itemId: p.id });
    }

    // 補充。ラインが空なら待たずに出す（速く打てる人を待たせない）。
    // それ以外は最後尾が SPACING だけ進んだら次を出す
    if (!items.length) spawn(t, ENTRY);
    while (items.length < MAX_ITEMS && xOf(items[items.length - 1], t) >= SPACING) {
      // 最後尾がちょうど SPACING 進んだ時刻に出たことにする。
      // tick の間隔に引きずられて作業品の間が不揃いになるのを防ぐ
      spawn(items[items.length - 1].spawnAt + SPACING * course.laneMs);
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

      const head = items[0];
      if (!head) return events; // advance の直後なので通常は起きない
      const chars = [...head.word.kana];
      const expected = chars[head.typed];

      if (result.kana === expected) {
        const keys = Number.isInteger(result.keys) && result.keys > 0 ? result.keys : 1;
        head.typed++;
        strokes++;
        correctKeys += keys;
        missStreak = 0;

        // ズレを測れるのは、親指を落とした瞬間がある一打だけ。
        // 連続シフトで引き継いだ親指の一打（offsetMs が null）は測っていないので、
        // ぴったりにも、シフト打鍵の母数にも入れない（測っていないものは数えない）
        let tier = null;
        if (result.thumb && result.offsetMs != null) {
          tier = tierOf(result.offsetMs);
          shifted++;
          offsets.push(result.offsetMs);
          if (tier === 'good') good++;
        }
        events.push({ type: 'hit', itemId: head.id, kana: expected, tier, keys });

        if (tier === 'perfect') {
          perfect++;
          head.perfect++;
        }

        // 連打メーター。一打で二つの段をまたぐこともある（ローマ字の «っ» など）
        meterKeys += keys;
        while (meterKeys >= METER_STEPS[meterStep].keys) {
          const step = METER_STEPS[meterStep];
          endAt += step.ms;
          timeBonusMs += step.ms;
          events.push({ type: 'meter', step: meterStep, bonusMs: step.ms });
          meterStep++;
          if (meterStep === METER_STEPS.length) {
            meterKeys -= step.keys;
            meterStep = 0;
          }
        }

        if (head.typed >= chars.length) {
          items.shift();
          score += head.value;
          cleared++;
          events.push({ type: 'clear', itemId: head.id, value: head.value });
          if (!items.length) spawn(t, ENTRY);
        }
      } else {
        // 外れ。不発（親指が要る字を、正しい文字キーで単独に打った）かどうかも返す。
        // 指は合っていて親指だけ落ちたのか、別のキーなのかで直し方が違うので、画面の言い方を変える
        const how = keyFor(expected);
        const misfire = !!(how && how.thumb && !result.thumb && result.charCode === how.code);
        if (misfire) misfires++;
        misses++;
        meterKeys = 0;
        meterStep = 0;
        missStreak++;
        events.push({ type: 'miss', itemId: head.id, expected, got: result.kana ?? null, misfire });
      }
      return events;
    },

    get state() {
      return {
        phase,
        remainingMs: phase === 'ready' ? course.timeMs : Math.max(0, endAt - (overAt ?? now)),
        items: items.map((p) => ({
          id: p.id,
          word: p.word,
          value: p.value,
          typed: p.typed,
          perfect: p.perfect,
          x: phase === 'ready' ? 0 : xOf(p, now),
        })),
        score,
        correctKeys,
        meterKeys,
        meterNext: METER_STEPS[meterStep].keys,
        missStreak,
        cleared,
        lost,
        misses,
        perfect,
        good,
        shifted,
        offsets,
        strokes,
        elapsedMs: phase === 'ready' ? 0 : (overAt ?? now) - startAt,
        target: course.target,
      };
    },

    summary() {
      if (phase !== 'over') throw new Error('summary はゲームが終わってから');
      const durationMs = overAt - startAt;
      const tries = strokes + misses;
      return {
        course: course.id,
        score,
        balance: score - course.target,
        cleared,
        lost,
        strokes,
        misses,
        misfires,
        accuracy: tries ? strokes / tries : 0,
        kpm: durationMs > 0 ? (strokes * 60000) / durationMs : 0,
        perfect,
        good,
        shifted,
        offsets: offsets.slice(),
        correctKeys,
        // 平均キータイプ数（回/秒）。正しく打ったキーを、延長込みの遊んだ秒数で割り、小数一桁で切り捨てる
        keysPerSec: durationMs > 0 ? Math.floor((correctKeys / (durationMs / 1000)) * 10) / 10 : 0,
        timeBonusMs,
        durationMs,
      };
    },
  };
  return api;
}
