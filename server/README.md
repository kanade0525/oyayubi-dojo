# ぴったりランキング API

HTTP API → Lambda（nodejs22.x / arm64）→ DynamoDB 1 テーブル。AWS SAM で置く。
判断ロジックは `src/core.mjs`、DynamoDB は `src/store-dynamo.mjs`、入口は `src/index.mjs`。
依存パッケージは無い（`@aws-sdk` は実行環境に同梱のものを使う）。

## エンドポイント

コース（`course`）は `p3000` / `p5000` / `p10000`。数値は `src/core.mjs` の `COURSE_LIMITS` と `assets/js/game/courses.js` で揃える。

- `POST /players` … `{ nickname, consent: true, consentVersion }` → 201 `{ playerId, nickname, token }`
- `POST /scores` … `Authorization: Bearer <token>`、本文 `{ course, input, score, kpm, accuracy, durationMs }` → `{ rank, best, isBest, overallRank, overallBest }`
  - `input` は `nicola` / `romaji`（必須）。`durationMs` はコースの制限時間 − 1 秒から、延長込みの上限 + 1 秒まで（途中でやめた回は送らない）
  - `rank` / `best` / `isBest` … そのコースの、その入力方式の部門（通算）での順位・点数の自己ベスト・今回で更新したか
  - `overallRank` / `overallBest` … そのコースの総合（通算）での順位・毎分の自己ベスト
- `GET /ranking?course=p3000&board=all|nicola|romaji&period=all|month` → `{ course, board, period, entries: [{ rank, nickname, input, score, kpm, accuracy, at }], leaders }`（上位 50）
  - どの表も 1 人 1 行。部門（`nicola` / `romaji`）は点数の自己ベストを点数の順、総合（`all`）は毎分の自己ベストを毎分の順（その一本の `input` と `score` も出す）。同じ値は先に出した人が上
  - `leaders` は `board=all` のときだけ `{ nicola: { nickname, score } | null, romaji: … }`（そのコース・期間の各部門の 1 位）。部門の表では `null`
  - `month` は日本時間の今月。返す `period` は `YYYY-MM`
- `DELETE /players/me` … `Authorization: Bearer <token>` → 204（もう居なくても 204）

エラーは `{ error }` とステータス（400 / 401 / 404 / 413 / 500）。

## デプロイ

```sh
cd server
sam build
sam deploy --guided --parameter-overrides \
  TableName=oyayubi-dojo-kenpin \
  AllowedOrigin=https://<遊び場のオリジン> \
  TokenPepper="$(openssl rand -base64 48)"
```

パラメータの意味:

- `TableName` … DynamoDB のテーブル名。スタックを消してもテーブルは残る（Retain）
- `AllowedOrigin` … CORS で許すオリジンちょうど一つ。`https://` から始まり末尾スラッシュ無し
- `TokenPepper` … token のハッシュに混ぜる秘密（32 字以上）。**変えると全員の登録が通らなくなる**ので、
  一度決めたらパスワード管理に控えておく。`samconfig.toml` には書かない

`--guided` は最後に「設定を samconfig.toml に保存するか」を聞く。**n と答える。**
y にすると本番の AllowedOrigin（と SAM の版によっては TokenPepper）が、コミットされるファイルに書き戻される。

`samconfig.toml` と `.env.example` の値はダミー。`CHANGE_ME` のままではデプロイで弾かれる。

## 回転ずしからの移行（一度だけ）

回転ずしのときの表（`oyayubi-dojo-ranking`）は、索引（GSI）に写す属性が今と違う。
CloudFormation は既存の GSI の中身を書き換えられず、一回の更新で作る・消すのも索引一つまでなので、
同じ表のまま直すと四回に分けたデプロイが要る。代わりに `TableName` を `oyayubi-dojo-kenpin` に変えて
デプロイする。表ごと作り直しになり、一回で済む。

- 古い表は `UpdateReplacePolicy: Retain` で残る（消えない）。要らなければ後で手で消す
- 新しい表は空。**回転ずしのときに登録した人の token は 401 になる**ので、もう一度登録してもらう
  （ブラウザに残った古い登録の扱いはブラウザ側で決める）
- スタック名（`oyayubi-dojo-ranking`）はそのまま。`ApiUrl` は変わらない

## デプロイ後

出力 `ApiUrl` を次の二か所に入れる。片方だけだと `npm run check` が落ちる。

1. `assets/js/game/config.js` の `RANKING_API_URL`（末尾スラッシュ無し）
2. `_headers` の CSP の `connect-src`（`'none'` をそのオリジンちょうど一つに置き換える）

## テスト

`node --test tools/server.test.mjs`（AWS には繋がない。偽ストアで `core.mjs` を回す）
