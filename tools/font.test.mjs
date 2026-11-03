#!/usr/bin/env node
/*
 * 筆字の書体に、サイトで使う字が全部入っているか。
 * 入っていない字はふつうのゴシックで出て、黙って混ざる（画面を見ないと気づけない）。
 * 落ちたら tools/font-chars.mjs の冒頭の手順で書体を作り直す。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { siteChars } from './font-chars.mjs';

const ROOT = resolve(import.meta.dirname, '..');

test('サイトで使う字は、筆字に入れた字の一覧（assets/fonts/chars.txt）に全部ある', () => {
  const have = new Set(readFileSync(join(ROOT, 'assets/fonts/chars.txt'), 'utf8'));
  const missing = [...siteChars()].filter((c) => !have.has(c));
  assert.deepEqual(missing, [], `筆字に無い字: ${missing.join('')}（tools/font-chars.mjs の手順で作り直す）`);
});
