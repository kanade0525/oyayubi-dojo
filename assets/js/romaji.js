// ローマ字入力の判定。親指シフトと同じ文・同じ語を、ローマ字でも打って比べるためのもの。
//
// 打つ先のかなの並びが決まっているので、IME のように変換はしない。
// 「いまの位置から始まるかなの塊」を綴れるローマ字を全部並べ、打った字がそのどれかの頭に
// 合っていれば受け、どれにも合わなければミスにする。塊を綴り切ったら、その塊のかなの数だけ進める。
//
// 塊は一字とは限らない。
//   ・拗音        しゃ = sha / sya（2字）
//   ・促音        っか = kka（2字）。xtu / ltu で一字ずつも打てる
//   ・撥音        んか = nka（2字）。n 一つで済むのは、次が母音・y・n で始まらないときだけ。
//                 nn / n' / xn なら どこでも一字の「ん」になる
// 綴りの揺れ（shi / si / ci、tsu / tu、fu / hu、ji / zi など）は、主な IME が受けるものを受ける。
//
// DOM も時計も知らない。tools/romaji.test.mjs から直接試す。

/** かな一字 → 綴り。先頭が案内（hint）に出す綴り */
const BASE = {
  あ: ['a'], い: ['i', 'yi'], う: ['u', 'wu', 'whu'], え: ['e'], お: ['o'],
  か: ['ka', 'ca'], き: ['ki'], く: ['ku', 'cu', 'qu'], け: ['ke'], こ: ['ko', 'co'],
  さ: ['sa'], し: ['shi', 'si', 'ci'], す: ['su'], せ: ['se', 'ce'], そ: ['so'],
  た: ['ta'], ち: ['chi', 'ti'], つ: ['tsu', 'tu'], て: ['te'], と: ['to'],
  な: ['na'], に: ['ni'], ぬ: ['nu'], ね: ['ne'], の: ['no'],
  は: ['ha'], ひ: ['hi'], ふ: ['fu', 'hu'], へ: ['he'], ほ: ['ho'],
  ま: ['ma'], み: ['mi'], む: ['mu'], め: ['me'], も: ['mo'],
  や: ['ya'], ゆ: ['yu'], よ: ['yo'],
  ら: ['ra'], り: ['ri'], る: ['ru'], れ: ['re'], ろ: ['ro'],
  わ: ['wa'], を: ['wo'],
  が: ['ga'], ぎ: ['gi'], ぐ: ['gu'], げ: ['ge'], ご: ['go'],
  ざ: ['za'], じ: ['ji', 'zi'], ず: ['zu'], ぜ: ['ze'], ぞ: ['zo'],
  だ: ['da'], ぢ: ['di'], づ: ['du'], で: ['de'], ど: ['do'],
  ば: ['ba'], び: ['bi'], ぶ: ['bu'], べ: ['be'], ぼ: ['bo'],
  ぱ: ['pa'], ぴ: ['pi'], ぷ: ['pu'], ぺ: ['pe'], ぽ: ['po'],
  ゔ: ['vu'],
  ぁ: ['xa', 'la'], ぃ: ['xi', 'li', 'xyi', 'lyi'], ぅ: ['xu', 'lu'], ぇ: ['xe', 'le', 'xye', 'lye'], ぉ: ['xo', 'lo'],
  ゃ: ['xya', 'lya'], ゅ: ['xyu', 'lyu'], ょ: ['xyo', 'lyo'], ゎ: ['xwa', 'lwa'],
  っ: ['xtu', 'ltu', 'xtsu', 'ltsu'],
  ん: ['nn', "n'", 'xn'],
  '、': [','], '。': ['.'], '．': ['.'], '・': ['/'], 'ー': ['-'],
};

/** 拗音の頭。い段の字 → 子音の綴り（先頭が案内用） */
const YOUON_HEAD = {
  き: ['ky'], し: ['sh', 'sy'], ち: ['ch', 'ty', 'cy'], に: ['ny'], ひ: ['hy'], み: ['my'], り: ['ry'],
  ぎ: ['gy'], じ: ['j', 'zy', 'jy'], ぢ: ['dy'], び: ['by'], ぴ: ['py'],
};
const YOUON_TAIL = { ゃ: 'a', ゅ: 'u', ょ: 'o', ぇ: 'e' };

/** 二字の塊で、上の規則に乗らないもの */
const PAIRS = {
  ふぁ: ['fa'], ふぃ: ['fi'], ふぇ: ['fe'], ふぉ: ['fo'], ふゅ: ['fyu'],
  てぃ: ['thi'], でぃ: ['dhi'], でゅ: ['dhu'], うぃ: ['wi'], うぇ: ['we'], つぁ: ['tsa'],
  ゔぁ: ['va'], ゔぃ: ['vi'], ゔぇ: ['ve'], ゔぉ: ['vo'],
};
for (const [head, cons] of Object.entries(YOUON_HEAD)) {
  for (const [tail, v] of Object.entries(YOUON_TAIL)) PAIRS[head + tail] = cons.map((c) => c + v);
}

const isLetter = (ch) => ch >= 'a' && ch <= 'z';

/** その綴りで打てる字か */
export function canType(kana) {
  return Object.hasOwn(BASE, kana);
}

/**
 * chars[pos] から始まる塊を綴れるローマ字を全部返す。[{ s: 綴り, n: かなの数 }]
 * 先に来るものほど案内に向く綴り。
 */
export function spellingsAt(chars, pos) {
  const c = chars[pos];
  if (c == null) return [];
  const out = [];
  const next = chars[pos + 1];

  if (next != null && PAIRS[c + next]) for (const s of PAIRS[c + next]) out.push({ s, n: 2 });

  if (c === 'っ' && next != null && next !== 'っ' && next !== 'ん') {
    // 次の塊の頭の子音を重ねる。「っち」は tchi も受ける（cchi と並んで IME が受ける）
    for (const r of spellingsAt(chars, pos + 1)) {
      const h = r.s[0];
      if (!isLetter(h) || 'aiueon'.includes(h)) continue;
      out.push({ s: h + r.s, n: r.n + 1 });
      if (r.s.startsWith('ch')) out.push({ s: 't' + r.s, n: r.n + 1 });
    }
  }

  if (c === 'ん' && next != null && next !== 'ん') {
    // n 一つで済む形。次が母音・y・n で始まると「な行・にゃ行」と区別できないので出さない
    for (const r of spellingsAt(chars, pos + 1)) {
      const h = r.s[0];
      if ('aiueoyn'.includes(h) || "'".includes(h)) continue;
      out.push({ s: 'n' + r.s, n: r.n + 1 });
    }
  }

  for (const s of BASE[c] ?? []) out.push({ s, n: 1 });
  return out;
}

/** キーの押下（KeyboardEvent.key）から、ローマ字の一字を取り出す。関係ないキーなら null */
export function romajiKeyOf(key) {
  if (typeof key !== 'string' || key.length !== 1) return null;
  const k = key.toLowerCase();
  return isLetter(k) || ",.-/'".includes(k) ? k : null;
}

/**
 * 判定器。打ちかけの綴り（buffer）だけを持つ。位置は呼ぶ側が持つ。
 *
 *   const r = createRomaji();
 *   r.press(chars, index, 's')  → { ok: true, done: 0 }       受けたが、塊はまだ途中
 *   r.press(chars, index, 'h')  → { ok: true, done: 0 }
 *   r.press(chars, index, 'a')  → { ok: true, done: 2 }       「しゃ」を打ち切った。index を 2 進める
 *   r.press(chars, index, 'q')  → { ok: false, done: 0 }      どの綴りにも合わない。buffer は変えない
 *
 * 呼ぶ側が字を飛ばすなど、位置を自分で動かしたときは reset() で buffer を捨てる。
 */
export function createRomaji() {
  let buffer = '';
  return {
    get buffer() { return buffer; },
    reset() { buffer = ''; },

    press(chars, pos, ch) {
      const cand = spellingsAt(chars, pos);
      if (!cand.length) throw new Error(`ローマ字で打てない字: ${chars[pos]}`);
      const b = buffer + ch;
      const hits = cand.filter((c) => c.s.startsWith(b));
      if (!hits.length) return { ok: false, done: 0 };
      const exact = hits.find((c) => c.s === b);
      // 綴り切っていても、もっと長い綴りの頭でもあるなら待つ（いまの綴りの表では起きない）
      if (exact && hits.every((c) => c.s === b)) {
        buffer = '';
        return { ok: true, done: exact.n };
      }
      buffer = b;
      return { ok: true, done: 0 };
    },

    /** いま打ちかけの塊を、この後どう綴ればよいか。案内に出す */
    hint(chars, pos) {
      const c = spellingsAt(chars, pos).find((x) => x.s.startsWith(buffer));
      return c ? { typed: buffer, rest: c.s.slice(buffer.length), n: c.n } : null;
    },
  };
}
