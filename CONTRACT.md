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
| コア（石田＋Claude本体） | `keycheck.html` / `assets/css/keycheck.css` / `assets/js/nicola.js` / `assets/js/romaji.js` / `assets/js/icons.js` / `assets/js/layout.js` / `assets/js/app.js` / `assets/data/nicola.js` / 設定ファイル類 |
| 課題データ | `assets/js/lessons.js` |
| 適応出題 | `assets/js/drill.js` |
| 音 | `assets/js/sound.js` |
| テスト | `tools/` 配下すべて / `.github/workflows/check.yml` |
| デザイン | `index.html` / `assets/css/app.css` / `assets/js/keyboard.js` / `assets/js/meter.js` |
| トークンエコノミー | `assets/js/storage.js` / `assets/js/trophies.js` / `assets/js/medal.js` |
| ゲーム企画 | `assets/js/game/words.js` / `assets/js/game/courses.js` |
| ゲーム画面（デザイン兼実装） | `game.html` / `assets/css/game.css` / `assets/js/game/engine.js` / `assets/js/game/sfx.js` / `assets/js/game/main.js` |
| ランキング（サーバー） | `server/` 配下すべて / `assets/js/game/ranking.js` / `tools/server.test.mjs` |
| コア（ゲームの設定値） | `assets/js/game/config.js` |
| 可視化（コア） | `assets/js/viz.js` / `assets/js/iso.js` / `assets/css/viz.css` / `tools/iso.test.mjs` |
| 可視化（グラフ） | `assets/js/charts.js` / `assets/css/charts.css` |

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
  lenientRelease: true,    // 親指を先に離しても同時打鍵と認める（規格の外・既定 false）
  continuousShift: false,  // 連続シフト（親指を押したまま続けて打つ。規格の外・既定 false）
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
                           //   連続シフトの 2 打目以降も null（測る相手が無い）
  continued: false,        // 連続シフトで引き継いだ親指で出た一打か
  state: 'S4',             // このイベントを処理する「前」の状態
}
```

**規格の外の 2 つ（`lenientRelease` / `continuousShift`）は、既定 `false` で §5.4 そのまま。**
既定のままなら遷移表の検査（`tools/nicola.test.mjs`）が見ている挙動と完全に一致する。
アプリ側の既定は `storage.js` の `DEFAULT_SETTINGS` が持っていて、そちらは
`lenientRelease: true` / `continuousShift: false`。

- **`lenientRelease`** … S5（親指が先）で親指キーが離れたときの 処理D の厚み検査を省く。
  規格どおりだと、親指の押下時間が「先行ぶんの 2 倍」以下で不発になる。親指が先の S5 は
  「別々の打鍵だった」という読み方が成り立たない（親指キー単独では字が出ない）ので、
  ここは緩めてよい。**S4 の 処理C は緩めない** — あちらは前の字と次の親指が本当に区別できない
- **`continuousShift`** … 一打が確定したあとも、指が乗っている親指を次の文字キーへ渡す。
  この一打は `continued: true` / `offsetMs: null` で出る。引き継いだ親指の解放や
  時間切れでは**親指単独を出さない**（前の一打で出し終えているため二重報告になる）

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

## タイピングゲーム（2026-11-02 に回転ずしから題材を替えた。題材は工場の検品ライン）

`game.html` は独立したページ。ゲームのために `index.html` / `app.js` へ足すのはナビのリンク一本だけ。
練習（覚える・鍛える）は**静か**、ゲームは**派手**。この対比は崩さない。
名前は «タイピングゲーム»。看板・ナビ・入口・タイトルとも同じ。«検品ライン» は題材で、名前にはしない（名前だけではゲームだと読まれない、と本人に言われた）。

**採点は寿司打と同じ数値・同じ算出方法**（単位だけ 円 → pt）。寿司打の記録とそのまま比べられることがこのゲームの値打ちなので、
独自の加点・独自の数値を入れない。同時打鍵のズレ（ぴったり等）は結果画面に «参考» として出すだけで、点には入れない。
題材だけ替えた（皿 → ラインを流れる作業品、取る → 検品を通す、取り逃し → 検品漏れ、コースの値段 → ノルマ）。

### 遊び方の骨格（寿司打と同じ）

- 作業品には**かなの語**が付いている。先頭（出口に一番近い）の作業品の語を打ち切ると、その値段（pt）が入る
- 作業品の値段は語の字数で決まる。語は字数の順（最小 → 最大 → 最小の一つ上）に、一つの字数で 3 枚ずつ出る
- 打ち切る前に出口まで流れたら検品漏れ（点は入らない、ミスにも数えない）
- **制限時間が尽きたら終わり**。通した値段の合計 − ノルマ を «お得 / 損» として出す
- 連打メーター：ミスなしで続けて正しく打ったキーが 28 / 59 / 92 / 130 に届くたびに +1 / +1 / +2 / +3 秒。130 で一周、ミスで 0
- 結果の項目：お得 / 損、正しく打ったキーの数、平均キータイプ数（正しく打ったキー ÷ 延長込みの秒数、小数一桁切り捨て）、ミスタイプ数
- キーは «実際に押したキー»：親指シフトは一字 1 キー、ローマ字は綴りのキー数

### `assets/js/game/courses.js`（ゲーム企画）

```js
export const COURSES = [
  { id: 'p3000', name: '3,000 pt', target: 3000, timeMs: 60000, laneMs: 8000, minLen: 2, maxLen: 7,
    prices: [{ minLen: 2, maxLen: 4, price: 100 }, { minLen: 5, maxLen: 6, price: 180 }, { minLen: 7, maxLen: 7, price: 240 }] },
  { id: 'p5000', ..., timeMs: 90000, minLen: 5, maxLen: 10, prices: 5〜6 字 180 / 7〜9 字 240 / 10 字 380 },
  { id: 'p10000', ..., timeMs: 120000, minLen: 9, maxLen: 14, prices: 9 字 240 / 10〜12 字 380 / 13〜14 字 500 },
];   // id はランキングの鍵なので変えない
export function itemValue(course, word)   // 作業品一つの値段
export function lengthCycle(course)       // 字数の順（一周ぶん）
export const SAME_LEN_RUN = 3
export const METER_STEPS = [{ keys: 28, ms: 1000 }, { keys: 59, ms: 1000 }, { keys: 92, ms: 2000 }, { keys: 130, ms: 3000 }]
```

数値の出どころは courses.js の注記に書いた。`server/src/core.mjs` に同じ数（`COURSE_LIMITS` / `METER_STEPS`）を写してある。`tools/game.test.mjs` が調べた値そのものと、サーバーの値の両方を確かめる。

### `assets/js/game/words.js`（ゲーム企画）

```js
export const WORDS = [ { kana: 'ともだちとでかける', shifted: 5 }, ... ]   // lessons.js から起動時に組む
export function shiftedCount(kana)   // 親指を使う字の数。配列に無い字があれば null
```

- 語の表は持たない。語・文章・速度の課題と実文（`TEXTS`）を句読点で区切って拾う。面を覚えるための並び（第一〜三課・第六課）は入れない
- 2〜14 字、親指を使う字を一つ以上含む語。長さの帯は `engine.js` がコースの `minLen`〜`maxLen` で絞る。どの帯にも 100 語以上

### `assets/js/game/engine.js`（ゲーム画面）— DOM を知らない

`nicola.js` と同じく**時刻は必ず引数で受け取る**。中で `performance.now()` / `Date.now()` / `Math.random()` を読まない（テストから時間を進めるため）。乱数は `rng` で受け取る。

```js
export function keyFor(kana)                 // { code, thumb, hand } | null
export function createGame({ course, words, rng })
{
  start(t), input(result, t), tick(t),       // input / tick の返り値は events の配列
  get state(),   // { phase, remainingMs, items: [{ id, word, value, typed, perfect, x /* 0..1 */ }], score, combo, maxCombo,
                 //   missStreak, cleared, lost, misses, perfect, good, shifted, offsets, strokes, correctKeys, meterKeys, meterNext, elapsedMs, target }
  summary(),     // 終わる前に呼んだら throw
}

// events
{ type: 'hit', itemId, kana, tier, keys }   { type: 'miss', itemId, expected, got, misfire }
{ type: 'clear', itemId, value }      { type: 'lost', itemId }   { type: 'meter', step, bonusMs }   { type: 'over' }

// summary()
{ course, score, balance /* score - target */, cleared, lost, strokes, correctKeys, keysPerSec, misses, misfires, accuracy, kpm,
  perfect, good, shifted, offsets /* 参考 */, timeBonusMs, maxCombo, durationMs }
```

- `input(result)` の `result.keys` はその字に要ったキーの数（無ければ 1）。ローマ字は main.js が綴りのキー数を渡す
- 連続シフトで出た一打（`continued`）はズレを測れないので、ぴったりにもシフト打鍵の数にも入れない
- 自己ベストは `oyayubi-dojo:gamebest:v3` に入力方式×コースごと、この端末だけに残す。回転ずしの v1 / v2（円）は読まない
- 入力方式は `oyayubi-dojo:gameinput:v1`（`nicola` / `romaji`）。ローマ字は `romaji.js` で綴りを判定し、かなを打ち切るたびに `input({ kana, charCode: 'Romaji', thumb: null, offsetMs: null })`、合わない字は `kana: null` で渡す
- ラインは canvas を使わず、作業品一つを一要素にして `x` を CSS 変数で渡す（`main.js`）
- 結果の «X で共有» は `https://x.com/intent/tweet` を開くリンクだけ。投稿するかは本人が決め、こちらからは何も送らない

### `assets/js/game/config.js`（コア）

```js
export const RANKING_API_URL = '';   // 空ならランキングは「準備中」と画面に出す（隠さない）
export const SUPPORT_URL = '';       // Buy Me a Coffee の URL。空なら支援リンクは出さない
```

本番の値は石田さんが入れる。**ダミーの URL は入れない**（投げ銭が他人に飛ぶ・存在しない API を叩く）。

### `assets/js/game/ranking.js`（ランキング）

```js
export function rankingEnabled()                       // RANKING_API_URL が空でなければ true
export function currentPlayer()                        // { playerId, nickname } | null（localStorage）
export async function register({ nickname, consent })  // consent が true でなければ throw。{ playerId, nickname }
export async function submitScore(summary)             // 登録済みでなければ throw。{ rank, best, isBest, overallRank, overallBest }。401 なら手元の登録を捨てて throw
export async function fetchRanking({ course, board, period })  // board: 'all'（総合）| 'nicola' | 'romaji'、period: 'all' | 'month'。{ entries: [{ rank, nickname, input, score, kpm, accuracy, at }], leaders }
export async function forgetMe()                       // サーバーの記録を消し、手元の登録も消す
```

- **失敗は throw する**。握りつぶして空配列を返さない（「ランキングが空」と「つながらない」を画面で区別できなくなる）
- 送るのは**ニックネームとスコアだけ**。メールアドレス・本名は取らない。手元の記録（localStorage の練習記録）は送らない
- 登録時の同意文に「何を送るか・どこに残るか・消し方」を書く。同意の版（`CONSENT_VERSION`）をサーバーに残す
- localStorage のキーは `oyayubi-dojo:player:v1`

### サーバー（`server/`）

AWS SAM。HTTP API → Lambda（Node.js、SDK は実行環境同梱のものを使い、依存パッケージを足さない）→ DynamoDB（1 テーブル）。

| メソッド | パス | 中身 |
| --- | --- | --- |
| POST | `/players` | `{ nickname, consent: true, consentVersion }` → `{ playerId, nickname, token }`（nickname は正規化後） |
| POST | `/scores` | `Authorization: Bearer <token>`。summary を受けて自己ベストなら更新 |
| GET | `/ranking?course=&board=&period=` | ノルマのコースごとに上位 50 件。board は all（総合・速さの順）/ nicola / romaji（部門・点数の順）。どれも一人一行。総合には各部門の 1 位（leaders）を添える |
| DELETE | `/players/me` | `Authorization: Bearer <token>`。本人の全記録を消す |

- token はサーバーにハッシュでだけ残す
- スコアは**ありえない値を弾く**（コースの時間・延長の上限・打鍵速度の上限・一字あたりの値段の最大から決まる上限を超えたら 400）
- スコアの `course` と `input`（`nicola` / `romaji`）は必須。無ければ 400。自己ベストはコースごとに、部門（点数）と総合（速さ）で一人一つずつ
- 環境変数: `TABLE_NAME` / `ALLOWED_ORIGIN` / `TOKEN_PEPPER`。今はダミー値。本番値は石田さんが入れる
- 判断ロジック（検証・ハッシュ・順位）は `server/src/core.mjs` に置き、DynamoDB を差し替えられる形にする。テストは手元の偽ストアで回す

### CSP

ランキングは外への通信なので、`connect-src` は **`'none'` か、`RANKING_API_URL` のオリジンちょうど一つ**のどちらかに限る。
`RANKING_API_URL` が空なら `'none'` のまま。検査はこの対応を突き合わせる。
外部リンク（`<a href="https://...">`、Buy Me a Coffee）は通信ではなく遷移なので許す。`src=` の外部参照は引き続き禁止。

## 画面

ハッシュルーティング。

| ルート | 画面 | 中身 |
| --- | --- | --- |
| `#/` | 門 | 三つの場所への扉だけ。説明文・数字の欄は置かない |
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

**「腕試し」はゲーム（`game.html`、2026-11-02 に回転ずしから題材を替えた «タイピングゲーム»）の入口の名前として戻した（2026-11-02）。**
旧「腕試し」（固定の一本を打つ測定モード）は廃止のまま。測定は打てば自動で付いてくる。
入口を分けるのは、来る人の**目的**がまるで違うから。覚える＝まだ打てない人、鍛える＝打てるが速く正確にしたい人、
腕試し＝腕前を試して遊びたい人。玄関はこの三つを同じ重さで並べるだけの画面にし、
各札の一行目で「誰のための入口か」を名指しする。
以前玄関で聞いていた「打ったことはありますか？」の一問（`settings.firstTime`）はやめた。
腕試しがその問いの外にあり、問いが入口の前の関門に見えたため。
**三つは «別のサイト» に見せる（2026-11-02）。** 共通のナビに三つを並べるだけでは «全部入りの一つのサイト» に見え、
上級者は入門の看板を見て離れた。場所ごとに看板（銘）・ヘッダーの帯の色・ナビの中身を変える。

| 場所 | 看板 | 色 | ルート | ナビ |
| --- | --- | --- | --- | --- |
| 門 | 親指シフトマスター | 配色のまま | `#/` | 覚える / 鍛える / 腕試し ｜ 配列表 / 設定 |
| 覚える | 親指シフト入門 | 山吹 `#f0c35a` | `#/learn`、七つの課の `#/play/:id` | 七つの課 / 配列表 / 設定 |
| 鍛える | 親指シフト トレーニング | 朱 `#ff8a70` | `#/train` `#/record`、その場で組んだ `#/play/:id` | 稽古 / 記録 / 配列表 / 設定 |
| 腕試し | タイピングゲーム | 浅葱 `#5fd0d0` | `game.html` | ノルマを選ぶ / ランキング |

- 切り替えは `body[data-area]`（`gate` / `learn` / `train` / `game`）。`app.js` の `setArea()` がハッシュごとに付け替え、CSS が看板とナビを出し分ける。`game.html` は固定で `game`
- 配列表と設定は場所を持たない道具。開いても直前の場所の顔のまま
- ほかの場所へは、ヘッダー右の «ほかの入口» から。目立たせない
- 場所の色は看板・帯・扉の縁・その場所の主ボタンにだけ使う。本文の色は配色（`data-tone`）のまま
- 道場と店の文は、もう打てる人が読んで «自分向け» と思う書き方にする。親指シフトの仕組みの説明はしない

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
