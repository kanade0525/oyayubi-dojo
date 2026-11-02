// 配列表の画像（修了の特典）。
//
// このファイルは何か
//   NICOLA の 3 面（単独打鍵・左親指・右親指）を一枚の PNG に描いて保存させる。
//   A4 横（印刷用）と、モニターの縁に貼る細長い版の二つ。
//
// なぜ画面の中で描くのか
//   このサイトは外のサービスを使わない（CSP の connect-src は API 一つだけ）。
//   画像を置いておく手もあるが、配列表（assets/data/nicola.js）と食い違う元を増やしたくない。
//   いつも配列表そのものから描く。
//
// 印刷するものなので、画面の配色に関わらず白地に黒で描く。
// 書体は画面と同じゴシック（--ui と同じ並び）。

const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", "Yu Gothic UI", Meiryo, "Noto Sans CJK JP", sans-serif';
const ROWS = [
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
];
const LEGEND = { Semicolon: ';', Comma: ',', Period: '.', Slash: '/' };
const INK = '#111111';
const MID = '#555555';
const SAME = '#1f5fbf';   // 同側シフト（別のかな）
const CROSS = '#b0306a';  // 交差シフト（主に濁音・半濁音）

/** 一つのキーを描く。単独打鍵を大きく、上の左右に左親指・右親指の面 */
function drawKey(g, k, code, x, y, s) {
  g.strokeStyle = '#999999';
  g.lineWidth = Math.max(1, s * 0.02);
  g.strokeRect(x, y, s, s);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = INK;
  g.font = `600 ${s * 0.42}px ${FONT}`;
  g.fillText(k.none ?? '', x + s / 2, y + s * 0.66);
  g.font = `${s * 0.24}px ${FONT}`;
  g.fillStyle = k.hand === 'left' ? SAME : CROSS;
  g.fillText(k.left ?? '', x + s * 0.27, y + s * 0.24);
  g.fillStyle = k.hand === 'right' ? SAME : CROSS;
  g.fillText(k.right ?? '', x + s * 0.73, y + s * 0.24);
  g.fillStyle = MID;
  g.font = `${s * 0.13}px ${FONT}`;
  g.textAlign = 'right';
  g.fillText(LEGEND[code] ?? code.replace(/^Key/, ''), x + s - s * 0.06, y + s - s * 0.1);
}

function drawBoard(g, layout, x0, y0, s, gap) {
  ROWS.forEach((row, r) => {
    row.forEach((code, i) => {
      drawKey(g, layout.keys[code], code, x0 + r * s * 0.35 + i * (s + gap), y0 + r * (s + gap), s);
    });
  });
}

/** kind: 'a4'（2480×1754、A4 横 300dpi 相当の 7 割）| 'strip'（2400×560） */
export function renderLayoutSheet(layout, kind = 'a4') {
  const a4 = kind === 'a4';
  const W = a4 ? 2480 : 2400;
  const H = a4 ? 1754 : 560;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const s = a4 ? 190 : 150;
  const gap = a4 ? 14 : 10;
  const boardW = 10 * (s + gap) + 2 * s * 0.35;
  const x0 = (W - boardW) / 2;
  if (a4) {
    g.fillStyle = INK;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = `700 64px ${FONT}`;
    g.fillText('NICOLA 配列表', x0, 190);
    g.font = `32px ${FONT}`;
    g.fillStyle = MID;
    g.fillText('大きい字：単独打鍵　上の左：左親指と同時　上の右：右親指と同時', x0, 250);
    g.fillStyle = SAME;
    g.fillText('青＝同じ側の親指（別のかな）', x0, 1560);
    g.fillStyle = CROSS;
    g.fillText('赤紫＝逆の側の親指（主に濁音・半濁音）', x0 + 620, 1560);
    g.fillStyle = MID;
    g.fillText('親指シフトマスター　https://kanade0525.github.io/oyayubi-dojo/', x0, 1640);
    drawBoard(g, layout, x0, 380, s, gap);
  } else {
    drawBoard(g, layout, x0, (H - (3 * s + 2 * gap)) / 2, s, gap);
  }
  return c;
}

/** 描いて PNG として保存させる */
export function downloadLayoutPng(layout, kind = 'a4') {
  const c = renderLayoutSheet(layout, kind);
  c.toBlob((blob) => {
    if (!blob) throw new Error('配列表の画像を作れませんでした');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = kind === 'a4' ? 'nicola-layout-a4.png' : 'nicola-layout-strip.png';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}
