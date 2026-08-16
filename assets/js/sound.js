// 打鍵音
// ================================================================
// このファイルは何か
//   1 打ごとの手応えを «音» で返す。音声ファイルは一つも持たず、その場で WebAudio で合成する。
//   （CSP が connect-src 'none' なので外から取ってくる道がそもそも無い。
//     同じ作者の typing-engineer も同じ方式で、あちらの流儀をそのまま引き継いだ。）
//
// なぜ音を作るのか
//   このアプリの主役は「文字キーと親指キーの押下時間差（ms）」で、
//   数十 ms のズレは目より耳のほうがはるかによく分かる。
//   画面のメーターは «あとで» 見るもの、音は «打っている最中に» 分かるもの、と役割が違う。
//
// 中心にある考え … «ズレを、ズレとして鳴らす»
//   同時打鍵は本来「一つの音」に聞こえるはずのもの。親指と文字がずれれば、
//   太鼓でいう «フラム»（二度打ち）になる。だからこのファイルは、判定を
//   「良い音／悪い音」に翻訳しない。実際に起きた 2 打を、実際に起きた順で、
//   ズレの大きさに比例した間隔で鳴らす。
//
//     ぴったり（perfect）… 二つが融けて «一つの音» に聞こえる
//     良い（good）      … かすかに «タッ・タ» と割れる
//     ずれ（off）       … はっきり割れる。加えて音が濁る（後述）
//
//   そして «向き» は鳴る順で出す。ここがいちばん大事なところで、
//   親指が早すぎる人と遅すぎる人では直し方が真逆なので、向きが分からないと直せない。
//
//     親指が先行（offsetMs < 0）… 低い «親指の声» が先 → 低→高、上がる形に聞こえる
//     親指が遅れ（offsetMs > 0）… 高い «文字の声» が先 → 高→低、下がる形に聞こえる
//
//   音の高低で向きが出るので、目を画面から離していても「自分は早い／遅い」が分かる。
//   これは色や文字では代えがきかない。
//
// 平時は静か、節目だけ派手
//   アプリ全体の方針をそのまま音にも当てた。打鍵音が大きいと 10 分ももたない。
//   単独打鍵はいちばん小さく、同時打鍵は少しだけ大きく、
//   祝いの音（課題完了・実績）だけはっきり鳴らす。既定は 'off'（無音）。
//
// 音を出さない環境でもアプリは動くこと
//   WebAudio が無い・AudioContext が作れない・音が壊れている、どの場合も
//   «黙って無音になる» だけで、例外は外へ出さない。音は本質ではなく手応えなので、
//   ここでアプリを落とすのは割に合わない。
//
// 契約
//   export function createSound({ volume, kind })
//   export const SOUND_KINDS
//   返り値: { hit, shifted, miss, misfire, finish, earned, setVolume, setKind, prime, get enabled }

// 判定の境目は meter.js のものを借りる。同じ数を 2 か所に書くと、
// 片方だけ直したときに «画面はぴったりと言っているのに音は割れている» が起きる。
import { THRESHOLDS, tierOf } from './meter.js';

// ---------------------------------------------------------------- 音色

/**
 * 音色の一覧。id は trophies.js の UNLOCKS（kind:'sound' の target）と
 * storage.js の settings.sound に入る値。ここを勝手に増やしても «開かない» ので、
 * 増やすときは trophies 側と揃えること。
 */
export const SOUND_KINDS = [
  { id: 'off', name: '無音', note: '音を出さない（既定）' },
  { id: 'tsuzumi', name: '鼓', note: '皮の低い響き。長く打っても疲れない' },
  { id: 'hyoshigi', name: '拍子木', note: '硬く短い。ズレの輪郭がいちばん立つ' },
  { id: 'typewriter', name: '和文タイプ', note: '機械の音。打っている実感が出る' },
];

/**
 * 音色ごとの «二つの声»。
 *   thumb … 親指キーの声。必ず低いほうにする
 *   char  … 文字キーの声。必ず高いほうにする
 * 低い＝親指、高い＝文字、という対応をどの音色でも崩さない。
 * 音色を変えたら向きの読み方まで変わる、では覚え直しになってしまう。
 *
 *   freq  … 基音、bend … 減衰中に何割まで下げるか（打楽器はピッチが落ちる）
 *   noise … 撥や木の «当たり» の成分。これが無いと電子音になり、打鍵の実感が出ない
 */
const VOICES = {
  // 鼓。皮の張った低い響き。ピッチが大きく落ちて「ポン」になる。
  // 長時間の稽古に耐えるよう、いちばん角が立たない音色を既定の推奨にしてある。
  tsuzumi: {
    thumb: { type: 'sine', freq: 290, bend: 0.55, dur: 0.14, gain: 0.95, noiseHz: 800, noiseQ: 0.7, noiseDur: 0.03, noise: 0.16 },
    char: { type: 'sine', freq: 600, bend: 0.55, dur: 0.10, gain: 0.80, noiseHz: 1900, noiseQ: 0.7, noiseDur: 0.02, noise: 0.14 },
    top: 2300,
  },
  // 拍子木。硬い木を打ち合わせる音。極端に短く、立ち上がりが鋭い。
  // 短い音ほど «二つに割れた» ことが分かりやすいので、ズレを詰める稽古に向く。
  hyoshigi: {
    thumb: { type: 'square', freq: 820, bend: 0.75, dur: 0.055, gain: 0.34, noiseHz: 2400, noiseQ: 1.8, noiseDur: 0.014, noise: 0.30 },
    char: { type: 'square', freq: 1380, bend: 0.75, dur: 0.042, gain: 0.28, noiseHz: 3400, noiseQ: 1.8, noiseDur: 0.011, noise: 0.26 },
    top: 3600,
  },
  // 和文タイプ。ノイズの当たりが主で、金属の余韻が少し残る。
  // 打鍵そのものの実感がいちばん強い代わり、いちばんうるさいので音量は控えめに振ってある。
  typewriter: {
    thumb: { type: 'triangle', freq: 900, bend: 0.6, dur: 0.045, gain: 0.26, noiseHz: 1900, noiseQ: 0.9, noiseDur: 0.026, noise: 0.42 },
    char: { type: 'triangle', freq: 1750, bend: 0.6, dur: 0.032, gain: 0.22, noiseHz: 3000, noiseQ: 0.9, noiseDur: 0.022, noise: 0.38 },
    top: 4200,
  },
};

// ---------------------------------------------------------------- 数

/** 予約の先読み（秒）。currentTime ちょうどに予約すると、
    予約した瞬間には既に «過去» になっていることがあり、頭が欠けて «プツッ» と鳴る。
    8ms の遅れは体感できないが、この欠けは体感できる。 */
const LOOKAHEAD = 0.008;

/** 立ち上がり（秒）。打楽器なので限りなく短く。0 にはできない（0 から exponential は張れない） */
const ATTACK = 0.003;

/** ズレを «間» に翻訳するときの倍率。
    実時間のまま鳴らすと ±15ms は耳では一つに融けてしまい（融合の限界がおよそ 25〜30ms）、
    良い／悪いの差が出ない。1.8 倍に引き伸ばすと、good の縁でようやく割れ始め、
    off では明確に二度打ちになる。«誇張はするが、順序と比は保つ» という線。 */
const SPREAD = 1.8;

/** 間の上限（秒）。これ以上開くと «2 打» ではなく «別の 2 音» に聞こえてしまう */
const MAX_GAP = 0.18;

/** 同時に生かしておく発音体の上限。速く打たれたときに際限なくノードが増えないための保険。
    超えた分は黙って捨てる。音が一つ抜けるより、音のせいで打鍵が重くなるほうが害が大きい */
const MAX_VOICES = 40;

/** 全体の頭。1.0 だと祝いの和音で歪むので余裕を残す */
const HEADROOM = 0.5;

/** 場面ごとの相対音量。«平時は静か» はここで作る */
const LEVEL = {
  hit: 0.30, // 単独打鍵。いちばん小さい。これが 1 分に 100 回鳴る
  shift: 0.42, // 同時打鍵。判定を運ぶぶんだけ気持ち大きい
  miss: 0.30,
  misfire: 0.40, // 打ち直させたいので、ミスの中では強めに出す
  finish: 0.75,
  earned: 0.80,
};

// ---------------------------------------------------------------- 本体

/**
 * 打鍵音を作る。ここでは AudioContext を «作らない»。
 * @param {{ volume?: number, kind?: string }} options
 *   volume … 0〜1。storage.js の settings.soundVolume をそのまま渡す
 *   kind  … SOUND_KINDS の id。storage.js の settings.sound をそのまま渡す
 */
export function createSound({ volume = 0.4, kind = 'off' } = {}) {
  let vol = clamp01(volume);
  let kindId = validKind(kind);

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let live = 0; // 鳴っている最中の発音体の数
  let dead = false; // 一度でも作るのに失敗したら、二度と試さない
  let busyUntil = 0; // 祝いの音が鳴り終わる予定の時刻（audio 時計）
  let lastPreview = 0; // 音量スライダーの試聴が連打されないように

  const isEnabled = () => kindId !== 'off' && vol > 0;

  // -- 出だし ---------------------------------------------------------------
  //
  // 自動再生ポリシーへの対処。ここには二つ別々の問題がある。
  //
  //   (1) ユーザー操作より前に作った AudioContext は suspended で始まり、鳴らない。
  //       → 操作のあとで作る。作ったあとも、念のため鳴らす直前に resume() を叩く。
  //   (2) AudioContext の生成そのものが、環境によっては数 ms かかる（音声デバイスを開く）。
  //       これを keydown の中でやると、判定の直後の処理を巻き込んで止める。
  //       このアプリは数十 ms の精度を売りにしているので、それは許せない。
  //       → 最初の操作を捕まえて、«その次のタスクで» 作る。判定の走る道から外に出す。
  //
  // その結果、いちばん最初の 1 打だけ音が出ないことがある。
  // 実際には課題を始めるまでに必ずクリックかキー操作を挟むので、まず起きない。
  // 確実にしたい呼び出し側は、ボタンの click ハンドラから prime() を呼べばよい。

  function build() {
    if (ctx || dead || !isEnabled()) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        dead = true;
        return null;
      }
      // latencyHint: 'interactive' … 遅延をできるだけ詰めてもらう。
      // リズムの手応えが目的なので、音質より «押した瞬間に鳴ること» を採る
      ctx = new AC({ latencyHint: 'interactive' });
      master = ctx.createGain();
      master.gain.value = vol * HEADROOM;
      master.connect(ctx.destination);
      noiseBuf = makeNoise(ctx);
    } catch {
      // WebAudio が無い、デバイスが開けない、同時に開ける数の上限、等。
      // どれもアプリを止める理由にはならない
      dead = true;
      ctx = null;
      master = null;
    }
    return ctx;
  }

  let armed = false;
  function arm() {
    if (armed || dead) return;
    armed = true;
    const onGesture = () => {
      // setTimeout(0) が肝。この操作を処理しているタスクの «外» で作る。
      // ここを直接 build() にすると、最初の 1 打の判定に生成コストが乗る
      setTimeout(() => {
        build();
      }, 0);
    };
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      try {
        window.addEventListener(type, onGesture, { once: true, capture: true, passive: true });
      } catch {
        /* addEventListener の options 非対応。音のために落とす理由はない */
      }
    }
  }

  /** 鳴らす直前に呼ぶ。鳴らせないなら null。ここが全ての発音の入口 */
  function ready() {
    if (!isEnabled() || dead) return null;
    if (!ctx) build();
    if (!ctx || !master) return null;
    // 操作の前に作られてしまった場合や、OS に止められた場合の復帰。
    // resume() は Promise を返すが待たない。待つと打鍵が止まる
    if (ctx.state === 'suspended') {
      try {
        ctx.resume();
      } catch {
        /* 失敗しても、次の打鍵でまた試せばよい */
      }
    }
    if (live > MAX_VOICES) return null;
    return ctx;
  }

  const now = () => ctx.currentTime + LOOKAHEAD;
  const voices = () => VOICES[kindId] ?? VOICES.tsuzumi;

  // -- 部品 -----------------------------------------------------------------

  /** 発音体を数える。onended で減らす。これが無いと上限の意味が無くなる */
  function track(node) {
    live++;
    node.onended = () => {
      live--;
      node.onended = null;
    };
  }

  /** 単音。打楽器なので指数の立ち上がりと指数の減衰、必要ならピッチも落とす */
  function osc(dest, { at, type, freq, bend = 0, dur, gain }) {
    const o = ctx.createOscillator();
    const a = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    // 太鼓も木も、当たった直後にピッチが下がる。これが無いと «ピー» という電子音になる
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * (1 - bend)), at + dur);
    a.gain.setValueAtTime(0.0001, at);
    a.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + ATTACK);
    a.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(a).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.02);
    track(o);
  }

  /** 雑音の一撃。撥や木の «当たり» の成分。フィルタで «何に当たったか» を作る */
  function burst(dest, { at, hz, q = 1, dur, gain, type = 'bandpass' }) {
    if (!noiseBuf) return;
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const a = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    a.gain.setValueAtTime(Math.max(0.0002, gain), at);
    a.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(a).connect(dest);
    // 読み出す場所を毎回ずらす。同じ波形を鳴らし続けると、
    // 打鍵ごとに «寸分違わず同じ» になり、機械的で気持ち悪い
    src.start(at, Math.random() * 0.4, dur + 0.02);
    track(src);
  }

  /**
   * 一打ぶんの «声»。
   * dirty … off 判定のときだけ真。少し低く外して、うなる相方を重ねる。
   *   «濁り» をこう作るのは、外れた音程が誰にでも «違う» と分かるから。
   *   音量を上げて叱るのではなく、音そのものを気持ち悪くする。直したくなる方を採った。
   */
  function strike(v, { at, gain, dirty = false }) {
    const bus = ctx.createGain();
    bus.gain.value = gain;
    if (dirty) {
      // 角を丸めて «こもった» 感じにする。抜けの良さは «合っている» の合図に取っておく
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      lp.Q.value = 0.7;
      bus.connect(lp).connect(master);
    } else {
      bus.connect(master);
    }
    const f = dirty ? v.freq * 0.98 : v.freq;
    osc(bus, { at, type: v.type, freq: f, bend: v.bend, dur: v.dur, gain: v.gain });
    if (dirty) {
      // わずかにずれた相方。差音がうなりになって «濁り» になる
      osc(bus, { at, type: v.type, freq: f * 1.055, bend: v.bend, dur: v.dur * 1.3, gain: v.gain * 0.75 });
    }
    if (v.noise) {
      burst(bus, { at, hz: v.noiseHz, q: v.noiseQ, dur: v.noiseDur, gain: v.noise });
    }
  }

  /** 祝いの鐘。音色設定に関わらず同じ音にしてある。
      «達成の合図» が音色を変えるたびに変わると、覚え直しになるし節目の意味が薄れる */
  function chime({ at, freq, dur = 0.42, gain = 0.5 }) {
    const bus = ctx.createGain();
    bus.gain.value = gain;
    bus.connect(master);
    osc(bus, { at, type: 'triangle', freq, dur, gain: 0.5 });
    // 3 倍音を軽く。金物らしさが出て、打鍵音と混ざらない
    osc(bus, { at, type: 'sine', freq: freq * 3.01, dur: dur * 0.4, gain: 0.10 });
  }

  /** ズレを «間»（秒）に翻訳する。ぴったりは 0 ＝ 二つが融けて一つの音になる */
  function gapOf(offsetMs) {
    if (offsetMs == null) return 0;
    const over = Math.abs(offsetMs) - THRESHOLDS.perfect;
    if (over <= 0) return 0;
    return Math.min(MAX_GAP, (over * SPREAD) / 1000);
  }

  // -- 公開する音 -----------------------------------------------------------

  const api = {
    /** 単独打鍵。いちばん小さく、短く。1 分に何十回も鳴るので «聞こえるか聞こえないか» でよい */
    hit() {
      try {
        if (!ready()) return;
        strike(voices().char, { at: now(), gain: LEVEL.hit });
      } catch {
        /* 音で落とさない */
      }
    },

    /**
     * 同時打鍵。判定を音で返す、このファイルの本題。
     * @param {{ tier?: 'perfect'|'good'|'off'|'misfire', offsetMs?: number|null }} j
     *   offsetMs は CONTRACT.md の符号どおり «負 = 親指が先行 / 正 = 親指が遅れ»。
     *   tier を省いても offsetMs から自分で決める（meter.js の tierOf と同じ境目になる）。
     */
    shifted({ tier, offsetMs } = {}) {
      try {
        const off = typeof offsetMs === 'number' && Number.isFinite(offsetMs) ? offsetMs : null;
        const t = tier ?? tierOf(off);
        // 不発は «ズレ» ではなく «成立しなかった» なので、別の音の担当に渡す
        if (t === 'misfire') return api.misfire();
        if (!ready()) return;

        const v = voices();
        const at = now();
        const gap = gapOf(off);
        const dirty = t === 'off';

        // 起きたとおりの順で鳴らす。«先行なら低い音から、遅れなら高い音から»。
        // 判定を良し悪しに翻訳せず、事実をそのまま音にすると、直す方向まで一緒に伝わる
        const early = off != null && off < 0;
        const first = early ? v.thumb : v.char;
        const second = early ? v.char : v.thumb;

        strike(first, { at, gain: LEVEL.shift, dirty });
        // 後から来たほうを少し弱く。フラムらしくなり、どちらが «先» かがさらに立つ
        strike(second, { at: at + gap, gain: LEVEL.shift * (gap > 0 ? 0.8 : 1), dirty });

        // ぴったりのときだけ、上に小さな粒を足す。
        // 二つが融けた «一つの音» の上澄みとして鳴るので、澄んで聞こえる。
        // 褒め言葉を鳴らすのではなく、合った結果として音が綺麗になるのが理想
        if (t === 'perfect' && v.top) {
          osc(master, { at, type: 'sine', freq: v.top, dur: 0.05, gain: LEVEL.shift * 0.22 });
        }
      } catch {
        /* 音で落とさない */
      }
    },

    /** 打ち間違い。短い低音一発。叱らない。責める音にすると打つのが嫌になる */
    miss() {
      try {
        if (!ready()) return;
        const at = now();
        const bus = ctx.createGain();
        bus.gain.value = LEVEL.miss;
        bus.connect(master);
        osc(bus, { at, type: 'sawtooth', freq: 210, bend: 0.4, dur: 0.07, gain: 0.35 });
        burst(bus, { at, hz: 500, q: 0.8, dur: 0.04, gain: 0.20, type: 'lowpass' });
      } catch {
        /* 音で落とさない */
      }
    },

    /**
     * シフト不発。同時打鍵のつもりが単打になった。
     * 他のどの音とも «形» を変えてある。判定の音は必ず «二つの声» で鳴るので、
     * 不発だけは一つの、音程のはっきりしない、こもった音にした。
     * 打鍵が «空振りした» 感じになるようピッチを大きく落としてある。
     */
    misfire() {
      try {
        if (!ready()) return;
        const at = now();
        const bus = ctx.createGain();
        bus.gain.value = LEVEL.misfire;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, at);
        lp.frequency.exponentialRampToValueAtTime(220, at + 0.16);
        bus.connect(lp).connect(master);
        osc(bus, { at, type: 'sawtooth', freq: 260, bend: 0.72, dur: 0.17, gain: 0.36 });
        burst(bus, { at, hz: 420, q: 0.6, dur: 0.10, gain: 0.26, type: 'lowpass' });
      } catch {
        /* 音で落とさない */
      }
    },

    /**
     * 課題を打ち切った。ここは «節目» なので派手にしてよい。
     * @param {{ best?: boolean }} o best なら自己ベスト更新。一音足して上まで抜ける
     */
    finish({ best = false } = {}) {
      try {
        if (!ready()) return;
        const at = Math.max(now(), busyUntil);
        // ド・ミ・ソ（＋自己ベストなら上のド）。上がって終わると «済んだ» 感じになる
        const notes = best ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
        notes.forEach((f, i) => {
          // setTimeout ではなく音の時計で並べる。
          // setTimeout は数十 ms ずれるうえ、画面の描き替えと重なると転ぶ
          chime({ at: at + i * 0.09, freq: f, dur: i === notes.length - 1 ? 0.6 : 0.32, gain: LEVEL.finish });
        });
        if (best) {
          // 自己ベストのときだけ、上にきらめきを散らす。«節目だけ派手» の派手のほう
          [1568, 2093, 2637].forEach((f, i) => {
            osc(master, { at: at + 0.36 + i * 0.05, type: 'sine', freq: f, dur: 0.3, gain: 0.10 });
          });
        }
        busyUntil = at + notes.length * 0.09 + 0.6;
      } catch {
        /* 音で落とさない */
      }
    },

    /**
     * 実績を取った。課題完了と続けて呼ばれることが多いので、
     * 直前の祝いが鳴り終わってから鳴る。重ねると «どっちの祝いか» が分からなくなる。
     * 呼ぶ側は finish() の直後に素直に呼んでよい（待ち合わせはここで面倒を見る）。
     */
    earned() {
      try {
        if (!ready()) return;
        // 直前の祝いがまだ鳴っているときだけ、その後ろに回す。
        // 何も鳴っていないなら待たない（単独で呼ばれたときに間延びさせない）
        const at = busyUntil > ctx.currentTime ? busyUntil + 0.12 : now();
        // 完全五度で上がる 2 音。finish の 3〜4 音の音階とは «形» が違うので取り違えない
        chime({ at, freq: 783.99, dur: 0.5, gain: LEVEL.earned });
        chime({ at: at + 0.13, freq: 1174.66, dur: 0.75, gain: LEVEL.earned });
        busyUntil = at + 0.9;
      } catch {
        /* 音で落とさない */
      }
    },

    /**
     * 音量。0〜1。設定画面のスライダーからそのまま呼んでよい。
     * 動かした結果が耳で分からないと調整できないので、その場で試聴も鳴らす（連打は間引く）。
     */
    setVolume(v) {
      vol = clamp01(v);
      try {
        if (!isEnabled()) {
          // 0 にされたら、以後 AudioContext は作らない（作ってあるものは黙らせる）
          if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
          return;
        }
        if (!ctx) build();
        if (!ctx || !master) return;
        // 段差で «プツッ» と鳴らないように、少しなまらせて追従させる
        master.gain.setTargetAtTime(vol * HEADROOM, ctx.currentTime, 0.02);
        if (ctx.currentTime - lastPreview > 0.12) {
          lastPreview = ctx.currentTime;
          api.hit();
        }
      } catch {
        /* 音で落とさない */
      }
    },

    /**
     * 音色。SOUND_KINDS の id。知らない値と 'off' はすべて無音に落とす。
     * 'off' 以外を選んだときは «選んだ音» をその場で鳴らす。
     * 一覧から選ぶだけで音が分からないと、選びようがない。
     */
    setKind(k) {
      const next = validKind(k);
      const changed = next !== kindId;
      kindId = next;
      try {
        if (!isEnabled()) {
          // 無音に戻した。作ってあるなら止めるが、閉じはしない（選び直したら即戻せるように）
          if (ctx && ctx.state === 'running') ctx.suspend();
          return;
        }
        // ここは設定画面のクリックの中から呼ばれる＝ユーザー操作の直後なので、
        // その場で作ってよい（打鍵の判定を邪魔しない場所）
        if (!ctx) build();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();
        if (changed) api.shifted({ tier: 'perfect', offsetMs: 0 });
      } catch {
        /* 音で落とさない */
      }
    },

    /**
     * 音を «温めて» おく。任意。
     * ボタンの click ハンドラなど、確実にユーザー操作の中から呼ぶこと。
     * 呼ばなくても最初の操作で自動的に温まるが、
     * 「1 打目から確実に鳴らしたい」ときはここを呼ぶのがいちばん確か。
     */
    prime() {
      try {
        if (!isEnabled()) return;
        build();
        if (ctx && ctx.state === 'suspended') ctx.resume();
      } catch {
        /* 音で落とさない */
      }
    },

    /** 音を出す設定になっているか。設定画面の表示用。作れなかった環境では false になる */
    get enabled() {
      return isEnabled() && !dead;
    },

    /** いま選ばれている音色 id。呼ぶ側が自分の設定と突き合わせられるように */
    get kind() {
      return kindId;
    },
  };

  arm();
  return api;
}

// ---------------------------------------------------------------- 小物

function clamp01(v) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.min(1, Math.max(0, n));
}

function validKind(k) {
  return SOUND_KINDS.some((s) => s.id === k) ? k : 'off';
}

/**
 * 白色雑音を 0.5 秒ぶんだけ、AudioContext ごとに一度だけ作る。
 * 打鍵のたびに作ると、そのたびに数万回の乱数を回すことになり、
 * よりによって判定を出した直後にメインスレッドが引っかかる。
 * 一度作って読み出す場所をずらして使い回せば、発音のコストはノードを繋ぐだけになる。
 */
function makeNoise(ctx) {
  const n = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
