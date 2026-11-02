// タイピングゲーム（題材は検品ライン）のランキング。このアプリで唯一、外へ通信するファイル。
//
// なぜこの形か。
//
// ・送るのはニックネームとスコア（コース・入力方式・点数・速さ・正確さ・遊んだ時間）だけ。
//   メールアドレスや本名は取らない。手元の練習記録（storage.js）は一切送らない。
//   summary から送る項目をここで拾い直しているのは、summary に項目が増えたときに
//   黙って外へ出ていかないようにするため。
//
// ・失敗は全部 throw する。握りつぶして空配列を返すと、画面が「ランキングが空」と
//   「つながらない」を区別できなくなる。投げるのは RankingError で、status（HTTP の
//   ステータス。つながらなかったときは 0）を持たせてある。
//
// ・登録は手元の localStorage（oyayubi-dojo:player:v1）に { playerId, nickname, token } で残す。
//   token は本人の証明なので画面には出さない。currentPlayer() も token を返さない。
//   localStorage は全アクセスを try/catch で包む（読めなくても遊べる。登録が無い扱いになる）。
//
// ・RANKING_API_URL が空なら通信しない。呼ばれたら throw する（画面は rankingEnabled() で先に分ける）。

import { RANKING_API_URL } from './config.js';

/** 同意文の版。同意文を変えたら上げる。サーバーに登録と一緒に残る */
export const CONSENT_VERSION = '2026-11-02-2';

const PLAYER_KEY = 'oyayubi-dojo:player:v1';
const INPUTS = ['nicola', 'romaji'];
/** 表は三つ。all は総合（速さの順）、ほかは入力方式ごとの部門（点数の順）。どれも一人一行 */
const BOARDS = ['all', ...INPUTS];
const TIMEOUT_MS = 10_000;

export class RankingError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'RankingError';
    this.status = status;
  }
}

export function rankingEnabled() {
  return RANKING_API_URL !== '';
}

// ---------------------------------------------------------------- 手元の登録

function loadPlayer() {
  let raw = null;
  try {
    raw = localStorage.getItem(PLAYER_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p.playerId === 'string' && typeof p.nickname === 'string' && typeof p.token === 'string') return p;
  } catch {
    // 壊れた値は「登録なし」として扱う。遊ぶのは止めない
  }
  return null;
}

function savePlayer(p) {
  try {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

function dropPlayer() {
  try {
    localStorage.removeItem(PLAYER_KEY);
    return true;
  } catch {
    return false;
  }
}

/** { playerId, nickname } | null。token は返さない */
export function currentPlayer() {
  const p = loadPlayer();
  return p ? { playerId: p.playerId, nickname: p.nickname } : null;
}

// ---------------------------------------------------------------- 通信

async function call(method, path, { body, token } = {}) {
  if (!rankingEnabled()) throw new RankingError('ランキングは準備中です');
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${RANKING_API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (err) {
    throw new RankingError(`ランキングにつながりませんでした（${err?.name ?? '不明'}）`, 0);
  }

  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new RankingError(`ランキングの応答が読めませんでした（${res.status}）`, res.status);
  }
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : `ランキングでエラーが起きました（${res.status}）`;
    throw new RankingError(msg, res.status);
  }
  return data;
}

// ---------------------------------------------------------------- 公開する操作

/** 同意して登録する。consent が true ちょうどでなければ送らずに throw */
export async function register({ nickname, consent }) {
  if (consent !== true) throw new RankingError('同意が無いので登録しません');
  if (typeof nickname !== 'string' || nickname.trim() === '') throw new RankingError('ニックネームを入れてください');
  // 二重に登録すると手元の token が上書きされ、先の登録の記録をこの端末から消せなくなる
  if (loadPlayer()) throw new RankingError('この端末はもう参加しています');

  const data = await call('POST', '/players', {
    body: { nickname, consent: true, consentVersion: CONSENT_VERSION },
  });
  const player = { playerId: data.playerId, nickname: data.nickname, token: data.token };

  // 手元に残せないと、次からスコアを送れず、消すこともできない登録になる。
  // サーバー側を消してから失敗を伝える（消せなかったらその旨も伝える）
  if (!savePlayer(player)) {
    try {
      await call('DELETE', '/players/me', { token: player.token });
    } catch {
      throw new RankingError('この端末に登録を残せませんでした。サーバーの登録も消せていません');
    }
    throw new RankingError('この端末に登録を残せませんでした（ブラウザの保存が使えない状態です）');
  }
  return { playerId: player.playerId, nickname: player.nickname };
}

/**
 * 結果を送る。登録済みでなければ throw。
 * → { rank, best, isBest, overallRank, overallBest }（rank / best は部門、overall は総合の速さ）
 */
export async function submitScore(summary) {
  const p = loadPlayer();
  if (!p) throw new RankingError('ランキングに登録していません');
  const { course, input, score, kpm, accuracy, durationMs } = summary;
  if (!INPUTS.includes(input)) throw new RankingError(`入力方式が違います: ${input}`);
  try {
    return await call('POST', '/scores', {
      token: p.token,
      body: { course, input, score, kpm, accuracy, durationMs: Math.round(durationMs) },
    });
  } catch (err) {
    // 401 は «サーバーにこの登録が無い»。手元の登録を捨てて、参加し直せるようにする
    if (err instanceof RankingError && err.status === 401) {
      dropPlayer();
      throw new RankingError('登録が見つかりません。もう一度参加してください', 401);
    }
    throw err;
  }
}

/**
 * 順位表。course はコースの id、board は 'all'（総合）| 'nicola' | 'romaji'、period は 'all' | 'month'。
 * → { entries: [{ rank, nickname, input, score, kpm, accuracy, at }], leaders }
 *   leaders は総合のときだけ（そのコースの） { nicola: { nickname, score } | null, romaji: … }（各部門の 1 位）
 */
export async function fetchRanking({ course, board, period = 'all' }) {
  if (period !== 'all' && period !== 'month') throw new RankingError(`期間が違います: ${period}`);
  if (!BOARDS.includes(board)) throw new RankingError(`表が違います: ${board}`);
  if (typeof course !== 'string' || !course) throw new RankingError('コースがありません');
  const q = new URLSearchParams({ course, board, period });
  const data = await call('GET', `/ranking?${q}`);
  if (!Array.isArray(data?.entries)) throw new RankingError('ランキングの応答の形が違います');
  return { entries: data.entries, leaders: data.leaders ?? null };
}

/** サーバーの記録を全部消し、手元の登録も消す */
export async function forgetMe() {
  const p = loadPlayer();
  if (!p) throw new RankingError('この端末には登録がありません');
  await call('DELETE', '/players/me', { token: p.token });
  if (!dropPlayer()) throw new RankingError('サーバーの記録は消しました。この端末の登録が消せませんでした');
}
