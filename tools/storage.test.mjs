#!/usr/bin/env node
/*
 * assets/js/storage.js のうち、覚えるのレッスンの記録（recordLessonRun）の単体テスト。
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
const { recordLessonRun, loadStats } = await import(pathToFileURL(join(ROOT, 'assets/js/storage.js')).href);

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
