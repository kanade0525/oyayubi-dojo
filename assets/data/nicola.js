// NICOLA（親指シフト）配列表。
//
// なぜ JSON ではなく JS モジュールなのか。
// JSON を fetch で読むと CSP の connect-src を 'self' に緩めることになる。この app は
// 外へ一切出ていかないのが売りで、connect-src 'none' を置くと「うっかり CDN を書いた
// 時点でブラウザが止める」という不変条件になる。宣言を宣言のままにしないため、
// 配列表は import で読める JS にしてある。ビルドも要らない。
//
// 出典: KeyLogicKit の nicola.json（MIT License, Copyright (c) msonrm）
//   https://github.com/msonrm/KeyLogicKit
//   規格そのものは 日本語入力コンソーシアム の NICOLA 配列。
//   取り込みにあたり、キー名を KeyboardEvent.code に直し、左右どちらの領域の
//   キーかを示す hand を足した。かなの割り当ては一切変えていない。
//
// 面の呼び方（規格 §5.3）。ここを取り違えると学習者に逆を教えることになる。
//   単独打鍵            … none
//   同側シフト（左手×左親指 / 右手×右親指） … 別のかな
//   交差シフト（左手×右親指 / 右手×左親指） … 主に濁音・半濁音
//
// left / right は「どちらの親指を沈めたか」であって、同側/交差ではない。
// 同側か交差かは hand と組み合わせて初めて決まる（layout.js の lookup が判定する）。

export const NICOLA = {
  name: 'NICOLA',
  thumbKeys: {
    // macOS は 英数/かな、Windows は 無変換/変換。どちらもスペースの左右にある
    left: ['Lang2', 'NonConvert'],
    right: ['Lang1', 'KanaMode', 'Convert'],
  },
  keys: {
    KeyQ: { hand: 'left', none: '。', left: 'ぁ', right: 'ぁ' },
    KeyW: { hand: 'left', none: 'か', left: 'え', right: 'が' },
    KeyE: { hand: 'left', none: 'た', left: 'り', right: 'だ' },
    KeyR: { hand: 'left', none: 'こ', left: 'ゃ', right: 'ご' },
    KeyT: { hand: 'left', none: 'さ', left: 'れ', right: 'ざ' },
    KeyY: { hand: 'right', none: 'ら', left: 'ぱ', right: 'よ' },
    KeyU: { hand: 'right', none: 'ち', left: 'ぢ', right: 'に' },
    KeyI: { hand: 'right', none: 'く', left: 'ぐ', right: 'る' },
    KeyO: { hand: 'right', none: 'つ', left: 'づ', right: 'ま' },
    KeyP: { hand: 'right', none: '、', left: 'ぴ', right: 'ぇ' },
    Semicolon: { hand: 'right', none: 'ん', left: null, right: 'っ' },
    KeyA: { hand: 'left', none: 'う', left: 'を', right: 'ゔ' },
    KeyS: { hand: 'left', none: 'し', left: 'あ', right: 'じ' },
    KeyD: { hand: 'left', none: 'て', left: 'な', right: 'で' },
    KeyF: { hand: 'left', none: 'け', left: 'ゅ', right: 'げ' },
    KeyG: { hand: 'left', none: 'せ', left: 'も', right: 'ぜ' },
    KeyH: { hand: 'right', none: 'は', left: 'ば', right: 'み' },
    KeyJ: { hand: 'right', none: 'と', left: 'ど', right: 'お' },
    KeyK: { hand: 'right', none: 'き', left: 'ぎ', right: 'の' },
    KeyL: { hand: 'right', none: 'い', left: 'ぽ', right: 'ょ' },
    KeyZ: { hand: 'left', none: '．', left: 'ぅ', right: 'ぅ' },
    KeyX: { hand: 'left', none: 'ひ', left: 'ー', right: 'び' },
    KeyC: { hand: 'left', none: 'す', left: 'ろ', right: 'ず' },
    KeyV: { hand: 'left', none: 'ふ', left: 'や', right: 'ぶ' },
    KeyB: { hand: 'left', none: 'へ', left: 'ぃ', right: 'べ' },
    KeyN: { hand: 'right', none: 'め', left: 'ぷ', right: 'ぬ' },
    KeyM: { hand: 'right', none: 'そ', left: 'ぞ', right: 'ゆ' },
    Comma: { hand: 'right', none: 'ね', left: 'ぺ', right: 'む' },
    Period: { hand: 'right', none: 'ほ', left: 'ぼ', right: 'わ' },
    Slash: { hand: 'right', none: '・', left: 'ぉ', right: 'ぉ' },
  },
};
