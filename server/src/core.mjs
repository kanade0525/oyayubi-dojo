// ランキング API の判断ロジック。DynamoDB も Lambda も知らない。
//
// なぜ分けているか。
//
// ・ここに入力検証・ニックネームの正規化・token の発行と照合・スコアの上限・順位の決め方・
//   ルーティングを全部置く。保存先はインターフェース（下の「ストアの約束」）として外から渡す。
//   こうしておくと、node:test から偽ストアを渡して全部の判断を AWS 抜きで検査できる。
//   @aws-sdk を import するのは store-dynamo.mjs だけ。このファイルは Node 標準だけで動く。
//
// ・token はサーバーにハッシュでしか残さない。漏れたテーブルから token を復元されないように、
//   ハッシュには環境変数の pepper を混ぜる（テーブルだけ盗まれても総当たりの起点が無い）。
//   token は 32 バイトの乱数なので、パスワードのような遅いハッシュは要らない。SHA-256 で足りる。
//
// ・token の形は「playerId.秘密」。Bearer だけでプレイヤーを引けるようにするため。
//   秘密の照合は timingSafeEqual で行う（一致した長さで処理時間が変わらないように）。
//
// ・スコアは「人間に出せない値」を弾く。上限は「コースの制限時間＋延長の上限」の間、
//   毎分 600 かな（親指シフトの上級者でも届かない速さ）で打ち続け、全部の字でそのコースの単価と
//   ぴったりの上乗せ（ローマ字には無い）を取った金額。これを超えたら改ざんと見なして 400 を返す。
//   正直に遊んだ人を誤って弾かないよう、上限はわざと緩めに取ってある。
//
// ・エラーは { error } の JSON とステータスコードで返す。想定外の例外は中身を返さず 500 にする
//   （スタックやテーブル名を外に見せない）。詳細はログにだけ出す。

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------- コースの数値
//
// assets/js/game/courses.js と揃えること。
// サーバーはブラウザのファイルを import できない（配置先が違う）ので、上限計算に要る数値だけを
// ここに写してある。courses.js 側で時間・単価・上乗せを上げたら、ここも同じだけ上げる。
// 下げる分には放っておいても害は無い（上限が緩いままになるだけ）。
// 上げ忘れると、正直に遊んだ上手な人のスコアが 400 で弾かれる。
// 写した値（2026-11-02 時点の courses.js）:
//   COURSES の timeMs、YEN_PER_KANA、PERFECT_BONUS、COMBO_STEP、COMBO_TIME_BONUS_MS

/** コースの id → { 制限時間（ms）, かな一字の単価（円） }。id はランキングの鍵なので三つで固定 */
export const COURSE_LIMITS = Object.freeze({
  otegaru: Object.freeze({ timeMs: 60_000, yenPerKana: 30 }),
  osusume: Object.freeze({ timeMs: 90_000, yenPerKana: 40 }),
  koukyu: Object.freeze({ timeMs: 120_000, yenPerKana: 45 }),
});
export const COURSE_IDS = Object.freeze(Object.keys(COURSE_LIMITS));

/** courses.js の PERFECT_BONUS（ぴったり一打ごとの上乗せ・円） */
export const PERFECT_BONUS = 20;
/** courses.js の COMBO_STEP（この打数ごとに延長） */
export const COMBO_STEP = 20;
/** courses.js の COMBO_TIME_BONUS_MS（一回の延長） */
export const COMBO_TIME_BONUS_MS = 1000;

/** 入力方式。ランキングは方式ごとの順位表と、両方を混ぜた順位表を持つ */
export const INPUTS = Object.freeze(['nicola', 'romaji']);
/** 順位表の絞り込み。all は両方を混ぜた表 */
export const BOARD_INPUTS = Object.freeze(['all', ...INPUTS]);

/** ぴったりの上乗せ（円）。ローマ字には同時打鍵が無いので上乗せも無い */
export function perfectBonusOf(input) {
  if (input === 'nicola') return PERFECT_BONUS;
  if (input === 'romaji') return 0;
  throw new Error(`未知の入力方式: ${input}`);
}

/** 人間の打鍵速度の上限（かな／分）。親指シフトの上級者でも続けては届かない速さ */
export const HUMAN_MAX_KPM = 600;

/** 遊んだ時間の測りのぶれ（ms）。終わりの判定はフレーム単位なので、少しだけ超えうる */
export const DURATION_SLACK_MS = 1000;

/**
 * 延長を含めた、遊べる時間の上限（ms）。
 *
 * 上限の速さで一度も間違えずに打ち続けると、遊んだ 1ms ごとに
 *   r = (HUMAN_MAX_KPM / 60000) × COMBO_TIME_BONUS_MS / COMBO_STEP
 * ms ずつ延長が付く（いまの値で r = 0.5）。延長で伸びた時間にもさらに延長が付くので、
 * 合計の時間 D は D ≤ 制限時間 + r × D を満たす。よって D ≤ 制限時間 / (1 − r)。
 * コンボの延長は 20 打目ちょうどで付く（端数は切り捨て）ので、この連続近似は必ず上側に外れる。
 * r が 1 以上だと延長が時間の流れに追いついて終わらないゲームになるので、起動時に止める。
 */
const EXTENSION_RATE = ((HUMAN_MAX_KPM / 60_000) * COMBO_TIME_BONUS_MS) / COMBO_STEP;
if (!(EXTENSION_RATE < 1)) throw new Error('延長が速すぎて上限の時間が決まらない（courses.js の値を確かめる）');

export function maxDurationMsOf(course) {
  const c = COURSE_LIMITS[course];
  if (!c) throw new Error(`未知のコース: ${course}`);
  return Math.ceil(c.timeMs / (1 - EXTENSION_RATE));
}

/**
 * コースごとの上限金額（円）。
 * 延長込みの時間いっぱい、上限の速さで打ち、全部の字で単価とぴったりの上乗せを取った金額。
 * 単語の途中で終わった字にはお金が入らないので、実際はこれより必ず低い。
 * 親指シフトはいまの値で お手軽 60,000円 / おすすめ 108,000円 / 高級 156,000円。
 * ローマ字は上乗せが無いぶん低い。
 */
export function maxMoneyOf(course, input) {
  const c = COURSE_LIMITS[course];
  if (!c) throw new Error(`未知のコース: ${course}`);
  const maxKana = Math.ceil((HUMAN_MAX_KPM * maxDurationMsOf(course)) / 60_000);
  return maxKana * (c.yenPerKana + perfectBonusOf(input));
}

// ---------------------------------------------------------------- 定数

export const RANKING_LIMIT = 50;
export const NICKNAME_MAX = 12;
export const CONSENT_VERSION_MAX = 32;
export const PERIODS = Object.freeze(['all', 'month']);
/** 本文の上限（バイト）。summary は数百バイトしかない。大きいものは読む前に断る */
export const BODY_MAX_BYTES = 4096;

// ---------------------------------------------------------------- エラー

/** 利用者に返してよいエラー。message はそのまま { error } に入る */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (message) => new HttpError(400, message);
const unauthorized = () => new HttpError(401, '登録が確認できません');

// ---------------------------------------------------------------- ニックネーム

/**
 * ニックネームを正規化する。通らなければ HttpError(400) を投げる。
 *
 * NFKC で全角英数・半角カナなどを寄せる（見た目が同じ別名で並ぶのを減らすため）。
 * 制御文字・書式文字（ゼロ幅・双方向制御を含む \p{C}）は、表示を崩したり
 * 空に見える名前を作れたりするので、置き換えずに拒否する。黙って消すと本人の意図と違う名前になる。
 * 長さはコードポイントで数える（絵文字一つを 2 と数えない）。
 */
export function normalizeNickname(raw) {
  if (typeof raw !== 'string') throw bad('ニックネームがありません');
  const s = raw.normalize('NFKC');
  if (/\p{C}/u.test(s)) throw bad('ニックネームに使えない文字が入っています');
  const name = s.trim().replace(/\s+/gu, ' ');
  const len = [...name].length;
  if (len === 0) throw bad('ニックネームが空です');
  if (len > NICKNAME_MAX) throw bad(`ニックネームは ${NICKNAME_MAX} 字までです`);
  return name;
}

// ---------------------------------------------------------------- token

export function hashSecret(secret, pepper) {
  return createHash('sha256').update(`${pepper}\u0000${secret}`).digest('hex');
}

/** 新しい token とそのハッシュを作る。token は本人にだけ一度返し、サーバーにはハッシュだけ残す */
export function issueToken(playerId, pepper) {
  const secret = randomBytes(32).toString('base64url');
  return { token: `${playerId}.${secret}`, tokenHash: hashSecret(secret, pepper) };
}

/** Authorization ヘッダから { playerId, secret } を取り出す。形が違えば 401 */
export function parseBearer(header) {
  const m = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(header ?? '');
  if (!m) throw unauthorized();
  return { playerId: m[1], secret: m[2] };
}

function sameHash(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------- スコア

const isInt = (v) => Number.isSafeInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 送られた summary を検証し、残す値だけを取り出す。
 * 残すのは順位表に出す数（money / kpm / accuracy）と入力方式、検算に使う durationMs だけ。
 * 入力方式は必須。無いものを親指シフト扱いにすると、ローマ字の記録が親指シフトの表に混ざる。
 */
export function validateScore(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('スコアの形が違います');
  const { course, input, money, kpm, accuracy, durationMs } = body;
  if (!COURSE_IDS.includes(course)) throw bad('コースが違います');
  if (!INPUTS.includes(input)) throw bad('入力方式が違います');
  if (!isInt(money) || money < 0) throw bad('金額が違います');
  if (!isNum(kpm) || kpm < 0) throw bad('打鍵速度が違います');
  if (!isNum(accuracy) || accuracy < 0 || accuracy > 1) throw bad('正確さが違います');
  if (!isInt(durationMs) || durationMs <= 0) throw bad('遊んだ時間が違います');

  // ありえない値。どれか一つでも超えたら記録しない
  if (durationMs > maxDurationMsOf(course) + DURATION_SLACK_MS) throw bad('ありえない記録です（時間）');
  if (kpm > HUMAN_MAX_KPM) throw bad('ありえない記録です（速さ）');
  if (money > maxMoneyOf(course, input)) throw bad('ありえない記録です（金額）');

  // 値どうしの突き合わせ。上の三つは一つずつ上限と比べるだけなので、
  // 「金額だけ上限ぴったり・速さ 1・時間 1ms」のような矛盾した組を通してしまう。
  // ゲームは時間切れでしか終わらない（途中でやめた回は送らない）ので、時間は制限時間を下回らない
  if (durationMs < COURSE_LIMITS[course].timeMs - DURATION_SLACK_MS) throw bad('ありえない記録です（時間が短い）');
  // 取った金額は「正しく打った字数 ×（一字の単価＋ぴったりの上乗せ）」を超えない。
  // 字数は kpm と時間から戻せる。送る側で時間を丸めるので一字ぶんの余裕を持たせる
  const kanaTyped = Math.ceil((kpm * durationMs) / 60_000 + 1);
  if (money > kanaTyped * (COURSE_LIMITS[course].yenPerKana + perfectBonusOf(input))) throw bad('ありえない記録です（速さと金額が合わない）');

  return { course, input, money, kpm: Math.round(kpm * 10) / 10, accuracy: Math.round(accuracy * 1000) / 1000 };
}

// ---------------------------------------------------------------- 期間と順位

/**
 * 月の区切りは日本時間で決める。遊ぶ人はほぼ日本にいるので、UTC で切ると
 * 「1日の朝9時まで先月扱い」になって説明がつかない。
 */
export function monthKey(date) {
  const jst = new Date(date.getTime() + 9 * 3600_000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** API の period（'all' | 'month'）を保存上の期間（'all' | 'YYYY-MM'）にする */
export function periodKey(period, date) {
  if (period === 'all') return 'all';
  if (period === 'month') return monthKey(date);
  throw bad('期間が違います');
}

/**
 * 順位の並び。金額の多い順、同額なら先に出した人が上。
 * 同額を同順位にしないのは、50 件で切ったときに境目が曖昧にならないようにするため。
 * 負なら a が上。
 */
export function compareEntries(a, b) {
  if (a.money !== b.money) return b.money - a.money;
  return Date.parse(a.at) - Date.parse(b.at);
}

/**
 * compareEntries と同じ並びになる文字列。DynamoDB の GSI のソートキーに使い、降順で引く。
 * 金額を前に 0 埋めし、後ろに「遠い未来 − 時刻」を 0 埋めして付けると、
 * 文字列の降順＝金額の降順、同額なら時刻の昇順になる。
 */
const FAR_FUTURE_MS = 9_999_999_999_999;
export function boardSortKey(money, at) {
  return `${String(money).padStart(10, '0')}#${String(FAR_FUTURE_MS - Date.parse(at)).padStart(13, '0')}`;
}

// ---------------------------------------------------------------- ストアの約束
//
// store は次を持つ（すべて async）。
//
//   createPlayer({ playerId, nickname, tokenHash, consentVersion, createdAt })
//   getPlayer(playerId)                         → { playerId, nickname, tokenHash } | null
//   putBestIfHigher(entry)                      → true（更新した）| false（自己ベストに届かない）
//       entry = { playerId, nickname, course, input, period, money, kpm, accuracy, at }
//       自己ベストはプレイヤー×コース×入力方式×期間で一つ。
//       「今の自己ベストより金額が多いときだけ書く」を一回の条件付き書き込みで行うこと。
//       読んでから書くと、同時に二つ送られたときに低い方が勝ちうる。
//       プレイヤーが消えていたら HttpError(401) を投げる（消した直後の送信で記録を蘇らせない）。
//   getBest(playerId, course, input, period)    → entry | null
//   countAhead(board, entry)                    → board の中で compareEntries により entry より上にいる件数
//   topEntries(board, limit)                    → board の中を compareEntries の順に上位 limit 件
//       board = { course, period, input }。input は BOARD_INPUTS のどれか（all は両方を混ぜた表。
//       同じ人が親指シフトとローマ字の二行で並びうる）
//   deletePlayer(playerId)                      → 本人のアイテムを全部消す

// ---------------------------------------------------------------- 各エンドポイント

async function authenticate(store, pepper, headers) {
  const { playerId, secret } = parseBearer(headers.authorization);
  const player = await store.getPlayer(playerId);
  if (!player || !sameHash(player.tokenHash, hashSecret(secret, pepper))) throw unauthorized();
  return player;
}

async function postPlayers(ctx, body) {
  if (!body || typeof body !== 'object') throw bad('本文の形が違います');
  // 同意は true ちょうどだけを認める。'true' や 1 を通すと、同意の記録として弱くなる
  if (body.consent !== true) throw bad('同意が必要です');
  const v = body.consentVersion;
  if (typeof v !== 'string' || v.length === 0 || v.length > CONSENT_VERSION_MAX || /\p{C}/u.test(v)) {
    throw bad('同意の版が違います');
  }
  const nickname = normalizeNickname(body.nickname);
  const playerId = randomUUID();
  const { token, tokenHash } = issueToken(playerId, ctx.pepper);
  await ctx.store.createPlayer({
    playerId,
    nickname,
    tokenHash,
    consentVersion: v,
    createdAt: ctx.now().toISOString(),
  });
  return { status: 201, body: { playerId, nickname, token } };
}

async function postScores(ctx, headers, body) {
  const player = await authenticate(ctx.store, ctx.pepper, headers);
  const score = validateScore(body);
  const now = ctx.now();
  const at = now.toISOString();

  // 通算と今月の両方に出す。月の自己ベストは通算を更新しなくても更新されうる
  let isBest = false;
  for (const period of ['all', monthKey(now)]) {
    const updated = await ctx.store.putBestIfHigher({
      playerId: player.playerId,
      nickname: player.nickname,
      course: score.course,
      period,
      ...score,
      at,
    });
    if (period === 'all') isBest = updated;
  }

  const best = await ctx.store.getBest(player.playerId, score.course, score.input, 'all');
  if (!best) throw new Error('自己ベストを書いた直後に読めない');
  // 順位は同じ入力方式の表の中で数える
  const rank = (await ctx.store.countAhead({ course: score.course, period: 'all', input: score.input }, best)) + 1;
  return { status: 200, body: { rank, best: best.money, isBest } };
}

async function getRanking(ctx, query) {
  const course = query.course;
  if (!COURSE_IDS.includes(course)) throw bad('コースが違います');
  const period = periodKey(query.period ?? 'all', ctx.now());
  const input = query.input;
  if (!BOARD_INPUTS.includes(input)) throw bad('入力方式が違います');
  const rows = await ctx.store.topEntries({ course, period, input }, RANKING_LIMIT);
  const entries = rows.map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    input: r.input,
    money: r.money,
    kpm: r.kpm,
    accuracy: r.accuracy,
    at: r.at,
  }));
  return { status: 200, body: { course, period, input, entries } };
}

async function deleteMe(ctx, headers) {
  const { playerId, secret } = parseBearer(headers.authorization);
  const player = await ctx.store.getPlayer(playerId);
  // もう居ないなら消し終わっている。二度押し・消した後の再送で失敗に見せない
  if (!player) return { status: 204, body: null };
  if (!sameHash(player.tokenHash, hashSecret(secret, ctx.pepper))) throw unauthorized();
  await ctx.store.deletePlayer(playerId);
  return { status: 204, body: null };
}

// ---------------------------------------------------------------- ルーティング

/**
 * API を組み立てる。
 *   store  … 上の「ストアの約束」を満たすもの
 *   pepper … token のハッシュに混ぜる秘密。短いものは起動時に断る（ダミー値のまま動かさない）
 *   now    … 現在時刻を返す関数。テストから時刻を固定するため
 * 返すのは handle({ method, path, headers, query, rawBody }) → { status, body }。
 * headers のキーは小文字で渡すこと（API Gateway v2 は小文字で渡してくる）。
 */
export function createApi({ store, pepper, now = () => new Date(), log = console }) {
  if (!store) throw new Error('store がありません');
  if (typeof pepper !== 'string' || pepper.length < 32 || pepper === 'CHANGE_ME') {
    throw new Error('TOKEN_PEPPER が未設定か短すぎます（32 字以上の乱数にする）');
  }
  const ctx = { store, pepper, now };

  async function route({ method, path, headers, query, rawBody }) {
    const json = () => {
      if (rawBody == null || rawBody === '') throw bad('本文がありません');
      if (Buffer.byteLength(rawBody, 'utf8') > BODY_MAX_BYTES) throw new HttpError(413, '本文が大きすぎます');
      try {
        return JSON.parse(rawBody);
      } catch {
        throw bad('本文が JSON ではありません');
      }
    };
    if (path === '/players' && method === 'POST') return postPlayers(ctx, json());
    if (path === '/scores' && method === 'POST') return postScores(ctx, headers, json());
    if (path === '/ranking' && method === 'GET') return getRanking(ctx, query);
    if (path === '/players/me' && method === 'DELETE') return deleteMe(ctx, headers);
    throw new HttpError(404, '見つかりません');
  }

  return async function handle(req) {
    try {
      return await route({ headers: {}, query: {}, ...req });
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      log.error(err);
      return { status: 500, body: { error: 'サーバーで問題が起きました' } };
    }
  };
}
