// 回転ずしの描画（canvas 2D）。
//
// このファイルは何か
//   engine.js の state と events を受けて、レーン・皿・注文札・残り時間・金額・演出を描く。
//   判断は一切しない。何が起きたかは engine が決め、ここは «どう見せるか» だけを持つ。
//
// なぜ canvas か
//   皿が毎フレーム動き、演出（浮く金額・光る皿・揺れる札）が重なる。DOM でやると
//   要素の出し入れとレイアウトの再計算が打鍵の判定と同じスレッドを食う。
//   このアプリは数十 ms のズレを測っているので、描画で主スレッドを詰まらせたくない。
//
// 配色
//   色は app.css の配色トークン（data-tone の 4 配色）から読む。ここに色を書くと
//   配色を替えたときにゲームだけ浮く。ただし «皿の色» と «寿司ネタの色» は、
//   回転ずしの世界の色なので配色に関わらず固定にしてある（まぐろが緑になると読めない）。
//   CSS の color-mix はそのままでは canvas に渡せないので、隠した要素に当てて
//   ブラウザに解決させ、1 画素描いて読み戻す。
//
// 演出の方針
//   練習画面は静か、ゲームは派手。ただし «読む字» の周りだけは静かに保つ。
//   注文札（いま打つ単語）の上には演出を重ねない。光るのは皿と金額の側。
//   外部画像は使わない（CSP と «外へ出ない» 約束）。皿も寿司も図形で描く。

import { keyFor } from './engine.js';

// app.css の --ui と同じ並び。system-ui を先頭にすると Windows・Linux で書体がばらつく
// 数字も同じ書体で描く。等幅の欧文書体は端末の画面のような字面になり、隣の「円」「秒」と書体が二つ並ぶ。
// 太さは 700 まで。ヒラギノ角ゴの W8・W9 は欧文の字幅が広く、数字だけ別の書体に見える
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", "Yu Gothic UI", Meiryo, "Noto Sans CJK JP", "Noto Sans JP", sans-serif';

/** 読み取る配色トークン */
const TOKENS = [
  'bg', 'fg', 'fg-mid', 'fg-dim', 'tone', 'tone-ink', 'panel', 'panel-2', 'sunken',
  'line', 'line-soft', 'perfect', 'good', 'off', 'misfire', 'cross',
];

/** 皿の色。回転ずしの «値段は皿の色» という約束をそのまま借りる。安い順 */
const PLATES = [
  { rim: '#d9d4c8', face: '#f6f3ec', band: '#b9b2a2' },  // 白
  { rim: '#3d78c9', face: '#eef3fa', band: '#2c5ea5' },  // 青
  { rim: '#c8433a', face: '#fbefed', band: '#9e2f28' },  // 赤
  { rim: '#d4a83c', face: '#fbf5e4', band: '#a8801f' },  // 金
  { rim: '#2b2b30', face: '#3a3a42', band: '#c9a54a' },  // 黒（金縁）
];

/** 寿司ネタ。単語の意味とは結び付けない（任意の語に意味の合う絵は出せない）。
    皿ごとに決まった一つを選ぶ。«皿が流れている» が分かることが目的 */
const NETA = [
  { kind: 'nigiri', color: '#c9303f', stripe: null },          // まぐろ
  { kind: 'nigiri', color: '#f0874a', stripe: '#fbd0b2' },     // サーモン
  { kind: 'nigiri', color: '#f3c94b', stripe: null, nori: true }, // 玉子
  { kind: 'nigiri', color: '#eeeae0', stripe: '#d8d2c4' },     // いか
  { kind: 'nigiri', color: '#f2795c', stripe: '#fff1e8' },     // えび
  { kind: 'gunkan', color: '#e8561f' },                        // いくら
  { kind: 'gunkan', color: '#e2a531' },                        // うに
  { kind: 'maki', color: '#4caf50' },                          // かっぱ
  { kind: 'maki', color: '#c9303f' },                          // 鉄火
];

const RICE = '#f4efe4';
const NORI = '#1d2a22';

/** 一つの値を [r,g,b,a] として持つ。canvas に渡すときは rgba(...) に戻す */
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 1) * a})`;

const easeOut = (k) => 1 - (1 - k) ** 3;
const clamp01 = (k) => Math.max(0, Math.min(1, k));

/** 3,000 → «3,000» */
const yen = (n) => Math.round(n).toLocaleString('ja-JP');

/** KeyJ → J、Semicolon → ; 。打ち方の案内で物理キーを名指しする */
function keyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const NAMES = {
    Semicolon: ';', Quote: ':', Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '^',
    BracketLeft: '@', BracketRight: '[', Backslash: ']', IntlYen: '¥', IntlRo: '\\', Backquote: '`',
  };
  return NAMES[code] ?? code;
}

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D が使えない');

  let W = 0;
  let H = 0;
  let dpr = 1;
  let C = {};          // 解決済みの配色
  let course = null;

  /** 演出。{ kind, t0, dur, ... } を now で消化する */
  let fx = [];
  /** 最後に描いた皿の位置。取った・流れた皿は state から消えるので、演出の起点にここを使う */
  const lastPos = new Map();
  let shakeUntil = 0;
  let shakeT0 = 0;
  let missFlash = { until: 0, misfire: false };
  let timeFlashUntil = 0;
  let moneyPulseUntil = 0;

  // ---------------------------------------------------------------- 配色

  function readTheme() {
    // CSS 変数は color-mix(...) のまま返ってくるので、要素に当てて解決させる
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
    const pix = document.createElement('canvas');
    pix.width = 1;
    pix.height = 1;
    const p = pix.getContext('2d', { willReadFrequently: true });
    const out = {};
    for (const name of TOKENS) {
      probe.style.color = `var(--${name})`;
      const css = getComputedStyle(probe).color;
      p.clearRect(0, 0, 1, 1);
      p.fillStyle = '#010203';
      p.fillStyle = css;
      // 受け付けられなかった色は前の値のまま残る。黙って黒で描くより落とす
      if (p.fillStyle === '#010203' && css !== 'rgb(1, 2, 3)') {
        probe.remove();
        throw new Error(`配色 --${name} を canvas の色に直せない: ${css}`);
      }
      p.fillRect(0, 0, 1, 1);
      const d = p.getImageData(0, 0, 1, 1).data;
      out[name] = [d[0], d[1], d[2], d[3] / 255];
    }
    probe.remove();
    C = out;
  }

  // ---------------------------------------------------------------- 大きさ

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    W = Math.max(320, Math.round(rect.width));
    H = Math.max(300, Math.round(rect.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  /** 画面の寸法から割り出す配置。W と H が変わるたびに作り直す（毎フレームでも軽い） */
  function geom() {
    const s = Math.min(W / 1100, H / 560);           // 基準の 1100×560 からの倍率
    const u = Math.max(0.62, s);                      // 字はこれより小さくしない
    const hud = Math.round(78 * u);
    const laneY = Math.round(H * 0.70);
    const laneH = Math.round(Math.max(96, H * 0.25));
    const R = Math.max(26, Math.min(laneH * 0.33, W * 0.05));   // 皿の横半径の基準
    const panelTop = hud + Math.round(16 * u);
    const panelBottom = laneY - laneH / 2 - Math.round(26 * u);
    return { s, u, hud, laneY, laneH, R, panelTop, panelBottom };
  }

  function plateX(x, g) {
    const rx = g.R * 1.3;
    return W + rx - x * (W + rx * 2);
  }

  // ---------------------------------------------------------------- 部品

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function fitFont(text, maxW, size, weight = 700, min = 10, family = FONT) {
    let sz = size;
    ctx.font = `${weight} ${sz}px ${family}`;
    while (sz > min && ctx.measureText(text).width > maxW) {
      sz -= 1;
      ctx.font = `${weight} ${sz}px ${family}`;
    }
    return sz;
  }

  function tierOfValue(word) {
    // 皿の色は «この語がコースの中で長いほうか» で決める。値段は長さで決まるので同じこと
    if (!course) return 0;
    const n = [...word.kana].length;
    const span = Math.max(1, course.maxLen - course.minLen);
    const k = (n - course.minLen) / span;
    return Math.max(0, Math.min(PLATES.length - 1, Math.round(k * (PLATES.length - 1))));
  }

  function netaOf(id) {
    // 皿の id から決める。同じ皿は流れている間ずっと同じネタ
    const h = (id * 2654435761) >>> 0;
    return NETA[h % NETA.length];
  }

  function drawSushi(cx, cy, R, neta) {
    const w = R * 1.25;
    const h = R * 0.62;
    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + h * 0.38, w * 0.62, h * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    if (neta.kind === 'nigiri') {
      // しゃり
      ctx.fillStyle = RICE;
      roundRect(cx - w / 2, cy - h * 0.45, w, h * 0.8, h * 0.35);
      ctx.fill();
      // ネタ。少し大きく、角を丸めて上にかぶせる
      ctx.fillStyle = neta.color;
      roundRect(cx - w * 0.58, cy - h * 0.78, w * 1.16, h * 0.62, h * 0.32);
      ctx.fill();
      if (neta.stripe) {
        ctx.strokeStyle = neta.stripe;
        ctx.lineWidth = Math.max(1.5, R * 0.05);
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(cx + i * w * 0.3 - w * 0.08, cy - h * 0.74);
          ctx.lineTo(cx + i * w * 0.3 + w * 0.08, cy - h * 0.22);
          ctx.stroke();
        }
      }
      if (neta.nori) {
        ctx.fillStyle = NORI;
        ctx.fillRect(cx - w * 0.1, cy - h * 0.8, w * 0.2, h * 1.12);
      }
      // つや
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      roundRect(cx - w * 0.42, cy - h * 0.7, w * 0.4, h * 0.12, h * 0.06);
      ctx.fill();
    } else if (neta.kind === 'gunkan') {
      ctx.fillStyle = NORI;
      roundRect(cx - w * 0.42, cy - h * 0.55, w * 0.84, h * 0.95, h * 0.2);
      ctx.fill();
      ctx.fillStyle = neta.color;
      ctx.beginPath();
      ctx.ellipse(cx, cy - h * 0.55, w * 0.42, h * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      // 粒（いくら・うに）
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(cx + (i - 2) * w * 0.15, cy - h * 0.6 + (i % 2) * h * 0.08, Math.max(1.2, R * 0.04), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // 細巻き二つ
      for (const dx of [-0.26, 0.26]) {
        const x = cx + dx * w;
        ctx.fillStyle = NORI;
        ctx.beginPath();
        ctx.ellipse(x, cy - h * 0.15, w * 0.24, h * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = RICE;
        ctx.beginPath();
        ctx.ellipse(x, cy - h * 0.38, w * 0.2, h * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = neta.color;
        ctx.beginPath();
        ctx.ellipse(x, cy - h * 0.38, w * 0.08, h * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPlate(cx, cy, R, tier, { glow = null, alpha = 1, scale = 1 } = {}) {
    const pc = PLATES[tier];
    const rx = R * 1.3 * scale;
    const ry = R * 0.5 * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = R * 0.9;
    }
    // 縁
    ctx.fillStyle = pc.rim;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // 帯
    ctx.fillStyle = pc.band;
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.06, rx * 0.86, ry * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 面
    ctx.fillStyle = pc.face;
    ctx.beginPath();
    ctx.ellipse(cx, cy - ry * 0.04, rx * 0.74, ry * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- レーン

  function drawLane(g, now, laneMs) {
    const top = g.laneY - g.laneH / 2;
    // 台
    const grad = ctx.createLinearGradient(0, top, 0, top + g.laneH);
    grad.addColorStop(0, rgba(C.sunken));
    grad.addColorStop(1, rgba(C.panel));
    ctx.fillStyle = grad;
    ctx.fillRect(0, top, W, g.laneH);

    // ベルトの継ぎ目。皿と同じ速さで流す（ずれるとベルトの上を皿が滑って見える）
    const seg = Math.max(40, g.R * 1.5);
    const span = W + g.R * 2.6;
    const off = laneMs ? ((now / laneMs) * span) % seg : 0;
    ctx.strokeStyle = rgba(C.line, 0.55);
    ctx.lineWidth = 1;
    for (let x = W + seg - off; x > -seg; x -= seg) {
      ctx.beginPath();
      ctx.moveTo(x, top + 8);
      ctx.lineTo(x - g.laneH * 0.12, top + g.laneH - 8);
      ctx.stroke();
    }

    // 手すり（上下）。主色で引いて «レーン» の輪郭を出す
    for (const y of [top, top + g.laneH]) {
      ctx.fillStyle = rgba(C.tone, 0.85);
      ctx.fillRect(0, y - 2, W, 4);
      ctx.fillStyle = rgba(C.tone, 0.18);
      ctx.fillRect(0, y - 7, W, 3);
    }

    // 出口の目印。ここを越えたら取り逃し
    const ex = Math.max(18, g.R * 0.7);
    const eg = ctx.createLinearGradient(0, 0, ex * 2.4, 0);
    eg.addColorStop(0, rgba(C.misfire, 0.22));
    eg.addColorStop(1, rgba(C.misfire, 0));
    ctx.fillStyle = eg;
    ctx.fillRect(0, top, ex * 2.4, g.laneH);
  }

  function drawPlates(g, state, now, { attract = false } = {}) {
    const plates = state.plates;
    const seen = new Set();
    // 奥（後ろの皿）から描く。先頭の皿を最後に描いて、いちばん上に重ねる
    for (let i = plates.length - 1; i >= 0; i--) {
      const p = plates[i];
      const cx = plateX(p.x, g);
      const cy = g.laneY + g.laneH * 0.08;
      lastPos.set(p.id, { cx, cy, tier: tierOfValue(p.word), word: p.word, value: p.value });
      seen.add(p.id);
      const head = i === 0 && !attract;
      const tier = tierOfValue(p.word);
      let glow = null;
      if (p.perfect > 0) glow = rgba(C.perfect, 0.85);
      else if (head) glow = rgba(C.tone, 0.7);
      // 出口が近い先頭の皿は赤く脈打たせる。«もうすぐ流れる» を目の端で拾えるように
      const danger = head && p.x > 0.78;
      if (danger) glow = rgba(C.misfire, 0.6 + 0.4 * Math.sin(now / 70));

      drawPlate(cx, cy, g.R, tier, { glow });
      drawSushi(cx, cy - g.R * 0.08, g.R, netaOf(p.id));

      // 札（名前と値段）。皿の下に吊るす
      const tagW = g.R * 2.5;
      const tagY = cy + g.R * 0.62;
      const lsz = fitFont(p.word.label, tagW - 10, Math.round(15 * g.u), 700, 10);
      const tagH = lsz + Math.round(14 * g.u) + 10;
      // 皿は端で切れてもよいが、札は読めないと困る。中心を画面の内側に寄せる
      const tx = Math.min(Math.max(cx, tagW / 2 + 2), W - tagW / 2 - 2);
      ctx.fillStyle = head ? rgba(C.tone, 0.95) : rgba(C.bg, 0.86);
      roundRect(tx - tagW / 2, tagY, tagW, tagH, 6);
      ctx.fill();
      ctx.strokeStyle = head ? rgba(C.tone) : rgba(C.line);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = head ? rgba(C['tone-ink']) : rgba(C.fg);
      ctx.font = `700 ${lsz}px ${FONT}`;
      ctx.fillText(p.word.label, tx, tagY + 4, tagW - 8);
      ctx.font = `600 ${Math.round(11.5 * g.u)}px ${FONT}`;
      ctx.fillStyle = head ? rgba(C['tone-ink'], 0.85) : p.perfect ? rgba(C.perfect) : rgba(C['fg-mid']);
      ctx.fillText(`${yen(p.value)}円`, tx, tagY + 6 + lsz);

      if (head) {
        // いま打つ皿の印。上から指す三角
        const ay = cy - g.R * 1.35 + Math.sin(now / 160) * 3;
        ctx.fillStyle = danger ? rgba(C.misfire) : rgba(C.tone);
        ctx.beginPath();
        ctx.moveTo(cx - 9, ay - 10);
        ctx.lineTo(cx + 9, ay - 10);
        ctx.lineTo(cx, ay);
        ctx.closePath();
        ctx.fill();
      }
    }
    for (const id of lastPos.keys()) if (!seen.has(id) && lastPos.size > 40) lastPos.delete(id);
  }

  // ---------------------------------------------------------------- 上の帯（時間・コンボ・金額）

  function drawHud(g, state, now, totalMs) {
    const pad = Math.round(22 * g.u);
    ctx.fillStyle = rgba(C.bg, 0.72);
    ctx.fillRect(0, 0, W, g.hud);
    ctx.fillStyle = rgba(C['line-soft']);
    ctx.fillRect(0, g.hud - 1, W, 1);

    // 残り時間
    const sec = state.remainingMs / 1000;
    const low = sec <= 10;
    const flash = now < timeFlashUntil;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgba(C['fg-dim']);
    ctx.font = `600 ${Math.round(11.5 * g.u)}px ${FONT}`;
    ctx.fillText('のこり', pad, Math.round(24 * g.u));
    ctx.font = `700 ${Math.round(30 * g.u)}px ${FONT}`;
    ctx.fillStyle = flash ? rgba(C.perfect) : low ? rgba(C.off, 0.75 + 0.25 * Math.sin(now / 90)) : rgba(C.fg);
    const tText = sec.toFixed(1);
    ctx.fillText(tText, pad, g.hud - Math.round(16 * g.u));
    const tw = ctx.measureText(tText).width;
    ctx.font = `600 ${Math.round(13 * g.u)}px ${FONT}`;
    ctx.fillStyle = rgba(C['fg-mid']);
    ctx.fillText('秒', pad + tw + 4, g.hud - Math.round(16 * g.u));

    // 時間の帯。いちばん上の縁に全幅で。延長ぶんで 100% を超えたら満タンで止める
    const k = clamp01(state.remainingMs / totalMs);
    ctx.fillStyle = rgba(C['line-soft']);
    ctx.fillRect(0, g.hud - 4, W, 3);
    ctx.fillStyle = low ? rgba(C.off) : rgba(C.tone);
    ctx.fillRect(0, g.hud - 4, W * k, 3);

    // コンボ（中央）
    ctx.textAlign = 'center';
    if (state.combo >= 2) {
      ctx.font = `700 ${Math.round(28 * g.u)}px ${FONT}`;
      ctx.fillStyle = rgba(C.tone);
      ctx.fillText(String(state.combo), W / 2, g.hud - Math.round(26 * g.u));
      ctx.font = `600 ${Math.round(11.5 * g.u)}px ${FONT}`;
      ctx.fillStyle = rgba(C['fg-mid']);
      ctx.fillText('コンボ', W / 2, g.hud - Math.round(11 * g.u));
    } else {
      ctx.font = `600 ${Math.round(12 * g.u)}px ${FONT}`;
      ctx.fillStyle = rgba(C['fg-dim']);
      ctx.fillText('ミスせず続けると時間が延びる', W / 2, g.hud - Math.round(26 * g.u));
    }

    // 金額（右）。コースの値段を越えたら «得» の色に変わる
    const right = W - pad;
    const pulse = now < moneyPulseUntil ? 1 + 0.12 * Math.sin(((moneyPulseUntil - now) / 260) * Math.PI) : 1;
    ctx.textAlign = 'right';
    ctx.font = `600 ${Math.round(11.5 * g.u)}px ${FONT}`;
    ctx.fillStyle = rgba(C['fg-dim']);
    const bal = state.money - state.price;
    ctx.fillText(
      bal >= 0 ? `コース ${yen(state.price)}円 → ${yen(bal)}円 得` : `コース ${yen(state.price)}円まで あと ${yen(-bal)}円`,
      right, Math.round(20 * g.u));
    ctx.save();
    const my = g.hud - Math.round(13 * g.u);
    ctx.translate(right, my);
    ctx.scale(pulse, pulse);
    ctx.font = `700 ${Math.round(30 * g.u)}px ${FONT}`;
    ctx.fillStyle = bal >= 0 ? rgba(C.perfect) : rgba(C.fg);
    const mText = yen(state.money);
    const yW = (() => { ctx.font = `600 ${Math.round(14 * g.u)}px ${FONT}`; return ctx.measureText('円').width; })();
    ctx.font = `700 ${Math.round(30 * g.u)}px ${FONT}`;
    ctx.fillText(mText, -yW - 4, 0);
    ctx.font = `600 ${Math.round(14 * g.u)}px ${FONT}`;
    ctx.fillStyle = rgba(C['fg-mid']);
    ctx.fillText('円', 0, 0);
    ctx.restore();

    // 元を取るまでの帯（金額の下）
    const bw = Math.min(220 * g.u, W * 0.22);
    const bk = clamp01(state.money / state.price);
    ctx.fillStyle = rgba(C['line-soft']);
    ctx.fillRect(right - bw, Math.round(27 * g.u), bw, 3);
    ctx.fillStyle = bal >= 0 ? rgba(C.perfect) : rgba(C.cross);
    ctx.fillRect(right - bw, Math.round(27 * g.u), bw * bk, 3);
  }

  // ---------------------------------------------------------------- 注文札（いま打つ単語）

  function drawOrder(g, state, now) {
    const head = state.plates[0];
    if (!head) return;
    const chars = [...head.word.kana];
    const panelW = Math.min(W - 40, 760 * g.u);
    const room = Math.max(120, g.panelBottom - g.panelTop);
    const panelH = Math.min(room, Math.round(230 * g.u));
    let px = (W - panelW) / 2;
    const py = g.panelTop + (room - panelH) / 2;

    // 打ち間違いで札を揺らす。字そのものは揺らさない範囲で小さく
    if (now < shakeUntil) {
      const k = (now - shakeT0) / (shakeUntil - shakeT0);
      px += Math.sin(k * Math.PI * 6) * 7 * (1 - k);
    }
    const missing = now < missFlash.until;

    ctx.fillStyle = rgba(C.panel, 0.94);
    roundRect(px, py, panelW, panelH, 14);
    ctx.fill();
    ctx.lineWidth = missing ? 2.5 : 1;
    ctx.strokeStyle = missing ? rgba(C.misfire) : rgba(C.line);
    ctx.stroke();

    const cx = px + panelW / 2;
    // 漢字かな交じり（大）
    const labelSize = fitFont(head.word.label, panelW - 60, Math.round(Math.min(58, panelH * 0.3)), 800, 18);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgba(C.fg);
    // 漢字とかなの二段をまとめて札の縦の真ん中に置く（案内は札の下端に別に出す）
    const kguess = Math.round(Math.min(34, panelH * 0.2));
    const block = labelSize + Math.round(18 * g.u) + kguess;
    const labelY = py + (panelH - block) / 2 + labelSize * 0.86 - Math.round(6 * g.u);
    ctx.fillText(head.word.label, cx, labelY);

    // かな（打つもの）。一字ずつ置いて、打ち終えた字の色を変える
    let ksz = Math.round(Math.min(34, panelH * 0.2));
    const gap = 0.12;
    ctx.font = `700 ${ksz}px ${FONT}`;
    let total = chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + ksz * gap * (chars.length - 1);
    while (total > panelW - 50 && ksz > 14) {
      ksz -= 1;
      ctx.font = `700 ${ksz}px ${FONT}`;
      total = chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + ksz * gap * (chars.length - 1);
    }
    const ky = labelY + Math.round(18 * g.u) + ksz;
    let x = cx - total / 2;
    ctx.textAlign = 'left';
    chars.forEach((c, i) => {
      const w = ctx.measureText(c).width;
      if (i === head.typed) {
        // いまの字。下線と淡い地で示す
        ctx.fillStyle = missing ? rgba(C.misfire, 0.2) : rgba(C.tone, 0.16);
        roundRect(x - 3, ky - ksz * 0.95, w + 6, ksz * 1.25, 6);
        ctx.fill();
        ctx.fillStyle = missing ? rgba(C.misfire) : rgba(C.tone);
        ctx.fillRect(x - 2, ky + ksz * 0.24, w + 4, 3);
      }
      ctx.fillStyle = i < head.typed ? rgba(C.tone, 0.95) : i === head.typed ? rgba(C.fg) : rgba(C['fg-mid']);
      if (i < head.typed) ctx.globalAlpha = 0.55;
      ctx.fillText(c, x, ky);
      ctx.globalAlpha = 1;
      x += w + ksz * gap;
    });

    // 詰まったときの打ち方。二度続けて外したら出す
    const want = chars[head.typed];
    if (state.missStreak >= 2 && want) {
      const how = keyFor(want);
      if (how) {
        const thumb = how.thumb === 'left' ? '左親指 ＋ ' : how.thumb === 'right' ? '右親指 ＋ ' : '親指なし・単独で ';
        const text = `「${want}」は ${thumb}${keyName(how.code)}`;
        ctx.textAlign = 'center';
        ctx.font = `700 ${Math.round(14 * g.u)}px ${FONT}`;
        ctx.fillStyle = rgba(C.off);
        ctx.fillText(text, cx, py + panelH - Math.round(12 * g.u));
      }
    } else if (missing && missFlash.misfire) {
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.round(14 * g.u)}px ${FONT}`;
      ctx.fillStyle = rgba(C.misfire);
      ctx.fillText('不発：親指が効いていません', cx, py + panelH - Math.round(12 * g.u));
    }
  }

  // ---------------------------------------------------------------- 下の帯

  function drawFoot(g, state, thumbs) {
    const y = H - Math.round(16 * g.u);
    const pad = Math.round(22 * g.u);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = `600 ${Math.round(12.5 * g.u)}px ${FONT}`;
    const items = [
      ['皿', `${state.cleared}枚`, C.fg],
      ['ぴったり', `${state.perfect}`, C.perfect],
      ['ミス', `${state.misses}`, C.misfire],
      ['取り逃し', `${state.lost}`, C['fg-mid']],
    ];
    let x = pad;
    for (const [k, v, col] of items) {
      ctx.fillStyle = rgba(C['fg-dim']);
      ctx.font = `600 ${Math.round(12 * g.u)}px ${FONT}`;
      ctx.fillText(k, x, y);
      x += ctx.measureText(k).width + 6;
      ctx.fillStyle = rgba(col);
      ctx.font = `700 ${Math.round(15 * g.u)}px ${FONT}`;
      ctx.fillText(v, x, y);
      x += ctx.measureText(v).width + Math.round(20 * g.u);
    }

    // 親指ランプ。押しっぱなしに気づかせるため、指の状態をそのまま映す
    if (thumbs) {
      ctx.textAlign = 'right';
      let rx = W - pad;
      for (const [side, name] of [['right', '右親指'], ['left', '左親指']]) {
        const on = thumbs[side];
        ctx.font = `600 ${Math.round(12 * g.u)}px ${FONT}`;
        ctx.fillStyle = on ? rgba(C.tone) : rgba(C['fg-dim']);
        ctx.fillText(name, rx, y);
        const tw = ctx.measureText(name).width;
        ctx.beginPath();
        ctx.arc(rx - tw - 10, y - 5, 5, 0, Math.PI * 2);
        ctx.fillStyle = on ? rgba(C.tone) : rgba(C.line);
        ctx.fill();
        rx -= tw + 34;
      }
    }
  }

  // ---------------------------------------------------------------- 演出

  function addFloat(text, x, y, color, now, { size = 22, dur = 900, rise = 60, tag = null } = {}) {
    fx.push({ kind: 'float', text, x, y, color, t0: now, dur, size, rise, tag });
  }

  function addBurst(x, y, color, now, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 3) * 0.2;
      const sp = 60 + (i % 4) * 30;
      fx.push({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, color, t0: now, dur: 650 });
    }
  }

  /** engine の events を演出に直す。音は main.js が鳴らす */
  function events(list, state, now) {
    const g = geom();
    for (const e of list) {
      const pos = lastPos.get(e.plateId);
      if (e.type === 'clear' && pos) {
        fx.push({ kind: 'lift', ...pos, t0: now, dur: 520 });
        addBurst(pos.cx, pos.cy - g.R * 0.4, C.tone, now, 12);
        // 浮く文字はレーンの中に収める。札（読む字）の上には演出を重ねない
        const moneySize = Math.round(26 * g.u);
        addFloat(`+${yen(e.value)}円`, pos.cx, pos.cy - g.R * 0.2, C.perfect, now, { size: moneySize, dur: 1000, rise: g.R * 0.7 });
        // 最後の一打がぴったりだと、横に出した «ぴったり +20» と金額が狭い画面で重なる。
        // 皿を取った時点で金額の真上へ積み直す。持ち上がる皿（lift）より後ろに並べ直して、
        // 皿の下に隠れないようにする（fx は並んだ順に描く）
        const tag = `perfect:${e.plateId}`;
        const moved = fx.filter((f) => f.tag === tag);
        fx = fx.filter((f) => f.tag !== tag);
        for (const f of moved) {
          f.x = pos.cx;
          f.y = pos.cy - g.R * 0.2 - moneySize * 1.15;
          f.rise = g.R * 0.7;
          fx.push(f);
        }
        moneyPulseUntil = now + 260;
      } else if (e.type === 'perfect' && pos) {
        addBurst(pos.cx, pos.cy - g.R * 0.3, C.perfect, now, 8);
        // 同じ皿で続けてぴったりを出すと文字が積み重なって読めない。前のものを差し替える
        fx = fx.filter((f) => f.tag !== `perfect:${e.plateId}`);
        addFloat(`ぴったり +${e.bonus}`, pos.cx - g.R * 2.2, pos.cy - g.R * 0.1, C.perfect, now, { size: Math.round(16 * g.u), dur: 800, rise: g.R * 0.5, tag: `perfect:${e.plateId}` });
      } else if (e.type === 'miss') {
        shakeT0 = now;
        shakeUntil = now + 260;
        missFlash = { until: now + 320, misfire: !!e.misfire };
      } else if (e.type === 'lost' && pos) {
        fx.push({ kind: 'drop', ...pos, t0: now, dur: 700 });
        addFloat('取り逃し', Math.max(60, pos.cx + g.R * 1.6), pos.cy - g.R * 0.8, C['fg-mid'], now, { size: Math.round(15 * g.u), dur: 900, rise: 24 });
      } else if (e.type === 'combo') {
        timeFlashUntil = now + 600;
        addFloat(`+${(e.bonusMs / 1000).toFixed(e.bonusMs % 1000 ? 1 : 0)}秒`, Math.round(150 * g.u), g.hud + Math.round(26 * g.u), C.perfect, now, { size: Math.round(20 * g.u), dur: 900, rise: 20 });
        addFloat(`${e.combo} コンボ！`, W / 2, g.laneY - g.laneH / 2 - Math.round(4 * g.u), C.tone, now, { size: Math.round(26 * g.u), dur: 900, rise: 20 });
      }
    }
  }

  function drawFx(g, now) {
    fx = fx.filter((f) => now - f.t0 < f.dur);
    for (const f of fx) {
      const k = clamp01((now - f.t0) / f.dur);
      if (f.kind === 'float') {
        ctx.save();
        ctx.globalAlpha = 1 - k ** 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `700 ${f.size}px ${FONT}`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = rgba(C.bg, 0.85);
        const y = f.y - easeOut(k) * f.rise;
        ctx.strokeText(f.text, f.x, y);
        ctx.fillStyle = rgba(f.color);
        ctx.fillText(f.text, f.x, y);
        ctx.restore();
      } else if (f.kind === 'spark') {
        const t = (now - f.t0) / 1000;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = rgba(f.color);
        ctx.beginPath();
        ctx.arc(f.x + f.vx * t, f.y + f.vy * t + 120 * t * t, 3 * (1 - k) + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'lift') {
        // 取った皿が手元へ持ち上がって消える
        const y = f.cy - easeOut(k) * g.R * 1.6;
        drawPlate(f.cx, y, g.R, f.tier, { alpha: 1 - k, scale: 1 + 0.25 * k, glow: rgba(C.perfect, 0.8) });
      } else if (f.kind === 'drop') {
        // 流れた皿がレーンの外へ落ちる
        const y = f.cy + k * k * g.R * 2.4;
        drawPlate(Math.max(0, f.cx) - k * 20, y, g.R, f.tier, { alpha: (1 - k) * 0.7 });
      }
    }
  }

  function drawCountdown(g, n, now) {
    ctx.fillStyle = rgba(C.bg, 0.55);
    ctx.fillRect(0, 0, W, H);
    const frac = n - Math.floor(n);
    const shown = Math.ceil(n);
    ctx.save();
    ctx.translate(W / 2, H * 0.44);
    const sc = 1 + 0.4 * (frac);
    ctx.scale(sc, sc);
    ctx.globalAlpha = Math.min(1, 0.3 + frac * 1.2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(120 * g.u)}px ${FONT}`;
    ctx.fillStyle = rgba(C.tone);
    ctx.fillText(shown > 0 ? String(shown) : 'はじめ', 0, 0);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${Math.round(15 * g.u)}px ${FONT}`;
    ctx.fillStyle = rgba(C['fg-mid']);
    ctx.fillText('日本語入力はオフ（英数）に。Esc で中断', W / 2, H * 0.44 + Math.round(110 * g.u));
    void now;
  }

  // ---------------------------------------------------------------- 一枚描く

  /**
   * @param {{ mode: 'attract'|'countdown'|'play'|'over', state: object, now: number,
   *           countdown?: number, thumbs?: {left:boolean,right:boolean}, totalMs?: number,
   *           laneMs?: number }} view
   */
  function draw(view) {
    const { mode, state, now } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = geom();

    // 地
    ctx.fillStyle = rgba(C.bg);
    ctx.fillRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.1, 10, W * 0.5, H * 0.1, W * 0.7);
    bg.addColorStop(0, rgba(C.tone, 0.1));
    bg.addColorStop(1, rgba(C.tone, 0));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 待っている間・終わったあとは、ベルトの流れを止めない（止めると画面が死んで見える）
    drawLane(g, now, view.laneMs ?? course?.laneMs ?? 9000);
    const attract = mode === 'attract';
    drawPlates(g, state, now, { attract });

    if (!attract) {
      drawOrder(g, state, now);
      drawHud(g, state, now, view.totalMs ?? course?.timeMs ?? 60000);
      drawFoot(g, state, view.thumbs);
    }
    drawFx(g, now);
    if (mode === 'countdown') drawCountdown(g, view.countdown ?? 0, now);
  }

  return {
    resize,
    readTheme,
    setCourse(c) {
      course = c;
      fx = [];
      lastPos.clear();
    },
    events,
    draw,
  };
}
