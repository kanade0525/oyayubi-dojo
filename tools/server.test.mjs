#!/usr/bin/env node
/*
 * ランキング API の判断ロジック（server/src/core.mjs）の単体テスト。
 *
 * AWS には一切つながない。core.mjs が受け取る「ストアの約束」を、ここで配列だけの
 * 偽ストアとして書いて渡す。@aws-sdk を import するファイル（store-dynamo.mjs / index.mjs）は
 * 読まない。読むと依存パッケージゼロの約束が CI で崩れる。
 *
 * 見るのは利用者から見える挙動だけ。
 *   登録できる／同意が無ければ断る／token が違えば断る／自己ベストは上がるときだけ変わる／
 *   ありえない金額は断る／順位表は金額の多い順・同額は先着順／消したら全部消える
 *
 * 偽ストアの並びは core.mjs の compareEntries を使う。DynamoDB 側は同じ並びを
 * boardSortKey の文字列順で出すので、その二つが一致することもここで検査する。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);

const core = await load('server/src/core.mjs');
const { createApi, compareEntries, boardSortKey, orderOf, maxMoneyOf, normalizeNickname, HttpError, monthKey } = core;

const PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';

// ---------------------------------------------------------------- 偽ストア

function fakeStore() {
  const players = new Map(); // playerId → profile
  const bests = new Map(); // `${playerId}|${course}|${input}|${period}` → entry
  const onBoard = (e, b) => e.course === b.course && e.period === b.period && (b.input === 'all' || e.input === b.input);
  return {
    players,
    bests,
    async createPlayer(p) {
      players.set(p.playerId, { ...p });
    },
    async getPlayer(id) {
      return players.get(id) ?? null;
    },
    async putBestIfHigher(entry) {
      if (!players.has(entry.playerId)) throw new HttpError(401, '登録が確認できません');
      const key = `${entry.playerId}|${entry.course}|${entry.input}|${entry.period}`;
      const cur = bests.get(key);
      if (cur && cur.money >= entry.money) return false;
      bests.set(key, { ...entry });
      return true;
    },
    async getBest(id, course, input, period) {
      return bests.get(`${id}|${course}|${input}|${period}`) ?? null;
    },
    async countAhead(board, entry) {
      return [...bests.values()].filter((e) => onBoard(e, board) && compareEntries(e, entry, orderOf(board.input)) < 0).length;
    },
    async topEntries(board, limit) {
      return [...bests.values()]
        .filter((e) => onBoard(e, board))
        .sort((a, b) => compareEntries(a, b, orderOf(board.input)))
        .slice(0, limit);
    },
    async deletePlayer(id) {
      players.delete(id);
      for (const k of [...bests.keys()]) if (k.startsWith(`${id}|`)) bests.delete(k);
    },
  };
}

/** 時刻を手で進められる API。clock.ms を書き換えると now() が動く */
function setup() {
  const store = fakeStore();
  const clock = { ms: Date.parse('2026-11-02T03:00:00Z') };
  const errors = [];
  const api = createApi({ store, pepper: PEPPER, now: () => new Date(clock.ms), log: { error: (e) => errors.push(e) } });
  const req = (method, path, { body, token, query } = {}) =>
    api({
      method,
      path,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      query: query ?? {},
      rawBody: body === undefined ? null : JSON.stringify(body),
    });
  const register = async (nickname) => {
    const res = await req('POST', '/players', { body: { nickname, consent: true, consentVersion: '2026-11-02' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  const score = (money, extra = {}) => ({ course: 'otegaru', input: 'nicola', money, kpm: 120, accuracy: 0.95, durationMs: 60000, ...extra });
  return { store, clock, api, req, register, score, errors };
}

// ---------------------------------------------------------------- 登録

describe('登録', () => {
  test('登録すると playerId と token が返り、サーバーには token のハッシュだけが残る', async () => {
    const { req, store } = setup();
    const res = await req('POST', '/players', { body: { nickname: 'ＴＡＲＯ　ｔａｒｏ', consent: true, consentVersion: 'v1' } });
    assert.equal(res.status, 201);
    const { playerId, token, nickname } = res.body;
    assert.match(playerId, /^[0-9a-f-]{36}$/);
    assert.ok(token.startsWith(`${playerId}.`));
    assert.equal(nickname, 'TARO taro'); // NFKC で寄せ、空白はひとつに
    const saved = store.players.get(playerId);
    assert.equal(saved.consentVersion, 'v1');
    assert.match(saved.tokenHash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(saved).includes(token.split('.')[1]), 'token の秘密がそのまま残っている');
  });

  test('同意が true ちょうどでなければ断る', async () => {
    const { req, store } = setup();
    for (const consent of [undefined, false, 'true', 1]) {
      const res = await req('POST', '/players', { body: { nickname: 'a', consent, consentVersion: 'v1' } });
      assert.equal(res.status, 400, `consent=${consent}`);
      assert.equal(typeof res.body.error, 'string');
    }
    const noVersion = await req('POST', '/players', { body: { nickname: 'a', consent: true } });
    assert.equal(noVersion.status, 400);
    assert.equal(store.players.size, 0);
  });

  test('ニックネームの正規化と拒否', () => {
    assert.equal(normalizeNickname('  すし  ざんまい '), 'すし ざんまい');
    assert.equal(normalizeNickname('ｱｲｳ'), 'アイウ');
    assert.equal(normalizeNickname('あ'.repeat(12)), 'あ'.repeat(12));
    assert.equal(normalizeNickname('🍣'.repeat(12)), '🍣'.repeat(12)); // 絵文字は一字と数える
    for (const ng of ['', '   ', '　', 'あ'.repeat(13), 'a\u0000b', 'a\nb', 'a​b', 'a‮b', 42, null]) {
      assert.throws(() => normalizeNickname(ng), HttpError, JSON.stringify(ng));
    }
  });

  test('本文が JSON でない・大きすぎる・知らない道は断る', async () => {
    const { api } = setup();
    assert.equal((await api({ method: 'POST', path: '/players', rawBody: '{' })).status, 400);
    assert.equal((await api({ method: 'POST', path: '/players', rawBody: 'x'.repeat(5000) })).status, 413);
    assert.equal((await api({ method: 'GET', path: '/nope' })).status, 404);
    assert.equal((await api({ method: 'GET', path: '/players' })).status, 404);
  });

  test('pepper が無い・短い・ダミーのままなら起動しない', () => {
    for (const pepper of [undefined, '', 'CHANGE_ME', 'short']) {
      assert.throws(() => createApi({ store: fakeStore(), pepper }), /TOKEN_PEPPER/);
    }
  });
});

// ---------------------------------------------------------------- 認証

describe('token', () => {
  test('token が無い・形が違う・秘密が違うものは 401', async () => {
    const { req, register, score } = setup();
    const { token, playerId } = await register('a');
    const wrongSecret = `${playerId}.${'A'.repeat(43)}`;
    const otherId = `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.${token.split('.')[1]}`;
    for (const t of [undefined, 'garbage', wrongSecret, otherId]) {
      const res = await req('POST', '/scores', { token: t, body: score(1000) });
      assert.equal(res.status, 401, String(t));
    }
    assert.equal((await req('POST', '/scores', { token, body: score(1000) })).status, 200);
  });

  test('別の pepper で動くサーバーでは同じ token が通らない', async () => {
    const { store, register, score } = setup();
    const { token } = await register('a');
    const other = createApi({ store, pepper: `${PEPPER}-other`, log: { error() {} } });
    const res = await other({ method: 'POST', path: '/scores', headers: { authorization: `Bearer ${token}` }, rawBody: JSON.stringify(score(1)) });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------- スコア

describe('自己ベスト', () => {
  test('上がったときだけ更新し、下がっても同額でも更新しない', async () => {
    const { req, register, score, store } = setup();
    const { token, playerId } = await register('a');
    const r1 = await req('POST', '/scores', { token, body: score(1500) });
    assert.deepEqual(r1.body, { rank: 1, best: 1500, isBest: true });

    const r2 = await req('POST', '/scores', { token, body: score(900) });
    assert.deepEqual(r2.body, { rank: 1, best: 1500, isBest: false });

    const r3 = await req('POST', '/scores', { token, body: score(1500) });
    assert.equal(r3.body.isBest, false);

    const r4 = await req('POST', '/scores', { token, body: score(2400) });
    assert.deepEqual(r4.body, { rank: 1, best: 2400, isBest: true });

    // 通算と今月（日本時間）の両方に残る
    assert.equal((await store.getBest(playerId, 'otegaru', 'nicola', 'all')).money, 2400);
    assert.equal((await store.getBest(playerId, 'otegaru', 'nicola', '2026-11')).money, 2400);
  });

  test('月の自己ベストは月が替わると別に数える', async () => {
    const { req, register, score, store, clock } = setup();
    const { token, playerId } = await register('a');
    await req('POST', '/scores', { token, body: score(3000) });
    clock.ms = Date.parse('2026-11-30T15:00:00Z'); // 日本時間 12/1 0:00
    const r = await req('POST', '/scores', { token, body: score(1000) });
    assert.equal(r.body.isBest, false); // 通算は更新していない
    assert.equal((await store.getBest(playerId, 'otegaru', 'nicola', '2026-12')).money, 1000);
    assert.equal((await store.getBest(playerId, 'otegaru', 'nicola', '2026-11')).money, 3000);
  });

  test('月の区切りは日本時間', () => {
    assert.equal(monthKey(new Date('2026-11-30T14:59:59Z')), '2026-11');
    assert.equal(monthKey(new Date('2026-11-30T15:00:00Z')), '2026-12');
  });

  test('上限を超える金額・速さ・時間、壊れた値は 400 で、何も残さない', async () => {
    const { req, register, score, store } = setup();
    const { token } = await register('a');
    const max = maxMoneyOf('otegaru', 'nicola');
    assert.equal((await req('POST', '/scores', { token, body: score(max + 1) })).status, 400);
    assert.equal((await req('POST', '/scores', { token, body: score(100, { kpm: 601 }) })).status, 400);
    assert.equal((await req('POST', '/scores', { token, body: score(100, { durationMs: 10 * 60_000 }) })).status, 400);
    for (const broken of [
      score(-1), score(1.5), score('100'), score(100, { course: 'tokujo' }),
      score(100, { accuracy: 1.2 }), score(100, { kpm: Number.NaN }), score(100, { durationMs: 0 }),
    ]) {
      assert.equal((await req('POST', '/scores', { token, body: broken })).status, 400, JSON.stringify(broken));
    }
    assert.equal(store.bests.size, 0);
    // 上限ちょうどは、速さと時間がそれに見合っていれば通る（毎分 600 かな・延長込みの最長時間）
    assert.equal((await req('POST', '/scores', { token, body: score(max, { kpm: 600, durationMs: core.maxDurationMsOf('otegaru') }) })).status, 200);
  });

  test('値どうしが合わない組は 400（どれも単独では上限の内側）', async () => {
    const { req, register, score, store } = setup();
    const { token } = await register('a');
    const max = maxMoneyOf('otegaru', 'nicola');
    // 金額だけ上限ちょうど・速さ 1・時間 1ms
    assert.equal((await req('POST', '/scores', { token, body: score(max, { kpm: 1, accuracy: 0.5, durationMs: 1 }) })).status, 400);
    // 制限時間より短い（ゲームは時間切れでしか終わらない）
    assert.equal((await req('POST', '/scores', { token, body: score(100, { durationMs: 30_000 }) })).status, 400);
    // 毎分 120 かな × 60 秒 ≒ 121 字 × (30 + 20) 円 = 6,050 円 を超える
    assert.equal((await req('POST', '/scores', { token, body: score(6_100) })).status, 400);
    assert.equal(store.bests.size, 0);
    // 境目の内側は通る
    assert.equal((await req('POST', '/scores', { token, body: score(6_050) })).status, 200);
  });

  test('上限は時間の長いコースほど高い', () => {
    assert.ok(maxMoneyOf('otegaru', 'nicola') < maxMoneyOf('osusume', 'nicola'));
    assert.ok(maxMoneyOf('osusume', 'nicola') < maxMoneyOf('koukyu', 'nicola'));
    assert.throws(() => maxMoneyOf('tokujo', 'nicola'));
    assert.throws(() => maxMoneyOf('otegaru', 'qwerty'));
  });

  test('上限は延長込みの時間 × 毎分 600 かな × (単価 + ぴったり) になっている', () => {
    // 延長率 r = 10 かな/秒 × 1000ms / 20 打 = 0.5 → 遊べる時間は最大で制限時間の 2 倍
    assert.equal(core.maxDurationMsOf('otegaru'), 120_000);
    assert.equal(maxMoneyOf('otegaru', 'nicola'), 1200 * (30 + 20));
    assert.equal(maxMoneyOf('osusume', 'nicola'), 1800 * (40 + 20));
    assert.equal(maxMoneyOf('koukyu', 'nicola'), 2400 * (45 + 20));
  });

  // サーバーは courses.js を import できないので数値を写している。写し間違い・上げ忘れをここで捕まえる
  test('core.mjs に写したコースの数値が courses.js と一致する', async () => {
    const c = await load('assets/js/game/courses.js');
    assert.deepEqual(c.COURSES.map((x) => x.id).sort(), [...core.COURSE_IDS].sort());
    for (const course of c.COURSES) {
      const lim = core.COURSE_LIMITS[course.id];
      assert.equal(lim.timeMs, course.timeMs, `${course.id} の timeMs`);
      assert.equal(lim.yenPerKana, c.plateValue(course, { kana: 'あ' }), `${course.id} の一字単価`);
      assert.equal(lim.yenPerKana * 7, c.plateValue(course, { kana: 'あいうえおかき' }), `${course.id} は長さに比例`);
    }
    assert.equal(core.PERFECT_BONUS, c.PERFECT_BONUS);
    assert.equal(core.COMBO_STEP, c.COMBO_STEP);
    assert.equal(core.COMBO_TIME_BONUS_MS, c.COMBO_TIME_BONUS_MS);
  });
});

// ---------------------------------------------------------------- 順位表

describe('順位表', () => {
  test('金額の多い順、同額は先に出した人が上', async () => {
    const { req, register, score, clock } = setup();
    const a = await register('あ');
    const b = await register('い');
    const c = await register('う');
    await req('POST', '/scores', { token: a.token, body: score(1000) });
    clock.ms += 1000;
    await req('POST', '/scores', { token: b.token, body: score(2000) });
    clock.ms += 1000;
    const rc = await req('POST', '/scores', { token: c.token, body: score(1000) });
    assert.equal(rc.body.rank, 3); // 同額のあは先に出しているので上

    const res = await req('GET', '/ranking', { query: { course: 'otegaru', period: 'all', input: 'nicola' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.entries.map((e) => [e.rank, e.nickname, e.money]), [
      [1, 'い', 2000], [2, 'あ', 1000], [3, 'う', 1000],
    ]);
    // 順位表に token・playerId は出さない
    assert.ok(!JSON.stringify(res.body).includes(a.token.split('.')[1]));
    assert.ok(!JSON.stringify(res.body).includes(a.playerId));
    assert.deepEqual(Object.keys(res.body.entries[0]).sort(), ['accuracy', 'at', 'input', 'kpm', 'money', 'nickname', 'rank']);

    const month = await req('GET', '/ranking', { query: { course: 'otegaru', period: 'month', input: 'all' } });
    assert.equal(month.body.period, '2026-11');
    assert.equal(month.body.entries.length, 3);

    const other = await req('GET', '/ranking', { query: { course: 'koukyu', period: 'all', input: 'all' } });
    assert.deepEqual(other.body.entries, []);
  });

  test('50 件で切る', async () => {
    const { req, register, score } = setup();
    for (let i = 0; i < 55; i++) {
      const p = await register(`p${i}`);
      await req('POST', '/scores', { token: p.token, body: score(100 + i) });
    }
    const res = await req('GET', '/ranking', { query: { course: 'otegaru', input: 'nicola' } });
    assert.equal(res.body.entries.length, 50);
    assert.equal(res.body.entries[0].money, 154);
  });

  test('コース・期間が違えば 400', async () => {
    const { req } = setup();
    assert.equal((await req('GET', '/ranking', { query: { course: 'tokujo', input: 'all' } })).status, 400);
    assert.equal((await req('GET', '/ranking', { query: { course: 'otegaru', period: 'year', input: 'all' } })).status, 400);
  });

  test('boardSortKey の文字列降順は compareEntries の並びと一致する（DynamoDB 側の並び）', () => {
    const rows = [
      { money: 0, kpm: 300.5, at: '2026-11-02T00:00:00.000Z' },
      { money: 9, kpm: 99.9, at: '2026-11-02T00:00:00.000Z' },
      { money: 10, kpm: 100, at: '2026-11-02T00:00:00.000Z' },
      { money: 10, kpm: 100, at: '2026-11-01T00:00:00.000Z' },
      { money: 123456, kpm: 12.3, at: '2026-12-31T23:59:59.999Z' },
      { money: 123456, kpm: 450, at: '2026-01-01T00:00:00.000Z' },
    ];
    for (const by of ['money', 'kpm']) {
      const bySortKey = [...rows].sort((x, y) => {
        const a = boardSortKey(x, by);
        const b = boardSortKey(y, by);
        return a < b ? 1 : a > b ? -1 : 0;
      });
      assert.deepEqual(bySortKey, [...rows].sort((a, b) => compareEntries(a, b, by)), by);
    }
  });

  test('混ぜた表は毎分の順、入力方式ごとの表は金額の順', () => {
    assert.equal(orderOf('all'), 'kpm');
    assert.equal(orderOf('nicola'), 'money');
    assert.equal(orderOf('romaji'), 'money');
  });
});

// ---------------------------------------------------------------- 入力方式

describe('入力方式', () => {
  test('input が無い・知らない値なら 400 で、何も残さない', async () => {
    const { req, register, score, store } = setup();
    const { token } = await register('a');
    for (const input of [undefined, null, '', 'qwerty', 'NICOLA']) {
      const res = await req('POST', '/scores', { token, body: score(100, { input }) });
      assert.equal(res.status, 400, `input=${input}`);
    }
    assert.equal(store.bests.size, 0);
  });

  test('ローマ字はぴったりの上乗せが無いぶん上限が低い', async () => {
    const { req, register, score } = setup();
    const { token } = await register('a');
    assert.equal(maxMoneyOf('otegaru', 'romaji'), 1200 * 30);
    // 毎分 120 かな × 60 秒 ≒ 121 字 × 30 円 = 3,630 円。親指シフトなら通る額でも、ローマ字では超える
    assert.equal((await req('POST', '/scores', { token, body: score(3_700, { input: 'romaji' }) })).status, 400);
    assert.equal((await req('POST', '/scores', { token, body: score(3_700) })).status, 200);
    assert.equal((await req('POST', '/scores', { token, body: score(3_630, { input: 'romaji' }) })).status, 200);
  });

  test('自己ベストと順位は入力方式ごと。all の表には両方が並ぶ', async () => {
    const { req, register, score, store, clock } = setup();
    const a = await register('あ');
    const b = await register('い');
    const ra = await req('POST', '/scores', { token: a.token, body: score(2000) });
    assert.deepEqual(ra.body, { rank: 1, best: 2000, isBest: true });
    clock.ms += 1000;
    // ローマ字の自己ベストは親指シフトの記録に引きずられない
    const ra2 = await req('POST', '/scores', { token: a.token, body: score(1000, { input: 'romaji' }) });
    assert.deepEqual(ra2.body, { rank: 1, best: 1000, isBest: true });
    clock.ms += 1000;
    const rb = await req('POST', '/scores', { token: b.token, body: score(1500, { input: 'romaji', kpm: 150 }) });
    assert.deepEqual(rb.body, { rank: 1, best: 1500, isBest: true }); // ローマ字の表で 1 位
    assert.equal((await store.getBest(a.playerId, 'otegaru', 'nicola', 'all')).money, 2000);
    assert.equal((await store.getBest(a.playerId, 'otegaru', 'romaji', 'all')).money, 1000);

    const rows = async (input) => (await req('GET', '/ranking', { query: { course: 'otegaru', period: 'all', input } })).body.entries
      .map((e) => [e.rank, e.nickname, e.input, e.money]);
    // 混ぜた表は毎分の順。いは金額では あ の親指シフトに負けるが、毎分（150）で上に来る
    assert.deepEqual(await rows('all'), [[1, 'い', 'romaji', 1500], [2, 'あ', 'nicola', 2000], [3, 'あ', 'romaji', 1000]]);
    assert.deepEqual(await rows('nicola'), [[1, 'あ', 'nicola', 2000]]);
    assert.deepEqual(await rows('romaji'), [[1, 'い', 'romaji', 1500], [2, 'あ', 'romaji', 1000]]);
  });

  test('順位表の input が無い・知らない値なら 400', async () => {
    const { req } = setup();
    assert.equal((await req('GET', '/ranking', { query: { course: 'otegaru', period: 'all' } })).status, 400);
    assert.equal((await req('GET', '/ranking', { query: { course: 'otegaru', period: 'all', input: 'kana' } })).status, 400);
  });
});

// ---------------------------------------------------------------- 削除

describe('削除', () => {
  test('本人の記録だけを全部消し、消した後の token は通らない', async () => {
    const { req, register, score, store } = setup();
    const a = await register('あ');
    const b = await register('い');
    await req('POST', '/scores', { token: a.token, body: score(1000) });
    await req('POST', '/scores', { token: a.token, body: score(500, { course: 'koukyu', durationMs: 120000 }) });
    await req('POST', '/scores', { token: b.token, body: score(800) });

    const del = await req('DELETE', '/players/me', { token: a.token });
    assert.equal(del.status, 204);
    assert.equal(del.body, null);
    assert.equal(store.players.has(a.playerId), false);
    assert.ok([...store.bests.keys()].every((k) => !k.startsWith(a.playerId)));
    assert.ok(store.players.has(b.playerId));

    assert.equal((await req('POST', '/scores', { token: a.token, body: score(9000) })).status, 401);
    const list = await req('GET', '/ranking', { query: { course: 'otegaru', input: 'all' } });
    assert.deepEqual(list.body.entries.map((e) => e.nickname), ['い']);

    // 二度押しは成功のまま
    assert.equal((await req('DELETE', '/players/me', { token: a.token })).status, 204);
  });

  test('秘密が違えば消さない', async () => {
    const { req, register, store } = setup();
    const a = await register('あ');
    const res = await req('DELETE', '/players/me', { token: `${a.playerId}.${'B'.repeat(43)}` });
    assert.equal(res.status, 401);
    assert.ok(store.players.has(a.playerId));
  });
});

// ---------------------------------------------------------------- 内部エラー

test('想定外の例外は中身を返さず 500、ログにだけ残す', async () => {
  const store = fakeStore();
  store.topEntries = async () => {
    throw new Error('ResourceNotFoundException: table oyayubi-secret-table');
  };
  const errors = [];
  const api = createApi({ store, pepper: PEPPER, log: { error: (e) => errors.push(e) } });
  const res = await api({ method: 'GET', path: '/ranking', query: { course: 'otegaru', input: 'all' } });
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(res.body).includes('oyayubi-secret-table'));
  assert.equal(errors.length, 1);
});

// ---------------------------------------------------------------- ブラウザ側（通信しない範囲）

describe('assets/js/game/ranking.js', () => {
  test('同意が無ければ送らずに throw。API の URL が空なら無効', async () => {
    let fetched = 0;
    globalThis.fetch = async () => {
      fetched++;
      throw new Error('呼ばれてはいけない');
    };
    const r = await load('assets/js/game/ranking.js');
    assert.equal(typeof r.CONSENT_VERSION, 'string');
    for (const consent of [undefined, false, 'true', 1]) {
      await assert.rejects(r.register({ nickname: 'a', consent }), /同意/);
    }
    assert.equal(fetched, 0);
    const { RANKING_API_URL } = await load('assets/js/game/config.js');
    assert.equal(r.rankingEnabled(), RANKING_API_URL !== '');
  });
});
