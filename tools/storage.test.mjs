#!/usr/bin/env node
/*
 * assets/js/storage.js のうち、覚えるのレッスンの記録（recordLessonRun）と、
 * タイピングゲームの記録（recordGameRun）の単体テスト。
 *
 * レッスンは速さを測らない場所なので、ゆっくり正確に打った一本が «鍛える» の自己ベスト・段位・
 * 履歴に混ざってはいけない（前は recordRun に通していて混ざっていた）。それを見る。
 * localStorage はブラウザにしか無いので、Map で代わりを置いてから読み込む。
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const ROOT = resolve(import.meta.dirname, '..');
const { recordLessonRun, loadStats, recordGameRun, loadGameBest, loadGameHistory, exportAll, clearAll, loadSeen, saveSeen } = await import(pathToFileURL(join(ROOT, 'assets/js/storage.js')).href);

describe('recordLessonRun', () => {
  beforeEach(() => mem.clear());

  test('進み具合とキー×面の当たり外れだけを残し、段位・自己ベスト・履歴・通算は動かさない', () => {
    const before = loadStats();
    recordLessonRun({ lessonId: 'l-home-1~pairs', faceHits: { 'KeyF:none': 5 }, faceMisses: { 'KeyK:none': 2 } });
    const s = loadStats();
    assert.equal(s.cleared['l-home-1~pairs'], 1);
    assert.equal(s.faceHits['KeyF:none'], 5);
    assert.equal(s.faceMisses['KeyK:none'], 2);
    assert.equal(s.rank, before.rank);
    assert.deepEqual(s.best, before.best);
    assert.equal(s.history.length, 0);
    assert.equal(s.runs, before.runs);
    assert.equal(s.kana, before.kana);
    assert.equal(s.score, before.score);
  });

  test('確認に届かなかった一本は «終えた» にしない', () => {
    recordLessonRun({ lessonId: 'l-home-1~check', passed: false, faceMisses: { 'KeyK:none': 4 } });
    const s = loadStats();
    assert.equal(s.cleared['l-home-1~check'] ?? 0, 0);
    assert.equal(s.faceMisses['KeyK:none'], 4);
  });
});

describe('recordGameRun', () => {
  beforeEach(() => mem.clear());
  const run = (o) => ({ course: 'p3000', input: 'nicola', speed: 'normal', score: 3000, balance: 0, keysPerSec: 2, misses: 1, cleared: 20, kpm: 100, ...o });

  test('回は速さを問わず新しい順に残し、自己ベストは «普通» の回だけ', () => {
    assert.deepEqual(recordGameRun(run({ score: 3100 }), 1), { isBest: true, prev: null });
    assert.deepEqual(recordGameRun(run({ score: 9000, speed: 'practice' }), 2), { isBest: false, prev: null });
    const r = recordGameRun(run({ score: 3050 }), 3);
    assert.equal(r.isBest, false);
    assert.equal(loadGameBest().nicola.p3000.score, 3100);
    assert.deepEqual(loadGameHistory().map((h) => [h.at, h.speed, h.score]), [[3, 'normal', 3050], [2, 'practice', 9000], [1, 'normal', 3100]]);
  });

  test('入力方式・速さが分からない結果は黙って残さず throw', () => {
    assert.throws(() => recordGameRun(run({ input: 'kana' })));
    assert.throws(() => recordGameRun(run({ speed: undefined })));
    assert.equal(loadGameHistory().length, 0);
  });

  test('書き出しに入り、全部消すで消える（記録の画面と同じところを見る）', () => {
    recordGameRun(run({}), 1);
    const out = JSON.parse(exportAll());
    assert.equal(out.game.history.length, 1);
    assert.equal(out.game.best.nicola.p3000.score, 3000);
    clearAll();
    assert.equal(loadGameHistory().length, 0);
    assert.deepEqual(loadGameBest(), { nicola: {}, romaji: {} });
  });
});

describe('門の «前回から» の控え', () => {
  beforeEach(() => mem.clear());

  test('一度も来ていなければ null。残した控えをそのまま読み、全部消すで消える', () => {
    assert.equal(loadSeen(), null);
    saveSeen({ at: 1, keys: 120, earned: ['m-first'] });
    assert.deepEqual(loadSeen(), { at: 1, keys: 120, earned: ['m-first'] });
    clearAll();
    assert.equal(loadSeen(), null);
  });

  test('控えが無いのに残そうとしたら落ちる', () => {
    assert.throws(() => saveSeen(null), /控えが無い/);
  });

  test('ゲームの回に打ち切ったキーの数を残す（門の打鍵数に足す）', () => {
    recordGameRun({ course: 'p3000', input: 'nicola', speed: 'normal', score: 3000, balance: 0, keysPerSec: 2, misses: 1, cleared: 20, kpm: 100, correctKeys: 240 }, 1);
    assert.equal(loadGameHistory()[0].keys, 240);
  });
});
