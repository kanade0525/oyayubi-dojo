# 回転ずしランキング API

HTTP API → Lambda（nodejs22.x / arm64）→ DynamoDB 1 テーブル。AWS SAM で置く。
判断ロジックは `src/core.mjs`、DynamoDB は `src/store-dynamo.mjs`、入口は `src/index.mjs`。
依存パッケージは無い（`@aws-sdk` は実行環境に同梱のものを使う）。

## エンドポイント

- `POST /players` … `{ nickname, consent: true, consentVersion }` → 201 `{ playerId, nickname, token }`
- `POST /scores` … `Authorization: Bearer <token>`、本文 `{ course, input, money, kpm, accuracy, durationMs }` → `{ rank, best, isBest }`。`input` は `nicola` / `romaji`（必須）。自己ベストと順位は入力方式ごと
- `GET /ranking?course=otegaru&period=all|month&input=all|nicola|romaji` → `{ course, period, input, entries: [{ rank, nickname, input, money, kpm, accuracy, at }] }`（上位 50）。`input=all` は両方を混ぜた表で、同じ人が二行並びうる
- `DELETE /players/me` … `Authorization: Bearer <token>` → 204（もう居なくても 204）

エラーは `{ error }` とステータス（400 / 401 / 404 / 413 / 500）。

## デプロイ

```sh
cd server
sam build
sam deploy --guided --parameter-overrides \
  TableName=oyayubi-dojo-ranking \
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

## デプロイ後

出力 `ApiUrl` を次の二か所に入れる。片方だけだと `npm run check` が落ちる。

1. `assets/js/game/config.js` の `RANKING_API_URL`（末尾スラッシュ無し）
2. `_headers` の CSP の `connect-src`（`'none'` をそのオリジンちょうど一つに置き換える）

## テスト

`node --test tools/server.test.mjs`（AWS には繋がない。偽ストアで `core.mjs` を回す）
