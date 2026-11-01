// Lambda の入口。API Gateway（HTTP API, ペイロード 2.0）のイベントを core.mjs の形に直して渡すだけ。
//
// 判断はここに書かない（core.mjs に置いてテストで回す）。ここにあるのは変換と環境変数の読み込みだけ。
//
// CORS のヘッダはここでは付けない。HTTP API の CorsConfiguration が付ける（template.yaml）。
// 両方で付けると値が食い違ったときにどちらが効いているか分からなくなる。
//
// 環境変数が欠けていたら、コールドスタートで落とす。ダミー値や空のまま動いて
// 「登録できたのに次から通らない」のような分かりにくい壊れ方をさせないため。

import { createApi } from './core.mjs';
import { createDynamoStore } from './store-dynamo.mjs';

const api = createApi({
  store: createDynamoStore({ tableName: process.env.TABLE_NAME }),
  pepper: process.env.TOKEN_PEPPER,
});

export async function handler(event) {
  const headers = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) headers[k.toLowerCase()] = v;

  let rawBody = event.body ?? null;
  if (rawBody != null && event.isBase64Encoded) rawBody = Buffer.from(rawBody, 'base64').toString('utf8');

  const res = await api({
    method: event.requestContext?.http?.method ?? '',
    path: event.rawPath ?? '',
    headers,
    query: event.queryStringParameters ?? {},
    rawBody,
  });

  return {
    statusCode: res.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: res.body == null ? '' : JSON.stringify(res.body),
  };
}
