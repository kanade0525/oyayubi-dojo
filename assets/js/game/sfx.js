// 回転ずしの効果音（WebAudio で合成。音声ファイルは持たない）。
//
// このファイルは何か
//   ゲームの «出来事» の音を鳴らす。皿を取った・取り逃した・コンボ・残り時間・始まりと終わり。
//   打鍵そのものの音は sound.js（練習と同じ音色・同じ設定）が受け持つ。ここは打鍵を鳴らさない。
//   打鍵の音色は実績で開く仕組みなので、ゲームが勝手に鳴らすと «開く» 意味が無くなる。
//
// なぜ既定で鳴らすか
//   打鍵音の既定は無音で、音色は実績を取るまで選べない。ゲームの音までそれに従うと、
//   初めて遊ぶ人には何も聞こえない。ゲームは «派手» の側なので、出来事の音は最初から鳴らす。
//   要らない人のために、タイトルに切り替えを置き、選んだ値を覚えておく。
//
// 音の決め方
//   取った … 皿が «カコン» と置かれる木の音と、値段の «チン»。ぴったりのときは «チン» を高く明るく
//   取り逃し … 低く下がる短い音。責める音にしない（取り逃しは数で十分に伝わっている）
//   コンボ … 上がる三音。時間が延びたことを耳で知らせる
//   残り 10 秒 … 一秒ごとの短い刻み。残り 3 秒からは高くする
//   開始 … 3・2・1 の短い音と、始まりの高い音
//   終わり … 拍子木を二つ（«カン、カン»）。店じまいの合図
//
// 鳴らない環境
//   AudioContext が無い環境では available が false になり、何も鳴らない。
//   タイトルの切り替えにも «この環境では鳴りません» と出す（黙って無音にはしない）。

const STORE_KEY = 'oyayubi-dojo:gamesound:v1';
const MASTER = 0.35;

export function loadSfxOn() {
  try {
    return localStorage.getItem(STORE_KEY) !== 'off';
  } catch {
    return true; // 保存できない環境（プライベート窓など）でも、既定の «鳴らす» で動く
  }
}

export function saveSfxOn(on) {
  try {
    localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
  } catch {
    /* 覚えられないだけで、この回は切り替わっている */
  }
}

export function createSfx({ on = true } = {}) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  const available = typeof AC === 'function';
  let ctx = null;
  let master = null;
  let enabled = on && available;

  function ready() {
    if (!enabled) return false;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  /** 一音。打楽器の形（すぐ立ち上がって指数で減る）。bend は終わりまでに何倍の高さへ動くか */
  function tone(at, { freq, dur, gain, type = 'sine', bend = 1 }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * bend, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** 木を打つ音。帯域を絞った雑音の短い当たり */
  function knock(at, { freq, dur = 0.05, gain }) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(bp).connect(g).connect(master);
    src.start(at);
    tone(at, { freq, dur: dur * 1.6, gain: gain * 0.5, type: 'triangle', bend: 0.9 });
  }

  const now = () => ctx.currentTime + 0.005;

  return {
    get available() {
      return available;
    },
    get enabled() {
      return enabled;
    },
    setEnabled(v) {
      enabled = !!v && available;
      if (!enabled && ctx && ctx.state === 'running') ctx.suspend();
      if (enabled) ready();
    },
    /** ボタンやキーの操作の中から呼ぶ。ブラウザは操作の前に作った音を止めておくため */
    prime() {
      ready();
    },

    take({ perfect = false } = {}) {
      if (!ready()) return;
      const t = now();
      knock(t, { freq: 900, gain: 0.5 });
      tone(t + 0.05, { freq: perfect ? 1975 : 1318, dur: 0.28, gain: 0.22 });
      if (perfect) tone(t + 0.1, { freq: 2637, dur: 0.3, gain: 0.12 });
    },
    lost() {
      if (!ready()) return;
      tone(now(), { freq: 330, dur: 0.22, gain: 0.3, type: 'triangle', bend: 0.6 });
    },
    combo() {
      if (!ready()) return;
      const t = now();
      [784, 988, 1175].forEach((f, i) => tone(t + i * 0.06, { freq: f, dur: 0.16, gain: 0.18, type: 'triangle' }));
    },
    tick(sec) {
      if (!ready()) return;
      knock(now(), { freq: sec <= 3 ? 2200 : 1500, dur: 0.03, gain: sec <= 3 ? 0.4 : 0.25 });
    },
    count(n) {
      if (!ready()) return;
      if (n > 0) tone(now(), { freq: 660, dur: 0.12, gain: 0.25 });
      else tone(now(), { freq: 1320, dur: 0.35, gain: 0.3 });
    },
    end() {
      if (!ready()) return;
      const t = now();
      knock(t, { freq: 1400, dur: 0.07, gain: 0.8 });
      knock(t + 0.32, { freq: 1400, dur: 0.07, gain: 0.8 });
    },
  };
}
