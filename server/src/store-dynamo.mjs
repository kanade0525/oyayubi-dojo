// core.mjs の「ストアの約束」を DynamoDB で満たす実装。
//
// テーブルは一つ。アクセスの型が四つしか無いので、表を分けるより一枚に畳んだ方が
// 権限・バックアップ・削除がそれぞれ一か所で済む。
//
//   PK = PLAYER#<id>  SK = PROFILE                 … ニックネーム・token のハッシュ・同意の版
//   PK = PLAYER#<id>  SK = BEST#<course>#<period>  … 自己ベスト。period は 'all' か 'YYYY-MM'
//       GSI1PK = BOARD#<course>#<period>  GSI1SK = core.boardSortKey(money, at)
//
// 順位表は GSI1 を降順に引くだけで出る。本人の記録は PK が同じなので、消すときは
// PK で引いて全部消せば「本人の全記録」になる（取りこぼしようがない）。
//
// 月ごとの自己ベストには TTL（expiresAt）を付け、400 日ほどで DynamoDB に消させる。
// 月間の順位表は過去の月を見せないので、残しておく理由が無い。
//
// @aws-sdk は Lambda の nodejs22.x 実行環境に同梱されているものを使う。package.json に足さない。
// このファイルだけが @aws-sdk を import する。テストはこのファイルを読まない。

import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { HttpError, boardSortKey } from './core.mjs';

const GSI = 'GSI1';
const MONTH_TTL_SECONDS = 400 * 24 * 3600;

const pk = (playerId) => `PLAYER#${playerId}`;
const bestSk = (course, period) => `BEST#${course}#${period}`;
const boardPk = (course, period) => `BOARD#${course}#${period}`;

const toEntry = (item) => ({
  playerId: item.playerId,
  nickname: item.nickname,
  course: item.course,
  period: item.period,
  money: item.money,
  kpm: item.kpm,
  accuracy: item.accuracy,
  at: item.at,
});

export function createDynamoStore({ tableName, client = new DynamoDBClient({}) }) {
  if (!tableName) throw new Error('TABLE_NAME がありません');
  const db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

  return {
    async createPlayer({ playerId, nickname, tokenHash, consentVersion, createdAt }) {
      await db.send(new PutCommand({
        TableName: tableName,
        Item: { PK: pk(playerId), SK: 'PROFILE', playerId, nickname, tokenHash, consentVersion, consentAt: createdAt, createdAt },
        // UUID の衝突は現実には起きないが、起きたら他人の登録を上書きするので止める
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
    },

    async getPlayer(playerId) {
      const { Item } = await db.send(new GetCommand({
        TableName: tableName,
        Key: { PK: pk(playerId), SK: 'PROFILE' },
        ConsistentRead: true,
      }));
      return Item ? { playerId: Item.playerId, nickname: Item.nickname, tokenHash: Item.tokenHash } : null;
    },

    async putBestIfHigher(entry) {
      const { playerId, course, period, money, at } = entry;
      const item = {
        PK: pk(playerId),
        SK: bestSk(course, period),
        GSI1PK: boardPk(course, period),
        GSI1SK: boardSortKey(money, at),
        ...entry,
      };
      if (period !== 'all') item.expiresAt = Math.floor(Date.parse(at) / 1000) + MONTH_TTL_SECONDS;

      // プロフィールが在ることの確認と、自己ベストの条件付き書き込みを一つのトランザクションにする。
      // 別々にすると、記録を消した直後に届いた送信が、消えたはずの自己ベストを書き戻せてしまう。
      try {
        await db.send(new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: tableName,
                Key: { PK: pk(playerId), SK: 'PROFILE' },
                ConditionExpression: 'attribute_exists(PK)',
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: item,
                // 同額は更新しない（先に出した時刻を残す。順位の並びと揃える）
                ConditionExpression: 'attribute_not_exists(PK) OR money < :money',
                ExpressionAttributeValues: { ':money': money },
              },
            },
          ],
        }));
        return true;
      } catch (err) {
        if (err.name !== 'TransactionCanceledException') throw err;
        const [profile, best] = (err.CancellationReasons ?? []).map((r) => r?.Code);
        if (profile === 'ConditionalCheckFailed') throw new HttpError(401, '登録が確認できません');
        if (best === 'ConditionalCheckFailed') return false;
        throw err; // 競合などはそのまま上げる（握りつぶすと「ベストではなかった」と区別できない）
      }
    },

    async getBest(playerId, course, period) {
      const { Item } = await db.send(new GetCommand({
        TableName: tableName,
        Key: { PK: pk(playerId), SK: bestSk(course, period) },
        ConsistentRead: true,
      }));
      return Item ? toEntry(Item) : null;
    },

    async countAhead(course, period, entry) {
      // GSI は結果整合なので、書いた直後は自分の新しい行がまだ見えないことがある。
      // ソートキーより「上」だけを数えるので、自分が見えても見えなくても件数は変わらない。
      let count = 0;
      let ExclusiveStartKey;
      do {
        const out = await db.send(new QueryCommand({
          TableName: tableName,
          IndexName: GSI,
          KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK > :sk',
          ExpressionAttributeValues: { ':pk': boardPk(course, period), ':sk': boardSortKey(entry.money, entry.at) },
          Select: 'COUNT',
          ExclusiveStartKey,
        }));
        count += out.Count ?? 0;
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return count;
    },

    async topEntries(course, period, limit) {
      const { Items = [] } = await db.send(new QueryCommand({
        TableName: tableName,
        IndexName: GSI,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': boardPk(course, period) },
        ScanIndexForward: false,
        Limit: limit,
      }));
      return Items.map(toEntry);
    },

    async deletePlayer(playerId) {
      const keys = [];
      let ExclusiveStartKey;
      do {
        const out = await db.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': pk(playerId) },
          ProjectionExpression: 'PK, SK',
          ConsistentRead: true,
          ExclusiveStartKey,
        }));
        for (const it of out.Items ?? []) keys.push({ PK: it.PK, SK: it.SK });
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);

      // 自己ベストを先に、プロフィールを最後に消す。途中で落ちても、プロフィールが残っていれば
      // 本人はもう一度「消す」を押せる（token が通るので）。逆順だと消し残しに手が届かなくなる。
      const bests = keys.filter((k) => k.SK !== 'PROFILE');
      for (let i = 0; i < bests.length; i += 25) await batchDelete(bests.slice(i, i + 25));
      if (keys.some((k) => k.SK === 'PROFILE')) await batchDelete([{ PK: pk(playerId), SK: 'PROFILE' }]);
    },
  };

  async function batchDelete(keys) {
    let pending = { [tableName]: keys.map((Key) => ({ DeleteRequest: { Key } })) };
    for (let attempt = 0; attempt < 5; attempt++) {
      const out = await db.send(new BatchWriteCommand({ RequestItems: pending }));
      const left = out.UnprocessedItems?.[tableName];
      if (!left || left.length === 0) return;
      pending = { [tableName]: left };
      await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
    }
    // 消し残しを成功と言わない。500 で返し、本人にもう一度押してもらう
    throw new Error('削除しきれなかった項目が残っています');
  }
}
