/**
 * The `h`-parameter gate (A7.33).
 *
 * `h()` — the hyperscript element factory — has exactly one implementation,
 * `client/lib/dom.js`. It used to reach the rest of the client as a
 * hand-threaded parameter in three spellings at once: positional
 * (`createModal(h, opts)`), an opt-in option with a default (`h = defaultH`),
 * and ~400 lines of `{ h, … }` pass-through across 167 modules. Every module
 * now imports it directly; this file pins the ESLint rule that keeps the
 * fourth spelling from starting.
 *
 * The allowlist is empty on purpose — including for `client/lib/dom.js`
 * itself, where the factory is a function *declaration*, never a parameter.
 *
 * Run with: node --test tests/h-parameter-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const H_MESSAGE = /Import `h` from client\/lib\/dom\.js/;

async function lintProbe(code, relPath) {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relPath),
  });
  return result.messages.filter(
    (m) => m.ruleId === 'no-restricted-syntax' && H_MESSAGE.test(m.message),
  );
}

const PROBE = 'client/views/h-gate-probe.js';

const RESTRICTED = [
  ['a positional parameter', "export const f = (h, x) => h('div', x);\n"],
  ['a destructured parameter', "export const f = ({ h, x }) => h('div', x);\n"],
  [
    'a destructured parameter with a default',
    "export const f = ({ h, x } = {}) => h('div', x);\n",
  ],
  [
    'destructured out of a context object',
    "export const f = (ctx) => {\n  const { h, x } = ctx;\n  return h('div', x);\n};\n",
  ],
  [
    'a shorthand property handed to someone else',
    "import { h } from '../../lib/dom.js';\nexport const f = () => ({ h });\n",
  ],
];

for (const [label, code] of RESTRICTED) {
  test(`gate: \`h\` as ${label} is a lint error`, async () => {
    const messages = await lintProbe(code, PROBE);
    assert.equal(
      messages.length,
      1,
      `expected the h-threading error, got: ${JSON.stringify(messages)}`,
    );
  });
}

test('gate: whole-token — `hue`, `height` and `hsl` are untouched', async () => {
  const messages = await lintProbe(
    'export const f = (hue, height) => ({ hsl: hue + height });\n',
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: a geometry `{ h: rowH }` stays legal', async () => {
  const messages = await lintProbe(
    'export const f = (rowH) => ({ h: rowH, w: 1 });\n',
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: no allowlist — it is in force inside lib/dom itself', async () => {
  for (const file of ['client/lib/dom.js', 'client/lib/dom/modal.js']) {
    const messages = await lintProbe(
      'export const f = ({ h }) => h("div");\n',
      file,
    );
    assert.equal(messages.length, 1, `${file} must not be exempt`);
  }
});

test('gate: the client is clean — the burndown is finished', async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const results = await eslint.lintFiles(['client']);
  const hits = results.flatMap((r) =>
    r.messages
      .filter(
        (m) => m.ruleId === 'no-restricted-syntax' && H_MESSAGE.test(m.message),
      )
      .map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line}`),
  );
  assert.deepEqual(hits, []);
});
