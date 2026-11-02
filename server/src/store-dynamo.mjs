// core.mjs の「ストアの約束」を DynamoDB で満たす実装。
//
// テーブルは一つ。アクセスの型が四つしか無いので、表を分けるより一枚に畳んだ方が
// 権限・バックアップ・削除がそれぞれ一か所で済む。
//
//   PK = PLAYER#<id>  SK = PROFILE                 … ニックネーム・token のハッシュ・同意の版
//   PK = PLAYER#<id>  SK = BEST#<course>#<input>#<period>  … 自己ベスト。input は nicola / romaji、
//                                                           period は 'all' か 'YYYY-MM'
//       GSI1PK = BOARD#<course>#all#<period>      … 両方の入力方式を混ぜた順位表
//       GSI2PK = BOARD#<course>#<input>#<period>  … 入力方式ごとの順位表
//       GSI1SK = core.boardSortKey(entry, 'kpm')    … 混ぜた表は毎分の順
//       GSI2SK = core.boardSortKey(entry, 'money')  … 入力方式ごとの表は金額の順
//
// 一つの自己ベストが二つの順位表に載るので、索引を二つ持つ。
// 順位表は該当する索引を降順に引くだけで出る。本人の記録は PK が同じなので、消すときは
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
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { HttpError, boardSortKey, orderOf } from './core.mjs';

/** board.input → 引く索引と、その索引の鍵の名前 */
const indexOf = (input) => (input === 'all'
  ? { IndexName: 'GSI1', pkName: 'GSI1PK', skName: 'GSI1SK' }
  : { IndexName: 'GSI2', pkName: 'GSI2PK', skName: 'GSI2SK' });
const MONTH_TTL_SECONDS = 400 * 24 * 3600;

const pk = (playerId) => `PLAYER#${playerId}`;
const bestSk = (course, input, period) => `BEST#${course}#${input}#${period}`;
const boardPk = ({ course, input, period }) => `BOARD#${course}#${input}#${period}`;

const toEntry = (item) => ({
  playerId: item.playerId,
  nickname: item.nickname,
  course: item.course,
  input: item.input,
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
      const { playerId, course, input, period, money, at } = entry;
      const item = {
        PK: pk(playerId),
        SK: bestSk(course, input, period),
        GSI1PK: boardPk({ course, input: 'all', period }),
        GSI1SK: boardSortKey(entry, orderOf('all')),
        GSI2PK: boardPk({ course, input, period }),
        GSI2SK: boardSortKey(entry, orderOf(input)),
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
                // 消している最中（deleting）のプロフィールには書かせない。下の deletePlayer を参照
                ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deleting)',
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

    async getBest(playerId, course, input, period) {
      const { Item } = await db.send(new GetCommand({
        TableName: tableName,
        Key: { PK: pk(playerId), SK: bestSk(course, input, period) },
        ConsistentRead: true,
      }));
      return Item ? toEntry(Item) : null;
    },

    async countAhead(board, entry) {
      const { IndexName, pkName, skName } = indexOf(board.input);
      // GSI は結果整合なので、書いた直後は自分の新しい行がまだ見えないことがある。
      // ソートキーより「上」だけを数えるので、自分が見えても見えなくても件数は変わらない。
      let count = 0;
      let ExclusiveStartKey;
      do {
        const out = await db.send(new QueryCommand({
          TableName: tableName,
          IndexName,
          KeyConditionExpression: `${pkName} = :pk AND ${skName} > :sk`,
          ExpressionAttributeValues: { ':pk': boardPk(board), ':sk': boardSortKey(entry, orderOf(board.input)) },
          Select: 'COUNT',
          ExclusiveStartKey,
        }));
        count += out.Count ?? 0;
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return count;
    },

    async topEntries(board, limit) {
      const { IndexName, pkName } = indexOf(board.input);
      const { Items = [] } = await db.send(new QueryCommand({
        TableName: tableName,
        IndexName,
        KeyConditionExpression: `${pkName} = :pk`,
        ExpressionAttributeValues: { ':pk': boardPk(board) },
        ScanIndexForward: false,
        Limit: limit,
      }));
      return Items.map(toEntry);
    },

    async deletePlayer(playerId) {
      // まず消している最中の印を付ける。これが無いと、自己ベストを消してからプロフィールを消すまでの
      // 間に届いた送信が条件（プロフィールが在る）を通って自己ベストを書き戻し、その直後に
      // プロフィールが消えて、本人の手の届かない記録が順位表に残る。
      // 印はプロフィールに付けるので、途中で落ちても token は通り、もう一度「消す」を押せる
      try {
        await db.send(new UpdateCommand({
          TableName: tableName,
          Key: { PK: pk(playerId), SK: 'PROFILE' },
          UpdateExpression: 'SET deleting = :t',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':t': true },
        }));
      } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
        // プロフィールがもう無い。消し残しの自己ベストがあれば下で拾って消す
      }

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
