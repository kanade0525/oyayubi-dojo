// 同時打鍵の状態機械。このアプリの中核。
//
// 親指シフトは「文字キー」と「親指キー」を重ねて押して入力する。完全に同時に押せる
// 人はいないので、どこまでのズレを同時とみなすかを決める規則が要る。それが
// NICOLA規格 JIS提案 §5.4「同時打けんの判定」で、5つの状態と処理A〜Dからなる。
// ここはその規格をそのまま実装したもので、独自の工夫は入れていない。
//
//   S1 初期 / S2 文字キーON / S3 親指キーON / S4 文字→親指 / S5 親指→文字
//
// **規格の状態遷移表は2018年4月に修正されている。古い版を実装すると壊れる。**
//   - S3 ＋ 文字キーオンは「出力しない」。原文では「OM出力」に打ち消し線が引かれている。
//     ここで出すと後段の処理B・処理Dが判定する余地を失い、同時打鍵が全部二重出力になる
//   - 処理C の t2 は「重なりの厚み」＝親指オンから *文字キーオフ* までの時間。
//     親指の押下継続時間ではない
//
// このファイルは DOM を知らない。Node から import してテストできるようにするためで、
// 実際 tools/nicola.test.mjs が規格の遷移表を全マス検証している。
//
// **現在時刻を自分で読まない。** 時刻は必ず引数で受け取る。内部で performance.now() を
// 読むと、テストから時間を進められずタイムアウトの検査が実時間待ちになり、CIで揺れる。
// タイムアウトは tick() を呼んだときにだけ発火する。

import { lookup, thumbSideOf } from './layout.js';

const DEFAULTS = {
  tau: 80,            // 重なりが薄すぎて同時打鍵と認めない境目
  charTimeout: 150,   // 文字キーを抱えたまま何も来ないときに諦めるまで
  thumbTimeout: 250,  // 親指キーを抱えたまま何も来ないときに諦めるまで
};

export function createNicola(options = {}) {
  const layout = options.layout ?? null;
  const thumbKeys = options.thumbKeys ?? { left: [], right: [] };
  const tau = options.tau ?? DEFAULTS.tau;
  const charTimeout = options.charTimeout ?? DEFAULTS.charTimeout;
  const thumbTimeout = options.thumbTimeout ?? DEFAULTS.thumbTimeout;
  const onOutput = options.onOutput ?? (() => {});

  // -- 規格の外 -----------------------------------------------------------
  // 既定は両方 false。この既定のあいだ、上の S1〜S5 は §5.4 そのままで動く
  // （tools/nicola.test.mjs の遷移表検査はこの状態を見ている）。
  //
  // なぜ要るか。規格は «一打ごとに初期状態へ戻る» 前提だが、実機のエミュレータ
  // （Lacaille・やまぶきR など）はどちらも緩めてあり、そちらに慣れた手で規格どおりの
  // 判定に来ると「同時押しが全然通らない」という形で当たる。アプリ側（storage.js）は
  // 既定を on にして渡す。緩めるのは «確定のしかた» だけで、遷移そのものは動かさない。
  const continuousShift = options.continuousShift ?? false;   // 連続シフト
  const lenientRelease = options.lenientRelease ?? false;     // 親指を先に離しても認める

  let state = 'S1';
  let M = null;        // { code, tDown }  抱えている文字キー
  let O = null;        // { code, side, tDown }  抱えている親指キー
  let deadline = null; // タイムアウトの期限。null なら待っていない

  // 物理的に押されている親指キー。確定済みでも指が離れていなければ点いたまま。
  // 画面の親指ランプはこれを映す（判定の状態ではなく、実際の指の状態を見せたい）。
  // 連続シフトは «どのキーが・いつから» まで要るので、真偽ではなく { code, tDown } を持つ。
  // 外へ出すとき（thumbHeld）は今までどおり真偽に落とす
  const heldThumbs = { left: null, right: null };

  /** 押しっぱなしの親指のうち、最後に押された方。無ければ null */
  function heldThumb() {
    const l = heldThumbs.left;
    const r = heldThumbs.right;
    if (l && r) return l.tDown >= r.tDown ? { ...l, side: 'left' } : { ...r, side: 'right' };
    if (l) return { ...l, side: 'left' };
    if (r) return { ...r, side: 'right' };
    return null;
  }

  /**
   * 連続シフトで次の一打へ渡す親指。continuousShift が落ちていれば常に null。
   *
   * tDown を «今» に置き直すのは、押しっぱなしにしていた時間がそのまま
   * 先行ぶんとして出てこないようにするため。continued の印は offsetMs を消すのに使う。
   */
  function carried(t) {
    if (!continuousShift) return null;
    const held = heldThumb();
    return held ? { code: held.code, side: held.side, tDown: t, continued: true } : null;
  }

  // -- 出力 ---------------------------------------------------------------

  // 完全同時を 0 にする。-0 のまま出すと `${-0}ms` が「-0ms」になる実装がある
  const noNegZero = n => (n === 0 ? 0 : n);

  function emit(result) {
    onOutput(result);
  }

  /** 文字キーの単独打鍵 */
  function emitChar(m, from) {
    const hit = layout ? lookup(layout, m.code, null) : null;
    emit({
      kana: hit?.kana ?? null,
      charCode: m.code,
      thumb: null,
      shiftKind: null,
      offsetMs: null,
      continued: false,
      state: from,
    });
  }

  /** 親指キーだけが押されて終わったとき。かなは出ない */
  function emitThumb(o, from) {
    // 連続シフトで引き継いだ親指は、前の一打で出し終えている。指を離したときや
    // 時間切れでここへ来ても、同じ押下を二度報告することになるので黙る
    if (o.continued) return;
    emit({
      kana: null,
      charCode: null,
      thumb: o.side,
      shiftKind: null,
      offsetMs: null,
      continued: false,
      state: from,
    });
  }

  /** 同時打鍵。offsetMs は 親指の押下時刻 − 文字キーの押下時刻 */
  function emitShifted(m, o, from) {
    const hit = layout ? lookup(layout, m.code, o.side) : null;
    emit({
      kana: hit?.kana ?? null,
      charCode: m.code,
      thumb: o.side,
      shiftKind: hit?.shiftKind ?? null,
      // 連続シフト中の一打には «親指をいつ落としたか» が無い。0 や
      // «押しっぱなしの分だけ先行» を出すとメーターが嘘をつくので、測れないと言う
      offsetMs: o.continued ? null : noNegZero(o.tDown - m.tDown),
      continued: o.continued === true,
      state: from,
    });
  }

  // -- 状態の移動 ---------------------------------------------------------

  function go(next, t, ms) {
    state = next;
    deadline = ms == null ? null : t + ms;
  }

  function clear() {
    M = null;
    O = null;
    state = 'S1';
    deadline = null;
  }

  /**
   * 一打ぶんが確定したあとの後始末。
   *
   * 規格は «確定したら初期状態へ» なので、親指に指を乗せたままでも次の文字キーは
   * 単独打鍵になる。エミュレータはここを繋いでいて（連続シフト）、その手癖のまま来ると
   * «2文字目から全部化ける» という形で当たる。continuousShift のときだけ繋ぐ。
   */
  function settle(t) {
    M = null;
    O = carried(t);
    if (O) {
      // 指が乗っている間は待ち続ける。ここで期限を置くと、親指を置いたまま
      // 次の字を考えている間に時間切れになって連続シフトが切れる
      go('S3', t, null);
      return;
    }
    state = 'S1';
    deadline = null;
  }

  // -- 入口 ---------------------------------------------------------------

  function keyDown(code, timeStamp) {
    const side = thumbSideOf(thumbKeys, code);
    if (side) {
      heldThumbs[side] = { code, tDown: timeStamp };
      thumbDown({ code, side, tDown: timeStamp }, timeStamp);
    } else {
      charDown({ code, tDown: timeStamp }, timeStamp);
    }
  }

  function charDown(m, t) {
    switch (state) {
      case 'S1':
        M = m;
        go('S2', t, charTimeout);
        break;

      case 'S2':
        // 前の文字キーを抱えたまま次が来た。前のは単独打鍵で確定する
        emitChar(M, 'S2');
        M = m;
        go('S2', t, charTimeout);
        break;

      case 'S3':
        // ★2018年の修正点。ここでは何も出さない。
        // 出してしまうと、この後の処理B・処理Dが「本当に同時打鍵だったか」を
        // 判定する余地を失う。S2＋親指オン（出力なしで S4）と対称。
        M = m;
        go('S5', t, charTimeout);
        break;

      case 'S4': {
        // 処理A: M1 → O → M2 の3キー。親指がどちらの文字キーに付くかを決める
        const t1 = O.tDown - M.tDown;   // M1 から O まで
        const t2 = t - O.tDown;         // O から M2 まで
        if (t1 >= t2) {
          // 親指は後から来た M2 の方に近い。M1 は単独打鍵だった
          emitChar(M, 'S4');
          M = m;
          go('S5', t, charTimeout);
        } else {
          // 親指は M1 に近い。M1 との同時打鍵として確定
          emitShifted(M, O, 'S4');
          O = carried(t);
          M = m;
          go(O ? 'S5' : 'S2', t, charTimeout);
        }
        break;
      }

      case 'S5':
        // 抱えている M と O は同時打鍵として確定させ、新しい文字キーを抱え直す
        emitShifted(M, O, 'S5');
        O = carried(t);
        M = m;
        go(O ? 'S5' : 'S2', t, charTimeout);
        break;
    }
  }

  function thumbDown(o, t) {
    switch (state) {
      case 'S1':
        O = o;
        go('S3', t, thumbTimeout);
        break;

      case 'S2':
        // 文字キーを抱えている所へ親指が来た。まだ確定させない
        O = o;
        go('S4', t, thumbTimeout);
        break;

      case 'S3':
        // 親指を抱えたまま別の親指が来た。前のは単独で確定
        emitThumb(O, 'S3');
        O = o;
        go('S3', t, thumbTimeout);
        break;

      case 'S4':
        emitShifted(M, O, 'S4');
        M = null;
        O = o;
        go('S3', t, thumbTimeout);
        break;

      case 'S5': {
        // 処理B: O1 → M → O2 の3キー。処理Aの親指版
        const t1 = M.tDown - O.tDown;   // O1 から M まで
        const t2 = t - M.tDown;         // M から O2 まで
        if (t1 >= t2) {
          emitThumb(O, 'S5');
          O = o;
          go('S4', t, thumbTimeout);
        } else {
          emitShifted(M, O, 'S5');
          M = null;
          O = o;
          go('S3', t, thumbTimeout);
        }
        break;
      }
    }
  }

  function keyUp(code, timeStamp) {
    const side = thumbSideOf(thumbKeys, code);
    if (side) heldThumbs[side] = null;

    switch (state) {
      case 'S1':
        // 確定済みのキーの離しが遅れて届くのは普通のこと。無視してよい
        break;

      case 'S2':
        if (M && code === M.code) {
          emitChar(M, 'S2');
          clear();
        }
        break;

      case 'S3':
        if (O && code === O.code) {
          emitThumb(O, 'S3');
          clear();
        }
        break;

      case 'S4': {
        // 処理C: 重なりの厚みで、同時打鍵と認めるかを決める。
        // t2 は「親指オンから *文字キーオフ* まで」＝重なっていた時間。
        // 親指キーが離れた場合は厚みを見ずに同時打鍵で確定させる（規格の帰結）。
        if (M && code === M.code) {
          const t1 = O.tDown - M.tDown;
          const t2 = timeStamp - O.tDown;
          if (t1 >= t2 && t2 < tau) {
            // 重なりが薄すぎる。同時打鍵は成立しなかった。親指はまだ生きている
            emitChar(M, 'S4');
            M = null;
            go('S3', timeStamp, thumbTimeout);
          } else {
            emitShifted(M, O, 'S4');
            settle(timeStamp);
          }
        } else if (O && code === O.code) {
          emitShifted(M, O, 'S4');
          settle(timeStamp);
        }
        break;
      }

      case 'S5': {
        // 処理D: 処理Cの左右対称形。原文に本文は無く、表に名前があるだけ。
        //
        // lenientRelease のときは、この厚みの検査を丸ごと省いて同時打鍵で確定させる。
        // S4（文字キーが先）と違い S5 は «親指が先» で、親指キーだけを押しても字は出ない。
        // つまり «別々の打鍵だった» という読み方がそもそも成り立たない。ここを規格どおり
        // 厳しくすると、親指をぽんと弾いて短く離す打ち方が t1 >= t2 の壁に当たる
        // （親指先行 15ms なら、親指の押下 30ms 以下が丸ごと不発になる）。
        // 一方 処理C（S4）は «前の字を打ち終える前に次の親指が来た» と本当に区別が
        // つかないので、こちらは緩めない。
        if (O && code === O.code) {
          const t1 = M.tDown - O.tDown;
          const t2 = timeStamp - M.tDown;
          if (!lenientRelease && t1 >= t2 && t2 < tau) {
            emitThumb(O, 'S5');
            O = null;
            go('S2', timeStamp, charTimeout);
          } else {
            emitShifted(M, O, 'S5');
            settle(timeStamp);
          }
        } else if (M && code === M.code) {
          emitShifted(M, O, 'S5');
          settle(timeStamp);
        }
        break;
      }
    }
  }

  /**
   * 時間だけを進める。タイムアウトはここでだけ起きる。
   * 画面側は requestAnimationFrame から呼ぶ。
   */
  function tick(timeStamp) {
    if (deadline == null || timeStamp < deadline) return;

    // 指がまだ乗っている親指を、時間切れで捨てない。タイムアウトは «keyup を
    // 取りこぼした» ときの逃げ道であって、押しっぱなしを咎めるためのものではない。
    // ここで捨てると、親指を置いたまま次の字を考えた瞬間に連続シフトが切れる
    if (state === 'S3' && continuousShift && O && heldThumbs[O.side]) {
      deadline = null;
      return;
    }

    switch (state) {
      case 'S2': emitChar(M, 'S2'); break;
      case 'S3': emitThumb(O, 'S3'); break;
      case 'S4': emitShifted(M, O, 'S4'); break;
      case 'S5': emitShifted(M, O, 'S5'); break;
    }
    clear();
  }

  /**
   * 状態を捨てる。規格の「初期化」にあたる。
   * 抱えているものは確定させてから捨てる。打った字が消えるより、
   * 意図した字が出る方がまだいい。
   */
  function reset() {
    switch (state) {
      case 'S2': emitChar(M, 'S2'); break;
      case 'S3': emitThumb(O, 'S3'); break;
      case 'S4': emitShifted(M, O, 'S4'); break;
      case 'S5': emitShifted(M, O, 'S5'); break;
    }
    clear();
    heldThumbs.left = null;
    heldThumbs.right = null;
  }

  return {
    keyDown,
    keyUp,
    tick,
    reset,
    get state() { return state; },
    // 呼び出し側が書き換えても内部が壊れないよう、複製を返す
    get thumbHeld() { return { left: heldThumbs.left != null, right: heldThumbs.right != null }; },
  };
}
