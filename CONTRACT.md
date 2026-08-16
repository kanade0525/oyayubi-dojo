# 実装契約（作業分担のための取り決め）

親指シフトタイピング道場。複数人（エージェント）で並行実装するため、
**モジュール間の境界と担当ファイル**をここで固定する。ここに書いた形から外れないこと。

## プロジェクトの流儀

同じ作者の `~/development/typing-engineer` の流儀をそのまま引き継ぐ。

- **ビルドステップ無し。** 素の ES modules を `index.html` から `<script type="module">` 1行で読む
- **依存パッケージゼロ。** npm install するものは何も無い。CDN も使わない（CSPで `connect-src 'none'`）
- **コメント・UI文言・コミットメッセージは全て日本語**
- コメントは「APIの説明」ではなく**「なぜこの方針か」**を書く。判断が要る所は厚く、単なる組み立ては薄く
- 各ファイルの冒頭に「このファイルは何か・なぜこの方針か」の段落を置く
- `innerHTML` は使わず `textContent` / `replaceChildren` を使う（CSP整合とXSS配慮）
- `localStorage` のキーは `oyayubi-dojo:*:v1` の形。**全アクセスを try/catch**（記録できなくても遊べる）

## 担当ファイル（他の担当のファイルは触らない）

| 担当 | ファイル |
| --- | --- |
| コア（石田＋Claude本体） | `keycheck.html` / `assets/js/nicola.js` / `assets/js/layout.js` / `assets/js/app.js` / `assets/data/nicola.js` / 設定ファイル類 |
| 課題データ | `assets/js/lessons.js` |
| 適応出題 | `assets/js/drill.js` |
| 音 | `assets/js/sound.js` |
| テスト | `tools/` 配下すべて / `.github/workflows/check.yml` |
| デザイン | `index.html` / `assets/css/app.css` / `assets/js/keyboard.js` / `assets/js/meter.js` |
| トークンエコノミー | `assets/js/storage.js` / `assets/js/trophies.js` |

## 用語

- **文字キー (M)** … かなが割り当てられた通常キー
- **親指キー (O)** … 左右の親指シフトキー
- **単独打鍵** … 文字キーだけ
- **同時打鍵** … 文字キー＋親指キー
- **同側シフト** … 左手のキー×左親指、右手のキー×右親指。**別のかな**になる
- **交差シフト** … 左手のキー×右親指、右手のキー×左親指。主に**濁音・半濁音**になる
- **シフト不発** … 同時打鍵のつもりが単独打鍵として判定されたミス

> 同側と交差の対応は規格 §5.3 が根拠。「左領域のキーに対して親指右を、右領域のキーに対して
> 親指左を同時打けんすると（中略）この打けん方式は，主として，濁音又は半濁音の入力に用いる」。
> 実配列とも一致する（左手「し」×右親指＝「じ」／左手「し」×左親指＝「あ」）。
> **2026-08-15 修正。** それ以前のこの節は逆に書いてあった。

## モジュール契約

### `assets/js/nicola.js` — 同時打鍵の状態機械（コア担当）

DOM を一切知らない。Node から `import` してテストできる。

```js
export function createNicola(options) { /* ... */ }

// options
{
  layout,                  // layout.js が返すテーブル
  thumbKeys: { left: ['Lang2'], right: ['Lang1', 'KanaMode'] },  // KeyboardEvent.code の配列
  tau: 80,                 // 同時打鍵未成立の判定（ms）
  charTimeout: 150,        // 文字キーのタイムアウト（ms）
  thumbTimeout: 250,       // 親指キーのタイムアウト（ms）
  onOutput,                // (result) => void  確定した入力を返す
}

// createNicola が返すもの
{
  keyDown(code, timeStamp),   // 押下を流し込む
  keyUp(code, timeStamp),     // 解放を流し込む
  tick(timeStamp),            // 経過時刻だけを流し込む。タイムアウトはここでだけ発火する
  reset(),                    // 状態を初期化（blur時など）
  get state(),                // 'S1'|'S2'|'S3'|'S4'|'S5'  デバッグ・表示用
  get thumbHeld(),            // { left: boolean, right: boolean }  画面の親指ランプ用
}
```

`thumbHeld` は**指の状態**であって、判定の状態ではない。内部で抱えるのをやめた親指でも、
`keyUp` が来るまでは点いたままにする。「親指を押しっぱなしにしている」ことに気づかせるのが
このランプの役目なので、抱えるのをやめた瞬間に消すと、いちばん見せたい状態が見えなくなる。

**`nicola.js` の中で `Date.now()` / `performance.now()` を読まないこと。** 時刻は必ず引数で
受け取る。内部で現在時刻を読むと、テストから時間を進められず、タイムアウトの検査が
実時間待ちになって CI で揺れる。画面側は `requestAnimationFrame` から `tick()` を呼ぶ。

`onOutput` に渡る `result` の形。**この形は全担当が依存するので変更しないこと。**

```js
{
  kana: 'ば',              // 確定した文字。引けなければ null
  charCode: 'KeyH',        // 使われた文字キーの code
  thumb: 'left',           // 'left' | 'right' | null（単独打鍵なら null）
  shiftKind: 'cross',      // 'same'（同側＝別のかな）| 'cross'（交差＝濁音・半濁音）| null
  offsetMs: -8,            // 親指キーと文字キーの押下時間差。
                           //   負 = 親指が先行 / 正 = 親指が遅れ / 単独打鍵なら null
  state: 'S4',             // このイベントを処理する「前」の状態
}
```

補足（テスト担当の指摘で追記）:

- **`offsetMs` = 親指の押下時刻 − 文字キーの押下時刻。** 負なら親指が先行、正なら遅れ。
  完全同時は `0`。**`-0` を出さないこと**（`` `${-0}ms` `` が「-0ms」と出る実装がある）
- **親指キーの単独出力**もある（S3のキーオフ・タイムアウト・reset、処理Bの `t1 >= t2`）。その形は
  `{ kana: null, charCode: null, thumb: 'left', shiftKind: null, offsetMs: null, state: 'S3' }`。
  `charCode === null && thumb !== null` で親指単独と判別できる
- **文字も親指も null の出力は出さない**
- `state` は「出力に至った状態」＝**イベント処理前**の状態。処理A で M1 を出すときは `'S4'`

### 規格の読み方で確定したこと（テスト担当が原文と照合）

規格の状態遷移表は 2018年4月に修正されている。**古い版を実装すると壊れる**ので注意。

1. **S3 ＋ 文字キーオン は出力しない。** 原文のセルは「OM出力」に打ち消し線が引かれ、
   `Mセット, S5へ` だけが残っている。ここで出すと後段の処理B・処理Dが判定する余地を失う。
   S2＋親指オン（出力なしで S4）とも対称になる。**間違えると同時打鍵が全部二重出力になる**
2. **処理C の `t2` は「重なりの厚み」**＝ 親指オンから**文字キーオフ**までの時間。
   親指の押下継続時間ではない。帰結として、S4 で同時打鍵が未成立になり得るのは
   **文字キーが離れたときだけ**で、親指キーが離れたときは無条件に MO 出力 → S1
3. **処理D は原文に本文が無い。** 処理C の左右対称形として実装する

### `assets/js/layout.js` — 配列テーブル（コア担当）

```js
export function loadLayout(name = 'nicola')      // 同期。fetch しない
export function lookup(layout, charCode, thumb)  // → { kana, shiftKind } | null
export function shiftKindOf(hand, thumb)         // → 'same' | 'cross' | null
export function handOf(layout, charCode)         // → 'left' | 'right' | null
export function thumbSideOf(thumbKeys, code)     // → 'left' | 'right' | null
```

**配列データは JSON ではなく JS モジュール**（`assets/data/nicola.js`）にした。
JSON を `fetch` で読むと CSP の `connect-src` を `'self'` に緩めることになる。
このアプリは外へ一切出ていかないのが売りで、`connect-src 'none'` を置けば
「うっかり CDN を書いた時点でブラウザが止める」という**不変条件**になる。
宣言を宣言のままにしないため、`import` で読める形にしてある。副次的に `loadLayout` が
同期になり、呼び出し側から `await` が消えた。

`lookup` は**例外を投げない**。未知のキーは打ち間違いとして普通に起きるので、
そのたびに throw されると呼び出し側が全部 try で包むことになる。引けなければ `null`。

### `assets/js/storage.js` — 保存（トークンエコノミー担当）

`typing-engineer` の `storage.js` と同じ設計。`recordRun()` が単一の記録窓口。

```js
export const STORAGE_KEYS          // 保存先をマイページに出して隠さないため
export function loadStats()
export function recordRun(run)     // → { stats, gained, earned }
export function loadSettings()     // 親指キー割り当て・閾値・配色
export function saveSettings(s)
export function exportAll()        // → JSON文字列
export function importAll(json)    // → boolean（app 名を検証してから入替）
export function clearAll()
```

`recordRun` に渡す `run` の形。**プレイ画面がこの形で渡す。**

```js
{
  lessonId: 'basic-1',
  kana: 120,          // 確定した文字数（同時打鍵は1と数える）→ CPM の分子
  keystrokes: 189,    // 物理キー数 → KCPM の分子
  seconds: 52.3,
  misses: { mistouch: 3, shiftMisfire: 2, wrongFace: 1 },   // 3分類
  offsets: { left: [-8, 12, -3], right: [5, -20] },          // ズレ幅(ms)の生データ
  timing: { perfect: 40, good: 55, off: 20 },                // 判定の内訳
  faceHits: { 'KeyH:none': 12, 'KeyH:left': 3 },             // キー×シフト面。ヒートマップ用
}
```

### `assets/js/trophies.js` — 実績・段位（トークンエコノミー担当）

```js
export const TROPHIES   // [{ id, name, hint, category, check: (stats) => boolean }]
export const RANKS      // [{ at, name }]
export function newlyEarned(stats)   // 未取得かつ条件充足のものを返す
export function scoreOf(run)
export function rankOf(score)
export function streakOf(days)
export function dayKey(date)         // ローカル時刻で 'YYYY-MM-DD'。toISOString だとUTCでずれる
```

### `assets/js/keyboard.js` — 3面キーボード図（デザイン担当）

```js
export function renderKeyboard(container, layout)
export function highlight(container, { charCode, thumb })  // 次に押すキーと親指を強調
export function setThumbLamp(container, { left, right })   // 押下中の親指を光らせる
```

### `assets/js/meter.js` — タイミングメーター（デザイン担当）

```js
export function renderMeter(container)
export function showJudgement(container, { offsetMs, tier })
// tier: 'perfect' | 'good' | 'off' | 'misfire'
```

判定の段階。`offsetMs` の絶対値で決める。

| tier | 条件 | 意味 |
| --- | --- | --- |
| `perfect` | ±15ms 以内 | ぴったり |
| `good` | ±35ms 以内 | 良い |
| `off` | それ以上（判定窓の内側） | ずれ。**先行/遅れの向きを必ず出す** |
| `misfire` | シフトが効かず単打になった | 不発。打ち直させる |

向きを出すのが肝。親指が遅い人と早すぎる人では直し方が逆なので、向きが無いと直せない。

## 画面

ハッシュルーティング。

| ルート | 画面 | 中身 |
| --- | --- | --- |
| `#/` | 玄関 | 二つの入口と、自分の数字。初回の一問もここ |
| `#/learn` | **覚える** | 課題の一覧。七つの課を順に開く |
| `#/train` | **鍛える** | 適応出題（弱点集中・総ざらい・速度）・実文18本・自由入力 |
| `#/record` | 記録 | 段位・ズレ分布・ヒートマップ・カレンダー・実績・データ持ち帰り |
| `#/play/:id` | プレイ | 打つ画面 |
| `#/layout` | 配列表 | 3面の一覧 |
| `#/setup` | 設定 | 親指キー・判定の幅・打鍵音・配色 |

### 言葉の決め方（ここを外すと全部崩れる）

**「道場」という比喩は看板だけに使う。機能の名前には使わない。**
「稽古」「腕試し」「道場」は比喩の内側の語で、互いを区別する力を持たない。
比喩は世界観は作れても、部品の名前にはならない。

最初はこの原則が無く、`コース` / `稽古` / `腕試し` の三つを並べていた。
どれも「練習」の言い換えで、利用者は違いを説明できなかった。

いまの二つは**扱う対象が違う**ので区別が立つ。

> 違いはひとつだけ。**覚える**は**まだ打てない字**を、**鍛える**は**もう打てる字**を扱う。

名前だけに頼らず、この一行を画面にも出している。

**「腕試し」は廃止した。** 測定は専用モードにするものではなく、打てば自動的に付いてくる。
振り分けに要るのは測定値ではなく「初めてかどうか」の1ビットだけなので、玄関で一問聞く。
**門にはしない**（答えなくても両方押せる）。答えは `settings.firstTime`（true / false / null）。

演出の方針は **平時は静か、節目だけ派手**。打鍵中はミニマルに保ち、
課題完了・実績解除・自己ベスト更新の瞬間だけ演出を出す。

## 親指キー（macOS で実測して確定・2026-08-15）

Chrome 150 / macOS で実測した結果、**英数キーとかなキーが両方とも使える**ことを確認した。
押下・解放とも取得でき、同時打鍵時に文字キーが IME に横取りされない（`keyCode` が 229 ではなく 72）。

```
[ 英数 ] [   スペース   ] [ かな ]
   ↑                        ↑
 左親指 Lang2            右親指 Lang1
```

スペースの左右がそのまま親指の定位置なので、Windows の無変換／変換と同じ配置で組める。

| キー | `code` | 既定 |
| --- | --- | --- |
| 英数 | `Lang2` | **左親指** |
| かな | `Lang1`（Safari は `KanaMode`）| **右親指**。両方の code を同じ扱いにする |
| 無変換 / 変換 | `NonConvert` / `Convert` | Windows の既定 |
| スペース | `Space` | 親指キーには使わない（文字側で使う可能性があるため） |
| Command | `MetaLeft` / `MetaRight` | **選択不可**。⌘押下中は他キーの `keyup` が飛ばない |

`timeStamp` の粒度は 0.1ms。数十msの判定には十分。
ただし親指キーは**設定で変更できる**ようにする（環境差とユーザーの好みがあるため）。

## 参考

- NICOLA規格 JIS提案 §5.4 同時打けんの判定 … <http://nicola.sunicom.co.jp/spec/jisdraft.htm>（HTTPで取得）
- 配列データ … KeyLogicKit の `nicola.json`（MIT。著作権表示を保持すること）
- 既存実装の流儀 … `~/development/typing-engineer`
