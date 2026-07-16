/**
 * Unit tests for the caret remap used when a remote collab edit lands in a
 * focused textarea (client/lib/collab/textarea-merge.js). Pure string math —
 * the DOM wrapper is exercised in browser verification.
 *
 * Run with: node --test tests/collab-textarea-merge.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { remapOffset } from '../client/lib/collab/textarea-merge.js';

test('insertion before the caret shifts it right', () => {
  // "abc|def" → remote inserts "XY" at 0 → "XYabc|def"
  assert.equal(remapOffset('abcdef', 'XYabcdef', 3), 5);
});

test('insertion after the caret leaves it alone', () => {
  // "abc|def" → remote appends → caret stays
  assert.equal(remapOffset('abcdef', 'abcdefXY', 3), 3);
});

test('deletion before the caret shifts it left', () => {
  // "abXYc|d" → remote removes "XY" → "abc|d"
  assert.equal(remapOffset('abXYcd', 'abcd', 5), 3);
});

test('caret inside a replaced region clamps to the end of the replacement', () => {
  // "aa[OLD]bb" with caret inside OLD; remote replaces OLD with LONGERTEXT
  assert.equal(remapOffset('aaOLDbb', 'aaLONGERTEXTbb', 4), 12);
});

test('caret at the very start and very end', () => {
  assert.equal(remapOffset('hello', 'Xhello', 0), 0);
  assert.equal(remapOffset('hello', 'helloX', 5), 5);
  assert.equal(remapOffset('hello', 'Xhello', 5), 6);
});

test('identical strings are an identity mapping', () => {
  assert.equal(remapOffset('same', 'same', 2), 2);
});

test('typical co-typing: remote appends a line while caret is mid-text', () => {
  const cur = 'regel een\nregel twee';
  const next = 'regel een\nregel twee\nregel drie (remote)';
  assert.equal(remapOffset(cur, next, 9), 9);
});

test('out-of-range positions clamp safely', () => {
  // 99 clamps to the end of `cur` (2); the remote insertion sits exactly at
  // that position, and insertions at the caret keep the caret before them.
  assert.equal(remapOffset('ab', 'abXY', 99), 2);
  assert.equal(remapOffset('ab', 'ab', -5), 0);
});
