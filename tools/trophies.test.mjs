#!/usr/bin/env node
/*
 * 実績の格（メダル）と進み具合、白金（x-all）の開き方の検査。
 * 格の無い実績はメダルの色が決まらず、medal.js が既定の銅で描いてしまう（取り違えに気づけない）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TROPHIES, TIERS, progressOf, newlyEarned } from '../assets/js/trophies.js';

test('全実績に格があり、白金はちょうど一つ', () => {
  const ids = new Set(TIERS.map((t) => t.id));
  assert.deepEqual(TROPHIES.filter((t) => !ids.has(t.tier)).map((t) => t.id), []);
  assert.equal(TROPHIES.filter((t) => t.tier === 'platinum').length, 1);
});

test('進み具合は 0〜目標に収まる', () => {
  const stats = { keystrokes: 250000, streak: 2, days: [], earned: {}, timing: { perfect: 7 }, shiftHits: { cross: 3 } };
  for (const t of TROPHIES) {
    const p = progressOf(t, stats);
    if (!p) continue;
    assert.ok(p.now >= 0 && p.now <= p.goal, `${t.id}: ${p.now} / ${p.goal}`);
  }
  assert.deepEqual(progressOf(TROPHIES.find((t) => t.id === 'm-keys100k'), stats), { now: 100000, goal: 100000 });
});

test('最後の一つを取った回に、白金も一緒に開く', () => {
  const last = TROPHIES.find((t) => t.id === 'm-first');
  const earned = Object.fromEntries(TROPHIES.filter((t) => t.id !== 'x-all' && t !== last).map((t) => [t.id, '2026-11-02']));
  const got = newlyEarned({ runs: 1, earned, best: {}, timing: {}, days: [] }).map((t) => t.id);
  assert.ok(got.includes('m-first'), '最後の一つが取れていない');
  assert.ok(got.includes('x-all'), '白金が同じ回に開かない');
});

test('ほかが残っていれば白金は開かない', () => {
  const got = newlyEarned({ runs: 1, earned: {}, best: {}, timing: {}, days: [] }).map((t) => t.id);
  assert.ok(!got.includes('x-all'));
});
