import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envStr, envBool, envInt, envList } from '../server/config/utils.js';

/**
 * The env accessor family (server/config/utils.js) is the one way server code
 * reads configuration. These tests pin the family contract itself, so a
 * behaviour change there is a deliberate, test-visible act — in particular
 * envBool's "unrecognized value → fallback" rule, which is what keeps a typo'd
 * security flag (AUTH_ENABLED=fasle) on the safe side of its default.
 */

const VAR = 'TEST_ACCESSOR_VAR';

function withVar(value, fn) {
  const saved = process.env[VAR];
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[VAR];
    else process.env[VAR] = saved;
  }
}

test('envStr: trims; unset or blank → fallback', () => {
  withVar('  hello ', () => assert.equal(envStr(VAR), 'hello'));
  withVar(undefined, () => assert.equal(envStr(VAR, 'fb'), 'fb'));
  withVar('   ', () => assert.equal(envStr(VAR, 'fb'), 'fb'));
  withVar('', () => assert.equal(envStr(VAR), ''));
});

test('envBool: recognized truthy tokens → true, any case', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' On ']) {
    withVar(v, () => assert.equal(envBool(VAR), true, `value ${v}`));
  }
});

test('envBool: recognized falsy tokens → false, even with fallback true', () => {
  for (const v of ['0', 'false', 'FALSE', 'no', 'off', ' Off ']) {
    withVar(v, () => assert.equal(envBool(VAR, true), false, `value ${v}`));
  }
});

test('envBool: unset, blank, or unrecognized → fallback', () => {
  for (const v of [undefined, '', '   ', 'banana', 'fasle', '2']) {
    withVar(v, () => {
      assert.equal(envBool(VAR, true), true, `value ${String(v)} fb=true`);
      assert.equal(envBool(VAR, false), false, `value ${String(v)} fb=false`);
      assert.equal(envBool(VAR), false, `value ${String(v)} no fb`);
    });
  }
});

test('envInt: parses, floors, bounds → fallback when violated', () => {
  withVar('42', () => assert.equal(envInt(VAR, 7), 42));
  withVar('12.9', () => assert.equal(envInt(VAR, 7), 12));
  withVar(undefined, () => assert.equal(envInt(VAR, 7), 7));
  withVar('nope', () => assert.equal(envInt(VAR, 7), 7));
  withVar('0', () => assert.equal(envInt(VAR, 7, { min: 1 }), 7));
  withVar('999', () => assert.equal(envInt(VAR, 7, { max: 100 }), 7));
});

test('envList: splits on comma/whitespace, lowercases, dedupes', () => {
  withVar('A, b  c,a', () => assert.deepEqual(envList(VAR), ['a', 'b', 'c']));
  withVar(undefined, () => assert.deepEqual(envList(VAR), []));
});
