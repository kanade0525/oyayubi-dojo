#!/usr/bin/env node
/*
 * ゲームの効果音（assets/js/game/sfx.js）の検査。
 *
 * 音そのものは耳でしか確かめられないが、«鳴らすつもりの所で音の部品を組んでいるか» と
 * «切ったら何も組まないか» は数えられる。AudioContext の偽物を渡して、作られた発音体を数える。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSfx } from '../assets/js/game/sfx.js';

function fakeAudio() {
  const made = { osc: 0, noise: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect: (n) => n, gain: param(), frequency: param(), Q: param() });
  class AC {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = node(); }
    resume() { this.state = 'running'; }
    suspend() { this.state = 'suspended'; }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createOscillator() { made.osc++; return { ...node(), type: '', start() {}, stop() {} }; }
    createBuffer(_c, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { made.noise++; return { ...node(), buffer: null, start() {} }; }
  }
  return { AC, made };
}

function withAudio(fn) {
  const { AC, made } = fakeAudio();
  const prev = globalThis.AudioContext;
  globalThis.AudioContext = AC;
  try {
    fn(made);
  } finally {
    globalThis.AudioContext = prev;
  }
}

test('既定で鳴らす：出来事ごとに発音体を組む', () => {
  withAudio((made) => {
    const sfx = createSfx({ on: true });
    assert.equal(sfx.available, true);
    for (const call of [() => sfx.take(), () => sfx.take({ perfect: true }), () => sfx.lost(), () => sfx.combo(), () => sfx.tick(5), () => sfx.count(3), () => sfx.count(0), () => sfx.end()]) {
      const before = made.osc + made.noise;
      call();
      assert.ok(made.osc + made.noise > before, `${call} で音が組まれていない`);
    }
  });
});

test('切ったら何も組まない', () => {
  withAudio((made) => {
    const sfx = createSfx({ on: false });
    sfx.take();
    sfx.end();
    assert.equal(made.osc + made.noise, 0);
    sfx.setEnabled(true);
    sfx.lost();
    assert.ok(made.osc > 0, '入れ直したのに鳴らない');
  });
});

test('AudioContext の無い環境では available が false で、入れても鳴らそうとしない', () => {
  const prev = globalThis.AudioContext;
  delete globalThis.AudioContext;
  try {
    const sfx = createSfx({ on: true });
    assert.equal(sfx.available, false);
    assert.equal(sfx.enabled, false);
    sfx.setEnabled(true);
    assert.equal(sfx.enabled, false);
    sfx.take();
  } finally {
    if (prev) globalThis.AudioContext = prev;
  }
});
