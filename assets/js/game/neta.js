// 皿に載せる絵（canvas 2D）。
//
// このファイルは何か
//   words.js の各語が持つ pic（絵の名前）から、皿の上の絵を描く。
//   «鯖» の皿に玉子が載っていると、読んだ字と目に入る絵が食い違い、一瞬止まる。
//   絵は語を読む助けであって、邪魔をしてはいけない。だから語ごとに合う絵を決めてある。
//
// 何を描くか
//   寿司ネタはネタの色と模様（トロのさし・光り物の皮・海老の縞）で描き分ける。
//   寿司でない語（蕎麦・団子・季節の語・店でのひとこと）は、その語が指す物を描く。
//   «春» は桜、«お愛想» は積んだ皿、のように、店や季節の中で一番それらしい物を選んだ。
//
// 大きさ
//   皿の横半径の基準 R（render.js の g.R）だけで寸法を決める。R は 26〜60px 程度と小さいので、
//   細かい描き込みはせず、色の面と太い線で «何か» が分かることを優先している。
//   絵は皿の幅（2.6R）と、皿の上 1.3R ほどに収める。
//
// 色
//   寿司と食べ物の色は «実物の色» なので配色（data-tone）に関わらず固定。
//   外部画像は使わない（CSP と «外へ出ない» 約束）。すべて図形で描く。
//
// 契約
//   export const PICS        … 絵の名前 → 描く関数 (ctx, cx, cy, R) の表
//   export function drawPic(ctx, name, cx, cy, R)
//   知らない名前は例外にする（黙って別の絵を出すと、食い違いに誰も気づかない）。
//   words.js の pic がすべて PICS にあることは tools/words.test.mjs が確かめる。

const RICE = '#f4efe4';
const NORI = '#1d2a22';
const NEGI = '#6fae3c';
const GINGER = '#f2c9a0';

// ---------------------------------------------------------------- 小物

function ell(ctx, x, y, rx, ry, fill, rot = 0) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
  ctx.fill();
}

function rr(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** 白っぽい物は白い皿に溶けるので、薄い縁を引く。直前に作った道（path）をなぞる */
const EDGE = 'rgba(60,45,30,0.28)';
function edge(ctx, R) {
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = Math.max(1, R * 0.025);
  ctx.stroke();
}

function poly(ctx, pts, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

function line(ctx, x1, y1, x2, y2, stroke, width) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** 決まった並びの乱数。毎フレーム同じ位置に粒を置くため（ちらつかせない） */
function seq(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shadow(ctx, cx, cy, rx, ry) {
  ell(ctx, cx, cy, rx, ry, 'rgba(0,0,0,0.18)');
}

// 寸法の基準。旧来の寿司の大きさに合わせてある
const dims = (R) => ({ w: R * 1.25, h: R * 0.62 });

// ---------------------------------------------------------------- 握り

/**
 * 握り一貫。spec:
 *   color   … ネタの地の色
 *   skin    … ネタの上側の帯（皮・焼き目・血合い）の色。edge は帯の厚み（ネタの高さに対する割合）
 *   pat     … 'marble'（さし）| 'stripe'（サーモンの脂）| 'ebi'（海老の縞）| 'dots' | 'ridge' | 'grill' | 'bumps' | 'cross'
 *   patColor… 模様の色、patN … 模様の数
 *   band    … 海苔の帯を巻く
 *   top     … 'negi'（ねぎと生姜）| 'tsume'（煮詰めのつや）| 'sear'（炙り）| 'hotaru'（蛍烏賊の身）
 *   tail    … 尾の色（海老）
 */
function nigiri(ctx, cx, cy, R, spec) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.62, h * 0.32);
  // しゃり
  rr(ctx, cx - w / 2, cy - h * 0.45, w, h * 0.8, h * 0.35, RICE);
  edge(ctx, R);
  if (spec.tail) {
    // 尾はネタの右端から跳ね上がる。ネタより先に描いて下に潜らせる
    poly(ctx, [[cx + w * 0.5, cy - h * 0.62], [cx + w * 0.78, cy - h * 0.98], [cx + w * 0.82, cy - h * 0.48], [cx + w * 0.5, cy - h * 0.4]], spec.tail);
  }
  // ネタ
  const nx = cx - w * 0.58;
  const ny = cy - h * 0.86;
  const nw = w * 1.16;
  const nh = h * 0.74;
  rr(ctx, nx, ny, nw, nh, h * 0.32, spec.color);
  edge(ctx, R);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(nx, ny, nw, nh, h * 0.32);
  ctx.clip();
  const lw = Math.max(1.5, R * 0.05);
  const rnd = seq(spec.seed ?? 7);
  switch (spec.pat) {
    case 'marble': {
      // トロのさし。斜めの白い筋。多いほど脂が乗っている
      const n = spec.patN ?? 4;
      for (let i = 0; i < n; i++) {
        const x = nx + ((i + 0.5) / n) * nw;
        line(ctx, x - nw * 0.12, ny, x + nw * 0.06, ny + nh, spec.patColor ?? 'rgba(255,240,240,0.7)', lw * (0.8 + rnd() * 0.6));
      }
      break;
    }
    case 'stripe': {
      for (let i = -1; i <= 1; i++) {
        line(ctx, cx + i * w * 0.3 - w * 0.08, ny + nh * 0.06, cx + i * w * 0.3 + w * 0.08, ny + nh * 0.9, spec.patColor, lw * 1.4);
      }
      break;
    }
    case 'ebi': {
      // 茹で海老の紅白の縞。縦に太く
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = spec.patColor;
        ctx.fillRect(nx + nw * (0.06 + i * 0.2), ny, nw * 0.09, nh);
      }
      break;
    }
    case 'dots': {
      for (let i = 0; i < (spec.patN ?? 9); i++) {
        ell(ctx, nx + nw * (0.1 + rnd() * 0.8), ny + nh * (0.15 + rnd() * 0.35), lw * 0.75, lw * 0.6, spec.patColor);
      }
      break;
    }
    case 'ridge': {
      // 縁側の筋。細かい縦の線
      for (let i = 0; i < 9; i++) {
        const x = nx + nw * (0.08 + i * 0.105);
        line(ctx, x, ny + nh * 0.15, x + nw * 0.03, ny + nh * 0.85, spec.patColor, lw * 0.6);
      }
      break;
    }
    case 'grill': {
      // 鰻・穴子の焼き目
      for (let i = 0; i < 4; i++) {
        const x = nx + nw * (0.15 + i * 0.24);
        line(ctx, x, ny + nh * 0.1, x - nw * 0.06, ny + nh * 0.9, spec.patColor, lw * 1.1);
      }
      break;
    }
    case 'bumps': {
      // 数の子の粒
      for (let i = 0; i < 14; i++) {
        ell(ctx, nx + nw * (0.06 + rnd() * 0.88), ny + nh * (0.15 + rnd() * 0.7), lw * 0.7, lw * 0.7, spec.patColor);
      }
      break;
    }
    case 'cross': {
      // 烏賊の隠し包丁
      for (let i = 0; i < 6; i++) {
        const x = nx + nw * (0.1 + i * 0.16);
        line(ctx, x, ny + nh * 0.2, x + nw * 0.05, ny + nh * 0.75, spec.patColor, lw * 0.5);
      }
      break;
    }
    default:
      break;
  }
  if (spec.skin) {
    ctx.fillStyle = spec.skin;
    ctx.fillRect(nx, ny, nw, nh * (spec.edge ?? 0.35));
    if (spec.shine) {
      // 光り物の銀の筋
      line(ctx, nx, ny + nh * (spec.edge ?? 0.35), nx + nw, ny + nh * (spec.edge ?? 0.35), spec.shine, lw * 0.9);
    }
  }
  if (spec.top === 'sear') {
    for (let i = 0; i < 6; i++) {
      ell(ctx, nx + nw * (0.1 + rnd() * 0.8), ny + nh * (0.1 + rnd() * 0.3), nw * 0.09, nh * 0.12, 'rgba(90,45,15,0.55)');
    }
  }
  ctx.restore();
  if (spec.band) {
    ctx.fillStyle = NORI;
    ctx.fillRect(cx - w * 0.1, cy - h * 0.8, w * 0.2, h * 1.12);
  }
  if (spec.top === 'negi') {
    // 生姜とねぎを真ん中に少し
    ell(ctx, cx - w * 0.06, ny + nh * 0.1, w * 0.13, h * 0.11, GINGER);
    for (let i = 0; i < 5; i++) ell(ctx, cx + w * (-0.12 + i * 0.07), ny + nh * (0.02 + (i % 2) * 0.12), lw * 0.9, lw * 0.9, NEGI);
  }
  if (spec.top === 'hotaru') {
    // 蛍烏賊は小さな身が三つ並ぶ
    for (let i = -1; i <= 1; i++) {
      ell(ctx, cx + i * w * 0.32, ny + nh * 0.42, w * 0.15, h * 0.24, '#6e3b3a');
      ell(ctx, cx + i * w * 0.32 - w * 0.06, ny + nh * 0.35, w * 0.04, h * 0.05, '#2a1414');
    }
  }
  // つや（煮詰めは強め）
  ctx.fillStyle = spec.top === 'tsume' ? 'rgba(255,230,190,0.45)' : 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.roundRect(cx - w * 0.42, cy - h * 0.7, w * 0.4, h * 0.12, h * 0.06);
  ctx.fill();
}

const N = (spec) => (ctx, cx, cy, R) => nigiri(ctx, cx, cy, R, spec);

// 光り物の皮。上から青灰→銀
const HIKARI = { color: '#e9b9ad', skin: '#7f93a8', edge: 0.55, shine: '#dfe7ef' };

// ---------------------------------------------------------------- 軍艦・巻物

function gunkan(ctx, cx, cy, R, fill) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.62, h * 0.32);
  rr(ctx, cx - w * 0.42, cy - h * 0.55, w * 0.84, h * 0.95, h * 0.2, NORI);
  ell(ctx, cx, cy - h * 0.55, w * 0.42, h * 0.24, '#2a3a30');
  const lw = Math.max(1.2, R * 0.04);
  const rnd = seq(11);
  const top = cy - h * 0.62;
  switch (fill) {
    case 'ikura':
      for (let i = 0; i < 9; i++) {
        const x = cx + (rnd() - 0.5) * w * 0.66;
        const y = top + (rnd() - 0.5) * h * 0.3;
        ell(ctx, x, y, w * 0.09, w * 0.09, '#e8501c');
        ell(ctx, x - w * 0.03, y - w * 0.03, lw * 0.7, lw * 0.7, 'rgba(255,255,255,0.75)');
      }
      break;
    case 'uni':
      for (let i = 0; i < 4; i++) {
        ell(ctx, cx + (i - 1.5) * w * 0.17, top + (i % 2) * h * 0.06, w * 0.12, h * 0.17, '#e6a12f', 0.3);
      }
      for (let i = 0; i < 4; i++) line(ctx, cx + (i - 1.6) * w * 0.17, top - h * 0.08, cx + (i - 1.4) * w * 0.17, top + h * 0.1, '#c27c18', lw * 0.6);
      break;
    case 'negitoro':
      ell(ctx, cx, top, w * 0.4, h * 0.22, '#e8848d');
      for (let i = 0; i < 7; i++) ell(ctx, cx + (rnd() - 0.5) * w * 0.6, top + (rnd() - 0.5) * h * 0.22, lw, lw, NEGI);
      break;
    case 'shirasu':
      ell(ctx, cx, top, w * 0.4, h * 0.2, '#efe9db');
      for (let i = 0; i < 9; i++) {
        const x = cx + (rnd() - 0.5) * w * 0.6;
        const y = top + (rnd() - 0.5) * h * 0.2;
        line(ctx, x - w * 0.06, y, x + w * 0.06, y + (rnd() - 0.5) * h * 0.1, '#d8cfbb', lw * 0.8);
        ell(ctx, x - w * 0.06, y, lw * 0.45, lw * 0.45, '#333');
      }
      break;
    case 'kani':
      ell(ctx, cx, top, w * 0.4, h * 0.2, '#f6ece4');
      for (let i = 0; i < 6; i++) {
        const x = cx + (rnd() - 0.5) * w * 0.6;
        line(ctx, x - w * 0.07, top + (rnd() - 0.5) * h * 0.2, x + w * 0.07, top + (rnd() - 0.5) * h * 0.2, '#e0553e', lw * 1.3);
      }
      break;
    default:
      throw new Error(`軍艦の中身を知らない: ${fill}`);
  }
}

const G = (fill) => (ctx, cx, cy, R) => gunkan(ctx, cx, cy, R, fill);

/** 細巻き二つ。core は芯の色（一色か二色） */
function maki(ctx, cx, cy, R, core) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.62, h * 0.32);
  for (const dx of [-0.26, 0.26]) {
    const x = cx + dx * w;
    ell(ctx, x, cy - h * 0.15, w * 0.24, h * 0.5, NORI);
    ell(ctx, x, cy - h * 0.38, w * 0.2, h * 0.24, RICE);
    ell(ctx, x, cy - h * 0.38, w * 0.09, h * 0.11, core[0]);
    if (core[1]) ell(ctx, x + w * 0.04, cy - h * 0.36, w * 0.04, h * 0.05, core[1]);
  }
}

const M = (...core) => (ctx, cx, cy, R) => maki(ctx, cx, cy, R, core);

function inari(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.62, h * 0.32);
  rr(ctx, cx - w * 0.52, cy - h * 0.7, w * 1.04, h, h * 0.5, '#b8742c');
  rr(ctx, cx - w * 0.44, cy - h * 0.66, w * 0.88, h * 0.4, h * 0.2, '#cf8d40');
  const rnd = seq(5);
  for (let i = 0; i < 6; i++) ell(ctx, cx + (rnd() - 0.5) * w * 0.7, cy - h * (0.15 + rnd() * 0.4), R * 0.03, R * 0.02, '#f3e7c9');
}

function temaki(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.5, h * 0.28);
  // 円錐の海苔。口を左上に向けて寝かせる
  poly(ctx, [[cx + w * 0.55, cy + h * 0.2], [cx - w * 0.5, cy - h * 0.55], [cx - w * 0.2, cy - h * 1.25]], NORI);
  ell(ctx, cx - w * 0.35, cy - h * 0.9, w * 0.22, h * 0.38, RICE, -0.6);
  ell(ctx, cx - w * 0.42, cy - h * 1.0, w * 0.1, h * 0.22, '#b81d34', -0.6);
  line(ctx, cx - w * 0.3, cy - h * 0.95, cx - w * 0.38, cy - h * 1.45, '#5fa33a', R * 0.08);
}

/** 握りを三貫並べる（特上・おまかせ） */
function moriawase(ctx, cx, cy, R) {
  const s = R * 0.55;
  const { w } = dims(R);
  nigiri(ctx, cx - w * 0.55, cy, s, PICS_SPEC.maguro);
  nigiri(ctx, cx + w * 0.55, cy, s, PICS_SPEC.ikura_like);
  nigiri(ctx, cx, cy + R * 0.12, s, PICS_SPEC.chutoro);
}

// ---------------------------------------------------------------- 器もの

/**
 * 椀・丼。器を描いてから、口の楕円に中身を描く。
 * fill(ctx, x, y, rx, ry, R) は口の楕円の中に描く（はみ出しは切る）
 */
function bowl(ctx, cx, cy, R, { outer, inner, soup, fill, wide = 1 }) {
  const { w, h } = dims(R);
  const rx = w * 0.62 * wide;
  const ry = h * 0.3;
  const y0 = cy - h * 0.55;
  shadow(ctx, cx, cy + h * 0.4, rx * 0.8, h * 0.28);
  // 高台
  rr(ctx, cx - rx * 0.4, cy + h * 0.15, rx * 0.8, h * 0.2, 2, outer);
  // 胴
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.moveTo(cx - rx, y0);
  ctx.bezierCurveTo(cx - rx, y0 + h * 0.75, cx - rx * 0.5, cy + h * 0.25, cx, cy + h * 0.25);
  ctx.bezierCurveTo(cx + rx * 0.5, cy + h * 0.25, cx + rx, y0 + h * 0.75, cx + rx, y0);
  ctx.closePath();
  ctx.fill();
  // 口
  ell(ctx, cx, y0, rx, ry, inner);
  ell(ctx, cx, y0 + ry * 0.12, rx * 0.88, ry * 0.76, soup);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, y0 + ry * 0.12, rx * 0.88, ry * 0.76, 0, 0, Math.PI * 2);
  ctx.clip();
  fill?.(ctx, cx, y0 + ry * 0.12, rx * 0.88, ry * 0.76, R);
  ctx.restore();
}

const lw = (R) => Math.max(1.4, R * 0.05);

/** 麺。口の楕円の中に、ゆるく曲がった線を何本か */
function noodles(color, n = 7) {
  return (ctx, x, y, rx, ry, R) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw(R) * 1.1;
    for (let i = 0; i < n; i++) {
      const yy = y - ry * 0.7 + (i / (n - 1)) * ry * 1.4;
      ctx.beginPath();
      ctx.moveTo(x - rx, yy);
      ctx.bezierCurveTo(x - rx * 0.3, yy - ry * 0.35, x + rx * 0.3, yy + ry * 0.35, x + rx, yy);
      ctx.stroke();
    }
  };
}

function negiDots(ctx, x, y, rx, ry, R, n = 6) {
  const rnd = seq(3);
  for (let i = 0; i < n; i++) ell(ctx, x + (rnd() - 0.5) * rx * 1.2, y + (rnd() - 0.5) * ry, lw(R) * 0.9, lw(R) * 0.9, NEGI);
}

function tempuraShape(ctx, x, y, len, thick, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  poly(ctx, [[len * 0.45, 0], [len * 0.62, -thick * 0.9], [len * 0.62, thick * 0.9]], '#d9442c');
  ell(ctx, 0, 0, len * 0.5, thick, '#e2ad55');
  const rnd = seq(9);
  for (let i = 0; i < 6; i++) ell(ctx, (rnd() - 0.5) * len * 0.8, (rnd() - 0.5) * thick, thick * 0.3, thick * 0.25, '#f0cc80');
  ctx.restore();
}

const SOBA = { outer: '#26252a', inner: '#8e2020', soup: '#5a3518' };
const UDON = { outer: '#26252a', inner: '#8e2020', soup: '#c99a52' };
const WAN = { outer: '#7d1a1a', inner: '#1d1a1a', soup: '#b47d3e' };
const DON = { outer: '#e9eef4', inner: '#3a5f9a', soup: RICE };

const BOWLS = {
  soba: { ...SOBA, fill: (ctx, x, y, rx, ry, R) => { noodles('#8a7458')(ctx, x, y, rx, ry, R); negiDots(ctx, x, y, rx, ry, R); } },
  udon: { ...UDON, fill: (ctx, x, y, rx, ry, R) => { noodles('#f5ecd8', 6)(ctx, x, y, rx, ry, R); negiDots(ctx, x, y, rx, ry, R, 4); } },
  kitsune: {
    ...UDON,
    fill: (ctx, x, y, rx, ry, R) => {
      noodles('#f5ecd8', 6)(ctx, x, y, rx, ry, R);
      rr(ctx, x - rx * 0.45, y - ry * 0.6, rx * 0.8, ry * 1.1, 3, '#c98a35');
      negiDots(ctx, x + rx * 0.3, y, rx * 0.5, ry, R, 3);
    },
  },
  tensoba: {
    ...SOBA,
    fill: (ctx, x, y, rx, ry, R) => {
      noodles('#8a7458')(ctx, x, y, rx, ry, R);
      tempuraShape(ctx, x - rx * 0.1, y, rx * 1.1, ry * 0.4, -0.15);
    },
  },
  miso: {
    ...WAN,
    fill: (ctx, x, y, rx, ry, R) => {
      const s = rx * 0.14;
      for (const [dx, dy] of [[-0.4, -0.2], [0.15, 0.25], [0.45, -0.3]]) rr(ctx, x + dx * rx - s / 2, y + dy * ry - s / 2, s, s * 0.8, 1, '#f6f1e4');
      ell(ctx, x - rx * 0.05, y - ry * 0.25, rx * 0.25, ry * 0.25, '#2f5a2c', 0.4);
      negiDots(ctx, x, y, rx, ry, R, 3);
    },
  },
  asari: {
    ...WAN,
    fill: (ctx, x, y, rx, ry, R) => {
      for (const [dx, dy] of [[-0.45, 0], [0, -0.25], [0.42, 0.15], [-0.05, 0.4]]) {
        ell(ctx, x + dx * rx, y + dy * ry, rx * 0.2, ry * 0.42, '#5a5048');
        ell(ctx, x + dx * rx, y + dy * ry - ry * 0.05, rx * 0.12, ry * 0.25, '#e8c08a');
      }
      negiDots(ctx, x, y, rx, ry, R, 3);
    },
  },
  zoni: {
    ...WAN,
    soup: '#e6d6b0',
    fill: (ctx, x, y, rx, ry, R) => {
      rr(ctx, x - rx * 0.4, y - ry * 0.5, rx * 0.55, ry * 0.9, ry * 0.3, '#fbf8f0');
      ell(ctx, x + rx * 0.4, y - ry * 0.1, rx * 0.16, ry * 0.3, '#e46a2a');
      ell(ctx, x + rx * 0.2, y + ry * 0.45, rx * 0.2, ry * 0.2, '#4f8a3a');
    },
  },
  oyako: {
    ...DON,
    soup: '#f1c94e',
    fill: (ctx, x, y, rx, ry, R) => {
      const rnd = seq(4);
      for (let i = 0; i < 5; i++) rr(ctx, x + (rnd() - 0.6) * rx * 1.2, y + (rnd() - 0.6) * ry, rx * 0.22, ry * 0.4, 3, '#b5773a');
      for (let i = 0; i < 4; i++) ell(ctx, x + (rnd() - 0.5) * rx, y + (rnd() - 0.5) * ry, rx * 0.08, ry * 0.15, '#4f9a3a');
    },
  },
  kaisen: {
    ...DON,
    fill: (ctx, x, y, rx, ry, R) => {
      ell(ctx, x - rx * 0.45, y - ry * 0.1, rx * 0.3, ry * 0.5, '#b81d34', 0.3);
      ell(ctx, x + rx * 0.05, y - ry * 0.3, rx * 0.28, ry * 0.45, '#f2834a', -0.2);
      ell(ctx, x + rx * 0.5, y + ry * 0.1, rx * 0.25, ry * 0.45, '#f3c94b');
      const rnd = seq(8);
      for (let i = 0; i < 6; i++) ell(ctx, x + (rnd() - 0.4) * rx * 0.6, y + ry * (0.3 + rnd() * 0.3), rx * 0.06, rx * 0.06, '#e8501c');
      ell(ctx, x - rx * 0.1, y + ry * 0.35, rx * 0.12, ry * 0.2, '#8fbf4a');
    },
  },
  zuke: {
    ...DON,
    fill: (ctx, x, y, rx, ry) => {
      for (let i = 0; i < 5; i++) ell(ctx, x + (i - 2) * rx * 0.3, y - ry * 0.05 + (i % 2) * ry * 0.15, rx * 0.22, ry * 0.55, i % 2 ? '#7d1b28' : '#93222f', -0.5);
      ell(ctx, x + rx * 0.05, y - ry * 0.4, rx * 0.12, ry * 0.18, '#8fbf4a');
    },
  },
  chirashi: {
    outer: '#1c1a1c',
    inner: '#9e2420',
    soup: RICE,
    wide: 1.12,
    fill: (ctx, x, y, rx, ry, R) => {
      const cols = ['#b81d34', '#f2834a', '#f3c94b', '#e8501c', '#eeeae0', '#5fa33a', '#f2795c', '#f6b8c8'];
      const rnd = seq(21);
      for (let i = 0; i < 14; i++) {
        rr(ctx, x + (rnd() - 0.55) * rx * 1.7, y + (rnd() - 0.6) * ry * 1.5, rx * 0.2, ry * 0.32, 2, cols[i % cols.length]);
      }
    },
  },
  somen: {
    outer: 'rgba(170,215,235,0.85)',
    inner: '#d9eef6',
    soup: '#e6f3f8',
    fill: (ctx, x, y, rx, ry, R) => {
      noodles('#fbfaf5', 8)(ctx, x, y, rx, ry, R);
      ell(ctx, x + rx * 0.4, y - ry * 0.2, rx * 0.14, ry * 0.3, 'rgba(255,255,255,0.9)');
      ell(ctx, x - rx * 0.3, y + ry * 0.3, rx * 0.12, ry * 0.25, '#d9442c');
    },
  },
  agedashi: {
    outer: '#5b4636',
    inner: '#3a2d23',
    soup: '#a8722f',
    fill: (ctx, x, y, rx, ry) => {
      rr(ctx, x - rx * 0.4, y - ry * 0.7, rx * 0.8, ry * 1.3, 4, '#d9a24a');
      ell(ctx, x, y - ry * 0.45, rx * 0.22, ry * 0.3, '#f6f1e4');
      ell(ctx, x + rx * 0.05, y - ry * 0.62, rx * 0.08, ry * 0.12, NEGI);
    },
  },
};

const B = (name) => (ctx, cx, cy, R) => bowl(ctx, cx, cy, R, BOWLS[name]);

function yunomi(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.42, h * 0.26);
  const x0 = cx - w * 0.3;
  rr(ctx, x0, cy - h * 1.2, w * 0.6, h * 1.5, [2, 2, h * 0.25, h * 0.25], '#7f8f78');
  // 釉の流れ
  rr(ctx, x0, cy - h * 1.2, w * 0.6, h * 0.45, 2, '#9fae93');
  ell(ctx, cx, cy - h * 1.2, w * 0.3, h * 0.14, '#5e6b55');
  ell(ctx, cx, cy - h * 1.18, w * 0.25, h * 0.1, '#a5b85a');
  // 湯気
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = lw(R);
  for (const dx of [-0.1, 0.12]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * w, cy - h * 1.35);
    ctx.bezierCurveTo(cx + (dx - 0.1) * w, cy - h * 1.6, cx + (dx + 0.1) * w, cy - h * 1.75, cx + dx * w, cy - h * 2);
    ctx.stroke();
  }
}

function dangoSkewer(ctx, cx, cy, R, cols, rot = -0.25) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.6, h * 0.28);
  ctx.save();
  ctx.translate(cx, cy - h * 0.35);
  ctx.rotate(rot);
  line(ctx, -w * 0.75, 0, w * 0.7, 0, '#c9a26a', lw(R) * 0.9);
  const r = w * 0.2;
  cols.forEach((c, i) => {
    const x = (i - (cols.length - 1) / 2) * r * 2.05;
    ell(ctx, x, 0, r, r, c);
    edge(ctx, R);
    ell(ctx, x - r * 0.35, -r * 0.35, r * 0.25, r * 0.18, 'rgba(255,255,255,0.4)');
  });
  ctx.restore();
}

function tsukimi(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  // 月を奥に
  ell(ctx, cx + w * 0.45, cy - h * 1.35, w * 0.24, w * 0.24, '#f3d36a');
  shadow(ctx, cx, cy + h * 0.38, w * 0.6, h * 0.28);
  // 三方（台）
  rr(ctx, cx - w * 0.5, cy - h * 0.1, w, h * 0.35, 2, '#d8b98a');
  const r = w * 0.15;
  const row = (n, y) => { for (let i = 0; i < n; i++) { const x = cx + (i - (n - 1) / 2) * r * 2; ell(ctx, x, y, r, r, '#f8f5ec'); edge(ctx, R); } };
  row(3, cy - h * 0.1 - r);
  row(2, cy - h * 0.1 - r * 2.7);
  row(1, cy - h * 0.1 - r * 4.4);
}

function mochi(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.6, h * 0.28);
  for (const dx of [-0.28, 0.28]) {
    rr(ctx, cx + dx * w - w * 0.25, cy - h * 0.65, w * 0.5, h * 0.8, h * 0.3, '#fbf8f0');
    edge(ctx, R);
    ell(ctx, cx + dx * w + w * 0.05, cy - h * 0.5, w * 0.1, h * 0.08, '#c9934a');
  }
}

function kagami(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.6, h * 0.28);
  rr(ctx, cx - w * 0.55, cy - h * 0.05, w * 1.1, h * 0.3, 2, '#e9e2d0');
  ell(ctx, cx, cy - h * 0.3, w * 0.5, h * 0.35, '#fbf8f0');
  edge(ctx, R);
  ell(ctx, cx, cy - h * 0.75, w * 0.38, h * 0.3, '#fffdf7');
  edge(ctx, R);
  ell(ctx, cx, cy - h * 1.12, w * 0.17, w * 0.15, '#f08a1f');
  ell(ctx, cx + w * 0.08, cy - h * 1.32, w * 0.09, w * 0.04, '#3f8a3a', -0.4);
}

function hishimochi(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.6, h * 0.28);
  const layer = (y, c) => poly(ctx, [[cx - w * 0.5, y], [cx, y - h * 0.32], [cx + w * 0.5, y], [cx, y + h * 0.32]], c);
  // 下から緑・白・桃。厚みは側面の帯で
  const cols = ['#7fb25a', '#fbf8f0', '#f4a9bb'];
  cols.forEach((c, i) => {
    const y = cy - h * 0.1 - i * h * 0.28;
    poly(ctx, [[cx - w * 0.5, y], [cx, y + h * 0.32], [cx + w * 0.5, y], [cx + w * 0.5, y + h * 0.22], [cx, y + h * 0.54], [cx - w * 0.5, y + h * 0.22]], c);
    poly(ctx, [[cx - w * 0.5, y], [cx, y + h * 0.32], [cx + w * 0.5, y], [cx + w * 0.5, y + h * 0.22], [cx, y + h * 0.54], [cx - w * 0.5, y + h * 0.22]], 'rgba(0,0,0,0.12)');
    layer(y, c);
  });
}

function tamagoyaki(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.62, h * 0.28);
  for (const dx of [-0.3, 0.3]) {
    const x = cx + dx * w - w * 0.27;
    // 上面
    poly(ctx, [[x, cy - h * 0.6], [x + w * 0.1, cy - h * 0.82], [x + w * 0.64, cy - h * 0.82], [x + w * 0.54, cy - h * 0.6]], '#e6b23c');
    // 切り口。巻いた層が見える
    rr(ctx, x, cy - h * 0.6, w * 0.54, h * 0.85, 3, '#f5d35c');
    for (let i = 1; i < 4; i++) line(ctx, x + w * 0.04, cy - h * 0.6 + i * h * 0.2, x + w * 0.5, cy - h * 0.6 + i * h * 0.2, '#e3b53e', lw(R) * 0.7);
  }
}

function chawanmushi(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.45, h * 0.26);
  rr(ctx, cx - w * 0.36, cy - h * 0.75, w * 0.72, h * 1.05, [2, 2, h * 0.3, h * 0.3], '#efe8d6');
  edge(ctx, R);
  for (let i = 0; i < 3; i++) line(ctx, cx - w * 0.36, cy - h * (0.45 - i * 0.22), cx + w * 0.36, cy - h * (0.45 - i * 0.22), '#3b5f9a', lw(R) * 0.6);
  // 蓋
  ell(ctx, cx, cy - h * 0.8, w * 0.42, h * 0.2, '#e3dac4');
  ctx.fillStyle = '#efe8d6';
  ctx.beginPath();
  ctx.ellipse(cx, cy - h * 0.82, w * 0.4, h * 0.42, 0, Math.PI, 0);
  ctx.fill();
  ell(ctx, cx, cy - h * 1.25, w * 0.09, h * 0.08, '#3b5f9a');
}

function tempura(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.62, h * 0.3);
  // 敷き紙
  poly(ctx, [[cx - w * 0.55, cy - h * 0.1], [cx + w * 0.2, cy - h * 0.55], [cx + w * 0.6, cy + h * 0.1], [cx - w * 0.15, cy + h * 0.45]], '#fbf8f0');
  edge(ctx, R);
  tempuraShape(ctx, cx - w * 0.05, cy - h * 0.15, w * 1.1, h * 0.2, -0.3);
  tempuraShape(ctx, cx + w * 0.05, cy - h * 0.45, w * 1.1, h * 0.2, -0.35);
}

function oden(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.6, h * 0.28);
  ctx.save();
  ctx.translate(cx, cy - h * 0.45);
  ctx.rotate(-0.2);
  line(ctx, -w * 0.8, 0, w * 0.7, 0, '#c9a26a', lw(R) * 0.9);
  // こんにゃく（三角）・大根・玉
  poly(ctx, [[-w * 0.6, h * 0.35], [-w * 0.25, h * 0.35], [-w * 0.42, -h * 0.4]], '#6b6660');
  ell(ctx, w * 0.05, 0, w * 0.21, h * 0.42, '#d9b77a');
  ell(ctx, w * 0.05, 0, w * 0.15, h * 0.32, '#e8d3a2');
  ell(ctx, w * 0.45, 0, w * 0.17, w * 0.17, '#9a6230');
  ctx.restore();
}

function shoyu(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.3, w * 0.5, h * 0.24);
  ell(ctx, cx, cy - h * 0.15, w * 0.48, h * 0.38, '#f3f0ea');
  edge(ctx, R);
  ell(ctx, cx, cy - h * 0.13, w * 0.38, h * 0.27, '#2c1409');
  ell(ctx, cx - w * 0.12, cy - h * 0.2, w * 0.1, h * 0.05, 'rgba(255,255,255,0.4)');
}

function wasabi(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.3, w * 0.4, h * 0.22);
  ctx.fillStyle = '#8fbf4a';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.38, cy + h * 0.05);
  ctx.bezierCurveTo(cx - w * 0.3, cy - h * 0.8, cx + w * 0.3, cy - h * 0.8, cx + w * 0.38, cy + h * 0.05);
  ctx.closePath();
  ctx.fill();
  const rnd = seq(2);
  for (let i = 0; i < 8; i++) ell(ctx, cx + (rnd() - 0.5) * w * 0.5, cy - h * (0.05 + rnd() * 0.45), R * 0.025, R * 0.025, '#6e9e33');
}

function gari(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.3, w * 0.5, h * 0.24);
  [[-0.2, -0.1, -0.5], [0.15, -0.2, 0.3], [0, -0.45, 0], [-0.1, -0.3, 0.9]].forEach(([dx, dy, rot]) => {
    ell(ctx, cx + dx * w, cy + dy * h, w * 0.26, h * 0.3, '#f4bdb3', rot);
    ell(ctx, cx + dx * w, cy + dy * h, w * 0.2, h * 0.22, '#f7d3c6', rot);
  });
}

function noriSheet(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.25, w * 0.6, h * 0.25);
  poly(ctx, [[cx - w * 0.6, cy - h * 0.1], [cx - w * 0.1, cy - h * 0.6], [cx + w * 0.6, cy - h * 0.35], [cx + w * 0.1, cy + h * 0.2]], NORI);
  line(ctx, cx - w * 0.3, cy - h * 0.25, cx + w * 0.2, cy - h * 0.2, 'rgba(120,160,130,0.45)', lw(R));
}

function hashi(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.2, w * 0.7, h * 0.2);
  // 箸置き
  rr(ctx, cx + w * 0.25, cy - h * 0.3, w * 0.22, h * 0.3, h * 0.12, '#3b5f9a');
  line(ctx, cx - w * 0.75, cy + h * 0.05, cx + w * 0.75, cy - h * 0.45, '#8a5a2a', lw(R) * 1.4);
  line(ctx, cx - w * 0.75, cy + h * 0.22, cx + w * 0.75, cy - h * 0.28, '#8a5a2a', lw(R) * 1.4);
}

function plates(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  // 食べ終えた皿を積む。お愛想は皿を数えて決まる
  const cols = [['#c8433a', '#fbefed'], ['#3d78c9', '#eef3fa'], ['#d4a83c', '#fbf5e4'], ['#d9d4c8', '#f6f3ec'], ['#3d78c9', '#eef3fa']];
  cols.forEach(([rim, face], i) => {
    const y = cy - i * h * 0.24;
    ell(ctx, cx, y + h * 0.06, w * 0.5, h * 0.24, 'rgba(0,0,0,0.25)');
    ell(ctx, cx, y, w * 0.5, h * 0.24, rim);
    ell(ctx, cx, y - h * 0.03, w * 0.38, h * 0.16, face);
  });
}

function fish(ctx, cx, cy, R, { body, belly, tail, grill = null, big = 1, split = false }) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.3, w * 0.7, h * 0.25);
  const y = cy - h * 0.3;
  const rx = w * 0.58 * big;
  const ry = h * (split ? 0.5 : 0.36) * big;
  // 尾（右）
  poly(ctx, [[cx + rx * 0.85, y], [cx + rx * 1.3, y - ry * 0.9], [cx + rx * 1.22, y], [cx + rx * 1.3, y + ry * 0.9]], tail);
  if (!split && big > 1) {
    // 背びれ
    poly(ctx, [[cx - rx * 0.3, y - ry * 0.8], [cx + rx * 0.1, y - ry * 1.5], [cx + rx * 0.5, y - ry * 0.7]], tail);
  }
  ell(ctx, cx, y, rx, ry, body);
  if (belly) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ell(ctx, cx, y + ry * 0.75, rx, ry * 0.55, belly);
    ctx.restore();
  }
  if (split) line(ctx, cx - rx * 0.8, y, cx + rx * 0.9, y, '#6b4220', lw(R) * 1.2);
  if (grill) for (let i = 0; i < 4; i++) line(ctx, cx - rx * 0.4 + i * rx * 0.3, y - ry * 0.7, cx - rx * 0.55 + i * rx * 0.3, y + ry * 0.6, grill, lw(R));
  if (!split) {
    ell(ctx, cx - rx * 0.68, y - ry * 0.15, R * 0.07, R * 0.07, '#f6f1e4');
    ell(ctx, cx - rx * 0.68, y - ry * 0.15, R * 0.035, R * 0.035, '#111');
    // えら
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = lw(R) * 0.8;
    ctx.beginPath();
    ctx.arc(cx - rx * 0.6, y, ry * 0.7, -0.9, 0.9);
    ctx.stroke();
  }
}

function fillet(ctx, cx, cy, R, { color, sauce, glaze }) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.3, w * 0.62, h * 0.26);
  if (sauce) ell(ctx, cx, cy - h * 0.05, w * 0.6, h * 0.32, sauce);
  rr(ctx, cx - w * 0.45, cy - h * 0.75, w * 0.9, h * 0.7, h * 0.3, color);
  rr(ctx, cx - w * 0.45, cy - h * 0.75, w * 0.9, h * 0.22, h * 0.2, 'rgba(0,0,0,0.25)');
  ell(ctx, cx - w * 0.15, cy - h * 0.5, w * 0.2, h * 0.07, glaze);
  ell(ctx, cx + w * 0.3, cy - h * 0.6, w * 0.1, h * 0.12, GINGER);
}

function jubako(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.38, w * 0.62, h * 0.3);
  // 重箱を二段。手前の面と上面
  rr(ctx, cx - w * 0.55, cy - h * 0.55, w * 1.1, h * 0.8, 2, '#1c1a1c');
  line(ctx, cx - w * 0.55, cy - h * 0.15, cx + w * 0.55, cy - h * 0.15, '#9e2420', lw(R));
  poly(ctx, [[cx - w * 0.55, cy - h * 0.55], [cx - w * 0.35, cy - h * 0.95], [cx + w * 0.75, cy - h * 0.95], [cx + w * 0.55, cy - h * 0.55]], '#9e2420');
  // 中身（海老・黒豆・伊達巻）
  ell(ctx, cx - w * 0.15, cy - h * 0.75, w * 0.18, h * 0.12, '#e2553a');
  ell(ctx, cx + w * 0.2, cy - h * 0.72, w * 0.16, h * 0.1, '#f3c94b');
  ell(ctx, cx + w * 0.45, cy - h * 0.82, w * 0.1, h * 0.07, '#111');
  ell(ctx, cx - w * 0.38, cy - h * 0.66, w * 0.08, h * 0.06, '#111');
}

// ---------------------------------------------------------------- 季節・景色

function sakura(ctx, cx, cy, R) {
  const { h } = dims(R);
  const s = R * 0.5;
  const y = cy - h * 0.55;
  ctx.save();
  ctx.translate(cx, y);
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 5);
    ctx.fillStyle = '#f6b3c4';
    ctx.beginPath();
    // 先が割れた花びら
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-s * 0.55, -s * 0.3, -s * 0.5, -s * 0.95, -s * 0.14, -s);
    ctx.lineTo(0, -s * 0.84);
    ctx.lineTo(s * 0.14, -s);
    ctx.bezierCurveTo(s * 0.5, -s * 0.95, s * 0.55, -s * 0.3, 0, 0);
    ctx.fill();
    line(ctx, 0, -s * 0.1, 0, -s * 0.4, '#e27a96', Math.max(1, R * 0.03));
    ctx.restore();
  }
  ell(ctx, 0, 0, s * 0.16, s * 0.16, '#e27a96');
  ctx.restore();
}

function momiji(ctx, cx, cy, R) {
  const { h } = dims(R);
  const s = R * 0.62;
  const y = cy - h * 0.5;
  // 七つの裂け目を持つ葉。先の尖った山を角度ごとに並べる
  const lobes = [[-90, 1], [-45, 0.9], [0, 0.75], [45, 0.45], [135, 0.45], [180, 0.75], [-135, 0.9]];
  ctx.fillStyle = '#d63f26';
  ctx.beginPath();
  lobes.forEach(([deg, len], i) => {
    const a = (deg * Math.PI) / 180;
    const b = ((lobes[(i + 1) % lobes.length][0] + (i === lobes.length - 1 ? 360 : 0) + deg) / 2) * (Math.PI / 180);
    const tip = [cx + Math.cos(a) * s * len, y + Math.sin(a) * s * len];
    const notch = [cx + Math.cos(b) * s * 0.42, y + Math.sin(b) * s * 0.42];
    if (i === 0) ctx.moveTo(tip[0], tip[1]);
    else ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(notch[0], notch[1]);
  });
  ctx.closePath();
  ctx.fill();
  line(ctx, cx, y, cx + s * 0.1, y + s * 0.75, '#9a2a18', Math.max(1.2, R * 0.05));
}

function snow(ctx, cx, cy, R) {
  const { h } = dims(R);
  const s = R * 0.55;
  const y = cy - h * 0.55;
  const c = '#5e98d6';
  const wdt = Math.max(1.5, R * 0.06);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const ex = cx + Math.cos(a) * s;
    const ey = y + Math.sin(a) * s;
    line(ctx, cx, y, ex, ey, c, wdt);
    for (const k of [0.55]) {
      const bx = cx + Math.cos(a) * s * k;
      const by = y + Math.sin(a) * s * k;
      for (const d of [-0.6, 0.6]) line(ctx, bx, by, bx + Math.cos(a + d) * s * 0.3, by + Math.sin(a + d) * s * 0.3, c, wdt);
    }
  }
}

function yukidaruma(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.35, w * 0.5, h * 0.25);
  const edge = '#b7c4d3';
  ell(ctx, cx, cy - h * 0.25, w * 0.42, w * 0.38, edge);
  ell(ctx, cx, cy - h * 0.25, w * 0.39, w * 0.35, '#fdfdfb');
  ell(ctx, cx, cy - h * 1.15, w * 0.3, w * 0.28, edge);
  ell(ctx, cx, cy - h * 1.15, w * 0.27, w * 0.25, '#fdfdfb');
  ell(ctx, cx - w * 0.1, cy - h * 1.2, R * 0.04, R * 0.04, '#222');
  ell(ctx, cx + w * 0.1, cy - h * 1.2, R * 0.04, R * 0.04, '#222');
  // バケツ
  poly(ctx, [[cx - w * 0.2, cy - h * 1.45], [cx + w * 0.2, cy - h * 1.45], [cx + w * 0.15, cy - h * 1.85], [cx - w * 0.15, cy - h * 1.85]], '#d0453a');
}

function hanabi(ctx, cx, cy, R) {
  const { h } = dims(R);
  const s = R * 0.62;
  const y = cy - h * 0.7;
  // 夜空の丸に開く。皿の白地の上では光が見えないので、暗い丸を敷く
  ell(ctx, cx, y, s * 1.08, s * 1.08, '#1d2240');
  const cols = ['#f7c948', '#f2696b', '#7ec8f2'];
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI * 2) / 16;
    const c = cols[i % 3];
    line(ctx, cx + Math.cos(a) * s * 0.22, y + Math.sin(a) * s * 0.22, cx + Math.cos(a) * s * 0.8, y + Math.sin(a) * s * 0.8, c, Math.max(1.4, R * 0.045));
    ell(ctx, cx + Math.cos(a) * s * 0.92, y + Math.sin(a) * s * 0.92, R * 0.04, R * 0.04, c);
  }
}

function suika(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.35, w * 0.6, h * 0.25);
  const r = w * 0.62;
  const y = cy - h * 0.05;
  const half = (rad, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(cx, y, rad, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  };
  half(r, '#2f7a34');
  half(r * 0.9, '#e9f1d4');
  half(r * 0.82, '#e5423f');
  for (const [dx, dy] of [[-0.45, -0.25], [-0.15, -0.5], [0.2, -0.45], [0.45, -0.22], [0, -0.22]]) {
    ell(ctx, cx + dx * r, y + dy * r, R * 0.035, R * 0.055, '#1b1b1b');
  }
}

function nami(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  const y = cy - h * 0.2;
  // 青海波。半円を重ねる
  for (const [row, n] of [[0, 3], [1, 2]]) {
    for (let i = 0; i < n; i++) {
      const x = cx + (i - (n - 1) / 2) * w * 0.5;
      const yy = y - row * h * 0.45;
      for (const [k, c] of [[1, '#2c5ea5'], [0.72, '#eef3fa'], [0.5, '#3d78c9'], [0.25, '#eef3fa']]) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, yy, w * 0.26 * k, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

function furin(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  const y = cy - h * 1.1;
  line(ctx, cx, y - h * 0.6, cx, y - h * 0.2, '#555', Math.max(1, R * 0.03));
  // 硝子の鉢
  ctx.fillStyle = 'rgba(200,230,245,0.95)';
  ctx.beginPath();
  ctx.arc(cx, y + h * 0.15, w * 0.3, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  line(ctx, cx - w * 0.22, y + h * 0.02, cx + w * 0.22, y + h * 0.02, '#d9442c', Math.max(1.4, R * 0.05));
  ell(ctx, cx - w * 0.1, y - h * 0.05, w * 0.05, h * 0.06, '#d9442c');
  // 短冊
  line(ctx, cx, y + h * 0.15, cx, y + h * 0.45, '#555', Math.max(1, R * 0.03));
  rr(ctx, cx - w * 0.08, y + h * 0.45, w * 0.16, h * 0.75, 1, '#f2d36a');
}

function mikan(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.35, w * 0.6, h * 0.25);
  for (const [dx, dy, s] of [[-0.3, 0, 1], [0.3, 0, 1], [0, -0.55, 0.95]]) {
    const x = cx + dx * w;
    const y = cy - h * 0.2 + dy * h;
    ell(ctx, x, y, w * 0.26 * s, h * 0.45 * s, '#f0921f');
    ell(ctx, x - w * 0.08, y - h * 0.15, w * 0.07, h * 0.08, 'rgba(255,230,180,0.6)');
  }
  ell(ctx, cx + w * 0.06, cy - h * 1.05, w * 0.11, h * 0.08, '#3f8a3a', -0.5);
}

function takenoko(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.35, w * 0.5, h * 0.25);
  poly(ctx, [[cx - w * 0.38, cy + h * 0.15], [cx + w * 0.38, cy + h * 0.15], [cx + w * 0.05, cy - h * 1.7]], '#8f5e34');
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    poly(ctx, [[cx - w * 0.38 * (1 - t), cy + h * 0.15 - t * h * 1.85], [cx + w * 0.38 * (1 - t) + w * 0.05 * t, cy + h * 0.15 - t * h * 1.85], [cx + w * 0.05 * t, cy + h * 0.15 - (t + 0.18) * h * 1.85]], i % 2 ? '#a8733f' : '#7a4e2a');
  }
  ell(ctx, cx + w * 0.05, cy - h * 1.6, w * 0.06, h * 0.12, '#b7c45a');
}

function yuyake(ctx, cx, cy, R) {
  const { h } = dims(R);
  const s = R * 0.62;
  const y = cy - h * 0.7;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, y, s, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y - s, 0, y + s);
  g.addColorStop(0, '#3b3a78');
  g.addColorStop(0.55, '#f08a4b');
  g.addColorStop(1, '#f6c35a');
  ctx.fillStyle = g;
  ctx.fillRect(cx - s, y - s, s * 2, s * 2);
  ell(ctx, cx, y + s * 0.45, s * 0.4, s * 0.4, '#fbe7a1');
  ctx.fillStyle = '#2b2d4a';
  ctx.fillRect(cx - s, y + s * 0.45, s * 2, s);
  ctx.restore();
}

function torii(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.3, w * 0.6, h * 0.2);
  const red = '#d23a2a';
  const pw = Math.max(3, R * 0.11);
  rr(ctx, cx - w * 0.38, cy - h * 1.5, pw, h * 1.7, 1, red);
  rr(ctx, cx + w * 0.38 - pw, cy - h * 1.5, pw, h * 1.7, 1, red);
  rr(ctx, cx - w * 0.5, cy - h * 1.2, w, pw * 0.8, 1, red);
  // 笠木。両端が反る
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.68, cy - h * 1.75);
  ctx.quadraticCurveTo(cx, cy - h * 1.5, cx + w * 0.68, cy - h * 1.75);
  ctx.lineTo(cx + w * 0.62, cy - h * 1.55);
  ctx.quadraticCurveTo(cx, cy - h * 1.32, cx - w * 0.62, cy - h * 1.55);
  ctx.closePath();
  ctx.fill();
  rr(ctx, cx - w * 0.58, cy - h * 1.58, w * 1.16, pw * 0.7, 1, red);
}

function koinobori(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  line(ctx, cx - w * 0.6, cy + h * 0.2, cx - w * 0.6, cy - h * 2, '#8a6a3a', Math.max(1.5, R * 0.05));
  const carp = (y, body, s) => {
    const x0 = cx - w * 0.6;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x0, y - h * 0.22 * s);
    ctx.quadraticCurveTo(x0 + w * 0.6 * s, y - h * 0.32 * s, x0 + w * 1.15 * s, y - h * 0.22 * s);
    ctx.lineTo(x0 + w * 0.95 * s, y);
    ctx.lineTo(x0 + w * 1.15 * s, y + h * 0.22 * s);
    ctx.quadraticCurveTo(x0 + w * 0.6 * s, y + h * 0.32 * s, x0, y + h * 0.22 * s);
    ctx.closePath();
    ctx.fill();
    ell(ctx, x0 + w * 0.15 * s, y - h * 0.02, R * 0.09 * s, R * 0.09 * s, '#fff');
    ell(ctx, x0 + w * 0.15 * s, y - h * 0.02, R * 0.045 * s, R * 0.045 * s, '#111');
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, R * 0.03);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x0 + w * (0.4 + i * 0.18) * s, y, h * 0.14 * s, -1.2, 1.2);
      ctx.stroke();
    }
  };
  carp(cy - h * 1.6, '#2a2f3a', 1);
  carp(cy - h * 0.85, '#d23a2a', 0.85);
}

function uchiwa(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.3, w * 0.5, h * 0.2);
  line(ctx, cx + w * 0.05, cy - h * 0.3, cx + w * 0.3, cy + h * 0.2, '#a87a3a', Math.max(2, R * 0.08));
  const y = cy - h * 1.0;
  ell(ctx, cx, y, w * 0.45, w * 0.42, '#f6f1e4');
  // 金魚
  ell(ctx, cx - w * 0.05, y, w * 0.14, w * 0.09, '#d9442c', -0.3);
  poly(ctx, [[cx + w * 0.06, y - w * 0.05], [cx + w * 0.22, y - w * 0.14], [cx + w * 0.2, y + w * 0.08]], '#d9442c');
  ctx.strokeStyle = '#3d78c9';
  ctx.lineWidth = Math.max(1, R * 0.03);
  ctx.beginPath();
  ctx.arc(cx, y, w * 0.45, 0, Math.PI * 2);
  ctx.stroke();
  for (const dy of [0.2, 0.3]) {
    ctx.beginPath();
    ctx.arc(cx - w * 0.15, y + w * dy, w * 0.08, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
}

function kakigori(ctx, cx, cy, R) {
  const { w, h } = dims(R);
  shadow(ctx, cx, cy + h * 0.3, w * 0.4, h * 0.2);
  // 脚付きの硝子の器
  rr(ctx, cx - w * 0.2, cy + h * 0.05, w * 0.4, h * 0.15, 2, 'rgba(180,220,240,0.95)');
  rr(ctx, cx - w * 0.05, cy - h * 0.3, w * 0.1, h * 0.4, 1, 'rgba(180,220,240,0.95)');
  ctx.fillStyle = 'rgba(180,220,240,0.95)';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.45, cy - h * 0.7);
  ctx.quadraticCurveTo(cx, cy - h * 0.05, cx + w * 0.45, cy - h * 0.7);
  ctx.closePath();
  ctx.fill();
  // 氷の山と苺の蜜
  ctx.fillStyle = '#fbfdff';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.42, cy - h * 0.7);
  ctx.bezierCurveTo(cx - w * 0.35, cy - h * 1.9, cx + w * 0.35, cy - h * 1.9, cx + w * 0.42, cy - h * 0.7);
  ctx.closePath();
  ctx.fill();
  edge(ctx, R);
  ctx.fillStyle = '#e8384f';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.3, cy - h * 1.2);
  ctx.bezierCurveTo(cx - w * 0.25, cy - h * 1.85, cx + w * 0.25, cy - h * 1.85, cx + w * 0.3, cy - h * 1.2);
  ctx.quadraticCurveTo(cx, cy - h * 1.0, cx - w * 0.3, cy - h * 1.2);
  ctx.fill();
}

function yakizakana(ctx, cx, cy, R) {
  fish(ctx, cx, cy, R, { body: '#b98245', belly: '#e3c08a', tail: '#7a4f25', grill: 'rgba(60,30,10,0.55)' });
}

// ---------------------------------------------------------------- 表

/** 握りの仕様。名前で引けるように表にしてある（盛り合わせも同じものを使う） */
const PICS_SPEC = {
  maguro: { color: '#b81d34' },
  chutoro: { color: '#de6672', pat: 'marble', patN: 4 },
  ootoro: { color: '#efb0b6', pat: 'marble', patN: 7, patColor: 'rgba(255,250,250,0.85)' },
  salmon: { color: '#f2834a', pat: 'stripe', patColor: '#fdd6bb' },
  aburi: { color: '#f2834a', pat: 'stripe', patColor: '#fdd6bb', top: 'sear' },
  ika: { color: '#f1eee6', pat: 'cross', patColor: '#d8d2c4' },
  tako: { color: '#f3e3dc', skin: '#8e2236', edge: 0.4, pat: 'dots', patColor: '#f6d6d6', patN: 5 },
  ebi: { color: '#fbefe6', pat: 'ebi', patColor: '#e9583a', tail: '#d9442c' },
  amaebi: { color: '#f5a58c', pat: 'stripe', patColor: 'rgba(255,220,205,0.7)', tail: '#e9583a' },
  botanebi: { color: '#f08a6c', pat: 'stripe', patColor: 'rgba(255,215,195,0.75)', tail: '#d9442c' },
  aji: { ...HIKARI, top: 'negi' },
  saba: { ...HIKARI, skin: '#6f8aa0', pat: 'grill', patColor: '#3d4f63' },
  shimesaba: { ...HIKARI, color: '#f2d8cf', skin: '#7f93a8', edge: 0.4 },
  iwashi: { ...HIKARI, pat: 'dots', patColor: '#3a4656', patN: 6, edge: 0.5 },
  kohada: { ...HIKARI, color: '#efe2d6', pat: 'dots', patColor: '#45515f', patN: 12 },
  sanma: { ...HIKARI, skin: '#59677a', top: 'negi' },
  buri: { color: '#f3cbb8', skin: '#b54a4a', edge: 0.22 },
  hamachi: { color: '#f5d4c3', skin: '#c35a5a', edge: 0.18 },
  kanpachi: { color: '#f3d9cc', skin: '#c97a72', edge: 0.16 },
  shimaaji: { color: '#f2dcd0', skin: '#c9a35a', edge: 0.14, shine: '#e8ebef' },
  tai: { color: '#f5e3de', skin: '#d76a6a', edge: 0.2 },
  hirame: { color: '#f2efe8', pat: 'cross', patColor: '#e2ddd2' },
  engawa: { color: '#ece2cc', pat: 'ridge', patColor: '#d4c6a6' },
  tara: { color: '#f4f1ea' },
  katsuo: { color: '#9e2a2e', skin: '#5a3a33', edge: 0.25, top: 'negi' },
  kinmedai: { color: '#f5e6e0', skin: '#d9373a', edge: 0.45, top: 'sear' },
  konbujime: { color: '#efeadf', skin: '#7c7a4a', edge: 0.18 },
  hotate: { color: '#f3e7d2', pat: 'ridge', patColor: 'rgba(225,205,175,0.6)' },
  akagai: { color: '#e2603e', skin: '#f3c2a8', edge: 0.15 },
  anago: { color: '#b98451', pat: 'grill', patColor: '#7a4f25', top: 'tsume' },
  unagi: { color: '#7d4a22', pat: 'grill', patColor: '#4f2a10', top: 'tsume', band: true },
  tamago: { color: '#f3c94b', skin: '#c98a2b', edge: 0.12, band: true },
  kazunoko: { color: '#e9cf6c', pat: 'bumps', patColor: '#f6e39a' },
  hotaruika: { color: RICE, top: 'hotaru' },
  kani: { color: '#f6ece4', skin: '#e0553e', edge: 0.4 },
  // 盛り合わせの右の一貫（サーモン）
  ikura_like: { color: '#f2834a', pat: 'stripe', patColor: '#fdd6bb' },
};

export const PICS = {
  ...Object.fromEntries(Object.entries(PICS_SPEC).filter(([k]) => k !== 'ikura_like').map(([k, spec]) => [k, N(spec)])),
  ikura: G('ikura'),
  uni: G('uni'),
  negitoro: G('negitoro'),
  shirasu: G('shirasu'),
  kappa: M('#5fae4a'),
  tekka: M('#b81d34'),
  negitoromaki: M('#e8848d', NEGI),
  natto: M('#a07a3a', '#c9a35e'),
  inari,
  temaki,
  moriawase,
  soba: B('soba'),
  udon: B('udon'),
  kitsune: B('kitsune'),
  tensoba: B('tensoba'),
  miso: B('miso'),
  asari: B('asari'),
  zoni: B('zoni'),
  oyako: B('oyako'),
  kaisen: B('kaisen'),
  zuke: B('zuke'),
  chirashi: B('chirashi'),
  somen: B('somen'),
  agedashi: B('agedashi'),
  yunomi,
  dango: (ctx, cx, cy, R) => dangoSkewer(ctx, cx, cy, R, ['#f4b6c2', '#f8f5ec', '#9cc27a']),
  tsukimi,
  mochi,
  kagami,
  hishimochi,
  tamagoyaki,
  chawanmushi,
  tempura,
  oden,
  shoyu,
  wasabi,
  gari,
  nori: noriSheet,
  hashi,
  plates,
  yakizakana,
  tai_okashira: (ctx, cx, cy, R) => fish(ctx, cx, cy, R, { body: '#d9454a', belly: '#f4c9c0', tail: '#c23a3e', big: 1.1 }),
  hokke: (ctx, cx, cy, R) => fish(ctx, cx, cy, R, { body: '#c99a55', belly: null, tail: '#8a5a2a', grill: 'rgba(90,50,20,0.45)', split: true }),
  teriyaki: (ctx, cx, cy, R) => fillet(ctx, cx, cy, R, { color: '#8a4a1f', sauce: null, glaze: 'rgba(255,220,170,0.55)' }),
  misoni: (ctx, cx, cy, R) => fillet(ctx, cx, cy, R, { color: '#a77a45', sauce: '#8a5a28', glaze: 'rgba(255,230,190,0.5)' }),
  jubako,
  sakura,
  momiji,
  snow,
  yukidaruma,
  hanabi,
  suika,
  nami,
  furin,
  mikan,
  takenoko,
  yuyake,
  torii,
  koinobori,
  uchiwa,
  kakigori,
};

export function drawPic(ctx, name, cx, cy, R) {
  const fn = PICS[name];
  if (!fn) throw new Error(`皿の絵 ${name} が neta.js に無い`);
  ctx.save();
  fn(ctx, cx, cy, R);
  ctx.restore();
}
