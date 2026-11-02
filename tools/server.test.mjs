#!/usr/bin/env node
/*
 * ランキング API の判断ロジック（server/src/core.mjs）の単体テスト。
 *
 * AWS には一切つながない。core.mjs が受け取る「ストアの約束」を、ここで Map だけの
 * 偽ストアとして書いて渡す。@aws-sdk を import するファイル（store-dynamo.mjs / index.mjs）は
 * 読まない。読むと依存パッケージゼロの約束が CI で崩れる。
 *
 * 見るのは利用者から見える挙動だけ。
 *   登録できる／同意が無ければ断る／token が違えば断る／自己ベストは上がるときだけ変わる／
 *   ありえない記録は断る／表はコースごと／部門は点数の順・総合は毎分の順・同じ値は先着順／
 *   どの表も 1 人 1 行／総合には各部門の 1 位が付く／消したら全部消える
 *
 * 偽ストアの並びは core.mjs の compareEntries と orderOf を使う。DynamoDB 側は同じ並びを
 * boardSortKey の文字列順で出すので、その二つが一致することもここで検査する。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);

const core = await load('server/src/core.mjs');
const { createApi, compareEntries, boardSortKey, orderOf, orderValue, maxScoreOf, maxDurationMsOf, normalizeNickname, HttpError, monthKey } = core;

const PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';

// ---------------------------------------------------------------- 偽ストア

function fakeStore() {
  const players = new Map(); // playerId → profile
  const bests = new Map(); // `${playerId}|${course}|${board}|${period}` → entry
  const tail = ({ course, board, period }) => `|${course}|${board}|${period}`;
  const rowsOf = (where) => [...bests.entries()].filter(([k]) => k.endsWith(tail(where))).map(([, e]) => e);
  return {
    players,
    bests,
    async createPlayer(p) {
      players.set(p.playerId, { ...p });
    },
    async getPlayer(id) {
      return players.get(id) ?? null;
    },
    async putBestIfHigher(where, entry) {
      if (!core.COURSE_IDS.includes(where.course)) throw new Error(`未知のコース: ${where.course}`);
      if (!core.BOARDS.includes(where.board)) throw new Error(`未知の順位表: ${where.board}`);
      if (where.board !== 'all' && where.board !== entry.input) throw new Error(`部門 ${where.board} に ${entry.input} の記録は書けない`);
      if (entry.course !== where.course || entry.period !== where.period) throw new Error('記録のコース・期間と書く先が食い違っている');
      if (!players.has(entry.playerId)) throw new HttpError(401, '登録が確認できません');
      const key = `${entry.playerId}${tail(where)}`;
      const cur = bests.get(key);
      const by = orderOf(where.board);
      if (cur && orderValue(cur, by) >= orderValue(entry, by)) return false;
      bests.set(key, { ...entry });
      return true;
    },
    async getBest(id, where) {
      return bests.get(`${id}${tail(where)}`) ?? null;
    },
    async countAhead(where, entry) {
      return rowsOf(where).filter((e) => compareEntries(e, entry, orderOf(where.board)) < 0).length;
    },
    async topEntries(where, limit) {
      return rowsOf(where).sort((a, b) => compareEntries(a, b, orderOf(where.board))).slice(0, limit);
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
  // 3000 点コース（60 秒・一字あたり最大 50 pt）。毎分 120 かな × 60 秒 → 字数は 121 字まで見る。
  // 入力方式によらず 121 × 50 = 6,050 pt まで通る
  const score = (points, extra = {}) => ({ course: 'p3000', input: 'nicola', score: points, kpm: 120, accuracy: 0.95, durationMs: 60000, ...extra });
  const post = async (token, body) => {
    const res = await req('POST', '/scores', { token, body });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };
  const ranking = async (board, period = 'all', course = 'p3000') => {
    const res = await req('GET', '/ranking', { query: { course, board, period } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };
  return { store, clock, api, req, register, score, post, ranking, errors };
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
      const res = await req('POST', '/scores', { token: t, body: score(100) });
      assert.equal(res.status, 401, String(t));
    }
    assert.equal((await req('POST', '/scores', { token, body: score(100) })).status, 200);
  });

  test('別の pepper で動くサーバーでは同じ token が通らない', async () => {
    const { store, register, score } = setup();
    const { token } = await register('a');
    const other = createApi({ store, pepper: `${PEPPER}-other`, log: { error() {} } });
    const res = await other({ method: 'POST', path: '/scores', headers: { authorization: `Bearer ${token}` }, rawBody: JSON.stringify(score(1)) });
    assert.equal(res.status, 401);
  });

  test('プロフィールが消えた後に届いた送信は 401 で、何も書き戻さない', async () => {
    const { req, register, score, store } = setup();
    const { token, playerId } = await register('a');
    // token の照合は通ったが、書く直前にプロフィールが消えた（消す処理と送信が行き違った）場合
    const getPlayer = store.getPlayer;
    store.getPlayer = async (id) => {
      const p = await getPlayer(id);
      store.players.delete(id);
      return p;
    };
    const res = await req('POST', '/scores', { token, body: score(100) });
    assert.equal(res.status, 401);
    assert.ok([...store.bests.keys()].every((k) => !k.startsWith(playerId)));
  });
});

// ---------------------------------------------------------------- 自己ベスト

describe('自己ベスト', () => {
  test('部門の自己ベストは点数が上がったときだけ更新し、下がっても同点でも更新しない', async () => {
    const { register, score, post, store } = setup();
    const { token, playerId } = await register('a');
    assert.deepEqual(await post(token, score(150)), { rank: 1, best: 150, isBest: true, overallRank: 1, overallBest: 120 });
    assert.deepEqual(await post(token, score(90)), { rank: 1, best: 150, isBest: false, overallRank: 1, overallBest: 120 });
    assert.equal((await post(token, score(150))).isBest, false);
    assert.deepEqual(await post(token, score(240)), { rank: 1, best: 240, isBest: true, overallRank: 1, overallBest: 120 });

    // 通算と今月（日本時間）の両方に残る
    assert.equal((await store.getBest(playerId, { course: 'p3000', board: 'nicola', period: 'all' })).score, 240);
    assert.equal((await store.getBest(playerId, { course: 'p3000', board: 'nicola', period: '2026-11' })).score, 240);
  });

  test('総合の自己ベストは毎分で決まり、部門とは別に更新される。総合の一行はその一本の入力方式と点数を持つ', async () => {
    const { register, score, post, store } = setup();
    const { token, playerId } = await register('a');
    await post(token, score(300, { kpm: 120 }));
    // 点数は下がったが速くなった一本。部門は更新しない、総合は更新する
    const r = await post(token, score(200, { kpm: 150.04 }));
    assert.deepEqual(r, { rank: 1, best: 300, isBest: false, overallRank: 1, overallBest: 150 });
    const overall = await store.getBest(playerId, { course: 'p3000', board: 'all', period: 'all' });
    assert.deepEqual([overall.input, overall.score, overall.kpm], ['nicola', 200, 150]);
    // ローマ字のもっと速い一本は、総合の一行をローマ字の一本に置き換える。親指シフトの部門には触らない
    const r2 = await post(token, score(100, { input: 'romaji', kpm: 180 }));
    assert.deepEqual(r2, { rank: 1, best: 100, isBest: true, overallRank: 1, overallBest: 180 });
    const overall2 = await store.getBest(playerId, { course: 'p3000', board: 'all', period: 'all' });
    assert.deepEqual([overall2.input, overall2.score, overall2.kpm], ['romaji', 100, 180]);
    assert.equal((await store.getBest(playerId, { course: 'p3000', board: 'nicola', period: 'all' })).score, 300);
    // 毎分は 0.1 刻みで比べる。丸めて同じなら更新しない（先に出した方を残す）
    await post(token, score(50, { input: 'romaji', kpm: 180.04 }));
    assert.equal((await store.getBest(playerId, { course: 'p3000', board: 'all', period: 'all' })).score, 100);
  });

  test('月の自己ベストは月が替わると別に数える', async () => {
    const { register, score, post, store, clock } = setup();
    const { token, playerId } = await register('a');
    await post(token, score(300));
    clock.ms = Date.parse('2026-11-30T15:00:00Z'); // 日本時間 12/1 0:00
    const r = await post(token, score(100, { kpm: 100 }));
    assert.equal(r.isBest, false); // 通算は更新していない
    assert.equal((await store.getBest(playerId, { course: 'p3000', board: 'nicola', period: '2026-12' })).score, 100);
    assert.equal((await store.getBest(playerId, { course: 'p3000', board: 'nicola', period: '2026-11' })).score, 300);
    assert.equal((await store.getBest(playerId, { course: 'p3000', board: 'all', period: '2026-12' })).kpm, 100);
    assert.equal((await store.getBest(playerId, { course: 'p3000', board: 'all', period: 'all' })).kpm, 120);
  });

  test('月の区切りは日本時間', () => {
    assert.equal(monthKey(new Date('2026-11-30T14:59:59Z')), '2026-11');
    assert.equal(monthKey(new Date('2026-11-30T15:00:00Z')), '2026-12');
  });
});

// ---------------------------------------------------------------- 検証

describe('ありえない記録', () => {
  test('一字あたりの値段の最大は、値段の表の全部の段の price / minLen の最大（切り上げ）', () => {
    assert.equal(core.maxPricePerKanaOf('p3000'), 50); // 100 / 2
    assert.equal(core.maxPricePerKanaOf('p5000'), 38); // 380 / 10（180 / 5 = 36 より高い）
    assert.equal(core.maxPricePerKanaOf('p10000'), 39); // 500 / 13 = 38.46…（240 / 9 = 26.7 より高い）
    assert.throws(() => core.maxPricePerKanaOf('otegaru'));
  });

  test('上限は延長込みの時間 × 毎分 600 かな × 一字あたりの値段の最大', () => {
    // 延長率 r = 15 キー/秒 × 7000ms / 130 キー ≈ 0.8077 → 遊べる時間は最大で制限時間の 5.2 倍
    assert.equal(maxDurationMsOf('p3000'), 312_000);
    assert.ok(Math.abs(maxDurationMsOf('p5000') - 468_000) <= 1);
    assert.equal(maxDurationMsOf('p10000'), 624_000);
    assert.equal(maxScoreOf('p3000'), 3120 * 50);
    assert.equal(maxScoreOf('p10000'), 6240 * 39);
    assert.throws(() => maxScoreOf('otegaru'));
  });

  test('時間は制限時間 − 1 秒から、延長込みの上限 + 1 秒まで', async () => {
    const { req, register, score, store } = setup();
    const { token } = await register('a');
    for (const [course, durationMs] of [['p3000', 58_999], ['p3000', 313_001], ['p5000', 88_999], ['p10000', 625_001], ['p3000', 0], ['p3000', 60_000.5]]) {
      assert.equal((await req('POST', '/scores', { token, body: score(100, { course, durationMs }) })).status, 400, `${course} ${durationMs}`);
    }
    assert.equal(store.bests.size, 0);
    for (const [course, durationMs] of [['p3000', 59_000], ['p3000', 313_000], ['p5000', 89_000], ['p10000', 625_000]]) {
      assert.equal((await req('POST', '/scores', { token, body: score(100, { course, durationMs }) })).status, 200, `${course} ${durationMs}`);
    }
  });

  test('コース・速さ・正確さ・点数・入力方式が壊れていれば 400 で、何も残さない', async () => {
    const { req, register, score, store } = setup();
    const { token } = await register('a');
    for (const broken of [
      score(-1), score(1.5), score('100'), score(null),
      score(100, { course: undefined }), score(100, { course: 'otegaru' }), score(100, { course: 'P3000' }),
      score(100, { kpm: 600.1 }), score(100, { kpm: -1 }), score(100, { kpm: Number.NaN }), score(100, { kpm: '120' }),
      score(100, { accuracy: 1.2 }), score(100, { accuracy: -0.1 }),
      score(100, { input: undefined }), score(100, { input: '' }), score(100, { input: 'qwerty' }), score(100, { input: 'NICOLA' }),
      score(100, { input: 'all' }), // 総合は表の名前で、入力方式ではない
      [], 'score',
    ]) {
      assert.equal((await req('POST', '/scores', { token, body: broken })).status, 400, JSON.stringify(broken));
    }
    assert.equal(store.bests.size, 0);
  });

  test('点数は打った字数 × 一字あたりの値段の最大まで（字数は速さと時間から戻す。入力方式で差は無い）', async () => {
    const { req, register, score, store } = setup();
    const { token } = await register('a');
    // 毎分 120 かな × 60 秒 → 121 字まで見る
    for (const input of ['nicola', 'romaji']) {
      assert.equal((await req('POST', '/scores', { token, body: score(6051, { input }) })).status, 400, input);
    }
    // 一字あたりの値段はコースで違う。1 万点コースの 120 秒 → 241 字 × 39 = 9,399 pt
    assert.equal((await req('POST', '/scores', { token, body: score(9400, { course: 'p10000', durationMs: 120_000 }) })).status, 400);
    // 点数だけ上限ちょうど・速さ 1
    assert.equal((await req('POST', '/scores', { token, body: score(maxScoreOf('p3000'), { kpm: 1 }) })).status, 400);
    assert.equal(store.bests.size, 0);
    for (const input of ['nicola', 'romaji']) {
      assert.equal((await req('POST', '/scores', { token, body: score(6050, { input }) })).status, 200, input);
    }
    assert.equal((await req('POST', '/scores', { token, body: score(9399, { course: 'p10000', durationMs: 120_000 }) })).status, 200);
  });

  test('上限ちょうどは、速さと時間が見合っていれば通り、一つ超えると断る', async () => {
    const { req, register, score } = setup();
    const { token } = await register('a');
    const top = { kpm: 600, durationMs: maxDurationMsOf('p3000') };
    assert.equal((await req('POST', '/scores', { token, body: score(maxScoreOf('p3000') + 1, top) })).status, 400);
    assert.equal((await req('POST', '/scores', { token, body: score(maxScoreOf('p3000'), top) })).status, 200);
    assert.equal((await req('POST', '/scores', { token, body: score(maxScoreOf('p3000'), { ...top, input: 'romaji' }) })).status, 200);
  });

  // courses.js 側との突き合わせは tools/game.test.mjs が持つ（ブラウザ側の担当）。ここでは写した値そのものを固定する
  test('写したコースの数値', () => {
    const tier = (minLen, maxLen, price) => ({ minLen, maxLen, price });
    assert.deepEqual(core.COURSE_LIMITS, {
      p3000: { timeMs: 60_000, prices: [tier(2, 4, 100), tier(5, 6, 180), tier(7, 7, 240)] },
      p5000: { timeMs: 90_000, prices: [tier(5, 6, 180), tier(7, 9, 240), tier(10, 10, 380)] },
      p10000: { timeMs: 120_000, prices: [tier(9, 9, 240), tier(10, 12, 380), tier(13, 14, 500)] },
    });
    assert.deepEqual(core.METER_STEPS, [{ keys: 28, ms: 1000 }, { keys: 59, ms: 1000 }, { keys: 92, ms: 2000 }, { keys: 130, ms: 3000 }]);
    for (const name of ['PERFECT_BONUS', 'COMBO_STEP', 'COMBO_TIME_BONUS_MS', 'perfectBonusOf']) assert.equal(core[name], undefined, name);
  });
});

// ---------------------------------------------------------------- 順位表

describe('順位表', () => {
  test('部門の表は点数の多い順、同点は先に出した人が上。一行に出すのは決めた列だけ', async () => {
    const { register, score, post, ranking, clock } = setup();
    const a = await register('あ');
    const b = await register('い');
    const c = await register('う');
    await post(a.token, score(100));
    clock.ms += 1000;
    await post(b.token, score(200));
    clock.ms += 1000;
    const rc = await post(c.token, score(100));
    assert.equal(rc.rank, 3); // 同点のあは先に出しているので上

    const res = await ranking('nicola');
    assert.equal(res.course, 'p3000');
    assert.equal(res.board, 'nicola');
    assert.equal(res.period, 'all');
    assert.equal(res.leaders, null); // 部門の表には 1 位を添えない
    assert.deepEqual(res.entries.map((e) => [e.rank, e.nickname, e.score]), [[1, 'い', 200], [2, 'あ', 100], [3, 'う', 100]]);
    // 順位表に token・playerId は出さない
    assert.ok(!JSON.stringify(res).includes(a.token.split('.')[1]));
    assert.ok(!JSON.stringify(res).includes(a.playerId));
    assert.deepEqual(Object.keys(res.entries[0]).sort(), ['accuracy', 'at', 'input', 'kpm', 'nickname', 'rank', 'score']);

    assert.deepEqual((await ranking('romaji')).entries, []);
  });

  test('どの表も 1 人 1 行。何度出しても、両方の入力方式で出しても増えない', async () => {
    const { register, score, post, ranking, clock } = setup();
    const a = await register('あ');
    for (const [points, kpm, input] of [[100, 100, 'nicola'], [300, 130, 'nicola'], [200, 140, 'nicola'], [90, 160, 'romaji'], [110, 150, 'romaji']]) {
      clock.ms += 1000;
      await post(a.token, score(points, { kpm, input }));
    }
    for (const period of ['all', 'month']) {
      const all = await ranking('all', period);
      assert.deepEqual(all.entries.map((e) => [e.nickname, e.input, e.kpm, e.score]), [['あ', 'romaji', 160, 90]], period);
      assert.deepEqual((await ranking('nicola', period)).entries.map((e) => [e.nickname, e.score, e.kpm]), [['あ', 300, 130]], period);
      assert.deepEqual((await ranking('romaji', period)).entries.map((e) => [e.nickname, e.score, e.kpm]), [['あ', 110, 150]], period);
    }
  });

  test('総合は毎分の順、部門は点数の順。総合には期間ごとの各部門の 1 位が付く', async () => {
    const { register, score, post, ranking, clock } = setup();
    const a = await register('あ');
    const b = await register('い');
    const c = await register('う');
    // あ：親指シフトで点数は高いが遅い／い：ローマ字で速い／う：両方
    const ra = await post(a.token, score(330, { kpm: 110 }));
    assert.deepEqual(ra, { rank: 1, best: 330, isBest: true, overallRank: 1, overallBest: 110 });
    clock.ms += 1000;
    const rb = await post(b.token, score(150, { input: 'romaji', kpm: 160 }));
    assert.deepEqual(rb, { rank: 1, best: 150, isBest: true, overallRank: 1, overallBest: 160 });
    clock.ms += 1000;
    const rc1 = await post(c.token, score(200, { kpm: 130 }));
    assert.deepEqual(rc1, { rank: 2, best: 200, isBest: true, overallRank: 2, overallBest: 130 });
    clock.ms += 1000;
    const rc2 = await post(c.token, score(100, { input: 'romaji', kpm: 100 }));
    // ローマ字の部門では 2 位。総合は前の 130 のまま
    assert.deepEqual(rc2, { rank: 2, best: 100, isBest: true, overallRank: 2, overallBest: 130 });

    const all = await ranking('all');
    assert.deepEqual(all.entries.map((e) => [e.rank, e.nickname, e.input, e.kpm, e.score]), [
      [1, 'い', 'romaji', 160, 150], [2, 'う', 'nicola', 130, 200], [3, 'あ', 'nicola', 110, 330],
    ]);
    assert.deepEqual(all.leaders, { nicola: { nickname: 'あ', score: 330 }, romaji: { nickname: 'い', score: 150 } });
    assert.deepEqual((await ranking('nicola')).entries.map((e) => [e.rank, e.nickname, e.score]), [[1, 'あ', 330], [2, 'う', 200]]);
    assert.deepEqual((await ranking('romaji')).entries.map((e) => [e.rank, e.nickname, e.score]), [[1, 'い', 150], [2, 'う', 100]]);

    // 来月に入ると、今月の表と 1 位は空から数え直す。通算はそのまま
    clock.ms = Date.parse('2026-11-30T15:00:00Z');
    await post(c.token, score(50, { input: 'romaji', kpm: 60 }));
    const month = await ranking('all', 'month');
    assert.equal(month.period, '2026-12');
    assert.deepEqual(month.entries.map((e) => e.nickname), ['う']);
    assert.deepEqual(month.leaders, { nicola: null, romaji: { nickname: 'う', score: 50 } });
    assert.deepEqual((await ranking('all')).leaders.romaji, { nickname: 'い', score: 150 });
  });

  test('誰もいなければ総合の 1 位はどちらも null', async () => {
    const { ranking } = setup();
    assert.deepEqual(await ranking('all'), { course: 'p3000', board: 'all', period: 'all', entries: [], leaders: { nicola: null, romaji: null } });
  });

  test('50 件で切る', async () => {
    const { register, score, post, ranking } = setup();
    for (let i = 0; i < 55; i++) {
      const p = await register(`p${i}`);
      await post(p.token, score(100 + i, { kpm: 100 + i }));
    }
    for (const board of ['all', 'nicola']) {
      const res = await ranking(board);
      assert.equal(res.entries.length, 50, board);
      assert.equal(res.entries[0].score, 154, board);
      assert.equal(res.entries[49].score, 105, board);
    }
  });

  test('コースごとに別の表。自己ベスト・順位・1 位はそのコースの中だけで数える', async () => {
    const { register, score, post, ranking, clock } = setup();
    const a = await register('あ');
    const b = await register('い');
    await post(a.token, score(300, { kpm: 150 }));
    clock.ms += 1000;
    // いは 1 万点コースで高い点。3000 点コースの表と順位には影響しない
    const rb = await post(b.token, score(2000, { course: 'p10000', durationMs: 120_000, kpm: 200 }));
    assert.deepEqual(rb, { rank: 1, best: 2000, isBest: true, overallRank: 1, overallBest: 200 });
    clock.ms += 1000;
    // あの 1 万点コース初回は、3000 点コースの自己ベストに引きずられず isBest
    const ra = await post(a.token, score(100, { course: 'p10000', durationMs: 120_000, kpm: 100 }));
    assert.deepEqual(ra, { rank: 2, best: 100, isBest: true, overallRank: 2, overallBest: 100 });

    const p3000 = await ranking('all', 'all', 'p3000');
    assert.deepEqual(p3000.entries.map((e) => [e.nickname, e.score]), [['あ', 300]]);
    assert.deepEqual(p3000.leaders, { nicola: { nickname: 'あ', score: 300 }, romaji: null });
    const p10000 = await ranking('nicola', 'all', 'p10000');
    assert.equal(p10000.course, 'p10000');
    assert.deepEqual(p10000.entries.map((e) => [e.nickname, e.score]), [['い', 2000], ['あ', 100]]);
    assert.deepEqual((await ranking('all', 'all', 'p10000')).leaders, { nicola: { nickname: 'い', score: 2000 }, romaji: null });
    assert.deepEqual(await ranking('all', 'all', 'p5000'), { course: 'p5000', board: 'all', period: 'all', entries: [], leaders: { nicola: null, romaji: null } });
  });

  test('コース・表・期間が無い・違うなら 400', async () => {
    const { req } = setup();
    for (const query of [
      {}, { board: 'all' }, { course: 'otegaru', board: 'all' }, { course: 'P3000', board: 'all' },
      { course: 'p3000' }, { course: 'p3000', board: 'kana' }, { course: 'p3000', board: 'ALL' }, { course: 'p3000', board: 'all', period: 'year' },
    ]) {
      assert.equal((await req('GET', '/ranking', { query })).status, 400, JSON.stringify(query));
    }
  });

  test('boardSortKey の文字列降順は compareEntries の並びと一致する（DynamoDB 側の並び）', () => {
    const rows = [
      { score: 0, kpm: 300.5, at: '2026-11-02T00:00:00.000Z' },
      { score: 9, kpm: 99.9, at: '2026-11-02T00:00:00.000Z' },
      { score: 10, kpm: 100, at: '2026-11-02T00:00:00.000Z' },
      { score: 10, kpm: 100, at: '2026-11-01T00:00:00.000Z' },
      { score: 243360, kpm: 12.3, at: '2026-12-31T23:59:59.999Z' },
      { score: 243360, kpm: 600, at: '2026-01-01T00:00:00.000Z' },
    ];
    for (const by of ['score', 'kpm']) {
      const bySortKey = [...rows].sort((x, y) => {
        const a = boardSortKey(x, by);
        const b = boardSortKey(y, by);
        return a < b ? 1 : a > b ? -1 : 0;
      });
      assert.deepEqual(bySortKey, [...rows].sort((a, b) => compareEntries(a, b, by)), by);
    }
  });

  test('総合は毎分の順、部門は点数の順', () => {
    assert.equal(orderOf('all'), 'kpm');
    assert.equal(orderOf('nicola'), 'score');
    assert.equal(orderOf('romaji'), 'score');
  });
});

// ---------------------------------------------------------------- 削除

describe('削除', () => {
  test('本人の記録だけを全部消し、消した後の token は通らない', async () => {
    const { req, register, score, post, ranking, store } = setup();
    const a = await register('あ');
    const b = await register('い');
    await post(a.token, score(100));
    await post(a.token, score(50, { input: 'romaji' }));
    await post(a.token, score(500, { course: 'p10000', durationMs: 120_000 }));
    await post(b.token, score(80));
    // 3000 点：部門 2 × 期間 2 ＋ 総合 × 期間 2 ＝ 6、1 万点：部門 1 × 期間 2 ＋ 総合 × 期間 2 ＝ 4
    assert.equal([...store.bests.keys()].filter((k) => k.startsWith(a.playerId)).length, 10);

    const del = await req('DELETE', '/players/me', { token: a.token });
    assert.equal(del.status, 204);
    assert.equal(del.body, null);
    assert.equal(store.players.has(a.playerId), false);
    assert.ok([...store.bests.keys()].every((k) => !k.startsWith(a.playerId)));
    assert.ok(store.players.has(b.playerId));

    assert.equal((await req('POST', '/scores', { token: a.token, body: score(90) })).status, 401);
    assert.deepEqual((await ranking('all')).entries.map((e) => e.nickname), ['い']);
    assert.deepEqual((await ranking('all')).leaders, { nicola: { nickname: 'い', score: 80 }, romaji: null });

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
  const res = await api({ method: 'GET', path: '/ranking', query: { course: 'p3000', board: 'all' } });
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
