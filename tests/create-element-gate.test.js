/**
 * The `document.createElement` gate (B150).
 *
 * `h()` from `client/lib/dom.js` is CLAUDE.md's first frontend rule and was the
 * one client convention without mechanical backing: `h` imported in 302 files,
 * `document.createElement` alive in 14 — mostly one head-asset recipe written
 * five times, whose copies had drifted on the `id` the dedupe hangs on. This
 * file pins the ESLint rule that keeps the second form from growing back.
 *
 * Two files are exempt: `client/lib/dom.js`, where the factory is implemented,
 * and `client/embed-sdk.js`, the standalone IIFE served to third-party pages,
 * which has no module graph to import from.
 *
 * Run with: node --test tests/create-element-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const MESSAGE = /Build elements with h\(\) from client\/lib\/dom\.js/;

async function lintProbe(code, relPath) {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relPath),
  });
  return result.messages.filter(
    (m) => m.ruleId === 'no-restricted-syntax' && MESSAGE.test(m.message),
  );
}

const PROBE = 'client/views/create-element-gate-probe.js';

const RESTRICTED = [
  [
    'a plain element',
    "export const f = () => document.createElement('div');\n",
  ],
  [
    'a head asset',
    "export function f() {\n  const s = document.createElement('style');\n  document.head.append(s);\n}\n",
  ],
  [
    'an offscreen canvas',
    "export const f = () => document.createElement('canvas');\n",
  ],
];

for (const [label, code] of RESTRICTED) {
  test(`gate: document.createElement for ${label} is a lint error`, async () => {
    const messages = await lintProbe(code, PROBE);
    assert.equal(
      messages.length,
      1,
      `expected the createElement error, got: ${JSON.stringify(messages)}`,
    );
  });
}

test('gate: createElementNS stays legal — h() and likert.js both need it', async () => {
  const messages = await lintProbe(
    'export const f = (ns, tag) => document.createElementNS(ns, tag);\n',
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: a `createElement` on something that is not `document` is untouched', async () => {
  const messages = await lintProbe(
    "export const f = (doc) => doc.createElement('div');\n",
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: exactly two files are exempt', async () => {
  const code = "export const f = () => document.createElement('div');\n";
  for (const file of ['client/lib/dom.js', 'client/embed-sdk.js']) {
    assert.deepEqual(await lintProbe(code, file), [], `${file} must be exempt`);
  }
  for (const file of [
    'client/lib/dom/modal.js',
    'client/lib/dom/head-assets.js',
    'client/lib/user/organization-role.js',
    'client/lib/theme/font-assets.js',
  ]) {
    const messages = await lintProbe(code, file);
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
        (m) => m.ruleId === 'no-restricted-syntax' && MESSAGE.test(m.message),
      )
      .map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line}`),
  );
  assert.deepEqual(hits, []);
});
