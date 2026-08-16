// 3 面キーボード図
// ================================================================
// このファイルは何か
//   NICOLA 配列を、1 キー 3 面のまま描く図。
//   プレイ画面の «次に押すキー» の案内、配列表の画面、
//   マイページの苦手ヒートマップ、すべてこの 1 つの図を使い回す。
//
// なぜこの方針か
//   1. ローマ字用のキーボード図では NICOLA を表せない。
//      1 つのキーに «単独打鍵»「同じ側の親指と」「逆側の親指と」の 3 面がある。
//      だから 3 面を 1 つの箱に収める描き方を専用に作った。
//
//        ┌─────────┐
//        │ ぱ   ば │  ← 上段：左親指の面 / 右親指の面
//        │    は   │  ← 下段：単独打鍵（いちばん使うので大きく）
//        └─────────┘
//
//   2. 色を分ける軸は «左シフトか右シフトか» ではなく «同じ側の親指か、逆側か»。
//      NICOLA には「逆側の親指（交差シフト）なら主に濁音・半濁音、
//      同じ側の親指（同側シフト）なら別のかな」という規則性がある（規格 §5.3）。
//      左右で色を分けると、この規則は図の上でばらばらになる。
//      同側 / 交差で分けると、規則がそのまま模様として見えるので覚えが速い。
//      左右のどちらの親指かは «面が左寄りか右寄りか» という位置が示す。
//      ―― 位置がどちらの親指かを、色が規則を担う。二つの情報が喧嘩しない。
//
//      «濁音になる面» ＝ 交差シフトの面。こちらを地を塗った重い面にしてある。
//      学習者はこの図で「この色は濁音」と覚えるので、ここを取り違えさせない。
//
//   3. 色だけに意味を持たせない。
//      同側は地を塗り、交差は破線の枠。色が見えなくても形で分かる。
//      配列表の画面には言葉の凡例も置いてある。
//
//   4. 親指ランプはこの図と同じ container に置く。
//      「シフトが沈んだままなのに気づかず、連続で外し続ける」が
//      親指シフト学習のいちばん典型的な詰まり方なので、
//      親指の状態は打鍵中ずっと目に入る場所に置く。
//
// 契約（CONTRACT.md）
//   export function renderKeyboard(container, layout)
//   export function highlight(container, { charCode, thumb })
//   export function setThumbLamp(container, { left, right })

/* ---------------------------------------------------------------- 物理配列 */

// 段ごとのキー。code と、キートップに小さく出す刻印。
// NICOLA が使うのは英字 3 段 + 記号少々なので、数字段は描かない。
const ROWS = [
  [
    ['KeyQ', 'Q'], ['KeyW', 'W'], ['KeyE', 'E'], ['KeyR', 'R'], ['KeyT', 'T'],
    ['KeyY', 'Y'], ['KeyU', 'U'], ['KeyI', 'I'], ['KeyO', 'O'], ['KeyP', 'P'],
  ],
  [
    ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyF', 'F'], ['KeyG', 'G'],
    ['KeyH', 'H'], ['KeyJ', 'J'], ['KeyK', 'K'], ['KeyL', 'L'], ['Semicolon', ';'],
  ],
  [
    ['KeyZ', 'Z'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'],
    ['KeyN', 'N'], ['KeyM', 'M'], ['Comma', ','], ['Period', '.'], ['Slash', '/'],
  ],
];

// どちらの手で打つキーか。同側 / 交差は、これと親指の左右だけで決まる
const LEFT_HAND = new Set([
  'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT',
  'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB',
]);

const handOf = (code) => (LEFT_HAND.has(code) ? 'left' : 'right');

/* ---------------------------------------------------------------- 仮の配列データ

   ★ これはダミーです。★
   本物は assets/data/nicola.json（コア担当）で、layout.js の
   lookup(layout, charCode, thumb) から引きます。まだ存在しないので、
   図の描き方と色分けを確かめられるだけの仮の表をここに置いています。

   仮の表は CONTRACT.md の規則（規格 §5.3）に揃えてあります。
     交差シフト（左手のキー×右親指 / 右手のキー×左親指） … 主に濁音・半濁音
     同側シフト（左手のキー×左親指 / 右手のキー×右親指） … 別のかな
   たとえば左手の「し」は、右親指と打てば「じ」、左親指と打てば「あ」。
   本物のデータが入ったら、この定数は消してください。
   面の中身も shiftKind も、そちらが唯一の正になります。          */

const FALLBACK = {
  // 単独 / 左親指の面 / 右親指の面
  // 左手のキー（Q〜T, A〜G, Z〜B）は «右» の欄が濁音になる
  KeyQ: ['。', 'ぁ', '？'],
  KeyW: ['か', 'え', 'が'],
  KeyE: ['た', 'り', 'だ'],
  KeyR: ['こ', 'ゃ', 'ご'],
  KeyT: ['さ', 'れ', 'ざ'],
  // 右手のキー（Y〜P, H〜;, N〜/）は «左» の欄が濁音になる
  KeyY: ['ら', 'ぱ', 'よ'],
  KeyU: ['ち', 'ぢ', 'に'],
  KeyI: ['く', 'ぐ', 'る'],
  KeyO: ['つ', 'づ', 'ま'],
  KeyP: ['，', 'ぴ', 'ぇ'],

  KeyA: ['う', 'を', 'ぅ'],
  KeyS: ['し', 'あ', 'じ'],
  KeyD: ['て', 'な', 'で'],
  KeyF: ['け', 'ゅ', 'げ'],
  KeyG: ['せ', 'も', 'ぜ'],
  KeyH: ['は', 'ば', 'み'],
  KeyJ: ['と', 'ど', 'お'],
  KeyK: ['き', 'ぎ', 'の'],
  KeyL: ['い', 'ぽ', 'ょ'],
  Semicolon: ['ん', '', 'っ'],

  KeyZ: ['．', 'ぃ', ''],
  KeyX: ['ひ', 'ー', 'び'],
  KeyC: ['す', 'ろ', 'ず'],
  KeyV: ['ふ', 'や', 'ぶ'],
  KeyB: ['へ', '', 'べ'],
  KeyN: ['め', 'ぷ', 'ぬ'],
  KeyM: ['そ', 'ぞ', 'ゆ'],
  Comma: ['ね', 'ぺ', 'む'],
  Period: ['ほ', 'ぼ', 'わ'],
  Slash: ['・', '', 'ぉ'],
};

/* ---------------------------------------------------------------- 配列の読み方 */

/**
 * 与えられた layout から 1 キー分（3 面）を取り出す。
 *
 * layout.js の lookup() が使えるなら、それを使うのが正しい。呼び出し側から
 * options.lookup で渡してもらう。渡されなければ、素直な形の layout を
 * 自前で読みにいき、それも駄目ならダミーに落ちる。
 * ―― 図が «何も出ない» のがいちばん困るので、必ず何かは描けるようにしてある。
 */
function faceOf(code, layout, lookup) {
  if (lookup && layout) {
    const solo = lookup(layout, code, null);
    const left = lookup(layout, code, 'left');
    const right = lookup(layout, code, 'right');
    if (solo || left || right) {
      return {
        solo: solo?.kana || '',
        left: left?.kana || '',
        right: right?.kana || '',
        leftKind: left?.shiftKind || null,
        rightKind: right?.shiftKind || null,
      };
    }
  }

  // lookup が無いとき用の、ゆるい読み取り。よくある形をいくつか試す
  const raw = layout && (layout.keys?.[code] ?? layout[code]);
  if (raw) {
    const pick = (...names) => {
      for (const n of names) if (typeof raw[n] === 'string' && raw[n]) return raw[n];
      return '';
    };
    const solo = Array.isArray(raw) ? raw[0] : pick('none', 'solo', 'single', 'kana');
    const left = Array.isArray(raw) ? raw[1] : pick('left', 'leftShift');
    const right = Array.isArray(raw) ? raw[2] : pick('right', 'rightShift');
    if (solo || left || right) {
      return { solo, left, right, leftKind: null, rightKind: null };
    }
  }

  const f = FALLBACK[code];
  return f
    ? { solo: f[0], left: f[1], right: f[2], leftKind: null, rightKind: null }
    : { solo: '', left: '', right: '', leftKind: null, rightKind: null };
}

/** 親指の左右とキーの手から、同側か交差かを決める */
const kindOf = (code, thumb) => (thumb === handOf(code) ? 'same' : 'cross');

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------------------------------------------------------------- 描く */

/**
 * 配列図を組む。container の中身は総取り替えになる。
 * @param {HTMLElement} container
 * @param {object|null} layout  layout.js が返すテーブル。無ければダミーで描く
 * @param {{ lookup?: Function, thumbs?: boolean }} [options]
 *        lookup … layout.js の lookup(layout, charCode, thumb)
 *        thumbs … 親指ランプを出すか（既定 true。配列表の画面では false でよい）
 */
export function renderKeyboard(container, layout = null, options = {}) {
  if (!container) return;
  const { lookup = null, thumbs = true } = options;
  container.classList.add('board');

  const parts = [];

  if (thumbs) {
    const bar = el('div', 'board__thumbs');
    bar.append(el('span', null, '親指'));
    for (const [side, label] of [['left', '左'], ['right', '右']]) {
      const t = el('span', 'thumb', label);
      t.dataset.thumb = side;
      t.prepend(el('i'));
      bar.append(t);
    }
    parts.push(bar);
  }

  const rows = el('div', 'board__rows');

  ROWS.forEach((keys, i) => {
    const row = el('div', 'board__row');
    row.dataset.row = String(i + 1);

    for (const [code, legend] of keys) {
      const f = faceOf(code, layout, lookup);
      const key = el('div', 'key');
      key.dataset.code = code;
      key.dataset.hand = handOf(code);

      const shifts = el('div', 'key__shifts');
      // 面の «置き場所» は親指の左右で決める。左親指の面は左、右親指の面は右。
      // 色は同側か交差かで決める。位置と色で別々のことを言わせる
      for (const side of ['left', 'right']) {
        const kind = (side === 'left' ? f.leftKind : f.rightKind) || kindOf(code, side);
        const face = el('div', `key__face key__face--${kind}`, side === 'left' ? f.left : f.right);
        face.dataset.thumb = side;
        face.dataset.kind = kind;
        // ヒートマップが引くための鍵。storage.js の faceHits と同じ書き方
        face.dataset.face = `${code}:${side}`;
        shifts.append(face);
      }

      const solo = el('div', 'key__solo', f.solo);
      solo.dataset.face = `${code}:none`;

      key.append(shifts, solo, el('span', 'key__code', legend));
      row.append(key);
    }
    rows.append(row);
  });

  parts.push(rows);
  container.replaceChildren(...parts);
}

/**
 * 次に押すキーと親指を強調する。
 * キーだけでなく «3 面のどれか» まで指す。面の取り違えが最も多いミスなので、
 * 「このキーの、この面」まで示さないと案内として役に立たない。
 *
 * @param {{ charCode: string|null, thumb: 'left'|'right'|null }} next
 */
export function highlight(container, { charCode = null, thumb = null } = {}) {
  if (!container) return;

  for (const k of container.querySelectorAll('.key.is-next')) {
    k.classList.remove('is-next');
    delete k.dataset.nextFace;
  }
  for (const t of container.querySelectorAll('.thumb.is-next')) {
    t.classList.remove('is-next');
  }

  if (charCode) {
    const key = container.querySelector(`.key[data-code="${CSS.escape(charCode)}"]`);
    if (key) {
      key.classList.add('is-next');
      key.dataset.nextFace = thumb ? kindOf(charCode, thumb) : 'solo';
    }
  }

  if (thumb) {
    const lamp = container.querySelector(`.thumb[data-thumb="${thumb}"]`);
    if (lamp) lamp.classList.add('is-next');
  }
}

/**
 * 押している «あいだ» ずっと光らせる。nicola.js の thumbHeld をそのまま流し込む想定。
 * 1 打ごとではなく keydown / keyup のたびに呼んでよい（class の付け外しだけ）。
 */
export function setThumbLamp(container, { left = false, right = false } = {}) {
  if (!container) return;
  const l = container.querySelector('.thumb[data-thumb="left"]');
  const r = container.querySelector('.thumb[data-thumb="right"]');
  if (l) l.classList.toggle('is-on', !!left);
  if (r) r.classList.toggle('is-on', !!right);
}

/**
 * 苦手な面を濃く塗る（マイページ）。
 * 契約の外に足した小道具。同じ図を塗り分けるだけにしてあるのは、
 * 練習中に見ている図とヒートマップの図が別物だと、対応が取れなくなるため。
 *
 * @param {Record<string, number>} levels  { 'KeyH:none': 0〜1 } の形。
 *        storage.js の faceHits をミス率に直したものを渡す想定。
 */
export function setHeat(container, levels = {}) {
  if (!container) return;
  for (const face of container.querySelectorAll('[data-face]')) {
    const v = levels[face.dataset.face];
    face.style.setProperty('--heat', String(Math.max(0, Math.min(1, Number(v) || 0))));
  }
}

/** 配列表の画面などで «この図が扱うキー» を知りたいとき用 */
export const KEY_CODES = ROWS.flat().map(([code]) => code);
